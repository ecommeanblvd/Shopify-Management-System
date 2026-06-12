/**
 * One-off CLI: sinh ma trận giá offer FedEx ((cost + $5) × markup) theo
 * (FedEx zone × bậc cân 0.5kg) cho từng market của store `cici-mean`, rồi
 * ghi vào `market_store_overrides.shipping`. GIỮ nguyên rates DHL có sẵn —
 * chỉ tính/đè các key "FedEx IP (a–b kg)".
 * Plan Task 2 / spec: docs/superpowers/specs/2026-06-12-fedex-offer-rate-matrix-design.md
 *
 *   npx tsx scripts/gen-fedex-offer-matrix.ts            # DRY-RUN (mặc định, không ghi)
 *   npx tsx scripts/gen-fedex-offer-matrix.ts --apply    # ghi DB trong 1 transaction
 *
 * Idempotent: upsert theo (store_id, market_handle); chạy lại cho cùng kết quả.
 * KHÔNG tự push Shopify — operator dùng luồng apply trang /f/markets như thường.
 */
import 'dotenv/config';
import { and, eq, ilike, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote } from '@/features/carrier-rates/engine/quote';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { fedexOfferPrice } from '@/features/markets/domain/fedex-offer-pricing';
import type { ShippingRate, ShippingZone } from '@/features/markets/types';

const FEDEX = '5683f3c0-9249-40c1-a3e7-d967f0d62c29';
const STORE = '04b6d06f-2747-4a86-9084-2cef7c2f88fa'; // cici-mean

/** Upper-bound parse từ key "FedEx IP (a–b kg)" → b (số). Dùng EN-DASH '–' (U+2013). */
function upperOf(key: string): number | null {
  const m = key.match(/–\s*([\d.]+)\s*kg/);
  return m ? Number(m[1]) : null;
}

/** Trích "Zone H"→"H", "Zone 9"→"9". */
function zoneShort(label: string): string {
  return label.replace(/^Zone\s+/i, '').trim();
}

