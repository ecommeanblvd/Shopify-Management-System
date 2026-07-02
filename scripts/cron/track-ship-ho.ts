/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:track-ship-ho`
 *
 * Poll trạng thái giao hàng các đơn ship hộ CHƯA giao → cập nhật
 * ship_ho_orders.delivery_status/delivered_at. One-way (carrier → hệ thống).
 * DHL cần env DHL_TRACK_API_KEY; thiếu key thì bỏ qua DHL.
 *
 * Exit codes: 0 — chạy xong; 1 — lỗi fatal.
 */

import { trackPendingShipHo } from '@/features/ship-ho/track';

async function main(): Promise<void> {
  const s = await trackPendingShipHo({ limit: 200 });
  process.stdout.write(
    `track-ship-ho: tracked ${s.tracked}, delivered ${s.delivered}, failed ${s.failed}, skipDHL ${s.skippedDhl}\n`,
  );
}

main()
  .catch((err) => {
    process.stderr.write(`track-ship-ho: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
