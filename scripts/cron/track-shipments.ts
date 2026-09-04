/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:track-shipments`
 *
 * Poll trạng thái giao hàng các shipment CHƯA giao (FedEx + DHL) theo tracking
 * number của hãng → cập nhật shipments.delivery_status/delivered_at. One-way
 * (carrier → hệ thống). DHL cần env DHL_TRACK_API_KEY; thiếu key thì bỏ qua DHL.
 *
 * Exit codes: 0 — chạy xong; 1 — lỗi fatal.
 */

import { trackPendingShipments } from '@/features/shipments/track';

import { chayCron } from '@/features/jobs/run';
async function main(): Promise<void> {
  const s = await trackPendingShipments({ limit: 200 });
  process.stdout.write(
    `track-shipments: tracked ${s.tracked}, delivered ${s.delivered}, failed ${s.failed}, skipDHL ${s.skippedDhl}\n`,
  );
}

chayCron('track-shipments', main);
