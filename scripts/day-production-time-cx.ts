/**
 * Điền Min/Max Production (days) vào file CX Working (CEO 26/09).
 * `railway run npx tsx scripts/day-production-time-cx.ts`
 */
import { dayProductionTime } from '../features/shopify-orders/day-production-time-lark';

async function main(): Promise<void> {
  const t0 = Date.now();
  const k = await dayProductionTime((s) => process.stdout.write(`${s}\n`));
  process.stdout.write(
    `\nXONG (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`
    + `  CX: ${k.cxDong} dòng\n  đã ghi: ${k.ghi}\n  đã đúng sẵn: ${k.daDung}\n`
    + `  khớp nhưng chưa có số: ${k.khongCoSo}\n  không khớp dòng nào bên mình: ${k.khongKhop}\n`,
  );
  process.exit(0);
}
void main();
