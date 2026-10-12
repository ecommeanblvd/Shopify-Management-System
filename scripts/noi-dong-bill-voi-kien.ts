/**
 * Nối DÒNG HOÁ ĐƠN với KIỆN (`carrier_bill_lines.shipment_id`) cho những dòng đã nhập trước
 * khi đường FBO biết ghi cột này.
 *
 * Vì sao cần: đường FBO (FedEx + UPS) chèn dòng bill mà KHÔNG ghi `shipment_id` — đo
 * 12/10/2026: 0/3.525 dòng FedEx và 0/37 dòng UPS có liên kết, trong khi đường DHL/Aramex
 * (`napShipmentChoDongBill`) thì có. Ba chỗ vì thế mù với FedEx/UPS:
 *   · `reconcile.ts` — tỉ giá theo CHÍNH hoá đơn khi đối soát; thiếu thì rơi về tỉ giá hiện
 *     tại của tài khoản, hoá đơn càng cũ càng lệch;
 *   · `pdfBillByShipment` — link xem PDF hoá đơn theo vận đơn, chưa bao giờ hiện;
 *   · `bills-actions` — suy mã đơn từ kiện cho dòng bill thiếu mã (78/93 dòng suy được sau
 *     khi vá).
 * Bản thân lỗi đã sửa ở `fbo-import-actions.ts`; script này lo phần dữ liệu cũ.
 *
 * KHỚP THEO MÃ VẬN ĐƠN, và chỉ khi khớp DUY NHẤT. Đo trên toàn bộ dữ liệu thật: 0 mã trùng
 * trong `shipments`, 0 dòng bill khớp nhiều kiện — nhưng phép kiểm vẫn nằm trong câu lệnh,
 * vì "hôm nay không trùng" không phải là "không bao giờ trùng".
 *
 *   npx dotenv -- npx tsx scripts/noi-dong-bill-voi-kien.ts
 *   npx dotenv -- npx tsx scripts/noi-dong-bill-voi-kien.ts --hang fedex,ups --apply
 */
import 'dotenv/config';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

/** Chỉ nhận khoá hãng có thật — chuỗi đi thẳng vào câu lệnh nên không được để người gõ tự do. */
const HANG_HOP_LE = new Set(['fedex', 'ups', 'dhl', 'aramex', 'sf-express']);

const apply = process.argv.includes('--apply');
const i = process.argv.indexOf('--hang');
const hang = (i >= 0 ? (process.argv[i + 1] ?? '') : 'fedex,ups').split(',').map((x) => x.trim()).filter(Boolean);
if (hang.length === 0 || hang.some((h) => !HANG_HOP_LE.has(h))) {
  throw new Error(`--hang chỉ nhận: ${[...HANG_HOP_LE].join(', ')}`);
}
const dsHang = hang.map((h) => `'${h}'`).join(',');

/** Dòng chưa nối, có mã vận đơn, thuộc hãng đang xét, và mã đó khớp ĐÚNG MỘT kiện. */
const DIEU_KIEN = `
  l.shipment_id is null
  and l.tracking_number is not null and l.tracking_number <> ''
  and b.carrier_account_id = a.id and a.carrier_id = c.id and c.key in (${dsHang})
  and (select count(*) from shipments s2 where s2.tracking_number = l.tracking_number) = 1`;

async function main() {
  console.log(apply ? '>>> GHI THẬT (--apply)' : '>>> CHẠY THỬ — chưa ghi gì. Thêm --apply để ghi.');
  console.log(`Hãng xét: ${hang.join(', ')}\n`);

  const dem = await db.execute(sql.raw(`
    select c.key as hang, count(*) as noi_duoc
    from carrier_bill_lines l
    join carrier_bills b on b.id = l.bill_id
    join carrier_accounts a on a.id = b.carrier_account_id
    join carriers c on c.id = a.carrier_id
    join shipments s on s.tracking_number = l.tracking_number
    where ${DIEU_KIEN}
    group by 1 order by 1`));
  const rows = ((dem as unknown as { rows?: Array<{ hang: string; noi_duoc: string }> }).rows) ?? [];
  if (rows.length === 0) { console.log('Không còn dòng nào để nối.'); process.exit(0); }
  let tong = 0;
  for (const r of rows) { console.log(`  ${r.hang.padEnd(10)} ${String(r.noi_duoc).padStart(6)} dòng`); tong += Number(r.noi_duoc); }
  console.log(`  ${'TỔNG'.padEnd(10)} ${String(tong).padStart(6)} dòng`);

  const mau = await db.execute(sql.raw(`
    select c.key as hang, l.tracking_number, l.order_number, o.shopify_order_number as ma_don_cua_kien
    from carrier_bill_lines l
    join carrier_bills b on b.id = l.bill_id
    join carrier_accounts a on a.id = b.carrier_account_id
    join carriers c on c.id = a.carrier_id
    join shipments s on s.tracking_number = l.tracking_number
    join shopify_orders o on o.id = s.order_id
    where ${DIEU_KIEN}
    limit 5`));
  console.log('\nMẫu 5 dòng sẽ nối:');
  for (const r of (((mau as unknown as { rows?: unknown[] }).rows) ?? [])) console.log('  ', JSON.stringify(r));

  if (!apply) { console.log('\nXong — chưa ghi gì.'); process.exit(0); }

  const kq = await db.execute(sql.raw(`
    update carrier_bill_lines l set shipment_id = s.id
    from shipments s, carrier_bills b, carrier_accounts a, carriers c
    where s.tracking_number = l.tracking_number and b.id = l.bill_id and ${DIEU_KIEN}`));
  console.log(`\nĐã nối ${(kq as unknown as { rowCount?: number }).rowCount ?? tong} dòng.`);
  process.exit(0);
}
void main();
