/**
 * Standalone Railway-friendly cron entry point — chạy MỘT NHÓM tác vụ.
 * Usage: `npm run cron:group -- moi-gio`
 *
 * Gộp nhiều tác vụ vào một service cron: mỗi service Railway nối repo sẽ build
 * lại mỗi lần push code, nên 17 service = 17 lượt build mỗi lần đẩy. Gộp còn 5
 * nhóm theo chu kỳ (xem features/jobs/groups.ts).
 *
 * Một tác vụ hỏng KHÔNG kéo cả nhóm chết: chạy hết rồi mới đặt exit code.
 * Mỗi tác vụ vẫn ghi một dòng job_runs riêng nên trang /f/jobs không đổi.
 */
import { chayMotJob } from '@/features/jobs/run';
import { NHOM_JOB, TEN_NHOM } from '@/features/jobs/groups';

import { retryFailedMmpPushes } from '@/features/mmp/order-push-retry';
import { pushUnsentBrandOrders } from '@/features/mmp/order-backfill';
import { retryPendingShipHoEvents } from '@/features/ship-ho/mmp-events';
import { pruneOldLogs } from '@/features/db-maintenance/prune-logs';
import { trackPendingShipments } from '@/features/shipments/track';

/** Tác vụ nào chạy bằng hàm nào. Khoá phải khớp sổ đăng ký. */
const CHAY: Record<string, () => Promise<unknown>> = {
  'retry-mmp-orders': async () => ({
    retry: await retryFailedMmpPushes(),
    moi: await pushUnsentBrandOrders({ sinceDays: 90 }),
  }),
  'retry-ship-ho-events': () => retryPendingShipHoEvents(),
  'prune-logs': () => pruneOldLogs(),
  'track-shipments': () => trackPendingShipments({ limit: 200 }),
};

async function main(): Promise<void> {
  const nhom = process.argv[2];
  if (!nhom || !NHOM_JOB[nhom]) {
    process.stderr.write(`Thiếu/sai tên nhóm. Có: ${TEN_NHOM.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  const keys = NHOM_JOB[nhom];
  process.stdout.write(`nhóm "${nhom}": ${keys.length} tác vụ\n`);
  let hong = 0, boQua = 0;
  for (const k of keys) {
    const fn = CHAY[k];
    // Tác vụ chưa nối vào bộ chạy nhóm thì BỎ QUA và nói rõ — im lặng bỏ qua là
    // tái lập đúng lỗi cũ: tác vụ tưởng có lịch mà thật ra không bao giờ chạy.
    if (!fn) { process.stdout.write(`  – ${k}: chưa nối vào bộ chạy nhóm, bỏ qua\n`); boQua++; continue; }
    if (!(await chayMotJob(k, fn))) hong++;
  }
  process.stdout.write(`xong: hỏng ${hong} · chưa nối ${boQua} / ${keys.length}\n`);
  if (hong > 0) process.exitCode = 1;
}

main()
  .catch((err) => { process.stderr.write(`run-group fatal: ${err instanceof Error ? err.stack : String(err)}\n`); process.exitCode = 1; })
  .finally(() => process.exit());
