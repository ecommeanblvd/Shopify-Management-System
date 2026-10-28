/**
 * Sửa đơn ship hộ bị gắn SAI TÀI KHOẢN HÃNG: `carrier_key` nói hãng A, mà
 * `carrier_account_id` lại trỏ tài khoản của hãng B.
 *
 *   npx dotenv -- npx tsx scripts/du-lieu/sua-tai-khoan-hang-lech.ts                       # chỉ in
 *   npx dotenv -- npx tsx scripts/du-lieu/sua-tai-khoan-hang-lech.ts --don 26-INSLG-SV-0164 --ap-dung
 *
 * DRY-RUN LÀ MẶC ĐỊNH, và `--ap-dung` **bắt buộc đi kèm `--don`**: lệch hãng là dữ liệu vận
 * hành của một đơn thật, mỗi dòng phải có người xác nhận đúng hãng. Không có đường nào sửa cả
 * lô một lượt.
 *
 * ## Hãng ĐÚNG lấy từ đâu
 *
 * Từ **`carrier_key` của chính dòng đó**, không suy từ tiền tố mã vận đơn. Hai nguồn trong một
 * dòng đang đá nhau, nhưng chỉ `carrier_key` là trường người nhập chọn hãng; tài khoản thì
 * dính theo luồng báo giá. Suy từ mã vận đơn là đoán (`SF…` của SF Express, `1Z…` của UPS, 12
 * số của FedEx — và không có gì bảo đảm hãng không đổi khuôn mã).
 *
 * Nên lượt này KHÔNG BAO GIỜ tự chọn hãng: nó chỉ kéo tài khoản về cho khớp `carrier_key`, và
 * TỪ CHỐI nếu hãng đó không có đúng một tài khoản đang bật.
 *
 * ## KHÔNG đụng ảnh giá
 *
 * `carrier_cost_vnd` / `charged_vnd` / `quote_breakdown` là **ảnh chụp bất biến** lúc báo giá
 * (xem `db/schema.ts`), và chúng được tính trên bảng giá của tài khoản SAI. Đổi tài khoản
 * KHÔNG tính lại chúng — cố ý. Lượt này in ra số mà bảng giá của hãng ĐÚNG sẽ ra, để người
 * duyệt thấy khoản lệch và tự quyết; báo giá lại là việc khác, có người chốt.
 *
 * Đo 28/10/2026 trên `26-INSLG-SV-0164` (CN, 2,2 kg): bảng FedEx 1.579.244 VND · bảng SF
 * Express 1.050.300 VND. Ảnh đã ghi là 1.393.826 (bảng FedEx, fuel 49% của tháng 9).
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quoteShipHoOrder } from '@/features/ship-ho/quote-adapter';
import { docDanhSachDon, lyDoKhongApDung } from '@/features/ship-ho/lech-tai-khoan-hang';

/* `type` chứ KHÔNG `interface`: `db.execute<T>` đòi `T extends Record<string, unknown>`, và
 * chỉ type alias mới có index signature ngầm. Interface thì tsc từ chối. */
type Lech = {
  id: string; code: string; carrierKey: string;
  taiKhoanCuId: string; taiKhoanCuTen: string; hangCu: string;
  awb: string | null; gui: string | null;
  giaVonDaGhi: string | null; thuBrand: string | null; bangKeId: string | null;
};

