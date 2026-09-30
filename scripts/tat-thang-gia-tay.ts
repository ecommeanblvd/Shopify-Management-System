/**
 * TẮT thang giá tay "Express Shipping" trên một store Shopify (CEO 01/10/2026).
 *
 * Vì sao tắt: thang tay chạy SONG SONG với "Engine Carrier Rates"; Shopify hiện cả hai và khách
 * chọn rẻ hơn. Đo trên Tinh Atelier ở dải cân thật (0,5–5kg × 36 vùng): 168/180 ca thang tay rẻ
 * hơn engine, chênh 15–35 USD mỗi kiện. Tức thang tay đang làm TRẦN GIÁ cho engine.
 *
 * TẮT chứ KHÔNG XOÁ (`active: false`): đảo lại chỉ cần bật lên, không mất thang giá đã dựng.
 * Xoá 2.000 rate trên store đang bán mà muốn khôi phục thì phải dựng lại từ đầu.
 *
 * Luôn ghi ảnh chụp ra tệp TRƯỚC khi đụng, kể cả lượt chạy thử.
 *
 * Chạy: railway run --service Shopify-Management-System npx tsx scripts/tat-thang-gia-tay.ts <store> [--ap-dung]
 */
import { writeFileSync } from 'node:fs';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';

const TEN_RATE = 'Express Shipping';
const AP = process.argv.includes('--ap-dung');
const LO = 20; // rate mỗi mutation — chú thích trong shipping-profiles-actions cảnh báo Shopify 5xx khi mutation to

const DOC = `query {
  deliveryProfiles(first: 5) {
    edges { node { id name profileLocationGroups {
      locationGroup { id }
      locationGroupZones(first: 50) {
        edges { node {
          zone { id name }
          methodDefinitions(first: 60) {
            edges { node { id name active
              rateProvider { __typename ... on DeliveryRateDefinition { price { amount currencyCode } } } } }
          }
        } }
      }
    } } }
  }
}`;

const SUA = `mutation ($id: ID!, $profile: DeliveryProfileInput!) {
  deliveryProfileUpdate(id: $id, profile: $profile) {
    profile { id }
    userErrors { field message }
  }
}`;

interface Muc { profileId: string; profileName: string; lgId: string; zoneId: string; zoneName: string; id: string; gia: string }

async function main() {
  const ten = process.argv[2] ?? 'tinhatelier';
  const s = (await db.execute<Record<string, unknown>>(sql`SELECT id, shop_domain, api_version, scopes FROM stores WHERE name=${ten};`)).rows[0];
  if (!s) throw new Error(`Không thấy store "${ten}"`);
  const scopes = (s.scopes as string[]) ?? [];
  if (!scopes.includes('write_shipping')) throw new Error(`${ten}: THIẾU quyền write_shipping`);
  const token = await getStoreToken(s.id as string);
  const goi = (query: string, variables?: Record<string, unknown>) =>
    graphqlCall({ shopDomain: s.shop_domain as string, apiVersion: s.api_version as string, token, query, variables });

  const r = await goi(DOC);
  if (r.errors) throw new Error(`đọc: ${JSON.stringify(r.errors).slice(0, 200)}`);

  writeFileSync(`/tmp/anh-chup-ship-${ten}.json`, JSON.stringify(r.data, null, 2));
  console.log(`Ảnh chụp TRƯỚC khi đụng: /tmp/anh-chup-ship-${ten}.json`);

  const can: Muc[] = []; let giuLai = 0;
  for (const p of (r.data as any).deliveryProfiles.edges)
    for (const g of p.node.profileLocationGroups)
      for (const z of g.locationGroupZones.edges)
        for (const m of z.node.methodDefinitions.edges) {
          const n = m.node;
          if (n.name !== TEN_RATE) { if (n.active) giuLai++; continue; }
          if (!n.active) continue;
          can.push({ profileId: p.node.id, profileName: p.node.name, lgId: g.locationGroup.id,
            zoneId: z.node.zone.id, zoneName: z.node.zone.name, id: n.id,
            gia: n.rateProvider?.price ? `${n.rateProvider.price.amount} ${n.rateProvider.price.currencyCode}` : '?' });
        }

  console.log(`\nSẼ TẮT: ${can.length} rate tên "${TEN_RATE}" đang bật`);
  console.log(`GIỮ NGUYÊN: ${giuLai} rate khác đang bật (gồm Engine Carrier Rates)`);
  const theoVung = new Map<string, number>();
  for (const c of can) theoVung.set(`${c.profileName} › ${c.zoneName}`, (theoVung.get(`${c.profileName} › ${c.zoneName}`) ?? 0) + 1);
  console.log(`Trải trên ${theoVung.size} vùng.`);
  if (can.length === 0) { console.log('Không có gì để tắt.'); process.exit(0); }
  if (!AP) { console.log('\nCHỈ ĐẾM — thêm --ap-dung để tắt thật trên store đang bán.'); process.exit(0); }

  // Gom theo (profile, locationGroup, zone) rồi chia lô nhỏ.
  const theoZone = new Map<string, Muc[]>();
  for (const c of can) {
    const k = `${c.profileId}|${c.lgId}|${c.zoneId}`;
    theoZone.set(k, [...(theoZone.get(k) ?? []), c]);
  }
  let xong = 0, loi = 0;
  for (const [k, ds] of theoZone) {
    const [profileId, lgId, zoneId] = k.split('|');
    for (let i = 0; i < ds.length; i += LO) {
      const lo = ds.slice(i, i + LO);
      const res = await goi(SUA, { id: profileId, profile: { locationGroupsToUpdate: [{
        id: lgId, zonesToUpdate: [{ id: zoneId,
          methodDefinitionsToUpdate: lo.map((m) => ({ id: m.id, active: false })) }] }] } });
      const ue = (res.data as any)?.deliveryProfileUpdate?.userErrors ?? [];
      if (res.errors || ue.length) {
        loi += lo.length;
        console.log(`  ✗ ${ds[0].zoneName} lô ${i / LO + 1}: ${JSON.stringify(res.errors ?? ue).slice(0, 180)}`);
      } else { xong += lo.length; }
    }
  }
  console.log(`\nĐã tắt: ${xong} · lỗi: ${loi}`);

  const lai = await goi(DOC);
  let conBat = 0;
  for (const p of (lai.data as any).deliveryProfiles.edges)
    for (const g of p.node.profileLocationGroups)
      for (const z of g.locationGroupZones.edges)
        for (const m of z.node.methodDefinitions.edges)
          if (m.node.name === TEN_RATE && m.node.active) conBat++;
  console.log(`Kiểm lại trên Shopify: còn ${conBat} rate "${TEN_RATE}" đang bật.`);
  process.exit(0);
}
main();
