/**
 * Migration MỘT LẦN (spec 2026-06-11 addon-services):
 *   (1) re-kind 2 dòng DHL Direct Signature: peak_fixed → addon_fixed (always);
 *   (2) insert 2 dòng FedEx Direct Signature (when_billed, fuelable=true).
 * Idempotent: chạy lại không nhân đôi (match theo note 'Direct Signature').
 *
 *   npx tsx scripts/migrate-addon-signature.ts            # dry-run
 *   npx tsx scripts/migrate-addon-signature.ts --apply    # ghi thật
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

const FEDEX_ACCOUNT = 'FedEx Vietnam — International Priority (IP) 2026';
const BOUNDARY = '2026-01-05';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '*** --apply: SẼ GHI ***' : 'DRY-RUN — chỉ in, không ghi.');

  // (1) DHL re-kind
  const dhl = await db.execute(sql`
    SELECT ca.name AS account, cs.id, cs.value::int, cs.starts_at::date, cs.ends_at::date
    FROM carrier_surcharges cs
    JOIN carrier_accounts ca ON ca.id = cs.carrier_account_id
    WHERE cs.kind = 'peak_fixed' AND cs.note ILIKE '%Direct Signature%'`);
  console.log(`DHL peak_fixed 'Direct Signature' cần re-kind: ${dhl.rows.length} (kỳ vọng 2)`);
  console.table(dhl.rows);

  // (2) FedEx insert (idempotent — đếm dòng addon_fixed Direct Signature hiện có)
  const fedexExisting = await db.execute(sql`
    SELECT count(*)::int AS n FROM carrier_surcharges cs
    JOIN carrier_accounts ca ON ca.id = cs.carrier_account_id
    WHERE ca.name = ${FEDEX_ACCOUNT} AND cs.kind = 'addon_fixed'
      AND cs.note ILIKE '%Direct Signature%'`);
  const already = Number((fedexExisting.rows[0] as { n: number }).n);
  console.log(`FedEx addon_fixed Direct Signature hiện có: ${already} (0 = sẽ insert 2)`);

  if (!apply) { console.log('DRY-RUN XONG.'); process.exit(0); }

  await db.execute(sql`
    UPDATE carrier_surcharges
    SET kind = 'addon_fixed', apply_mode = 'always'
    WHERE kind = 'peak_fixed' AND note ILIKE '%Direct Signature%'`);
  console.log('✓ DHL re-kinded');

  if (already === 0) {
    // 2 INSERT riêng (không VALUES + NULL timestamp — Postgres không suy
    // được kiểu cột khi NULL đứng đầu cột tham số hoá).
    const ins88 = await db.execute(sql`
      INSERT INTO carrier_surcharges
        (carrier_account_id, kind, value, fuelable, active, apply_mode, ends_at, note)
      SELECT ca.id, 'addon_fixed', 88000, true, true, 'when_billed',
             ${BOUNDARY}::timestamp,
             'Direct Signature — 88k đến trước 05/01/2026 (when_billed)'
      FROM carrier_accounts ca WHERE ca.name = ${FEDEX_ACCOUNT}`);
    const ins927 = await db.execute(sql`
      INSERT INTO carrier_surcharges
        (carrier_account_id, kind, value, fuelable, active, apply_mode, starts_at, note)
      SELECT ca.id, 'addon_fixed', 92700, true, true, 'when_billed',
             ${BOUNDARY}::timestamp,
             'Direct Signature — 92.7k từ 05/01/2026 (when_billed)'
      FROM carrier_accounts ca WHERE ca.name = ${FEDEX_ACCOUNT}`);
    const n = Number(ins88.rowCount ?? 0) + Number(ins927.rowCount ?? 0);
    // INSERT…SELECT chèn 0 dòng khi tên account lệch — phải báo lỗi to,
    // không được im lặng in "đã chèn".
    if (n !== 2) throw new Error(`FedEx insert được ${n}/2 dòng — kiểm tra tên account '${FEDEX_ACCOUNT}'`);
    console.log('✓ FedEx inserted 2 rows');
  } else {
    console.log('FedEx rows đã tồn tại — bỏ qua insert.');
  }
  console.log('ÁP DỤNG XONG. Nhớ refresh cache đối soát (?refresh=1).');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
