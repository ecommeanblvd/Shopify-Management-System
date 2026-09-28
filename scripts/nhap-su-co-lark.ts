/** Nhập sự cố từ bảng Lark `Incident Management (Cũ)`. CHỈ ĐỌC Lark. */
import { nhapSuCoTuLark } from '../features/su-co/nhap-lark';

async function main(): Promise<void> {
  const t0 = Date.now();
  const k = await nhapSuCoTuLark((s) => process.stdout.write(`${s}\n`));
  process.stdout.write(
    `\nXONG: đọc ${k.doc} · thêm ${k.them} · đã có ${k.boQuaDaCo}`
    + ` · ${k.dongChiPhi} dòng chi phí · nối được đơn ${k.noiDuocDon}`
    + ` · cần xem lại ${k.canXemLai} · khai mà không có số ${k.khaiKhongCoSo}`
    + ` · nguyên nhân lạ ${k.nguyenNhanLa}`
    + ` (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`,
  );
  process.exit(0);
}
void main();
