import { runHourlySync } from '@/features/shopify-orders/cron/hourly-sync';
import { retryFailedMmpPushes } from '@/features/mmp/order-push-retry';
import { pushUnsentBrandOrders } from '@/features/mmp/order-backfill';
import { verifyUnverifiedAddresses } from '@/features/shopify-orders/address-verify';
import { trackPendingShipments } from '@/features/shipments/track';
import { trackPendingShipHo } from '@/features/ship-ho/track';
import { retryPendingShipHoEvents } from '@/features/ship-ho/mmp-events';
import { refreshShipHoTiers } from '@/features/ship-ho/tier-refresh';

async function main(): Promise<void> {
  const results = await runHourlySync();
  let failures = 0;
  for (const r of results) {
    if (r.error) {
      failures++;
      process.stderr.write(`sync-orders: ${r.storeName} — FAILED: ${r.error}\n`);
    } else {
      process.stdout.write(`sync-orders: ${r.storeName} — ${r.ingested} orders\n`);
    }
  }
  if (failures > 0) process.exitCode = 1;
  try {
    const mmp = await retryFailedMmpPushes();
    process.stdout.write(`retry-mmp: retried ${mmp.retried}, recovered ${mmp.recovered}, stillFailing ${mmp.stillFailing}\n`);
  } catch (e) {
    process.stderr.write(`retry-mmp: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  // Đẩy đơn brand CHƯA từng push (kẽ hở: auto-push chỉ bắn lúc thao tác phân bổ,
  // retry-cron chỉ lo dòng pending/failed đã có). Đã lọc 'sent' nên nhẹ + idempotent.
  try {
    const bf = await pushUnsentBrandOrders();
    process.stdout.write(`push-unsent-brand: pushed ${bf.pushed}, skipped ${bf.skipped}, failed ${bf.failed}, total ${bf.total}\n`);
  } catch (e) {
    process.stderr.write(`push-unsent-brand: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  // Auto-verify địa chỉ đơn mới (chưa verify) qua FedEx. Cap 100/giờ + rate-limit
  // trong hàm để không đụng giới hạn API.
  try {
    const av = await verifyUnverifiedAddresses({ limit: 100 });
    process.stdout.write(`addr-verify: verified ${av.verified}, undeliverable ${av.undeliverable}, failed ${av.failed}\n`);
  } catch (e) {
    process.stderr.write(`addr-verify: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  // Cập nhật trạng thái giao (carrier API → fallback TrackingMore) cho shipment
  // chưa giao (cap 100 + rate-limit trong hàm).
  try {
    const tk = await trackPendingShipments({ limit: 100 });
    process.stdout.write(`track-shipments: tracked ${tk.tracked}, delivered ${tk.delivered}, failed ${tk.failed}, skipDHL ${tk.skippedDhl}\n`);
  } catch (e) {
    process.stderr.write(`track-shipments: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  // Track đơn ship hộ (bắn event trạng thái sang MMP khi đổi).
  try {
    const th = await trackPendingShipHo({ limit: 50 });
    process.stdout.write(`track-ship-ho: tracked ${th.tracked}, delivered ${th.delivered}, failed ${th.failed}\n`);
  } catch (e) {
    process.stderr.write(`track-ship-ho: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  // Gửi lại event ship hộ chưa tới MMP (outbox pending).
  try {
    const rt = await retryPendingShipHoEvents();
    process.stdout.write(`retry-ship-ho-events: tried ${rt.tried}, delivered ${rt.delivered}, failed ${rt.failed}\n`);
  } catch (e) {
    process.stderr.write(`retry-ship-ho-events: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  // Auto-tier chiết khấu ship hộ theo volume tháng trước (idempotent trong tháng).
  try {
    const tr = await refreshShipHoTiers();
    process.stdout.write(`ship-ho-tiers: partners ${tr.partners}, changed ${tr.changed}\n`);
  } catch (e) {
    process.stderr.write(`ship-ho-tiers: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

main()
  .catch((err) => {
    process.stderr.write(`sync-orders: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
