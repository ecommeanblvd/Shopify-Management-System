/**
 * Rà soát: cấu hình ship SỐNG trên Shopify của hai store có khớp nhau không (CEO 01/10/2026).
 *
 * Đọc thẳng `deliveryProfiles` của từng store rồi so từng vùng: nước nào thuộc vùng nào, có
 * những phương thức giao nào, giá bao nhiêu. KHÔNG so với bảng tham chiếu nội bộ — bảng
 * `market_store_overrides` chỉ có dòng cho cici-mean, nên nó không nói được gì về hai store này.
 *
 * SỐ PROFILE KHÁC NHAU KHÔNG PHẢI LỖI (CEO 01/10/2026): MEAN BLVD cần 2 profile vì gom nhiều
 * brand với thời gian sản xuất khác nhau; Tinh Atelier chỉ cần 1. Nên chỉ so vùng TRONG NHỮNG
 * PROFILE CẢ HAI BÊN ĐỀU CÓ, còn chênh lệch profile thì báo ở mục thông tin.
 *
 * Lý do tách như vậy: một phép rà báo động chuyện CỐ Ý thì lần sau không ai tin nó nữa — cùng
 * bài học với dải cảnh báo hàng đợi (đếm cả bản cố ý bỏ thì con số phình lên và mất uy tín).
 *
 * Chạy: railway run --service Shopify-Management-System npx tsx scripts/soi-ship-2-store.ts <chuan> <soi>
 */
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { SHIPPING_QUERY } from '@/features/settings-viewer/queries';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import type { ConnectorStore } from '@/lib/shopify/connector';
import { TEN_MUC } from '@/features/carrier-rates/hai-muc-giao';
import type { KetQuaShippingQuery } from '@/features/settings-viewer/queries';

/**
 * Dòng `stores` mà script này đọc — khai đúng cột trong câu SELECT, không `any`.
 *
 * `extends Record<string, unknown>`: `db.execute<T>` của drizzle đòi vậy. Và các cột nullable
 * khai đúng là nullable — `any` trước đây che mất chuyện `status` có thể NULL, rồi gán thẳng vào
 * `ConnectorStore.status` vốn chỉ nhận ba giá trị.
 */
interface DongStore extends Record<string, unknown> {
  id: string; shop_domain: string; api_version: string;
  status: string | null; maintenance_mode: boolean | null; scopes: string[] | null;
}

/** Tên mức mà callback THỰC SỰ trả về — participant phải bật đúng những tên này. */
const MUC_ENGINE = [TEN_MUC.standard, TEN_MUC.express];

interface PhuongThuc { ten: string; gia: string | null }
interface Vung { ten: string; nuoc: string[]; restOfWorld: boolean; pt: PhuongThuc[]; dvSai: string[] }

/** Bóc cây deliveryProfiles → danh sách vùng phẳng, sắp xếp ổn định để so được. */
function bocVung(raw: unknown): Map<string, Vung> {
  const ra = new Map<string, Vung>();
  const profiles = (raw as KetQuaShippingQuery)?.deliveryProfiles?.edges ?? [];
  for (const p of profiles) {
    const groups = p?.node?.profileLocationGroups ?? [];
    for (const g of groups) {
      for (const z of g?.locationGroupZones?.edges ?? []) {
        const zone = z?.node?.zone;
        if (!zone?.name) continue;
        const nuoc: string[] = []; let row = false;
        for (const c of zone.countries ?? []) {
          if (c?.code?.restOfWorld) row = true;
          else if (c?.code?.countryCode) nuoc.push(String(c.code.countryCode));
        }
        const pt: PhuongThuc[] = [];
        const dvSai: string[] = [];
        for (const m of z?.node?.methodDefinitions?.edges ?? []) {
          const n = m?.node;
          if (!n?.name) continue;
          if (n.active === false) continue; // rate đã tắt không ra checkout → không phải lệch
          const gia = n.rateProvider?.price ? `${n.rateProvider.price.amount} ${n.rateProvider.price.currencyCode}` : null;
          pt.push({ ten: String(n.name), gia });
          /* Participant chỉ chuyển tiếp giá có TÊN nằm trong participantServices đang bật. Tên
             không khớp thứ callback trả về thì vùng câm lặng — xem ghi chú ở settings-viewer. */
          if (n.rateProvider?.__typename === 'DeliveryParticipant') {
            const bat = (n.rateProvider.participantServices ?? []).filter((x) => x.active).map((x) => String(x.name));
            for (const can of MUC_ENGINE) if (!bat.includes(can)) dvSai.push(`${zone.name}: thiếu "${can}" (đang bật: ${bat.join(', ') || 'rỗng'})`);
          }
        }
        const key = `${p.node?.name ?? '(không tên)'} › ${zone.name}`;
        ra.set(key, { ten: key, nuoc: nuoc.sort(), restOfWorld: row, pt: pt.sort((a, b) => a.ten.localeCompare(b.ten)), dvSai });
      }
    }
  }
  return ra;
}

const bang = (v: Vung) => v.pt.map((p) => `${p.ten}=${p.gia ?? 'carrier'}`).join(' | ');

/* Gọi thẳng GraphQL: cờ `settings-viewer` là cờ MỞ MÀN HÌNH, không phải quyền. Vẫn giữ phép
 * kiểm quyền THẬT (scope read_shipping / write_shipping) và trạng thái store. */
