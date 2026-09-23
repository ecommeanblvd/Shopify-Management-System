/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:refresh-fuel`
 *
 * CHỈ LÀ VỎ BỌC: toàn bộ nghiệp vụ nằm ở
 * `features/carrier-rates/fuel-fetcher/refresh-all.ts`, dùng CHUNG với route
 * HTTP `/api/cron/refresh-fuel`. Trước 23/09/2026 hai đường vào tự viết lại câu
 * truy vấn "quét hãng nào" của riêng mình và lệch nhau — script có UPS +
 * SF Express, route thì không — nên hai hãng đó đứng im 11 tuần mà tác vụ vẫn
 * báo xanh. Đừng thêm danh sách hãng vào đây lần nữa.
 *
 * Exit codes:
 *   0 — mọi hãng đều làm mới được và giá không quá hạn
 *   1 — có hãng lỗi hoặc giá quá hạn; `chayCron` ghi luôn tên hãng vào job_runs
 *
 * Filename note: kept as `refresh-fedex-fuel.ts` so the existing Railway
 * cron service command (`npm run cron:refresh-fuel`) keeps working — the
 * script now covers DHL/UPS/SF too but the filename predates the dispatcher.
 */

import {
  chayRefreshFuel,
  loiRefreshFuel,
  type KetQuaRefreshFuel,
} from '@/features/carrier-rates/fuel-fetcher/refresh-all';
import { chayCron } from '@/features/jobs/run';

async function main(): Promise<KetQuaRefreshFuel> {
  const kq = await chayRefreshFuel({ triggeredBy: null });

  if (kq.tong === 0) {
    process.stdout.write('refresh-carrier-fuel: no enabled auto-refresh accounts; nothing to do.\n');
    return kq;
  }

  for (const r of kq.ketQua) {
    if (r.error) {
      process.stderr.write(`refresh-carrier-fuel: [${r.carrierKey}] ${r.accountName} — FAILED: ${r.error}\n`);
      continue;
    }
    const change = r.changed
      ? `${r.previousPercent ?? '∅'}% → ${r.newPercent}%`
      : `unchanged at ${r.newPercent}%`;
    process.stdout.write(`refresh-carrier-fuel: [${r.carrierKey}] ${r.accountName} — ${change}\n`);
  }
  for (const q of kq.quaHan) {
    process.stderr.write(`refresh-carrier-fuel: QUÁ HẠN ${q}\n`);
  }

  return kq;
}

chayCron('refresh-fuel', main, (summary) => loiRefreshFuel(summary as KetQuaRefreshFuel));
