/** Nhập đánh giá từ bảng Lark `Truspilot Review`. CHỈ ĐỌC Lark. */
import { nhapDanhGiaTuLark } from '../features/danh-gia/nhap-lark';

async function main(): Promise<void> {
  const t0 = Date.now();
  const k = await nhapDanhGiaTuLark((s) => process.stdout.write(`${s}\n`));
  process.stdout.write(
    `\nXONG: đọc ${k.doc} · thêm ${k.them} · đã có ${k.boQuaDaCo}`
    + ` · bỏ vì thiếu số sao ${k.boQuaThieuSao}`
    + ` · nối được đơn ${k.noiDuocDon} · tự điền brand ${k.tuDienBrand}`
    + ` · bỏ quốc gia rác ${k.bỏQuocGiaRac}`
    + ` (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`,
  );
  process.exit(0);
}
void main();
