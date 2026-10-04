/**
 * Đẩy lại đơn brand sang MMP theo MỐC NGÀY (CEO 04/10/2026: "đẩy lại tất cả các đơn từ 2026").
 *
 * Gọi ĐÚNG hai hàm vận hành — `forcePushAllBrandOrders` cho đơn có dòng brand trên store
 * đa-brand, `pushOwnedStoreOrders` cho store riêng của brand (TA, Mirer; mọi dòng thuộc brand
 * nên không có dòng phân bổ để lọc). Script KHÔNG tự viết truy vấn: hai bản của một câu hỏi thì
 * sớm muộn cũng phân kỳ.
 *
 *   npx tsx scripts/day-lai-don-mmp.ts --tu=2026-01-01 --dry
 *   npx tsx scripts/day-lai-don-mmp.ts --tu=2026-01-01 --limit=5
 *   npx tsx scripts/day-lai-don-mmp.ts --tu=2026-01-01
 *
 * `force` BẬT SẴN: đẩy lại kể cả đơn đã 'sent' — đó chính là việc MMP cần. MMP có dedupe nên
 * không đẻ đơn trùng; bên mình mỗi đơn vẫn một dòng trong `mmp_order_pushes`.
 */
import { forcePushAllBrandOrders, pushOwnedStoreOrders } from '@/features/mmp/order-backfill';

const arg = (ten: string): string | undefined =>
  process.argv.find((x) => x.startsWith(`--${ten}=`))?.split('=')[1];
const co = (ten: string): boolean => process.argv.includes(`--${ten}`);

async function main() {
  const tuNgay = arg('tu');
  const limit = arg('limit') ? Number(arg('limit')) : undefined;
  const dryRun = co('dry');
  if (tuNgay && !/^\d{4}-\d{2}-\d{2}$/.test(tuNgay)) throw new Error('--tu phải dạng YYYY-MM-DD');
  if (limit !== undefined && !Number.isInteger(limit)) throw new Error('--limit phải là số nguyên');

  console.log(`Từ ngày: ${tuNgay ?? '(mọi đời)'} · limit: ${limit ?? '(không)'} · ${dryRun ? 'CHỈ ĐẾM' : 'GỬI THẬT'}\n`);

  const tienDo = (ten: string) => (done: number, total: number, pushed: number, failed: number) =>
    console.log(`  [${ten}] ${done}/${total} — gửi ${pushed}, hỏng ${failed}`);

  console.log('1) Đơn có dòng brand (store đa-brand)');
  const a = await forcePushAllBrandOrders({ tuNgay, limit, dryRun, onProgress: tienDo('brand') });
  console.log('   ', a, '\n');

  console.log('2) Đơn của store riêng brand (TA, Mirer)');
  const b = await pushOwnedStoreOrders({ tuNgay, limit, dryRun, force: true, onProgress: tienDo('store riêng') });
  console.log('   ', b, '\n');

  console.log('TỔNG:', {
    tong: a.total + b.total, gui: a.pushed + b.pushed,
    boQua: a.skipped + b.skipped, hong: a.failed + b.failed,
  });
  process.exit(0);
}
void main();
