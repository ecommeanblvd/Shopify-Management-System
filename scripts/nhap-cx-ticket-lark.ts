/** Nhập 675 ticket lịch sử từ bảng Lark `CX - To Do` (CEO 27/09). CHỈ ĐỌC Lark. */
import { nhapTicketTuLark } from '../features/cx-ticket/nhap-lark';

async function main(): Promise<void> {
  const t0 = Date.now();
  const k = await nhapTicketTuLark((s) => process.stdout.write(`${s}\n`));
  process.stdout.write(
    `\nXONG: đọc ${k.doc} · thêm ${k.them} · bỏ qua ${k.boQua} · gắn ${k.ganDong} dòng đơn `
    + `· ${k.ghiChu} ghi chú · ${k.khongMapLoai} loại không map được `
    + `(${((Date.now() - t0) / 1000).toFixed(0)}s)\n`,
  );
  process.exit(0);
}
void main();
