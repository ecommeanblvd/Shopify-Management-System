/**
 * One-off: FORCE đẩy lại TẤT CẢ đơn brand sang MMP (kể cả đã 'sent') để MMP dựng
 * đủ brand hứng đơn. Chạy qua env app (có MMP_* + DATABASE_URL), KHÔNG qua HTTP
 * nên không bị timeout như nút UI.
 *
 *   railway run npx tsx scripts/push-all-brand-mmp.ts            # tất cả
 *   railway run npx tsx scripts/push-all-brand-mmp.ts 20         # test 20 đơn đầu
 */
import { forcePushAllBrandOrders } from '@/features/mmp/order-backfill';

async function main(): Promise<void> {
  const limitArg = process.argv[2] ? Math.max(0, Math.floor(Number(process.argv[2]))) : undefined;
  if (process.argv[2] && (limitArg === undefined || Number.isNaN(limitArg))) {
    process.stderr.write('limit không hợp lệ\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`push-all-brand-mmp: bắt đầu${limitArg ? ` (limit ${limitArg})` : ' (tất cả)'}\n`);
  const r = await forcePushAllBrandOrders({
    limit: limitArg,
    onProgress: (done, total, pushed, failed) =>
      process.stdout.write(`  …${done}/${total} — pushed ${pushed}, failed ${failed}\n`),
  });
  process.stdout.write(`push-all-brand-mmp: XONG — pushed ${r.pushed}, skipped ${r.skipped}, failed ${r.failed}, total ${r.total}\n`);
  if (r.failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    process.stderr.write(`push-all-brand-mmp: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
