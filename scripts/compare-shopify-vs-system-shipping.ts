/**
 * Audit giá ship: so giá "Standard" đang set up THỦ CÔNG trên Shopify meanblvd
 * với giá HỆ THỐNG quote (DHL + FedEx snapshot, đã gồm markup/fuel/VAT + nung
 * residential US/CA). Xuất 2 CSV:
 *   - shipping-compare-prices.csv : zone × nước × cân → shopify vs system.
 *   - shipping-zone-audit.csv     : nước Shopify rơi vào market hệ thống nào,
 *                                   carrier nào phục vụ (lệch cấu trúc zone).
 *
 *   railway run -- npx tsx scripts/compare-shopify-vs-system-shipping.ts
 */
import { writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { SHIPPING_QUERY, normalizeShopifyDeliveryProfile } from '@/features/settings-sync/domain/shipping';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { quote, type CarrierAccountSnapshot } from '@/features/carrier-rates/engine/quote';

const STORE = '679aacbb-f563-4725-9d2f-65b9fddac22f';
const WEIGHTS = [0.5, 1, 2, 3, 5];

/** Lấy giá Shopify cho cân w: chọn bậc có cận trên nhỏ nhất ≥ w. */
function shopifyPriceAt(schedule: { hi: number; price: number }[], w: number): number | null {
  const sorted = [...schedule].sort((a, b) => a.hi - b.hi);
  const band = sorted.find((s) => s.hi >= w - 1e-9) ?? sorted[sorted.length - 1];
  return band?.price ?? null;
}

/** Trích cận trên (số lớn nhất) từ tên rate "Standard (1.6-2.0kg)". */
function parseHi(rateName: string): number | null {
  const nums = (rateName.match(/[0-9]+(?:\.[0-9]+)?/g) ?? []).map(Number);
  return nums.length ? Math.max(...nums) : null;
}

function sysQuote(snap: CarrierAccountSnapshot | null, country: string, w: number): number | null {
  if (!snap || !snap.zonesByCountry.get(country)) return null;
  // Khớp recalc thật: luôn base Package + giả định nhà dân (residential US/CA).
  const q = quote(snap, { weightKg: w, destinationCountry: country, isResidential: true, packagingType: 'box' });
  return q.ok ? q.breakdown.finalDisplay : null;
}

async function main() {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, STORE)).limit(1);

  // Shopify live zones
  const token = await getStoreToken(STORE);
  const raw = await graphqlCall({ shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query: SHIPPING_QUERY });
  const norm = normalizeShopifyDeliveryProfile(raw.data);

  // Carrier snapshots
  const accts = await db.select({ id: schema.carrierAccounts.id, key: schema.carriers.key, disp: schema.carrierAccounts.displayCurrency })
    .from(schema.carrierAccounts).innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId));
  let dhl: CarrierAccountSnapshot | null = null, fedex: CarrierAccountSnapshot | null = null;
  for (const a of accts) {
    const snap = await loadAccountSnapshot(a.id);
    if (a.key === 'dhl') dhl = snap; if (a.key === 'fedex') fedex = snap;
    console.log(`carrier ${a.key}: display=${a.disp}`);
  }

  // Market templates (để map nước → market hệ thống)
  const templates = await db.select().from(schema.marketTemplates);
  const links = await db.select({ h: schema.marketCarrierLinks.marketHandle, key: schema.carriers.key })
    .from(schema.marketCarrierLinks)
    .innerJoin(schema.carrierAccounts, eq(schema.carrierAccounts.id, schema.marketCarrierLinks.carrierAccountId))
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.marketCarrierLinks.enabled, true));
  const carriersByMarket = new Map<string, string[]>();
  for (const l of links) { const a = carriersByMarket.get(l.h) ?? []; a.push(l.key); carriersByMarket.set(l.h, a); }
  const marketOf = new Map<string, { handle: string; name: string }>();
  for (const t of templates) for (const c of (t.countries as string[])) marketOf.set(c, { handle: t.handle, name: t.name });

  // === CSV A: price compare — CHUẨN = FedEx (carrier chính, rẻ nhất ở đa số
  // zone). DHL giữ làm tham chiếu. diff/pct so Shopify với FedEx. ===
  const priceRows: string[] = ['shopify_zone,country,weight_kg,shopify_usd,system_fedex_usd,system_dhl_usd,shopify_minus_fedex,pct_vs_fedex,fedex_cheaper_than_dhl,carrier_serves'];
  // === CSV B: zone audit ===
  const auditRows: string[] = ['shopify_zone,country,system_market,market_carriers,dhl_serves,fedex_serves,note'];

  for (const [zname, z] of Object.entries(norm.tree.zones)) {
    const schedule = Object.entries(z.rates)
      .map(([rn, r]) => ({ hi: parseHi(rn), price: r.price }))
      .filter((x): x is { hi: number; price: number } => x.hi !== null);
    const hasRealRates = schedule.some((s) => s.price > 0);

    for (const country of z.countries) {
      const dServes = !!dhl?.zonesByCountry.get(country);
      const fServes = !!fedex?.zonesByCountry.get(country);
      // audit row
      const m = marketOf.get(country);
      const mc = m ? (carriersByMarket.get(m.handle)?.join('|') || 'NONE') : '';
      const note: string[] = [];
      if (!m) note.push('không-có-market-hệ-thống');
      else if (mc === 'NONE') note.push('market-chưa-link-carrier');
      if (!dServes && !fServes) note.push('không-carrier-nào-phục-vụ');
      auditRows.push([zname, country, m ? `${m.handle}` : '', mc, dServes, fServes, note.join(';')].join(','));

      if (!hasRealRates) continue; // VN/HK nội địa 0đ — bỏ so giá
      for (const w of WEIGHTS) {
        const shop = shopifyPriceAt(schedule, w);
        const d = sysQuote(dhl, country, w);
        const f = sysQuote(fedex, country, w);
        // CHUẨN = FedEx. diff/pct so Shopify với FedEx (âm = Shopify thu thấp hơn
        // giá FedEx = lỗ). DHL chỉ tham chiếu + cờ FedEx có rẻ hơn DHL không.
        const diff = shop !== null && f !== null ? shop - f : null;
        const pct = diff !== null && f ? Math.round((diff / f) * 1000) / 10 : null;
        const fedexCheaper = f !== null ? (d === null || f <= d) : '';
        const serves = [dServes ? 'DHL' : '', fServes ? 'FedEx' : ''].filter(Boolean).join('|');
        priceRows.push([
          zname, country, w,
          shop ?? '', f !== null ? Math.round(f) : '', d !== null ? Math.round(d) : '',
          diff !== null ? Math.round(diff) : '', pct ?? '', fedexCheaper, serves,
        ].join(','));
      }
    }
  }

  writeFileSync('shipping-compare-prices.csv', priceRows.join('\n'));
  writeFileSync('shipping-zone-audit.csv', auditRows.join('\n'));
  console.log(`\n✓ shipping-compare-prices.csv (${priceRows.length - 1} dòng)`);
  console.log(`✓ shipping-zone-audit.csv (${auditRows.length - 1} dòng)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