/** Map countryCode → zone label cho 1 carrier account (join zones cho label). */
async function loadZoneOf(carrierAccountId: string): Promise<Map<string, string>> {
  const [zones, zoneCountries] = await Promise.all([
    db.select().from(schema.carrierZones)
      .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId)),
    db.select().from(schema.carrierZoneCountries)
      .where(eq(schema.carrierZoneCountries.carrierAccountId, carrierAccountId)),
  ]);
  const labelById = new Map(zones.map((z) => [z.id, z.label]));
  const out = new Map<string, string>();
  for (const zc of zoneCountries) {
    const label = labelById.get(zc.carrierZoneId);
    if (label) out.set(zc.countryCode.toUpperCase(), label);
  }
  return out;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(apply
    ? '*** --apply: SẼ GHI market_store_overrides ***'
    : 'DRY-RUN — chỉ in, không ghi.');

  // 1) Bộ 59 key chuẩn: lấy từ shipping config middle-east hiện có (the seed).
  const [seed] = await db.select({ shipping: schema.marketStoreOverrides.shipping })
    .from(schema.marketStoreOverrides)
    .where(and(
      eq(schema.marketStoreOverrides.storeId, STORE),
      eq(schema.marketStoreOverrides.marketHandle, 'middle-east'),
    ))
    .limit(1);
  if (!seed?.shipping) {
    throw new Error('Không tìm thấy shipping config middle-east (seed) — không lấy được bộ key chuẩn.');
  }
  const seedZones = (seed.shipping as { zones: Record<string, ShippingZone> }).zones;
  const sampleZone = Object.values(seedZones)[0];
  const fedexKeys = Object.keys(sampleZone.rates).filter((k) => /^FedEx IP/.test(k));
  const keyUpper = new Map<string, number>();
  for (const k of fedexKeys) {
    const b = upperOf(k);
    if (b === null) throw new Error(`Không parse được upper-bound từ key: ${JSON.stringify(k)}`);
    keyUpper.set(k, b);
  }
  console.log(`Bộ key chuẩn: ${fedexKeys.length} bậc "FedEx IP".`);

  // 2) country → (fedexZone, dhlZone) qua carrier_zone_countries (FedEx + DHL).
  const [dhlAccount] = await db.select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name })
    .from(schema.carrierAccounts)
    .where(ilike(schema.carrierAccounts.name, '%DHL%'))
    .limit(1);
  if (!dhlAccount) throw new Error('Không tìm thấy carrier account DHL (name ILIKE %DHL%).');
  const fedexZoneOf = await loadZoneOf(FEDEX);
  const dhlZoneOf = await loadZoneOf(dhlAccount.id);
  console.log(`Zone map: FedEx ${fedexZoneOf.size} nước, DHL ${dhlZoneOf.size} nước (${dhlAccount.name}).`);

  // 3) snapshot FedEx (1 lần), date=now.
  const now = new Date();
  const snap = await loadAccountSnapshot(FEDEX, now);
  if (!snap) throw new Error('Không load được FedEx snapshot (account/rate-card?).');

  // 4) mỗi market của STORE: dựng zones + rates.
  const markets = await db.select().from(schema.marketTemplates);
  let touchedZones = 0;
  // Lưu output đã build để --apply ghi trong 1 transaction.
  const pending: Array<{
    handle: string;
    shipping: { zones: Record<string, ShippingZone> };
    nextVersion: number;
  }> = [];

  for (const mk of markets) {
    const countries = (Array.isArray(mk.countries) ? mk.countries : [])
      .map((c) => String(c).toUpperCase());

    // Gom theo (fedexZone, dhlZone); bỏ nước không có fedexZone (vd VN domestic).
    const groups = new Map<string, { fz: string; dz: string; ccs: string[] }>();
    const skipped: string[] = [];
    for (const cc of countries) {
      const fz = fedexZoneOf.get(cc);
      if (!fz) { skipped.push(cc); continue; }
      const dz = dhlZoneOf.get(cc) ?? '?';
      const k = `${fz}||${dz}`;
      const g = groups.get(k) ?? { fz, dz, ccs: [] };
      g.ccs.push(cc);
      groups.set(k, g);
    }
    if (groups.size === 0) {
      console.log(`  [${mk.handle}] bỏ qua — không nước nào có FedEx zone${skipped.length ? ` (skip ${skipped.join(',')})` : ''}.`);
      continue;
    }

    // Shipping config hiện có của (STORE, market) — merge giữ DHL.
    const [cur] = await db.select({
      shipping: schema.marketStoreOverrides.shipping,
      version: schema.marketStoreOverrides.version,
    })
      .from(schema.marketStoreOverrides)
      .where(and(
        eq(schema.marketStoreOverrides.storeId, STORE),
        eq(schema.marketStoreOverrides.marketHandle, mk.handle),
      ))
      .limit(1);
    const curZones = (cur?.shipping as { zones?: Record<string, ShippingZone> } | null)?.zones ?? {};
    const outZones: Record<string, ShippingZone> = { ...curZones };

    const sampleLines: string[] = [];
    for (const g of groups.values()) {
      const zoneName = `${mk.name} — DHL ${zoneShort(g.dz)} / FedEx ${zoneShort(g.fz)}`;

      // Quote mỗi nước ở mỗi bậc → fedexOfferPrice (max-over-countries).
      const fedexRates: Record<string, ShippingRate> = {};
      for (const key of fedexKeys) {
        const b = keyUpper.get(key)!;
        const cq = g.ccs.map((cc) => {
          const q = quote(snap, { destinationCountry: cc, weightKg: b, effectiveDate: now });
          return q.ok
            ? { carrierCostDisplay: q.breakdown.carrierCostDisplay, finalDisplay: q.breakdown.finalDisplay }
            : { carrierCostDisplay: 0, finalDisplay: 0 };
        });
        const price = fedexOfferPrice(cq);
        if (price !== null) fedexRates[key] = { type: 'flat', price, currency: 'USD' };
      }

      // Merge: GIỮ rates cũ (DHL...) của zone nếu có, ĐÈ key "FedEx IP".
      const prevRates = outZones[zoneName]?.rates ?? {};
      outZones[zoneName] = { countries: g.ccs, rates: { ...prevRates, ...fedexRates } };
      touchedZones++;

      // Mẫu kiểm chứng: bậc 0.5kg của zone này.
      const halfKey = fedexKeys.find((k) => keyUpper.get(k) === 0.5);
      const halfPrice = halfKey ? fedexRates[halfKey]?.price : undefined;
      sampleLines.push(`      ${zoneName} [${g.ccs.join(',')}] — FedEx 0.5kg = ${halfPrice !== undefined ? `$${halfPrice.toFixed(2)}` : '<none>'}`);
    }

    pending.push({
      handle: mk.handle,
      shipping: { zones: outZones },
      nextVersion: (cur?.version ?? 0) + 1,
    });
    console.log(`  [${mk.handle}] ${groups.size} zone × ${fedexKeys.length} bậc${skipped.length ? ` (skip ${skipped.join(',')})` : ''}`);
    for (const line of sampleLines) console.log(line);
  }

  if (apply) {
    await db.transaction(async (tx) => {
      for (const p of pending) {
        await tx.insert(schema.marketStoreOverrides)
          .values({ storeId: STORE, marketHandle: p.handle, shipping: p.shipping, version: p.nextVersion })
          .onConflictDoUpdate({
            target: [schema.marketStoreOverrides.storeId, schema.marketStoreOverrides.marketHandle],
            set: { shipping: p.shipping, version: p.nextVersion, updatedAt: sql`now()` },
          });
      }
    });
  }

  console.log(`\nTổng: ${pending.length} market, ${touchedZones} zone chạm × ${fedexKeys.length} bậc. ${apply ? 'ĐÃ GHI.' : 'DRY-RUN — chưa ghi.'}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
