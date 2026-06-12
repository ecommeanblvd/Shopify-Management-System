/**
 * Sinh ma trận giá offer DHL cho MỌI zone đã set up trong
 * `market_store_overrides.shipping`, dùng CHUNG cơ chế với FedEx:
 *   offer = (carrierCost + $5 đóng gói) × markup, max theo nước, làm tròn lên $0.5.
 * carrierCost lấy từ engine DHL → đã gồm ĐỦ chi phí (base + fuel + demand +
 * Elevated Risk + …) nên giá flat phủ đủ chi phí DHL từng vùng.
 *
 * Merge: GIỮ nguyên rates FedEx + `label`, chỉ THAY các key "DHL Express (a–b kg)".
 * Bộ bậc cân DHL lấy từ zone đang có sẵn DHL (rate-card DHL).
 *
 *   npx tsx scripts/gen-dhl-offer-matrix.ts          # DRY-RUN (mặc định)
 *   npx tsx scripts/gen-dhl-offer-matrix.ts --apply  # ghi DB (1 transaction)
 *
 * Idempotent. KHÔNG đẩy Shopify — apply trang /f/functions/manual-shipping-rates khi sẵn sàng.
 */
import 'dotenv/config';
import { and, eq, ilike, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote } from '@/features/carrier-rates/engine/quote';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { fedexOfferPrice as offerPrice } from '@/features/markets/domain/fedex-offer-pricing';
import type { ShippingRate, ShippingZone, MarketShipping } from '@/features/markets/types';

/** Upper-bound từ key "DHL Express (a–b kg)" → b. EN-DASH '–' (U+2013). */
function upperOf(key: string): number | null {
  const m = key.match(/–\s*([\d.]+)\s*kg/);
  return m ? Number(m[1]) : null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '*** --apply: SẼ GHI DB ***' : 'DRY-RUN — chỉ in, không ghi.');

  const [dhl] = await db.select().from(schema.carrierAccounts)
    .where(ilike(schema.carrierAccounts.name, '%DHL%')).limit(1);
  if (!dhl) throw new Error('Không tìm thấy carrier account DHL.');
  const now = new Date();
  const snap = await loadAccountSnapshot(dhl.id, now);
  if (!snap) throw new Error('Không load được DHL snapshot.');

  const overrides = await db.select().from(schema.marketStoreOverrides);

  // Bộ bậc cân DHL chuẩn: lấy từ zone đang có nhiều key DHL nhất (rate-card DHL).
  let dhlKeys: string[] = [];
  for (const o of overrides) {
    for (const z of Object.values((o.shipping as MarketShipping | null)?.zones ?? {})) {
      const ks = Object.keys(z.rates).filter((k) => /^DHL Express/.test(k));
      if (ks.length > dhlKeys.length) dhlKeys = ks;
    }
  }
  if (dhlKeys.length === 0) throw new Error('Không tìm thấy bộ key DHL chuẩn nào.');
  const keyUpper = new Map(dhlKeys.map((k) => [k, upperOf(k)!]));
  console.log(`Bộ bậc DHL chuẩn: ${dhlKeys.length} bậc.`);

  const pending: Array<{ storeId: string; handle: string; shipping: MarketShipping; version: number }> = [];
  let touched = 0;

  for (const o of overrides) {
    const zones = (o.shipping as MarketShipping | null)?.zones;
    if (!zones) continue;
    const outZones: Record<string, ShippingZone> = {};
    const samples: string[] = [];

    for (const [zoneKey, zone] of Object.entries(zones)) {
      const dhlRates: Record<string, ShippingRate> = {};
      for (const key of dhlKeys) {
        const b = keyUpper.get(key)!;
        const cq = zone.countries.map((cc) => {
          const q = quote(snap, { destinationCountry: cc, weightKg: b, effectiveDate: now });
          return q.ok
            ? { carrierCostDisplay: q.breakdown.carrierCostDisplay, finalDisplay: q.breakdown.finalDisplay }
            : { carrierCostDisplay: 0, finalDisplay: 0 };
        });
        const price = offerPrice(cq);
        if (price !== null) dhlRates[key] = { type: 'flat', price, currency: 'USD' };
      }
      // Giữ rates không phải DHL (FedEx…) + label/countries; thay toàn bộ key DHL.
      const kept: Record<string, ShippingRate> = {};
      for (const [k, r] of Object.entries(zone.rates)) if (!/^DHL Express/.test(k)) kept[k] = r;
      outZones[zoneKey] = { ...zone, rates: { ...kept, ...dhlRates } };
      touched++;

      const half = dhlKeys.find((k) => keyUpper.get(k) === 0.5);
      const p5 = dhlKeys.find((k) => keyUpper.get(k) === 5);
      samples.push(`    ${zoneKey} [${zone.countries.join(',')}] DHL 0.5kg=${half && dhlRates[half] ? '$' + dhlRates[half].price.toFixed(2) : '—'}  5kg=${p5 && dhlRates[p5] ? '$' + dhlRates[p5].price.toFixed(2) : '—'}`);
    }

    pending.push({ storeId: o.storeId, handle: o.marketHandle, shipping: { zones: outZones }, version: o.version + 1 });
    console.log(`[${o.marketHandle}] ${Object.keys(zones).length} zone × ${dhlKeys.length} bậc`);
    samples.forEach((s) => console.log(s));
  }

  if (apply) {
    await db.transaction(async (tx) => {
      for (const p of pending) {
        await tx.update(schema.marketStoreOverrides)
          .set({ shipping: p.shipping, version: p.version, updatedAt: sql`now()` })
          .where(and(
            eq(schema.marketStoreOverrides.storeId, p.storeId),
            eq(schema.marketStoreOverrides.marketHandle, p.handle),
          ));
      }
    });
  }

  console.log(`\nTổng: ${pending.length} market, ${touched} zone × ${dhlKeys.length} bậc. ${apply ? 'ĐÃ GHI (chưa đẩy Shopify).' : 'DRY-RUN — chưa ghi.'}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
