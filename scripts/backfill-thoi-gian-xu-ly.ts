/**
 * Lấp thời gian xử lý + dự kiến giao cho đơn đã sync từ trước (CEO 25/09).
 * Chạy một lần: `railway run npx tsx scripts/backfill-thoi-gian-xu-ly.ts`
 */
import { lapThoiGianXuLy } from '../features/shopify-orders/backfill-thoi-gian';

async function main(): Promise<void> {
  const t0 = Date.now();
  const k = await lapThoiGianXuLy((s) => process.stdout.write(`${s}\n`));
  process.stdout.write(
    `\nXONG: ${k.don} đơn · ${k.dong} dòng · cập nhật ${k.capNhat} dòng `
    + `(${((Date.now() - t0) / 1000).toFixed(0)}s)\n`,
  );
  process.exit(0);
}
void main();
