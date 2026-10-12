/**
 * ĐO bảng giá UPS từ Rating API — chỉ đọc, ghi kết quả ra tệp JSON.
 *
 * Vì sao phải đo chứ không suy từ % chiết khấu trong hợp đồng: hợp đồng chiết khấu theo HAI
 * trục mà bảng giá trong hệ thống chỉ có một. Ngoài 10 cột Zone còn 5 cột LANE riêng cho
 * HK · SG · TW · AU · NZ, và chúng ĐÈ lên zone (Expedited 0,01–5kg: Zone 3 = 84,20% nhưng
 * lane AU/NZ = 69,60%). Lượt nhập trước chỉ lấy cột Zone nên AU·NZ·TW ăn chiết khấu Nhật/Hàn
 * còn SG·HK ăn chiết khấu Thái — sai từ −48,0% tới +82,5%.
 *
 * Hợp đồng còn MRPP (giá sàn mỗi kiện, tính từ biểu 0,5kg): "UPS áp giá sàn khi nó cao hơn
 * giá đã chiết khấu". Sàn ăn vào bậc 1kg của Zone 3 (−18,1%) và Zone 4 (−19,1%).
 *
 * Hai cơ chế chồng nhau nên vá từng ô sẽ còn sót. Cách chắc chắn: hỏi thẳng UPS từng nước ×
 * từng bậc rồi NHÓM theo giá đo được — nước nào lệch thang thì tự nó tách ra, không cần ai
 * nhớ rằng nó là lane. Đó chính là cách lẽ ra đã bắt được AU ngay từ đầu.
 *
 * Hai pha để đỡ số lượt gọi:
 *   1. mỗi nước đo 3 bậc (1 · 5 · 20kg) → nhóm các nước có cùng bộ ba;
 *   2. mỗi NHÓM đo nốt 17 bậc còn lại.
 *
 *   npx dotenv -- npx tsx scripts/do-bang-gia-ups.ts --out /duong/dan/ketqua.json
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { baoGiaUpsShop } from '@/lib/ups/rate';

const UPS = '46fa242a-d9e6-4bbc-a0ae-2549b84c9ade';
/** Biểu mà bảng giá nội bộ đang dùng — tên tài khoản là "UPS Worldwide Expedited". */
const DICH_VU = '08';
const BAC = Array.from({ length: 20 }, (_, i) => i + 1);
const BAC_MAU = [1, 5, 20];

interface Dich { nuoc: string; pc: string; city: string }

/** Gọi có thử lại: UPS thỉnh thoảng rơi một nhịp (bậc 14kg của SG, 12/10/2026). */
async function base(d: Dich, kg: number): Promise<number | null> {
  for (let lan = 1; lan <= 3; lan++) {
    const r = await baoGiaUpsShop({
      soTaiKhoan: process.env.UPS_ACCOUNT_NUMBER!, nuocDen: d.nuoc,
      maBuuChinh: d.pc || undefined, thanhPho: d.city || undefined,
      canKg: kg, kyNhan: false, nhaDan: false,
    });
    if (r.ok) return r.ds.find((x) => x.maDichVu === DICH_VU)?.base ?? null;
    // Tuyến không có dịch vụ này (111217) thì thử lại cũng vậy — dừng ngay.
    if (/111217|111210/.test(r.loi)) return null;
    await new Promise((s) => setTimeout(s, lan * 1000));
  }
  return null;
}

async function main() {
  const out = process.argv[process.argv.indexOf('--out') + 1];
  if (!out || out.startsWith('--')) throw new Error('thiếu --out <đường dẫn>');
  if (!process.env.UPS_ACCOUNT_NUMBER) throw new Error('chưa khai UPS_ACCOUNT_NUMBER');

  /* Nước đích THẬT (shopify_orders, ≥3 đơn, có mã bưu chính mẫu) + HK và MO thêm tay: HK là
   * LANE trong hợp đồng mà mình chưa từng gửi nên không có trong dữ liệu đơn — đúng chỗ lượt
   * soi trước trượt. */
  const r = await db.execute(sql.raw(`
    select upper(trim(ship_country)) as nuoc, max(ship_postcode) as pc, max(upper(ship_city)) as city
    from shopify_orders
    where ship_country is not null and length(trim(ship_country))=2
      and ship_postcode is not null and ship_postcode <> ''
    group by 1 having count(*) >= 3`));
  const dich: Dich[] = ((r as unknown as { rows?: Array<{ nuoc: string; pc: string; city: string }> }).rows ?? [])
    .filter((x) => x.nuoc !== 'VN')
    .map((x) => ({ nuoc: x.nuoc, pc: x.pc, city: (x.city ?? '').slice(0, 28) }));
  for (const them of [{ nuoc: 'HK', pc: '', city: 'HONG KONG' }, { nuoc: 'MO', pc: '', city: 'MACAU' }]) {
    if (!dich.some((d) => d.nuoc === them.nuoc)) dich.push(them);
  }
  console.log(`PHA 1 — đo ${dich.length} nước × ${BAC_MAU.length} bậc mẫu`);

  const mau = new Map<string, Array<number | null>>();
  for (const d of dich) {
    const bo: Array<number | null> = [];
    for (const kg of BAC_MAU) bo.push(await base(d, kg));
    mau.set(d.nuoc, bo);
    process.stdout.write(`  ${d.nuoc} ${bo.map((x) => (x == null ? '—' : Math.round(x))).join(' / ')}\n`);
  }

  // Nhóm theo bộ ba giá. Nước không đo được giữ riêng để người xem quyết.
  const nhom = new Map<string, string[]>();
  const khongDo: string[] = [];
  for (const [nuoc, bo] of mau) {
    if (bo.every((x) => x == null)) { khongDo.push(nuoc); continue; }
    const khoa = bo.map((x) => (x == null ? 'x' : Math.round(x))).join('|');
    nhom.set(khoa, [...(nhom.get(khoa) ?? []), nuoc]);
  }
  console.log(`\nPHA 2 — ${nhom.size} nhóm giá, đo nốt ${BAC.length - BAC_MAU.length} bậc mỗi nhóm`);

  const ketQua: Array<{ nuoc: string[]; thang: Record<number, number | null> }> = [];
  for (const [khoa, ds] of [...nhom.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const dd = dich.find((d) => d.nuoc === ds[0])!;
    const thang: Record<number, number | null> = {};
    BAC_MAU.forEach((kg, i) => { thang[kg] = mau.get(dd.nuoc)![i]; });
    for (const kg of BAC) if (!(kg in thang)) thang[kg] = await base(dd, kg);
    const thieu = BAC.filter((kg) => thang[kg] == null);
    console.log(`  [${ds.join(' ')}] theo ${dd.nuoc}${thieu.length ? ` · THIẾU bậc ${thieu.join(',')}` : ''}`);
    ketQua.push({ nuoc: ds.sort(), thang });
    void khoa;
  }
  if (khongDo.length) console.log(`\nKHÔNG đo được (UPS không khai thác tuyến này): ${khongDo.join(' ')}`);

  writeFileSync(out, JSON.stringify({
    luc: new Date().toISOString(), dichVu: DICH_VU, bac: BAC, nhom: ketQua, khongDo,
  }, null, 1));
  console.log(`\nĐã ghi ${out}`);
  process.exit(0);
}
void main();
