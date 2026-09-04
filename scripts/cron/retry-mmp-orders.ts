/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:retry-mmp-orders`
 *
 * HAI việc, không phải một:
 *   1. Thử lại các đơn đã có dòng push nhưng pending/failed.
 *   2. Đẩy đơn CHƯA TỪNG có dòng push (90 ngày gần đây).
 * Thiếu vế 2 chính là lý do MMP không nhận đơn nào suốt tháng 8 — retry chỉ
 * nhìn thấy dòng đã tồn tại, còn đơn mới thì chưa có dòng nào.
 *
 * Cửa sổ 90 ngày là CỐ Ý: chạy tự động không giới hạn sẽ dội sang MMP toàn bộ
 * tồn đọng từ 2020 (2.233 đơn). Nút operator trong app vẫn không giới hạn.
 */
import { retryFailedMmpPushes } from '@/features/mmp/order-push-retry';
import { pushUnsentBrandOrders } from '@/features/mmp/order-backfill';
import { chayCron } from '@/features/jobs/run';

async function main() {
  const retry = await retryFailedMmpPushes();
  const moi = await pushUnsentBrandOrders({ sinceDays: 90 });
  return { retry, moi };
}

chayCron('retry-mmp-orders', main);