async function docShip(s: ConnectorStore): Promise<unknown> {
  if (s.status !== 'active') throw new Error(`${s.shopDomain}: store không active (${s.status})`);
  const co = s.scopes.includes('read_shipping') || s.scopes.includes('write_shipping');
  if (!co) throw new Error(`${s.shopDomain}: THIẾU quyền read_shipping — scopes: ${s.scopes.join(', ')}`);
  const token = await getStoreToken(s.id);
  const r = await graphqlCall({ shopDomain: s.shopDomain, apiVersion: s.apiVersion, token, query: SHIPPING_QUERY });
  if (r.errors) throw new Error(`${s.shopDomain}: ${JSON.stringify(r.errors).slice(0, 200)}`);
  return r.data;
}

async function layStore(ten: string): Promise<ConnectorStore> {
  const r = await db.execute<DongStore>(sql`SELECT id, shop_domain, api_version, status, maintenance_mode, scopes
     FROM stores WHERE name = ${ten} LIMIT 1;`);
  const s = r.rows[0];
  if (!s) throw new Error(`Không thấy store "${ten}"`);
  /* Store THIẾU `status` thì coi là `disconnected`, không coi là `active`: `docShip` chặn theo
   * đúng trường này, nên đoán sai hướng kia là mở đường gọi Shopify cho một store chưa nối. */
  const tt = s.status === 'active' || s.status === 'error' ? s.status : 'disconnected';
  return { id: s.id, shopDomain: s.shop_domain, apiVersion: s.api_version,
    status: tt, maintenanceMode: s.maintenance_mode ?? false, scopes: s.scopes ?? [] };
}

async function main() {
  const [tenChuan, tenSoi] = [process.argv[2] ?? 'meanblvd', process.argv[3] ?? 'tinhatelier'];
  const A = await layStore(tenChuan), B = await layStore(tenSoi);
  console.log(`CHUẨN: ${A.shopDomain}\nSOI  : ${B.shopDomain}\n`);
  const va = bocVung(await docShip(A));
  const vb = bocVung(await docShip(B));
  console.log(`Vùng giao hàng: ${tenChuan} ${va.size} · ${tenSoi} ${vb.size}\n`);

  // Tách profile ra: chỉ so vùng trong profile CẢ HAI bên đều có.
  const prof = (k: string) => k.split(' › ')[0];
  const pa = new Set([...va.keys()].map(prof)), pb = new Set([...vb.keys()].map(prof));
  const chung = [...pa].filter((x) => pb.has(x));
  console.log('PROFILE — thông tin, không phải lỗi:');
  console.log(`   ${tenChuan}: ${[...pa].join(' | ')}`);
  console.log(`   ${tenSoi}: ${[...pb].join(' | ')}`);
  const rieng = [...pa].filter((x) => !pb.has(x)).concat([...pb].filter((x) => !pa.has(x)));
  if (rieng.length) console.log(`   Chỉ một bên có: ${rieng.join(' | ')} — số profile khác nhau là CHỦ Ý, không so.`);
  console.log(`   So vùng trong ${chung.length} profile chung: ${chung.join(' | ')}\n`);

  const moi = [...new Set([...va.keys(), ...vb.keys()])].filter((k) => chung.includes(prof(k))).sort();
  const thieu: string[] = [], thua: string[] = [];
  const lechNuoc: { vung: string; chiCoOChuan: string; chiCoOSoi: string; restOfWorld: string }[] = [];
  const lechGia: { vung: string; chuan: string; soi: string }[] = [];
  for (const k of moi) {
    const a = va.get(k), b = vb.get(k);
    if (a && !b) { thieu.push(k); continue; }
    if (!a && b) { thua.push(k); continue; }
    if (!a || !b) continue;
    const chiA = a.nuoc.filter((c) => !b.nuoc.includes(c));
    const chiB = b.nuoc.filter((c) => !a.nuoc.includes(c));
    if (chiA.length || chiB.length || a.restOfWorld !== b.restOfWorld) {
      lechNuoc.push({ vung: k, chiCoOChuan: chiA.join(',') || '—', chiCoOSoi: chiB.join(',') || '—',
        restOfWorld: a.restOfWorld === b.restOfWorld ? '=' : `${a.restOfWorld} vs ${b.restOfWorld}` });
    }
    if (bang(a) !== bang(b)) lechGia.push({ vung: k, chuan: bang(a) || '—', soi: bang(b) || '—' });
  }
  for (const [nhan, m] of [[tenChuan, va], [tenSoi, vb]] as const) {
    const sai = [...m.values()].flatMap((v) => v.dvSai);
    console.log(sai.length === 0
      ? `PARTICIPANT ${nhan}: mọi vùng nhận đúng ${MUC_ENGINE.join(' + ')} ✓`
      : `!! PARTICIPANT ${nhan}: ${sai.length} vùng KHÔNG nhận đúng tên mức — engine câm lặng ở đó`);
    sai.slice(0, 6).forEach((x) => console.log(`     ${x}`));
  }
  console.log('');
  console.log(`THIẾU ở ${tenSoi} (có bên chuẩn, không có bên soi): ${thieu.length}`);
  thieu.forEach((k) => console.log(`   − ${k}  [${va.get(k)!.nuoc.length} nước] ${bang(va.get(k)!)}`));
  console.log(`\nTHỪA ở ${tenSoi} (không có bên chuẩn): ${thua.length}`);
  thua.forEach((k) => console.log(`   + ${k}  [${vb.get(k)!.nuoc.length} nước] ${bang(vb.get(k)!)}`));
  console.log(`\nLỆCH DANH SÁCH NƯỚC: ${lechNuoc.length}`);
  if (lechNuoc.length) console.table(lechNuoc);
  console.log(`\nLỆCH PHƯƠNG THỨC / GIÁ: ${lechGia.length}`);
  if (lechGia.length) lechGia.forEach((x)=>console.log(`\n  ${x.vung}\n    chuẩn: ${x.chuan}\n    soi  : ${x.soi}`));
  process.exit(0);
}
main();
