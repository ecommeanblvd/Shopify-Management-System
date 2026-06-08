'use server';

import { asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export type SurchargeKind = typeof schema.carrierSurchargeKindEnum.enumValues[number];

export interface SurchargeRow {
  id: string;
  kind: SurchargeKind;
  value: string;
  valuePerKg: string | null;
  tier: string | null;
  /** ISO-2 country codes scoping `demand_per_kg`. NULL → applies globally. */
  countryCodes: string[] | null;
  active: boolean;
  note: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  updatedAt: Date;
  /** Set when a scraper/cron wrote this row (e.g. FedEx fuel weekly refresh). */
  lastAutoFetchedAt: Date | null;
  lastAutoSource: string | null;
}

export async function listSurcharges(carrierAccountId: string): Promise<SurchargeRow[]> {
  return db
    .select({
      id: schema.carrierSurcharges.id,
      kind: schema.carrierSurcharges.kind,
      value: schema.carrierSurcharges.value,
      valuePerKg: schema.carrierSurcharges.valuePerKg,
      tier: schema.carrierSurcharges.tier,
      countryCodes: schema.carrierSurcharges.countryCodes,
      active: schema.carrierSurcharges.active,
      note: schema.carrierSurcharges.note,
      startsAt: schema.carrierSurcharges.startsAt,
      endsAt: schema.carrierSurcharges.endsAt,
      updatedAt: schema.carrierSurcharges.updatedAt,
      lastAutoFetchedAt: schema.carrierSurcharges.lastAutoFetchedAt,
      lastAutoSource: schema.carrierSurcharges.lastAutoSource,
    })
    .from(schema.carrierSurcharges)
    .where(eq(schema.carrierSurcharges.carrierAccountId, carrierAccountId))
    // Group by kind for the page sections, then newest → oldest within each
    // kind by effective-window start (rows without a start date sort last),
    // tie-breaking on creation time.
    .orderBy(
      asc(schema.carrierSurcharges.kind),
      sql`${schema.carrierSurcharges.startsAt} desc nulls last`,
      desc(schema.carrierSurcharges.createdAt),
    )
    .then((rows) => rows.map((r) => ({
      ...r,
      countryCodes: Array.isArray(r.countryCodes) ? (r.countryCodes as string[]) : null,
    })));
}

export interface CreateSurchargeInput {
  carrierAccountId: string;
  kind: SurchargeKind;
  value: string;
  /**
   * Optional per-kg companion. When set, the engine bills max(value, valuePerKg × weight).
   * Only meaningful for kind='remote_fixed' (FedEx ODA Tier B/C model).
   */
  valuePerKg?: string;
  note?: string;
  /** Optional tier label — only meaningful for kind='remote_fixed'. */
  tier?: string;
  /**
   * Comma-separated ISO-2 country codes scoping the surcharge. Only
   * meaningful for kind='demand_per_kg'. Empty / missing = global.
   */
  countryCodes?: string;
}

function parseValue(raw: string, kind: SurchargeKind): number {
  const n = Number(String(raw).replace(/[,_\s]/g, ''));
  if (!Number.isFinite(n)) throw new Error('Value must be a number.');
  if (kind === 'fuel_percent' || kind === 'markup_percent') {
    if (n < -100 || n > 1000) throw new Error('Percentage must be between -100 and 1000.');
  } else {
    if (n < 0) throw new Error('Fixed amount must be ≥ 0.');
  }
  return n;
}

function parsePerKg(raw: string): number | null {
  const cleaned = String(raw).replace(/[,_\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error('Per-kg value must be a number.');
  if (n < 0) throw new Error('Per-kg value must be ≥ 0.');
  return n;
}

const ISO2_RE = /^[A-Z]{2}$/;

/**
 * Accept a comma- / space- / newline-separated list of ISO-2 codes,
 * upper-case and dedupe, throw on bad codes. Returns null when the
 * trimmed input is empty (catch-all scope).
 */
function parseCountryCodes(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const codes = trimmed
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  for (const c of codes) {
    if (!ISO2_RE.test(c)) {
      throw new Error(`"${c}" is not a valid ISO-2 country code.`);
    }
  }
  return Array.from(new Set(codes));
}

export async function createSurcharge(input: CreateSurchargeInput, userId: string): Promise<string> {
  const n = parseValue(input.value, input.kind);
  const perKg = input.valuePerKg !== undefined ? parsePerKg(input.valuePerKg) : null;
  const countries = input.countryCodes !== undefined
    ? parseCountryCodes(input.countryCodes)
    : null;
  const [row] = await db
    .insert(schema.carrierSurcharges)
    .values({
      carrierAccountId: input.carrierAccountId,
      kind: input.kind,
      value: n.toString(),
      valuePerKg: perKg !== null ? perKg.toString() : null,
      tier: input.tier?.trim() || null,
      countryCodes: countries,
      note: input.note?.trim() || null,
      updatedBy: userId,
    })
    .returning({ id: schema.carrierSurcharges.id });
  return row!.id;
}

export interface UpdateSurchargeInput {
  id: string;
  value?: string;
  /** Pass '' to clear the per-kg companion; pass a number to set it; omit to leave unchanged. */
  valuePerKg?: string;
  /** Pass '' to make the surcharge global; pass a code list to scope; omit to leave unchanged. */
  countryCodes?: string;
  note?: string;
  active?: boolean;
}

export async function updateSurcharge(input: UpdateSurchargeInput, userId: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.carrierSurcharges)
    .where(eq(schema.carrierSurcharges.id, input.id))
    .limit(1);
  if (!existing) throw new Error('Surcharge not found.');

  const patch: Partial<typeof schema.carrierSurcharges.$inferInsert> = {
    updatedBy: userId,
    updatedAt: new Date(),
  };
  if (input.value !== undefined) patch.value = parseValue(input.value, existing.kind).toString();
  if (input.valuePerKg !== undefined) {
    const perKg = parsePerKg(input.valuePerKg);
    patch.valuePerKg = perKg !== null ? perKg.toString() : null;
  }
  if (input.countryCodes !== undefined) {
    patch.countryCodes = parseCountryCodes(input.countryCodes);
  }
  if (input.note !== undefined) patch.note = input.note.trim() || null;
  if (input.active !== undefined) patch.active = input.active;

  await db.update(schema.carrierSurcharges).set(patch).where(eq(schema.carrierSurcharges.id, input.id));
}

export async function deleteSurcharge(id: string): Promise<void> {
  await db.delete(schema.carrierSurcharges).where(eq(schema.carrierSurcharges.id, id));
}
