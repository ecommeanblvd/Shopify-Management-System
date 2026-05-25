'use server';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface MatrixCell {
  zoneId: string;
  tierId: string;
  costAmount: string | null;
  updatedAt: Date | null;
}

export interface MatrixSnapshot {
  zones: { id: string; label: string; position: number }[];
  tiers: { id: string; upperKg: string; position: number }[];
  cells: MatrixCell[];
}

export async function loadMatrix(carrierAccountId: string): Promise<MatrixSnapshot> {
  const zones = await db
    .select({
      id: schema.carrierZones.id,
      label: schema.carrierZones.label,
      position: schema.carrierZones.position,
    })
    .from(schema.carrierZones)
    .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId))
    .orderBy(asc(schema.carrierZones.position), asc(schema.carrierZones.label));

  const tiers = await db
    .select({
      id: schema.carrierWeightTiers.id,
      upperKg: schema.carrierWeightTiers.upperKg,
      position: schema.carrierWeightTiers.position,
    })
    .from(schema.carrierWeightTiers)
    .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId))
    .orderBy(asc(sql`(${schema.carrierWeightTiers.upperKg})::numeric`));

  if (zones.length === 0 || tiers.length === 0) {
    return { zones, tiers, cells: [] };
  }

  const zoneIds = zones.map((z) => z.id);
  const cellRows = await db
    .select({
      zoneId: schema.carrierRateCells.carrierZoneId,
      tierId: schema.carrierRateCells.carrierWeightTierId,
      costAmount: schema.carrierRateCells.costAmount,
      updatedAt: schema.carrierRateCells.updatedAt,
    })
    .from(schema.carrierRateCells)
    .where(inArray(schema.carrierRateCells.carrierZoneId, zoneIds));

  const cells: MatrixCell[] = cellRows.map((r) => ({
    zoneId: r.zoneId,
    tierId: r.tierId,
    costAmount: r.costAmount,
    updatedAt: r.updatedAt,
  }));

  return { zones, tiers, cells };
}

export async function setCell({
  zoneId, tierId, costAmount, userId,
}: { zoneId: string; tierId: string; costAmount: string; userId: string }): Promise<void> {
  const n = Number(costAmount);
  if (!Number.isFinite(n) || n < 0) throw new Error('Cost must be a non-negative number.');

  await db
    .insert(schema.carrierRateCells)
    .values({
      carrierZoneId: zoneId,
      carrierWeightTierId: tierId,
      costAmount: n.toFixed(2),
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: [schema.carrierRateCells.carrierZoneId, schema.carrierRateCells.carrierWeightTierId],
      set: { costAmount: n.toFixed(2), updatedBy: userId, updatedAt: new Date() },
    });
}

export async function clearCell({ zoneId, tierId }: { zoneId: string; tierId: string }): Promise<void> {
  await db.delete(schema.carrierRateCells).where(and(
    eq(schema.carrierRateCells.carrierZoneId, zoneId),
    eq(schema.carrierRateCells.carrierWeightTierId, tierId),
  ));
}

export interface MatrixCsvRow {
  upperKg: number;
  rates: { zoneLabel: string; cost: number }[];
}

export interface ParsedMatrixCsv {
  zoneLabels: string[];
  rows: MatrixCsvRow[];
  warnings: string[];
}

/**
 * Parses a rate matrix CSV string. Expected shape:
 *
 *   ,Zone 1,Zone 2,Zone 3
 *   0.5,180000,210000,260000
 *   1.0,260000,310000,380000
 *
 * Header row first cell is ignored. Empty cells produce no rate entry for that
 * (zone, tier) pair (caller decides whether to clear or skip).
 */
