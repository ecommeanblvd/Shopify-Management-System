import { runHourlySync } from '@/features/shopify-orders/cron/hourly-sync';
import { retryFailedMmpPushes } from '@/features/mmp/order-push-retry';
import { pushUnsentBrandOrders } from '@/features/mmp/order-backfill';
import { verifyUnverifiedAddresses } from '@/features/shopify-orders/address-verify';

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
}

main()
  .catch((err) => {
    process.stderr.write(`sync-orders: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