async function main(): Promise<void> {
  const apDung = process.argv.includes('--ap-dung');
  const chon = docDanhSachDon(process.argv);

  console.log(apDung ? '*** ÁP DỤNG — SỬA THẬT ***\n' : '*** DRY-RUN — không sửa gì (thêm --don <mã> --ap-dung để sửa) ***\n');

  const lech = (await db.execute<Lech>(sql`
    select o.id, o.code, o.carrier_key as "carrierKey",
           ca.id as "taiKhoanCuId", ca.name as "taiKhoanCuTen", c.key as "hangCu",
           o.tracking_number as "awb", o.shipped_at::text as "gui",
           o.carrier_cost_vnd::text as "giaVonDaGhi", o.charged_vnd::text as "thuBrand",
           o.statement_id as "bangKeId"
    from ship_ho_orders o
    join carrier_accounts ca on ca.id = o.carrier_account_id
    join carriers c on c.id = ca.carrier_id
    where o.carrier_key is not null and o.carrier_key <> c.key
    order by o.code`)).rows;

  console.log(`Đơn ship hộ lệch hãng: ${lech.length}\n`);
  if (lech.length === 0) { console.log('Không có gì để sửa.'); process.exit(0); }

  // Tài khoản đích: ĐÚNG MỘT tài khoản đang bật của hãng mà `carrier_key` nói.
  const dich = new Map<string, { id: string; ten: string }>();
  for (const key of new Set(lech.map((l) => l.carrierKey))) {
    const ds = (await db.execute<{ id: string; ten: string }>(sql`
      select ca.id, ca.name as ten from carrier_accounts ca
      join carriers c on c.id = ca.carrier_id
      where c.key = ${key} and ca.enabled = true`)).rows;
    if (ds.length === 1) dich.set(key, ds[0]);
    else console.log(`⚠ hãng '${key}': có ${ds.length} tài khoản đang bật — KHÔNG tự chọn được.`);
  }

  for (const l of lech) {
    const d = dich.get(l.carrierKey);
    const nhan = chon.includes(l.code.toUpperCase()) ? '→ ĐƯỢC CHỌN' : '(không chọn)';
    console.log(`${l.code}  ${nhan}`);
    console.log(`  mã vận đơn      ${l.awb}  · ngày gửi ${l.gui}`);
    console.log(`  carrier_key     ${l.carrierKey}   ← coi là hãng ĐÚNG`);
    console.log(`  tài khoản ĐANG  ${l.taiKhoanCuTen} (hãng ${l.hangCu})`);
    console.log(`  tài khoản SẼ về ${d ? d.ten : 'KHÔNG XÁC ĐỊNH ĐƯỢC'}`);
    console.log(`  ảnh giá đã ghi  giá vốn ${l.giaVonDaGhi} · thu brand ${l.thuBrand} · bảng kê ${l.bangKeId ?? 'CHƯA có'}`);
    if (d) {
      const [o] = await db.select().from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, l.id));
      if (o) {
        const dims = o.dimLengthCm && o.dimWidthCm && o.dimHeightCm
          ? { lengthCm: Number(o.dimLengthCm), widthCm: Number(o.dimWidthCm), heightCm: Number(o.dimHeightCm) }
          : null;
        for (const [ten, acc] of [['hãng SAI (đang gắn)', l.taiKhoanCuId], ['hãng ĐÚNG', d.id]] as const) {
          const r = await quoteShipHoOrder({
            carrierAccountId: acc, weightKg: Number(o.weightKg), dimensions: dims,
            packagingType: (o.packagingType as 'bag' | 'box' | null) ?? null,
            destinationCountry: o.country, destinationPostcode: o.postcode ?? undefined,
            destinationCity: o.city ?? undefined,
          });
          console.log(`  bảng giá ${ten.padEnd(20)} ${r.ok ? `${r.carrierCostVnd.toLocaleString('vi-VN')} VND (${r.zone})` : `không báo được giá — ${r.reason}`}`);
        }
      }
    }
    console.log('');
  }

  if (!apDung) { console.log('Không sửa gì. Soi xong thì chạy lại với --don <mã> --ap-dung.'); process.exit(0); }
  const chan = lyDoKhongApDung(apDung, chon);
  if (chan) { console.log(`TỪ CHỐI: ${chan}`); process.exit(1); }

  let sua = 0;
  for (const l of lech) {
    if (!chon.includes(l.code.toUpperCase())) continue;
    const d = dich.get(l.carrierKey);
    if (!d) { console.log(`BỎ ${l.code}: không xác định được tài khoản đích.`); continue; }
    const r = await db.update(schema.shipHoOrders)
      // `ship_ho_orders` KHÔNG có cột `updated_at` — đừng thêm, tsc bắt ngay.
      .set({ carrierAccountId: d.id })
      .where(and(
        eq(schema.shipHoOrders.id, l.id),
        // Guard tài khoản CŨ: ai vừa sửa giữa lúc đọc và lúc ghi thì bỏ qua, không ghi đè.
        eq(schema.shipHoOrders.carrierAccountId, l.taiKhoanCuId),
      ));
    const n = (r as unknown as { rowCount?: number }).rowCount ?? 0;
    sua += n;
    console.log(`${n ? 'ĐÃ SỬA' : 'KHÔNG ĐỔI (đã bị ai sửa trước?)'} ${l.code} → ${d.ten}`);
  }

  const [{ conLai }] = (await db.execute<{ conLai: number }>(sql`
    select count(*)::int as "conLai" from ship_ho_orders o
    join carrier_accounts ca on ca.id = o.carrier_account_id
    join carriers c on c.id = ca.carrier_id
    where o.carrier_key is not null and o.carrier_key <> c.key`)).rows;
  console.log(`\nĐã sửa ${sua} đơn. Kiểm lại: còn ${conLai} đơn lệch hãng.`);
  process.exit(0);
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
