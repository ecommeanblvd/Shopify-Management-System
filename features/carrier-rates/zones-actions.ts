'use server';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const ISO2_RE = /^[A-Z]{2}$/;

export interface ZoneWithCountries {
  id: string;
  label: string;
  position: number;
  countries: string[];
}

export async function listZonesWithCountries(carrierAccountId: string): Promise<ZoneWithCountries[]> {
  const zones = await db
    .select()
    .from(schema.carrierZones)
    .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId))
    .orderBy(asc(schema.carrierZones.position), asc(schema.carrierZones.label));

  if (zones.length === 0) return [];

  const countries = await db
    .select()
    .from(schema.carrierZoneCountries)
    .where(inArray(schema.carrierZoneCountries.carrierZoneId, zones.map((z) => z.id)))
    .orderBy(asc(schema.carrierZoneCountries.countryCode));

  const byZone = new Map<string, string[]>();
  for (const c of countries) {
    const list = byZone.get(c.carrierZoneId) ?? [];
    list.push(c.countryCode);
    byZone.set(c.carrierZoneId, list);
  }

  return zones.map((z) => ({
    id: z.id,
    label: z.label,
    position: z.position,
    countries: byZone.get(z.id) ?? [],
  }));
}

export async function createZone(carrierAccountId: string, label: string): Promise<string> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('Zone label is required.');

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${schema.carrierZones.position}), -1) + 1` })
    .from(schema.carrierZones)
    .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId));

  const [row] = await db
    .insert(schema.carrierZones)
    .values({ carrierAccountId, label: trimmed, position: next })
    .returning({ id: schema.carrierZones.id });
  return row!.id;
}

export async function renameZone(zoneId: string, label: string): Promise<void> {
  const t = label.trim();
  if (!t) throw new Error('Label cannot be empty.');
  await db.update(schema.carrierZones).set({ label: t }).where(eq(schema.carrierZones.id, zoneId));
}

export async function deleteZone(zoneId: string): Promise<void> {
  // ON DELETE CASCADE removes zone_countries + rate_cells.
  await db.delete(schema.carrierZones).where(eq(schema.carrierZones.id, zoneId));
}

export interface ZoneCountriesPatch {
  add: string[];
  remove: string[];
}

/**
 * Patches the country list of a zone. Validates ISO-2 and uniqueness across the
 * account (a country lives in exactly one zone). Returns the list of countries
 * that were rejected because they already belong to another zone.
 */
export async function patchZoneCountries(
  zoneId: string,
  carrierAccountId: string,
  patch: ZoneCountriesPatch,
): Promise<{ rejected: string[] }> {
  const cleanAdd = Array.from(new Set(patch.add.map((c) => c.trim().toUpperCase()))).filter((c) => ISO2_RE.test(c));
  const cleanRemove = Array.from(new Set(patch.remove.map((c) => c.trim().toUpperCase()))).filter((c) => ISO2_RE.test(c));

  // Find which incoming additions already exist on this account (any zone).
  const existing = cleanAdd.length === 0
    ? []
    : await db
        .select({ countryCode: schema.carrierZoneCountries.countryCode, carrierZoneId: schema.carrierZoneCountries.carrierZoneId })
        .from(schema.carrierZoneCountries)
        .where(and(
          eq(schema.carrierZoneCountries.carrierAccountId, carrierAccountId),
          inArray(schema.carrierZoneCountries.countryCode, cleanAdd),
        ));

  const rejected: string[] = [];
  const toInsert: string[] = [];
  for (const code of cleanAdd) {
    const dup = existing.find((e) => e.countryCode === code);
    if (!dup) {
      toInsert.push(code);
    } else if (dup.carrierZoneId !== zoneId) {
      rejected.push(code);
    }
    // dup in same zone = no-op, harmless
  }

  if (toInsert.length > 0) {
    await db
      .insert(schema.carrierZoneCountries)
      .values(toInsert.map((countryCode) => ({ carrierAccountId, carrierZoneId: zoneId, countryCode })))
      .onConflictDoNothing();
  }

  if (cleanRemove.length > 0) {
    await db
      .delete(schema.carrierZoneCountries)
      .where(and(
        eq(schema.carrierZoneCountries.carrierZoneId, zoneId),
        inArray(schema.carrierZoneCountries.countryCode, cleanRemove),
      ));
  }

  return { rejected };
}
