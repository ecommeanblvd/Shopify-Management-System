/**
 * Gửi ảnh chụp tồn kho RESALE sang MMP. Hợp đồng: `docs/mmp/resale-ton-kho.md`.
 *
 *   # CHỈ DỰNG + IN, không gửi gì (mặc định):
 *   railway run --service Shopify-Management-System npx tsx scripts/du-lieu/day-ton-kho-resale-mmp.ts
 *
 *   # Gửi THỬ một ảnh nhỏ (hợp đồng yêu cầu làm bước này trước):
 *   ... day-ton-kho-resale-mmp.ts --gioi-han 20 --ap-dung
 *
 *   # Gửi thật toàn bộ:
 *   ... day-ton-kho-resale-mmp.ts --ap-dung
 *
 *   --json <đường-dẫn>   ghi payload ra tệp để soi
 *
 * DRY-RUN LÀ MẶC ĐỊNH. Đây là ghi ra ĐỐI TÁC rồi ra store khách thấy: ảnh chụp mới **thay
 * hẳn** ảnh trước, nên một lượt sai làm MMP hiểu sai toàn bộ tồn resale.
 *
 * Phải chạy qua `railway run` vì `MMP_WEBHOOK_SECRET` chỉ có trên Railway.
 */
import { writeFileSync } from 'node:fs';
import { dungAnhChupResale, guiAnhChupResale, TRAN_DONG } from '@/features/mmp/resale-ton-kho';

const URL_MMP = process.env.MMP_RESALE_TON_KHO_URL
  ?? 'https://portal.meanblvd.com/api/integration/resale/ton-kho';

function so(n: number): string { return n.toLocaleString('vi-VN'); }

async function main(): Promise<void> {
  const apDung = process.argv.includes('--ap-dung');
  const gAt = process.argv.indexOf('--gioi-han');
  const gioiHan = gAt >= 0 ? Number(process.argv[gAt + 1]) : undefined;
  const jAt = process.argv.indexOf('--json');
  const jsonPath = jAt >= 0 ? process.argv[jAt + 1] : null;

  console.log(apDung ? '*** ÁP DỤNG — GỬI THẬT SANG MMP ***\n' : '*** DRY-RUN — không gửi gì (thêm --ap-dung để gửi) ***\n');

  const { anh, thongKe } = await dungAnhChupResale(gioiHan ? { gioiHan } : undefined);

  console.log('── Nguồn ──');
  console.log(`  tồn hiện tại (warehouse_inventory, >0) : ${so(thongKe.dongTon)} dòng`);
  console.log(`  lô nhập (lark_wh_inventory, Lưu kho)   : ${so(thongKe.loNhap)} lô`);
  console.log('\n── Ảnh chụp dựng ra ──');
  console.log(`  snapshotId : ${anh.snapshotId}`);
  console.log(`  dòng       : ${so(thongKe.dongResale)} / trần ${so(TRAN_DONG)}`);
  console.log(`  chiếc      : ${so(thongKe.chiec)}`);
  console.log(`  byte       : ${so(Buffer.byteLength(JSON.stringify(anh), 'utf8'))}`);
  console.log(`  có mã biến thể Shopify : ${so(thongKe.dongCoVariantId)} / ${so(thongKe.dongResale)} dòng`);
  if (thongKe.skuNhapNhang > 0) console.log(`  SKU ra NHIỀU biến thể (để trống): ${thongKe.skuNhapNhang}`);
  if (thongKe.dongSaleBoRa > 0) {
    console.log(`  ĐÃ LOẠI ${so(thongKe.dongSaleBoRa)} dòng SKU đuôi -sale (${so(thongKe.chiecSaleBoRa)} chiếc)`);
    console.log('    — hợp đồng cấm gửi SKU -sale; đó là bản bán lại, MMP tự ghép từ SKU gốc.');
  }
  if (gioiHan) console.log(`  (ĐÃ CẮT còn ${gioiHan} dòng đầu — lượt gửi thử)`);

  console.log('\n── Theo loại tồn (chiếc) ──');
  for (const [loai, n] of Object.entries(thongKe.theoLoai).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${loai.padEnd(32)} ${so(n)}`);
  }
  console.log('  (Tồn kho (Consignment) CỐ Ý KHÔNG có — hàng ký gửi, brand vẫn sở hữu)');

  console.log('\n── 5 dòng đầu ──');
  for (const it of anh.items.slice(0, 5)) console.log('  ', JSON.stringify(it));

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify(anh, null, 2), 'utf8');
    console.log(`\nĐã ghi payload: ${jsonPath}`);
  }

  if (!apDung) {
    console.log('\nKhông gửi gì. Soi xong thì chạy lại với --ap-dung.');
    process.exit(0);
  }

  console.log(`\n── Gửi tới ${URL_MMP} ──`);
  const r = await guiAnhChupResale(anh, URL_MMP);
  console.log(`  ok=${r.ok}${r.http ? ` http=${r.http}` : ''}`);
  if (r.than) console.log(`  thân: ${r.than}`);
  if (r.loi) console.log(`  lỗi: ${r.loi}`);
  // 200 kèm boQua vẫn là "đã nhận" — hợp đồng nói DỪNG, không retry.
  process.exit(r.ok ? 0 : 1);
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