export function parseMatrixCsv(csv: string): ParsedMatrixCsv {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { zoneLabels: [], rows: [], warnings: ['CSV is empty'] };

  const warnings: string[] = [];

  const header = splitCsvLine(lines[0]);
  if (header.length < 2) warnings.push('Header row has no zone columns');
  const zoneLabels = header.slice(1).map((s) => s.trim()).filter((s) => s.length > 0);

  const rows: MatrixCsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length === 0) continue;
    const upperRaw = cells[0]?.trim() ?? '';
    if (!upperRaw) continue;
    const upper = Number(upperRaw);
    if (!Number.isFinite(upper) || upper <= 0) {
      warnings.push(`Row ${i + 1}: weight "${upperRaw}" is not a positive number — skipped`);
      continue;
    }
    const rates: { zoneLabel: string; cost: number }[] = [];
    for (let z = 0; z < zoneLabels.length; z += 1) {
      const raw = cells[z + 1]?.trim() ?? '';
      if (!raw) continue;
      const n = Number(raw.replace(/[,_\s]/g, ''));
      if (!Number.isFinite(n) || n < 0) {
        warnings.push(`Row ${i + 1}, column "${zoneLabels[z]}": "${raw}" is not a non-negative number — skipped`);
        continue;
      }
      rates.push({ zoneLabel: zoneLabels[z], cost: n });
    }
    rows.push({ upperKg: upper, rates });
  }

  return { zoneLabels, rows, warnings };
}

function splitCsvLine(line: string): string[] {
  // Minimal CSV splitter — no quoted fields support. Sufficient for numeric rate sheets.
  return line.split(',');
}

/**
 * Imports a parsed CSV into the account, creating missing zones and tiers as
 * needed. Returns counts and warnings. Caller has already validated user
 * permission. Idempotent on cell upsert.
 */
export async function importMatrix(
  carrierAccountId: string,
  parsed: ParsedMatrixCsv,
  userId: string,
): Promise<{ zonesCreated: number; tiersCreated: number; cellsWritten: number; warnings: string[] }> {
  const warnings = [...parsed.warnings];

  // 1. Resolve / create zones by label
  const existingZones = await db
    .select()
    .from(schema.carrierZones)
    .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId));
  const zoneByLabel = new Map(existingZones.map((z) => [z.label, z]));

  let zonesCreated = 0;
  for (const label of parsed.zoneLabels) {
    if (zoneByLabel.has(label)) continue;
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${schema.carrierZones.position}), -1) + 1` })
      .from(schema.carrierZones)
      .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId));
    const [row] = await db
      .insert(schema.carrierZones)
      .values({ carrierAccountId, label, position: next })
      .returning();
    zoneByLabel.set(label, row);
    zonesCreated += 1;
  }

  // 2. Resolve / create weight tiers by upperKg
  const existingTiers = await db
    .select()
    .from(schema.carrierWeightTiers)
    .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId));
  const tierByUpper = new Map(existingTiers.map((t) => [Number(t.upperKg), t]));

  let tiersCreated = 0;
  for (const row of parsed.rows) {
    if (tierByUpper.has(row.upperKg)) continue;
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${schema.carrierWeightTiers.position}), -1) + 1` })
      .from(schema.carrierWeightTiers)
      .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId));
    const [t] = await db
      .insert(schema.carrierWeightTiers)
      .values({ carrierAccountId, upperKg: row.upperKg.toString(), position: next })
      .returning();
    tierByUpper.set(row.upperKg, t);
    tiersCreated += 1;
  }

  // 3. Upsert cells
  let cellsWritten = 0;
  for (const row of parsed.rows) {
    const tier = tierByUpper.get(row.upperKg);
    if (!tier) continue;
    for (const r of row.rates) {
      const zone = zoneByLabel.get(r.zoneLabel);
      if (!zone) {
        warnings.push(`Zone "${r.zoneLabel}" not resolved — cell skipped`);
        continue;
      }
      await db
        .insert(schema.carrierRateCells)
        .values({
          carrierZoneId: zone.id,
          carrierWeightTierId: tier.id,
          costAmount: r.cost.toFixed(2),
          updatedBy: userId,
        })
        .onConflictDoUpdate({
          target: [schema.carrierRateCells.carrierZoneId, schema.carrierRateCells.carrierWeightTierId],
          set: { costAmount: r.cost.toFixed(2), updatedBy: userId, updatedAt: new Date() },
        });
      cellsWritten += 1;
    }
  }

  return { zonesCreated, tiersCreated, cellsWritten, warnings };
}
