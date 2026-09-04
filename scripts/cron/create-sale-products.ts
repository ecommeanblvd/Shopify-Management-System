/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:create-sale`
 *
 * Auto tạo product "-Sale" MEAN BLVD trên store meanblvd.myshopify.com cho hàng
 * warehouse return-stock mà bản gốc brand đã archived (QC Pass + Lưu kho, loại
 * customize). GHI vào store production.
 *
 * Exit codes: 0 — chạy xong; 1 — có lỗi (item-level hoặc fatal).
 */

import { createSaleProducts } from '@/features/warehouse/create-sale';

import { chayCron } from '@/features/jobs/run';
async function main(): Promise<void> {
  const s = await createSaleProducts();
  process.stdout.write(
    `create-sale: warehouseSkus ${s.warehouseSkus}, eligible ${s.eligible}, `
    + `created ${s.created}, errors ${s.errors.length}\n`,
  );
  for (const [reason, n] of Object.entries(s.skippedByReason)) {
    process.stdout.write(`create-sale: skipped ${reason}: ${n}\n`);
  }
  for (const e of s.errors) process.stderr.write(`create-sale: ${e}\n`);
  if (s.errors.length) process.exitCode = 1;
}

chayCron('create-sale', main);
