/**
 * Đẩy MỌI đơn của 2 store RIÊNG của brand (tinhatelier, mirermirer-official)
 * sang MMP — scope đúng 2 store này. Chạy qua env app (có MMP_* + DATABASE_URL),
 * KHÔNG qua HTTP nên không timeout như nút UI.
 *
 *   railway run npx tsx scripts/push-owned-store-mmp.ts --dry-run   # chỉ đếm, KHÔNG gửi
 *   railway run npx tsx scripts/push-owned-store-mmp.ts             # gửi đơn CHƯA sent
 *   railway run npx tsx scripts/push-owned-store-mmp.ts 20          # test 20 đơn đầu
 *   railway run npx tsx scripts/push-owned-store-mmp.ts --force     # gửi lại TẤT CẢ (refresh status)
 */
import { pushOwnedStoreOrders } from '@/features/mmp/order-backfill';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => /^\d+$/.test(a));
  const limit = limitArg ? Math.max(0, Math.floor(Number(limitArg))) : undefined;

  const mode = dryRun ? 'DRY-RUN (không gửi)' : force ? 'FORCE (gửi lại tất cả)' : 'gửi đơn chưa sent';
  process.stdout.write(`push-owned-store-mmp: ${mode}${limit ? ` · limit ${limit}` : ''}\n`);

  const r = await pushOwnedStoreOrders({
    limit,
    force,
    dryRun,
    onProgress: (done, total, pushed, failed) =>
      process.stdout.write(`  …${done}/${total} — pushed ${pushed}, failed ${failed}\n`),
  });

  if (dryRun) {
    process.stdout.write(`push-owned-store-mmp: DRY-RUN — sẽ gửi ${r.total} đơn (chưa POST gì).\n`);
  } else {
    process.stdout.write(
      `push-owned-store-mmp: XONG — pushed ${r.pushed}, skipped ${r.skipped}, failed ${r.failed}, total ${r.total}\n`,
    );
  }
  if (r.failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    process.stderr.write(`push-owned-store-mmp: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
