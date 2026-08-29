/**
 * Phần TĨNH của snapshot carrier — bảng giá, zone, bậc cân, phụ phí — nạp một
 * lần rồi giữ trong bộ nhớ tiến trình.
 *
 * Vì sao tách khỏi load.ts: mỗi lượt khách bấm thanh toán, callback
 * carrier-service dựng lại snapshot cho 5 carrier account, mỗi lần đọc ~5.000
 * dòng bảng giá gần như không đổi. Đo 24/08: ~2 triệu dòng/ngày sau khi đã
 * chặn được phần ODA. Supabase tính tiền theo egress (D-025) nên đọc đi đọc
 * lại cùng dữ liệu là trả tiền nhiều lần cho một thứ.
 *
 * Danh sách ODA KHÔNG nằm ở đây: nó lọc theo mã bưu chính của từng đơn nên mỗi
 * lượt một khác, và sau khi lọc chỉ còn vài dòng (D-027).
 *
 * File này cố tình KHÔNG có 'use server' — nó giữ state của tiến trình và
 * export cả hàm đồng bộ, hai thứ mà module 'use server' không cho phép.
 */

import { asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { CarrierAccountSnapshot, ZoneSnap } from './quote';
import { pickRateCardForDate, listRateCards } from './rate-cards';
import { taoBoNhoDem } from './snapshot-cache';

export type PhanTinhSnapshot = Omit<CarrierAccountSnapshot, 'remotePostcodes'>;

/** Lưới an toàn cuối, KHÔNG phải cơ chế chính: mọi lượt đều so phiên bản cấu
 *  hình nên dữ liệu đổi là nạp lại ngay, hạn dùng chỉ để mục cũ không nằm lại
 *  mãi trong bộ nhớ. Đặt 10 phút thì mỗi account vẫn nạp lại ~6 lần/giờ dù
 *  bảng giá không đổi (đo 24/08: 5 lượt nạp/15 phút, chiếm phần lớn lượng đọc
 *  còn lại) — 1 giờ giữ đúng vai trò lưới mà không đọc lại vô ích. */
const TTL_MS = 60 * 60_000;

const dem = taoBoNhoDem<{ phienBan: string; snap: PhanTinhSnapshot | null }>({ ttlMs: TTL_MS });

/** Dọn sạch phần đệm. Bình thường KHÔNG cần gọi — phiên bản cấu hình tự bắt
 *  thay đổi. Để lộ ra cho test và cho trường hợp cần ép nạp lại. */
export function xoaDemSnapshot(): void {
  dem.xoa();
}

export function soMucDangDem(): number {
  return dem.soMuc();
}

/**
 * Dấu vân tay của cấu hình cước một account: mốc sửa mới nhất + số dòng.
 * Cần cả hai vì `max(updated_at)` không đổi khi ops XOÁ một dòng.
 *
 * Đây là cùng cách làm với reconcile-cache.ts (`latestConfigVersion`), mở rộng
 * cho đủ các bảng mà snapshot đọc. Một truy vấn trả đúng MỘT dòng — thay cho
 * ~5.000 dòng bảng giá mỗi lượt.
 */
async function phienBanCauHinh(carrierAccountId: string): Promise<string> {
  const res = await db.execute(sql`
    select
      greatest(
        coalesce((select max(updated_at) from carrier_surcharges where carrier_account_id = ${carrierAccountId}), 'epoch'::timestamp),
        coalesce((select max(created_at) from carrier_rate_cards where carrier_account_id = ${carrierAccountId}), 'epoch'::timestamp),
        coalesce((select max(c.updated_at) from carrier_rate_cells c
                  join carrier_rate_cards r on r.id = c.rate_card_id
                  where r.carrier_account_id = ${carrierAccountId}), 'epoch'::timestamp),
        coalesce((select max(updated_at) from carrier_zones where carrier_account_id = ${carrierAccountId}), 'epoch'::timestamp),
        coalesce((select max(updated_at) from carrier_zone_countries where carrier_account_id = ${carrierAccountId}), 'epoch'::timestamp),
        coalesce((select max(updated_at) from carrier_zone_postcode_ranges where carrier_account_id = ${carrierAccountId}), 'epoch'::timestamp),
        coalesce((select max(updated_at) from carrier_weight_tiers where carrier_account_id = ${carrierAccountId}), 'epoch'::timestamp),
        coalesce((select updated_at from carrier_accounts where id = ${carrierAccountId}), 'epoch'::timestamp)
      )::text
      || '|' ||
      (
        (select count(*) from carrier_surcharges where carrier_account_id = ${carrierAccountId})
      + (select count(*) from carrier_rate_cards where carrier_account_id = ${carrierAccountId})
      + (select count(*) from carrier_rate_cells c
         join carrier_rate_cards r on r.id = c.rate_card_id
         where r.carrier_account_id = ${carrierAccountId})
      + (select count(*) from carrier_zones where carrier_account_id = ${carrierAccountId})
      + (select count(*) from carrier_zone_countries where carrier_account_id = ${carrierAccountId})
      + (select count(*) from carrier_zone_postcode_ranges where carrier_account_id = ${carrierAccountId})
      + (select count(*) from carrier_weight_tiers where carrier_account_id = ${carrierAccountId})
      )::text as v`);
  const rows = (res.rows ?? (res as unknown as Array<{ v: unknown }>)) as Array<{ v: unknown }>;
  return String(rows[0]?.v ?? '');
}

export async function napPhanTinhSnapshot(
  carrierAccountId: string,
  effectiveDate: Date,
): Promise<PhanTinhSnapshot | null> {
  // Bảng giá chọn theo NGÀY nên khoá đệm cũng chỉ tới ngày.
  const khoa = `${carrierAccountId}|${effectiveDate.toISOString().slice(0, 10)}`;
  const phienBan = await phienBanCauHinh(carrierAccountId);

  const dangCo = await dem.lay(khoa, async () => ({
    phienBan,
    snap: await docPhanTinh(carrierAccountId, effectiveDate),
  }));
  if (dangCo.phienBan === phienBan) return dangCo.snap;

  // Cấu hình đã đổi từ lượt trước → bỏ mục cũ, dựng lại.
  dem.xoa(khoa);
  const moi = await dem.lay(khoa, async () => ({
    phienBan,
    snap: await docPhanTinh(carrierAccountId, effectiveDate),
  }));
  return moi.snap;
}

async function docPhanTinh(
  carrierAccountId: string,
  effectiveDate: Date,
): Promise<PhanTinhSnapshot | null> {
  const [account] = await db
    .select()
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.id, carrierAccountId))
    .limit(1);
  if (!account) return null;

  // Pick the base-rate card whose window covers effectiveDate. No card →
  // no base rates for that date; return null so callers surface it clearly.
  const cards = await listRateCards(carrierAccountId);
  const card = pickRateCardForDate(cards, effectiveDate);
  if (!card) return null;

  const [zones, zoneCountries, zonePostcodeRangeRows, tiers, surcharges] = await Promise.all([
    db.select().from(schema.carrierZones)
      .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId))
      .orderBy(asc(schema.carrierZones.position)),
    db.select().from(schema.carrierZoneCountries)
      .where(eq(schema.carrierZoneCountries.carrierAccountId, carrierAccountId)),
    // Zone theo dải bưu chính (CN Hoa Nam → Zone K) — bảng nhỏ, không gating date.
    db.select().from(schema.carrierZonePostcodeRanges)
      .where(eq(schema.carrierZonePostcodeRanges.carrierAccountId, carrierAccountId)),
    db.select().from(schema.carrierWeightTiers)
      .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId))
      .orderBy(asc(sql`(${schema.carrierWeightTiers.upperKg})::numeric`)),
    db.select().from(schema.carrierSurcharges)
      .where(sql`${schema.carrierSurcharges.carrierAccountId} = ${carrierAccountId} AND ${schema.carrierSurcharges.active} = true`),
  ]);

  // Cells scoped to the chosen rate card (NOT all cells for the account).
  const cells = await db.select().from(schema.carrierRateCells)
    .where(eq(schema.carrierRateCells.rateCardId, card.id));

  // Index cells by (zoneId, tierId) — split by package_type so the engine
  // can pick Pak vs Package per the < 2kg rule.
  const tierUpperById = new Map(tiers.map((t) => [t.id, Number(t.upperKg)]));
  const packageRatesByZoneId = new Map<string, Map<number, number>>();
  const pakRatesByZoneId = new Map<string, Map<number, number>>();
  for (const c of cells) {
    const tierUpper = tierUpperById.get(c.carrierWeightTierId);
    if (tierUpper === undefined) continue;
    const bucket = c.packageType === 'pak' ? pakRatesByZoneId : packageRatesByZoneId;
    const inner = bucket.get(c.carrierZoneId) ?? new Map<number, number>();
    inner.set(tierUpper, Number(c.costAmount));
    bucket.set(c.carrierZoneId, inner);
  }

  // zonesByCountry: country → ZoneSnap (each zone is shared between its countries)
  const zoneSnapById = new Map<string, ZoneSnap>();
  for (const z of zones) {
    zoneSnapById.set(z.id, {
      label: z.label,
      rateByTierUpper: packageRatesByZoneId.get(z.id) ?? new Map(),
      pakRateByTierUpper: pakRatesByZoneId.get(z.id) ?? new Map(),
    });
  }
  const zonesByCountry = new Map<string, ZoneSnap>();
  for (const zc of zoneCountries) {
    const zs = zoneSnapById.get(zc.carrierZoneId);
    if (zs) zonesByCountry.set(zc.countryCode, zs);
  }

  // Zone override theo dải bưu chính (engine match trước zonesByCountry).
  const zonePostcodeRanges = zonePostcodeRangeRows.flatMap((r) => {
    const zs = zoneSnapById.get(r.carrierZoneId);
    return zs ? [{ countryCode: r.countryCode.toUpperCase(), rangeStart: r.rangeStart, rangeEnd: r.rangeEnd, zone: zs }] : [];
  });

  return {
    id: account.id,
    name: account.name,
    costCurrency: account.costCurrency,
    displayCurrency: account.displayCurrency,
    fxCostPerDisplay: Number(account.fxCostPerDisplay),
    // NULL → skip dim-weight entirely (engine charges actual). Default
    // 5000 cm³/kg (FedEx/DHL Air standard) set at the column level.
    dimDivisorCm3PerKg: account.dimDivisorCm3PerKg !== null
      ? Number(account.dimDivisorCm3PerKg)
      : null,
    chargeableRoundingMode: (account.chargeableRoundingMode === 'ceil' ? 'ceil' : null),
    totalsRoundingMode: (account.totalsRoundingMode === 'per_line' ? 'per_line' : null),
    chargeableRoundingKg: account.chargeableRoundingKg !== null
      ? Number(account.chargeableRoundingKg)
      : null,
    zonesByCountry,
    zonePostcodeRanges,
    weightTiers: tiers.map((t) => ({ upperKg: Number(t.upperKg) })),
    surcharges: surcharges.map((s) => ({
      kind: s.kind,
      value: Number(s.value),
      valuePerKg: s.valuePerKg !== null ? Number(s.valuePerKg) : null,
      active: s.active,
      tier: s.tier ?? null,
      // `country_codes` is jsonb — already deserialised by node-postgres
      // when present. Normalise to upper-case ISO-2 so the engine's
      // `country` lookup (which also upper-cases) hits.
      countryCodes: Array.isArray(s.countryCodes)
        ? (s.countryCodes as string[]).map((c) => c.toUpperCase())
        : null,
      excludedCountryCodes: Array.isArray(s.excludedCountryCodes)
        ? (s.excludedCountryCodes as string[]).map((c) => c.toUpperCase())
        : null,
      stepKg: s.stepKg !== null ? Number(s.stepKg) : null,
      stepFloorKg: s.stepFloorKg !== null ? Number(s.stepFloorKg) : null,
      fuelable: s.fuelable,
      vatable: s.vatable,
      applyMode: (s.applyMode === 'when_billed' ? 'when_billed' : 'always') as 'always' | 'when_billed',
      serviceKey: s.serviceKey ?? null,
      note: s.note ?? null,
      // Engine gates each row by (startsAt, endsAt) against the caller's
      // effectiveDate inside `quote()`. Loader still filters `active=true`
      // at SQL level to keep the working set small; rows whose window
      // doesn't cover the quote date are excluded in JS.
      startsAt: s.startsAt,
      endsAt: s.endsAt,
    })),
  };
}
