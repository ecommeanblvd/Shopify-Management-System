/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:sync-orders`
 *
 * Chạy chuỗi việc bám theo nhịp đồng bộ đơn. TRƯỚC 05/09 cả 11 việc dùng CHUNG
 * một tên tác vụ `sync-orders`, nên nhật ký chỉ thấy "5,9 phút" mà không biết
 * việc nào chậm. Nay mỗi việc ghi một dòng job_runs riêng — thấy ngay ai ăn
 * thời gian, đúng cách đã giúp tìm ra sync-lark 68 phút.
 *
 * Một việc hỏng KHÔNG chặn các việc sau: chayMotJob nuốt lỗi và ghi lại.
 */
import { runHourlySync } from '@/features/shopify-orders/cron/hourly-sync';
import { retryFailedMmpPushes } from '@/features/mmp/order-push-retry';
import { pushUnsentBrandOrders } from '@/features/mmp/order-backfill';
import { verifyUnverifiedAddresses } from '@/features/shopify-orders/address-verify';
import { trackPendingShipments } from '@/features/shipments/track';
import { trackPendingShipHo } from '@/features/ship-ho/track';
import { retryPendingShipHoEvents } from '@/features/ship-ho/mmp-events';
import { refreshShipHoTiers } from '@/features/ship-ho/tier-refresh';
import { reconcileShipHoFromCarrierBillsCore } from '@/features/ship-ho/reconcile-actions';
import { applyPodDeliveries } from '@/features/shipments/apply-pod';
import { applyReturnLinks } from '@/features/shipments/return-bill';
import { chayMotJob } from '@/features/jobs/run';

/** Thứ tự có ý nghĩa: nạp đơn trước, các việc ăn theo dữ liệu đơn sau. */
const VIEC: Array<{ key: string; fn: () => Promise<unknown> }> = [
  { key: 'sync-orders', fn: async () => {
    const r = await runHourlySync();
    const loi = r.filter((x) => x.error);
    if (loi.length) throw new Error(loi.map((x) => `${x.storeName}: ${x.error}`).join(' | '));
    return { cuaHang: r.map((x) => ({ ten: x.storeName, donNap: x.ingested })) };
  } },
  { key: 'retry-mmp-orders', fn: () => retryFailedMmpPushes() },
  { key: 'push-unsent-brand', fn: () => pushUnsentBrandOrders() },
  { key: 'addr-verify', fn: () => verifyUnverifiedAddresses({ limit: 100 }) },
  { key: 'track-shipments', fn: () => trackPendingShipments({ limit: 100 }) },
  { key: 'track-ship-ho', fn: () => trackPendingShipHo({ limit: 50 }) },
  { key: 'retry-ship-ho-events', fn: () => retryPendingShipHoEvents() },
  { key: 'ship-ho-tiers', fn: () => refreshShipHoTiers() },
  { key: 'apply-pod', fn: () => applyPodDeliveries() },
  { key: 'return-links', fn: () => applyReturnLinks() },
  { key: 'ship-ho-reconcile', fn: () => reconcileShipHoFromCarrierBillsCore() },
];

async function main(): Promise<void> {
  let hong = 0;
  for (const v of VIEC) if (!(await chayMotJob(v.key, v.fn))) hong++;
  process.stdout.write(`xong: ${VIEC.length - hong}/${VIEC.length} việc ok\n`);
  if (hong > 0) process.exitCode = 1;
}

main()
  .catch((err) => { process.stderr.write(`sync-orders fatal: ${err instanceof Error ? err.stack : String(err)}\n`); process.exitCode = 1; })
  .finally(() => process.exit());
