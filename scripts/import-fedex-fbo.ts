/**
 * Import file FedEx Billing Online (FBO) Excel → TẠO BILL AP (carrier_bills +
 * lines, nhóm theo số hoá đơn) VÀ cập nhật shipment_charges (billed đối soát).
 * Dùng chung lõi importFboToDatabase với action UI (Billing/Invoices).
 *
 *   railway run -- npx tsx scripts/import-fedex-fbo.ts <file.xlsx> [--apply]
 *
 * Mặc định dry-run. --apply mới ghi. Idempotent (upsert theo invoice# + AWB).
 */
import * as XLSX from 'xlsx';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { parseFedexFbo } from '@/features/shipments/fedex-fbo-parse';
import { groupFboIntoBills } from '@/features/shipments/fedex-fbo-bill';
import { importFboToDatabase } from '@/features/carrier-rates/ap/fbo-import-actions';

const FEDEX_ACCOUNT = '5683f3c0-9249-40c1-a3e7-d967f0d62c29';
const OWNER_EMAIL = 'lmtiep@gmail.com';

async function main(): Promise<void> {
  const file = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!file || file.startsWith('--')) { console.error('usage: import-fedex-fbo <file.xlsx> [--apply]'); process.exit(1); }

  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false }) as unknown[][];
  const parsed = parseFedexFbo(rows);
  const bills = groupFboIntoBills(parsed);
  console.log(`FBO: ${parsed.length} dòng vận đơn → ${bills.length} hoá đơn AP.`);

  if (!apply) {
    console.log('[DRY-RUN] Thêm --apply để ghi (tạo bill AP + charge đối soát).');
    process.exit(0);
  }

  // createdBy: ưu tiên owner, fallback user đầu tiên.
  const [owner] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, OWNER_EMAIL)).limit(1);
  const [any] = owner ? [owner] : await db.select({ id: schema.user.id }).from(schema.user).limit(1);
  if (!any) { console.error('Không có user để gán createdBy.'); process.exit(1); }

  const res = await importFboToDatabase(parsed, {
    carrierAccountId: FEDEX_ACCOUNT, currency: 'VND', userId: any.id, fileMeta: null,
  });
  console.log(`✓ Bill AP: tạo ${res.billsCreated}, cập nhật ${res.billsUpdated} hoá đơn`);
  console.log(`✓ Charge đối soát: ${res.chargesUpserted} | AWB khớp đơn ${res.matchedAwb}/${res.totalAwb} (không khớp ${res.unmatchedAwb})`);
  console.log(`  Tổng tiền AP: ${Math.round(res.grandTotal).toLocaleString('vi-VN')} VND`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
