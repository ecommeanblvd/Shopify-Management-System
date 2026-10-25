'use server';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';

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

/*
 * `createZone`, `renameZone`, `patchZoneCountries`, `deleteZone` tự gác `manage_carrier_rates`
 * trong thân hàm. Tới 25/10/2026 cả bốn KHÔNG kiểm quyền, và bốn action nội tuyến của trang
 * (`zones/page.tsx:25`, `:31`, `:38`, `:50`) cũng không — trang chỉ gác ở thân trang (`:66`).
 *
 * Lý do chung của cả cụm carrier-rates ghi: cổng quyền phải nằm TRONG THÂN HÀM, không ở
 * `page.tsx`. Mỗi export của tệp `'use server'` là một endpoint POST; thân trang chỉ chạy lúc
 * RENDER nên một POST thẳng vào action không kích hoạt nó, và cổng duy nhất của dashboard
 * (`app/(dashboard)/layout.tsx:10-11`) cũng là render. Nên mọi phiên đăng nhập gọi được, kể
 * cả 3 tài khoản vai `viewer`.
 *
 * Vì sao nặng: zone + danh sách nước của nó quyết định khách ở nước nào thì rơi vào cột giá
 * nào (`engine/snapshot-static.ts:132-136`, nạp cho route carrier-service). `patchZoneCountries`
 * chuyển một nước sang zone khác là đổi giá cả nước đó; `deleteZone` ON DELETE CASCADE xoá cả
 * country-map lẫn mọi ô giá của zone (xem chú thích ở thân `deleteZone`).
 *
 * Khoá `manage_carrier_rates` là ĐÚNG khoá của trang (`zones/page.tsx:72`, `canManage`).
 * `listZonesWithCountries` (ĐỌC) cố ý KHÔNG gác — trang gọi nó sau cổng `view_carrier_rates`
 * (`:66`).
 */
export async function createZone(carrierAccountId: string, label: string): Promise<string> {
  await requirePerm('manage_carrier_rates');
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
  await requirePerm('manage_carrier_rates');
  const t = label.trim();
  if (!t) throw new Error('Label cannot be empty.');
  await db.update(schema.carrierZones).set({ label: t }).where(eq(schema.carrierZones.id, zoneId));
}

export async function deleteZone(zoneId: string): Promise<void> {
  await requirePerm('manage_carrier_rates');
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
  await requirePerm('manage_carrier_rates');
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
