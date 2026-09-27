/** Lấp email/tên/ghi chú khách + số đo + EDD hai đầu (CEO 27/09). */
import { lapThongTinKhach } from '../features/shopify-orders/backfill-khach';
async function main(): Promise<void> {
  const t0 = Date.now();
  const k = await lapThongTinKhach((s) => process.stdout.write(`${s}\n`));
  process.stdout.write(`\nXONG: ${k.don} đơn quét · ghi ${k.donGhi} đơn · ${k.dongGhi} dòng (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  process.exit(0);
}
void main();
