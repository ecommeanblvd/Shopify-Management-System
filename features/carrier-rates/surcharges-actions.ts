'use server';

import { asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';

export type SurchargeKind = typeof schema.carrierSurchargeKindEnum.enumValues[number];

export interface SurchargeRow {
  id: string;
  kind: SurchargeKind;
  value: string;
  valuePerKg: string | null;
  tier: string | null;
  /** ISO-2 country codes scoping `demand_per_kg`. NULL → applies globally. */
  countryCodes: string[] | null;
  /** ISO-2 country codes the row is EXEMPT for (addon_fixed — FedEx Direct
   *  Signature miễn 13 nước). NULL → no exemptions. Exclusion wins. */
  excludedCountryCodes: string[] | null;
  active: boolean;
  note: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  updatedAt: Date;
  /** Set when a scraper/cron wrote this row (e.g. FedEx fuel weekly refresh). */
  lastAutoFetchedAt: Date | null;
  lastAutoSource: string | null;
  /**
   * Chế độ áp dụng — chỉ có nghĩa với kind='addon_fixed'.
   *   'always'      → engine cộng vào mọi quote.
   *   'when_billed' → KHÔNG vào quote; chỉ là giá tham chiếu đối soát.
   */
  applyMode: 'always' | 'when_billed';
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
      excludedCountryCodes: schema.carrierSurcharges.excludedCountryCodes,
      active: schema.carrierSurcharges.active,
      note: schema.carrierSurcharges.note,
      startsAt: schema.carrierSurcharges.startsAt,
      endsAt: schema.carrierSurcharges.endsAt,
      updatedAt: schema.carrierSurcharges.updatedAt,
      lastAutoFetchedAt: schema.carrierSurcharges.lastAutoFetchedAt,
      lastAutoSource: schema.carrierSurcharges.lastAutoSource,
      applyMode: schema.carrierSurcharges.applyMode,
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
      excludedCountryCodes: Array.isArray(r.excludedCountryCodes) ? (r.excludedCountryCodes as string[]) : null,
      applyMode: (r.applyMode === 'when_billed' ? 'when_billed' : 'always') as 'always' | 'when_billed',
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
  /**
   * Comma-separated ISO-2 codes the surcharge is EXEMPT for. Only
   * meaningful for kind='addon_fixed'. Empty / missing = no exemptions.
   */
  excludedCountryCodes?: string;
  /**
   * Chế độ áp dụng — chỉ có nghĩa với kind='addon_fixed'.
   * 'always' (default) → cộng vào mọi quote; 'when_billed' → tham chiếu đối soát.
   */
  applyMode?: 'always' | 'when_billed';
  /** Effective-from date (ISO string). Parsed to a Date; null/omitted → no start. */
  startsAt?: string | null;
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

/*
 * `createSurcharge`, `updateSurcharge`, `deleteSurcharge` tự gác `manage_carrier_rates` trong
 * thân hàm. Tới 25/10/2026 cả ba KHÔNG có dòng kiểm quyền nào, còn ba action nội tuyến của
 * trang (`surcharges/page.tsx:287`, `:315`, `:344`) cũng không kiểm — trang chỉ gác ở thân
 * trang (`:397-403`).
 *
 * Lý do chung của cả cụm carrier-rates ghi: cổng quyền phải nằm TRONG THÂN HÀM, không ở
 * `page.tsx`. Mỗi export của tệp `'use server'` là một endpoint POST; thân trang chỉ chạy lúc
 * RENDER nên một POST thẳng vào action không kích hoạt nó, và cổng duy nhất của dashboard
 * (`app/(dashboard)/layout.tsx:10-11`) cũng là render. Nên mọi phiên đăng nhập gọi được, kể
 * cả 3 tài khoản vai `viewer`.
 *
 * Vì sao nặng: `carrier_surcharges` được engine nạp ở `engine/snapshot-static.ts:143-144` cho
 * route carrier-service (`app/api/shopify/carrier-service/[storeId]/route.ts:63`). Một dòng
 * `fuel_percent` / `markup_percent` đổi là cộng/trừ THẲNG vào giá ship khách thấy ở checkout
 * (biên cho phép -100% đến +1000%, `parseValue` ở trên); `deleteSurcharge` gỡ một phụ phí
 * khỏi báo giá.
 *
 * `userId` thôi là THAM SỐ (`createSurcharge`, `updateSurcharge`). Trước đây người gọi tự khai
 * danh tính nên kẻ gọi thẳng đổ tên người khác vào `updated_by`. Giờ lấy từ `requirePerm`.
 *
 * Khoá `manage_carrier_rates` là ĐÚNG khoá của trang (`surcharges/page.tsx:365`, `:385`,
 * `:403`). `listSurcharges` (ĐỌC) cố ý KHÔNG gác — trang gọi nó sau cổng `view_carrier_rates`
 * (`:397`) và vai chỉ-xem phải đọc được.
 */
export async function createSurcharge(input: CreateSurchargeInput): Promise<string> {
  const userId = await requirePerm('manage_carrier_rates');
  const n = parseValue(input.value, input.kind);
  const perKg = input.valuePerKg !== undefined ? parsePerKg(input.valuePerKg) : null;
  const countries = input.countryCodes !== undefined
    ? parseCountryCodes(input.countryCodes)
    : null;
  const excludedCountries = input.excludedCountryCodes !== undefined
    ? parseCountryCodes(input.excludedCountryCodes)
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
      excludedCountryCodes: excludedCountries,
      note: input.note?.trim() || null,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      updatedBy: userId,
      applyMode: (input.kind === 'addon_fixed' || input.kind === 'country_fixed')
        ? (input.applyMode === 'when_billed' ? 'when_billed' : 'always')
        : 'always',
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
  /** Pass '' to clear exemptions; pass a code list to set; omit to leave unchanged. */
  excludedCountryCodes?: string;
  note?: string;
  active?: boolean;
  /** Chế độ áp dụng — chỉ có nghĩa với kind='addon_fixed' hoặc 'country_fixed'. */
  applyMode?: 'always' | 'when_billed';
  /** Pass an ISO date string to set effective-from; '' / null to clear; omit to leave unchanged. */
  startsAt?: string | null;
}

export async function updateSurcharge(input: UpdateSurchargeInput): Promise<void> {
  const userId = await requirePerm('manage_carrier_rates');
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
  // Cột generic nhưng UI hiện chỉ cho addon_fixed — gate như applyMode để
  // form kind khác không vô tình ghi đè danh sách miễn.
  if (input.excludedCountryCodes !== undefined && existing.kind === 'addon_fixed') {
    patch.excludedCountryCodes = parseCountryCodes(input.excludedCountryCodes);
  }
  if (input.note !== undefined) patch.note = input.note.trim() || null;
  if (input.active !== undefined) patch.active = input.active;
  if (input.startsAt !== undefined) {
    patch.startsAt = input.startsAt ? new Date(input.startsAt) : null;
  }
  if (input.applyMode !== undefined && (existing.kind === 'addon_fixed' || existing.kind === 'country_fixed')) {
    patch.applyMode = input.applyMode === 'when_billed' ? 'when_billed' : 'always';
  }

  await db.update(schema.carrierSurcharges).set(patch).where(eq(schema.carrierSurcharges.id, input.id));
}

export async function deleteSurcharge(id: string): Promise<void> {
  await requirePerm('manage_carrier_rates');
  await db.delete(schema.carrierSurcharges).where(eq(schema.carrierSurcharges.id, id));
}
