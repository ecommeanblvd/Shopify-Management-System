/**
 * Sửa dịch vụ bật trong DeliveryParticipant cho khớp thứ callback THỰC SỰ trả về.
 *
 * Sự cố 01/10/2026: Tinh Atelier không checkout được. Participant chỉ bật "FedEx International
 * Priority" — tên có từ trước D-071 (10/09, CEO đổi sang hai mức Standard/Express). Callback nay
 * trả "Standard Shipping"/"Express Shipping", Shopify lọc theo danh sách dịch vụ của participant
 * nên loại sạch → vùng không còn giá nào → "cannot be shipped to the selected address".
 *
 * Lỗi này CÓ TỪ TRƯỚC, bị thang giá tay che mất; tắt thang tay thì nó lộ ra.
 *
 * Đích đến là cấu hình của MEAN BLVD (đang chạy tốt): Standard Shipping + Express Shipping.
 * (Shopify KHÔNG có `adaptToNewServicesFlag` trong DeliveryParticipantInput — thử rồi, bị từ chối.
 *  Nên đổi tên mức lần sau vẫn phải chạy lại script này.)
 */
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { TEN_MUC } from '@/features/carrier-rates/hai-muc-giao';
import type { KetQuaDocShip, KetQuaUpdateShip } from './lib/shopify-ship-shape';

const AP = process.argv.includes('--ap-dung');
const DOC = `query {
  deliveryProfiles(first: 5) {
    edges {
      node {
        id
        name
        profileLocationGroups {
          locationGroup { id }
          locationGroupZones(first: 50) {
            edges {
              node {
                zone { id name }
                methodDefinitions(first: 5) {
                  edges {
                    node {
                      id
                      name
                      active
                      rateProvider {
                        __typename
                        ... on DeliveryParticipant {
                          carrierService { id name }
                                                    participantServices { name active }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;
const SUA = `mutation ($id: ID!, $profile: DeliveryProfileInput!) {
  deliveryProfileUpdate(id: $id, profile: $profile) { profile { id } userErrors { field message } }
}`;

async function main() {
  const ten = process.argv[2] ?? 'tinhatelier';
  const s = (await db.execute<Record<string, unknown>>(sql`SELECT id, shop_domain, api_version, scopes FROM stores WHERE name=${ten};`)).rows[0];
  if (!((s.scopes as string[]) ?? []).includes('write_shipping')) throw new Error(`${ten}: thiếu write_shipping`);
  const token = await getStoreToken(s.id as string);
  const goi = (query: string, variables?: Record<string, unknown>) =>
    graphqlCall({ shopDomain: s.shop_domain as string, apiVersion: s.api_version as string, token, query, variables });

  const r = await goi(DOC);
  if (r.errors) throw new Error(JSON.stringify(r.errors).slice(0, 200));
  const MUON = [TEN_MUC.standard, TEN_MUC.express];
  const can: Array<{ pid: string; lg: string; zid: string; zname: string; mid: string; csid: string; dang: string }> = [];
  let dungRoi = 0, thieuId = 0;
  for (const p of (r.data as KetQuaDocShip).deliveryProfiles?.edges ?? [])
    for (const g of p.node?.profileLocationGroups ?? [])
      for (const z of g.locationGroupZones?.edges ?? [])
        for (const m of z.node?.methodDefinitions?.edges ?? []) {
          const n = m.node;
          if (!n) continue;
          if (n.rateProvider?.__typename !== 'DeliveryParticipant') continue;
          const co = (n.rateProvider.participantServices ?? []).filter((x) => x.active).map((x) => x.name).sort();
          if (MUON.every((x) => co.includes(x)) && co.length === MUON.length) { dungRoi++; continue; }
          /* Thiếu BẤT KỲ id nào thì BỎ QUA và đếm riêng, KHÔNG dựng lệnh ghi với id rỗng.
           * Bản cũ dùng `any` nên bốn id này được coi như luôn có; thực tế Shopify có thể trả
           * null ở bất kỳ nhánh nào, và một `deliveryProfileUpdate` mang id rỗng là ghi vào
           * đâu không ai biết. Đây chính là chỗ `any` che mất. */
          const pid = p.node?.id, lg = g.locationGroup?.id, zid = z.node?.zone?.id, mid = n.id;
          const csid = n.rateProvider.carrierService?.id;
          if (!pid || !lg || !zid || !mid || !csid) { thieuId++; continue; }
          can.push({ pid, lg, zid, zname: z.node?.zone?.name ?? '(không tên)',
            mid, csid, dang: co.join(' | ') || '(rỗng)' });
        }
  console.log(`${ten}: ${dungRoi} participant đã đúng · ${can.length} cần sửa`);
  if (thieuId) console.log(`   ⚠ BỎ QUA ${thieuId} mức vì Shopify không trả đủ id — KHÔNG ghi mò`);
  const nhom = new Map<string, number>();
  for (const c of can) nhom.set(c.dang, (nhom.get(c.dang) ?? 0) + 1);
  for (const [k, v] of nhom) console.log(`   ${v} vùng đang bật: ${k}  →  ${MUON.join(' | ')}`);
  if (can.length === 0) { console.log('Không có gì để sửa.'); process.exit(0); }
  if (!AP) { console.log('\nCHỈ ĐẾM — thêm --ap-dung để sửa thật.'); process.exit(0); }

  let xong = 0, loi = 0;
  for (const c of can) {
    const res = await goi(SUA, { id: c.pid, profile: { locationGroupsToUpdate: [{ id: c.lg,
      zonesToUpdate: [{ id: c.zid, methodDefinitionsToUpdate: [{ id: c.mid, participant: {
        carrierServiceId: c.csid,
        participantServices: MUON.map((name) => ({ name, active: true })) } }] }] }] } });
    const ue = (res.data as KetQuaUpdateShip | null)?.deliveryProfileUpdate?.userErrors ?? [];
    if (res.errors || ue.length) { loi++; console.log(`  ✗ ${c.zname}: ${JSON.stringify(res.errors ?? ue).slice(0, 200)}`); }
    else xong++;
  }
  console.log(`\nĐã sửa: ${xong} · lỗi: ${loi}`);
  const lai = await goi(DOC);
  let sai = 0;
  for (const p of (lai.data as KetQuaDocShip).deliveryProfiles?.edges ?? [])
    for (const g of p.node?.profileLocationGroups ?? [])
      for (const z of g.locationGroupZones?.edges ?? [])
        for (const m of z.node?.methodDefinitions?.edges ?? []) {
          const n = m.node;
          if (!n) continue;
          if (n.rateProvider?.__typename !== 'DeliveryParticipant') continue;
          const co = (n.rateProvider.participantServices ?? []).filter((x) => x.active).map((x) => x.name);
          if (!MUON.every((x) => co.includes(x))) sai++;
        }
  console.log(`Kiểm lại trên Shopify: còn ${sai} participant chưa đúng.`);
  process.exit(0);
}
main();
