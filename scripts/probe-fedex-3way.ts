/**
 * Đối soát 3 chiều (read-only): billed (hóa đơn) / engine (tự dựng) /
 * FedEx-quote ACCOUNT (giá hợp đồng thật từ Rate API). FedEx-quote = số FedEx
 * LẼ RA phải thu → lệch billed vs quote = khả năng FedEx bill sai (đòi sửa).
 *
 * So sánh PRE-VAT (Rate API trả net charge chưa gồm VAT VN 8%): lấy billed −
 * billedVat đối chiếu totalNetCharge của dịch vụ ACCOUNT khớp nhất.
 *
 *   pnpm exec dotenv -- tsx scripts/probe-fedex-3way.ts [--limit 12] [--country HK]
 *   (cần chạy qua: railway run -- ... để có env FedEx prod)
 */
import { and, eq, isNotNull, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { reconcileShipments } from '@/features/shipments/reconcile';
import { quoteRate, type RateQuoteResult } from '@/lib/fedex/rate';

const HUB_POSTAL: Record<string, string> = { HN: '100000', SG: '700000' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const vnd = (n: number | null) => n === null ? '—' : new Intl.NumberFormat('vi-VN').format(Math.round(n));

async function main(): Promise<void> {
  const limit = Number(arg('limit') ?? '12');
  const country = arg('country');

  // engineTotal + billed theo shipmentId
  const sum = await reconcileShipments({ carrierKey: 'fedex', topN: 10_000 });
  const eng = new Map(sum.rows.map((r) => [r.shipmentId, r]));

  const conds = [
    eq(schema.shipments.carrierKey, 'fedex'),
    isNotNull(schema.shopifyOrders.shipPostcode),
    isNotNull(schema.shipments.dimLengthCm),
    isNotNull(schema.shipments.labelCreatedAt),
  ];
  if (country) conds.push(eq(schema.shopifyOrders.shipCountry, country));

  const orders = await db.select({
    sid: schema.shipments.id, ord: schema.shopifyOrders.shopifyOrderNumber,
    hub: schema.shipments.originHub, country: schema.shopifyOrders.shipCountry,
    postcode: schema.shopifyOrders.shipPostcode, wt: schema.shipments.actualWeightKg,
    l: schema.shipments.dimLengthCm, w: schema.shipments.dimWidthCm, h: schema.shipments.dimHeightCm,
    date: schema.shipments.labelCreatedAt,
  }).from(schema.shipmentCharges)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentCharges.shipmentId))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .where(and(...conds))
    .orderBy(desc(schema.shipments.labelCreatedAt))
    .limit(limit);

  console.log(`Đối soát 3 chiều ${orders.length} đơn FedEx (PRE-VAT)\n`);
  console.log('Đơn\tNước\tcân\tbilled(−VAT)\tFedEx ACCOUNT\tdịch vụ\tΔ(bill−FedEx)\tΔ%\tengine');

  let matched = 0, sumAbsPct = 0, counted = 0;
  for (const o of orders) {
    const r = eng.get(o.sid);
    if (!r || r.engineTotal === null) continue;
    const billedPreVat = r.billedTotal - (r.billedVat ?? 0);
    const shipperPostal = HUB_POSTAL[o.hub ?? ''] ?? '700000';
    let quotes: RateQuoteResult[] = [];
    try {
      const res = await quoteRate({
        shipperCountryCode: 'VN', shipperPostalCode: shipperPostal,
        recipientCountryCode: o.country!, recipientPostalCode: o.postcode!,
        weightKg: Number(o.wt), dimsCm: { length: Number(o.l), width: Number(o.w), height: Number(o.h) },
        shipDate: o.date!.toISOString().slice(0, 10),
      });
      quotes = res.quotes.filter((q) => q.rateType === 'ACCOUNT');
    } catch (e) {
      console.log(`${o.ord}\t${o.country}\tQUOTE LỖI: ${(e as Error).message.slice(0, 80)}`);
      await sleep(400); continue;
    }
    if (quotes.length === 0) { console.log(`${o.ord}\t${o.country}\t(không có quote ACCOUNT)`); await sleep(400); continue; }
    // dịch vụ ACCOUNT khớp nhất với billed pre-VAT
    const best = quotes.reduce((a, b) => Math.abs(b.totalNetCharge - billedPreVat) < Math.abs(a.totalNetCharge - billedPreVat) ? b : a);
    const delta = billedPreVat - best.totalNetCharge;
    const pct = billedPreVat > 0 ? (delta / billedPreVat) * 100 : 0;
    counted += 1; sumAbsPct += Math.abs(pct);
    if (Math.abs(pct) <= 3) matched += 1;
    console.log(`${o.ord}\t${o.country}\t${Number(o.wt)}\t${vnd(billedPreVat)}\t${vnd(best.totalNetCharge)}\t${best.serviceType.replace('FEDEX_INTERNATIONAL_', 'IP_').slice(0, 14)}\t${vnd(delta)}\t${pct.toFixed(1)}\t${vnd(r.engineTotal)}`);
    await sleep(350); // nhẹ tay với rate limit prod
  }

  console.log(`\n${counted} đơn quote OK | khớp ±3%: ${matched} | |Δ%| trung bình: ${counted ? (sumAbsPct / counted).toFixed(1) : '—'}%`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
