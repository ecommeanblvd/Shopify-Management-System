/**
 * Thang giá TAY trên Shopify đang rẻ hơn hay đắt hơn giá ENGINE? (CEO 01/10/2026)
 *
 * Tinh Atelier có thang "Express Shipping" theo bậc cân chạy SONG SONG với "Engine Carrier
 * Rates". Shopify hiện cả hai, khách chọn rẻ hơn — nên bậc nào rẻ hơn engine là bậc đó làm
 * TRẦN GIÁ, engine tính đúng bao nhiêu cũng vô nghĩa.
 *
 * Cách so: giá tay trong một bậc là CỐ ĐỊNH, giá engine TĂNG theo cân. Nên chỉ cần tính engine
 * ở hai đầu bậc là kết luận được cho cả bậc:
 *   tay < engine(đầu nhẹ)  → RẺ HƠN SUỐT BẬC (luôn hụt)
 *   tay > engine(đầu nặng) → ĐẮT HƠN SUỐT BẬC
 *   còn lại                → cắt nhau trong bậc
 *
 * Dùng ĐÚNG đường engine của checkout (loadAccountSnapshot + computeCheckoutRates) chứ không
 * dựng lại công thức — dựng lại là so với một engine khác.
 */
import { db } from '@/db/client';
import { sql, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { computeCheckoutRates, locCarrierCheckout, type CheckoutRateCarrier } from '@/features/carrier-rates/checkout-rates';

const Q = `query {
  deliveryProfiles(first: 5) { edges { node { name profileLocationGroups {
    locationGroupZones(first: 50) { edges { node {
      zone { name countries { code { countryCode restOfWorld } } }
      methodDefinitions(first: 60) { edges { node { name active
        rateProvider { __typename ... on DeliveryRateDefinition { price { amount currencyCode } } }
        methodConditions { field operator conditionCriteria { ... on Weight { value unit } } }
      } } }
    } } } } } } }
}`;

interface Bac { min: number; max: number; gia: number; tien: string }

async function main() {
  const ten = process.argv[2] ?? 'tinhatelier';
  const s = (await db.execute<Record<string, unknown>>(sql`SELECT id, shop_domain, api_version FROM stores WHERE name=${ten};`)).rows[0];
  const r = await graphqlCall({ shopDomain: s.shop_domain as string, apiVersion: s.api_version as string,
    token: await getStoreToken(s.id as string), query: Q });
  if (r.errors) { console.log('LỖI Shopify:', JSON.stringify(r.errors).slice(0, 300)); process.exit(1); }

  const accts = locCarrierCheckout(await db.select({
    id: schema.carrierAccounts.id, name: schema.carrierAccounts.name,
    key: schema.carriers.key, enabled: schema.carrierAccounts.enabled,
  }).from(schema.carrierAccounts).innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId)));

  const snapTheoNuoc = new Map<string, CheckoutRateCarrier[]>();
  async function giaEngine(nuoc: string, kg: number): Promise<{ gia: number; tien: string } | null> {
    if (!snapTheoNuoc.has(nuoc)) {
      const cs: CheckoutRateCarrier[] = [];
      for (const a of accts) {
        const snap = await loadAccountSnapshot(a.id, new Date(), { remoteCountry: nuoc, remotePostcodes: [] });
        if (snap) cs.push({ carrierKey: a.key ?? a.id, snapshot: snap });
      }
      snapTheoNuoc.set(nuoc, cs);
    }
    const rates = computeCheckoutRates({ country: nuoc, weightKg: kg, carriers: snapTheoNuoc.get(nuoc)! });
    const ex = rates.find((x) => x.service_code === 'express');
    return ex ? { gia: Number(ex.total_price) / 100, tien: ex.currency } : null;
  }

  const ket: Array<Record<string, unknown>> = [];
  let tongBac = 0, reHon = 0, datHon = 0, catNhau = 0, khongTinh = 0, khacTien = 0;

  for (const p of (r.data as any).deliveryProfiles.edges) {
    for (const g of p.node.profileLocationGroups) {
      for (const z of g.locationGroupZones.edges) {
        const zone = z.node.zone;
        const nuoc = (zone.countries ?? []).map((c: any) => c?.code?.countryCode).filter(Boolean) as string[];
        if (nuoc.length === 0) continue;
        const dai = nuoc[0];
        const bac: Bac[] = [];
        for (const m of z.node.methodDefinitions.edges) {
          const n = m.node;
          if (!n.active || !n.rateProvider?.price) continue;
          let lo = 0, hi = Infinity;
          for (const c of n.methodConditions ?? []) {
            const v = c.conditionCriteria?.value;
            if (v == null) continue;
            if (String(c.operator).startsWith('GREATER')) lo = Number(v);
            else hi = Number(v);
          }
          bac.push({ min: lo, max: hi === Infinity ? lo + 0.5 : hi, gia: Number(n.rateProvider.price.amount), tien: n.rateProvider.price.currencyCode });
        }
        if (bac.length === 0) continue;
        bac.sort((a, b) => a.min - b.min);
        let zReHon = 0, hutMax = 0, bacHutMax = '';
        for (const b of bac) {
          tongBac++;
          const eLo = await giaEngine(dai, Math.max(b.min, 0.1));
          const eHi = await giaEngine(dai, b.max);
          if (!eLo || !eHi) { khongTinh++; continue; }
          if (eLo.tien !== b.tien) { khacTien++; continue; }
          if (b.gia < eLo.gia) {
            reHon++; zReHon++;
            const hut = eHi.gia - b.gia;
            if (hut > hutMax) { hutMax = hut; bacHutMax = `${b.min}–${b.max}kg`; }
          } else if (b.gia > eHi.gia) datHon++;
          else catNhau++;
        }
        ket.push({ __bac: bac, vung: zone.name, nuoc: dai, soBac: bac.length, bacReHon: zReHon,
          hutLonNhat: hutMax > 0 ? `${Math.round(hutMax)} ${bac[0].tien} @ ${bacHutMax}` : '—' });
      }
    }
  }
  /* Khoảng cách lớn nhất luôn rơi vào bậc nặng nhất, mà 400–700kg thì không phải hàng thật của
   * một brand thời trang. Nên đo thêm ở DẢI CÂN THẬT — đây mới là con số quyết định được. */
  const CAN_THAT = [0.5, 1, 2, 3, 5];
  const thuc: Array<Record<string, unknown>> = [];
  let hutTong = 0, soCaHut = 0;
  for (const k of ket) {
    const zone = k.vung as string, dai = k.nuoc as string;
    const bacCua = (k.__bac as Bac[]) ?? [];
    const hang: Record<string, unknown> = { vung: zone, nuoc: dai };
    for (const kg of CAN_THAT) {
      const b = bacCua.find((x) => kg > x.min - 1e-9 && kg <= x.max + 1e-9);
      const e = await giaEngine(dai, kg);
      if (!b || !e || e.tien !== b.tien) { hang[`${kg}kg`] = '—'; continue; }
      const hut = Math.round(e.gia - b.gia);
      if (hut > 0) { hutTong += hut; soCaHut++; }
      hang[`${kg}kg`] = `${b.gia}/${Math.round(e.gia)}${hut > 0 ? ` (−${hut})` : ''}`;
    }
    thuc.push(hang);
  }
  console.log(`\nDẢI CÂN THẬT — "giá tay / giá engine (hụt)" tính bằng USD:`);
  console.table(thuc);
  console.log(`Số ca thang tay RẺ HƠN engine ở dải cân thật: ${soCaHut}/${ket.length * CAN_THAT.length}`);
  console.log(`Tổng hụt nếu mỗi ca xảy ra đúng một lần: ${hutTong.toLocaleString('vi-VN')} USD`);

  console.log(`\nTổng bậc so được: ${tongBac} · rẻ hơn engine SUỐT bậc: ${reHon} · đắt hơn: ${datHon} · cắt nhau: ${catNhau}`);
  if (khongTinh) console.log(`Engine không ra giá: ${khongTinh} bậc`);
  if (khacTien) console.log(`Khác đơn vị tiền, KHÔNG quy đổi (không bịa tỉ giá): ${khacTien} bậc`);
  console.table(ket.map(({ __bac, ...r }: any) => r));
  process.exit(0);
}
main();
