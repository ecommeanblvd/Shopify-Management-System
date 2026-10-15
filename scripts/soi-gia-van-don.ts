/**
 * SOI GIÁ THEO TỪNG VẬN ĐƠN — công cụ đối chiếu với màn hình cổng hãng.
 *
 *   railway run npx tsx scripts/soi-gia-van-don.ts 878631025811 878631980029
 *   railway run npx tsx scripts/soi-gia-van-don.ts --moi=10
 *   railway run npx tsx scripts/soi-gia-van-don.ts --moi=20 --chua-ghi
 *
 * In ra, cho mỗi mã: thông số THẬT đọc từ vận đơn (Track API), từng khoản tiền, và số phận
 * của từng ô trên Lark — ô nào sẽ được ghi, ô nào Lark đã có số và số đó là bao nhiêu.
 *
 * KHÔNG ghi gì lên Lark. Có một tác dụng phụ phải nói rõ: nó đi ĐÚNG đường của màn Phân tích
 * (`layGiaUocTinh`), nên có cập nhật dòng `fedex_rate_quotes` của kiện — đúng như khi nhân sự
 * bấm Phân tích. Kiện ĐÃ CÓ HOÁ ĐƠN thì chốt chặn trong `lay-gia-uoc-tinh.ts` giữ nguyên dòng
 * cũ, không đụng mốc đối soát (CEO chốt 15/10/2026: chỉ sửa từ nay, không làm lại lịch sử).
 */
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getLogRecordById } from '@/features/lark/client';
import { xemTruocGhiGia } from '@/features/lark/ghi-nguoc/patch-gia-uoc-tinh';
import { layGiaUocTinh } from '@/features/dong-hang/lay-gia-uoc-tinh';
import { moTaODich, nhanLarkDangCo, soInDam, tongUocTinh, vnd } from '@/features/dong-hang/xem-truoc-van-don';
import { layThongSoVanDon } from '@/lib/fedex/track';

const args = process.argv.slice(2);
const soMoi = Number(args.find((a) => a.startsWith('--moi='))?.slice(6) ?? 0);
const chuaGhi = args.includes('--chua-ghi');
const maTay = args.filter((a) => !a.startsWith('--'));

async function danhSach(): Promise<Array<{ id: string; tracking: string; maDon: string | null }>> {
  const dk = [eq(schema.shipments.carrierKey, 'fedex'), isNotNull(schema.shipments.trackingNumber)];
  if (maTay.length > 0) dk.push(inArray(schema.shipments.trackingNumber, maTay));
  if (chuaGhi) dk.push(isNull(schema.shipments.giaUocTinhGhiLuc));
  const r = await db.select({
    id: schema.shipments.id,
    tracking: schema.shipments.trackingNumber,
    maDon: schema.shopifyOrders.shopifyOrderNumber,
  }).from(schema.shipments)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .where(and(...dk))
    .orderBy(desc(schema.shipments.createdAt))
    .limit(maTay.length > 0 ? maTay.length : Math.max(soMoi, 1));
  return r.map((x) => ({ id: x.id, tracking: x.tracking as string, maDon: x.maDon }));
}

async function mot(k: { id: string; tracking: string; maDon: string | null }) {
  console.log(`\n${'='.repeat(78)}\n${k.tracking}  ${k.maDon ?? ''}`);

  const ts = await layThongSoVanDon(k.tracking);
  if (!ts) {
    console.log('  ⚠️  FedEx CHƯA có dữ liệu tra cứu cho mã này — giá dưới đây là DỰNG LẠI từ');
    console.log('      cân/kích thước trong hệ thống, có thể lệch với số hãng hiện trên cổng.');
  } else {
    const kt = ts.kichThuocCm;
    console.log(`  thông số NHÃN: ${ts.loaiBaoGoi ?? '?'} · ${ts.dichVu ?? '?'} · ${ts.canKg ?? '?'} kg · `
      + `${kt ? `${kt.dai}x${kt.rong}x${kt.cao} cm` : 'không có dim'} · `
      + `nhà dân ${ts.nhaDan === null ? '?' : ts.nhaDan ? 'CÓ' : 'KHÔNG'} · `
      + `ký nhận ${ts.kyNhanTrucTiep ? 'CÓ' : 'KHÔNG'} · gửi ${ts.ngayGui ?? '?'}`
      + (ts.maThamChieu ? ` · ref ${ts.maThamChieu}` : ''));
  }

  /* Kiện ĐÃ CÓ HOÁ ĐƠN thì `layGiaUocTinh` giữ nguyên dòng quote cũ — đó là mốc đối soát,
   * CEO chốt không làm lại lịch sử. Phải nói ra, nếu không người đọc thấy dòng "thông số
   * NHÃN: FEDEX_PAK" ngay trên một con số tính theo thang HỘP mà tưởng là đã đúng. */
  const [hd] = await db.select({ id: schema.shipmentCharges.id }).from(schema.shipmentCharges)
    .where(eq(schema.shipmentCharges.shipmentId, k.id)).limit(1);
  if (hd) {
    console.log('  ℹ️  kiện ĐÃ CÓ HOÁ ĐƠN → giữ nguyên dòng quote cũ làm mốc đối soát;');
    console.log('      số dưới đây là của dòng cũ, KHÔNG phải vừa hỏi lại theo thông số nhãn.');
  }

  const gia = await layGiaUocTinh(k.id, k.tracking);
  if (!gia) { console.log('  ✗ KHÔNG lấy được giá (thiếu cân/nước, hãng không trả lời, hoặc sai đơn vị tiền)'); return; }

  const [s] = await db.select({ rid: schema.shipments.larkRecordId }).from(schema.shipments)
    .where(eq(schema.shipments.id, k.id)).limit(1);
  const rec = s?.rid ? await getLogRecordById(s.rid) : null;
  if (!rec) {
    console.log(`  tổng: ${vnd(gia.total)}   (không đọc được dòng Lark — chỉ in giá)`);
    return;
  }

  const xem = xemTruocGhiGia(gia, rec.fields as Record<string, unknown>, k.tracking);
  console.log(`  TỔNG HÃNG BÁO: ${vnd(tongUocTinh(xem))}`);
  for (const d of xem.dong) {
    const dau = d.trangThai === 'se-ghi' ? '+' : d.trangThai === 'da-co-so' ? '!' : ' ';
    const phu = nhanLarkDangCo(d);
    console.log(`   ${dau} ${d.cot.padEnd(26)} ${soInDam(d).padStart(14)}${phu ? `   ← ${phu}` : ''}`);
    if (d.trangThai === 'da-co-so') console.log(`       ${moTaODich(d)}`);
  }
  if (xem.canhBao.length > 0) for (const c of xem.canhBao) console.log(`   ⚠️  ${c}`);
}

async function main() {
  if (maTay.length === 0 && soMoi <= 0) {
    console.error('Dùng: soi-gia-van-don.ts <mã...> | --moi=<N> [--chua-ghi]');
    process.exit(1);
  }
  const ds = await danhSach();
  if (ds.length === 0) { console.log('Không có kiện nào khớp.'); process.exit(0); }
  console.log(`Soi ${ds.length} vận đơn. Dấu: "+" ô Lark trống sẽ ghi · "!" Lark đã có số, KHÔNG đè.`);
  for (const k of ds) {
    try { await mot(k); } catch (e) { console.log(`  ✗ hỏng: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`); }
  }
  process.exit(0);
}
main();
