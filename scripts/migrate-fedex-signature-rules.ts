/** Migration MỘT LẦN (spec 2026-06-11 fedex-signature-country-exclusion):
 *  FedEx Direct Signature: 2 dòng → 3 dòng đúng mốc operator + 13 nước miễn.
 *    92.700 |        NULL → 2025-06-01
 *    88.000 |  2025-06-01 → 2026-01-01   (sửa từ ends 2026-01-05)
 *    92.700 |  2026-01-01 → NULL          (sửa từ starts 2026-01-05)
 *  DHL KHÔNG đụng. Idempotent: match theo (account, kind addon_fixed, note).
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

const FEDEX_ACCOUNT = 'FedEx Vietnam — International Priority (IP) 2026';
const EXCLUDED = ['SA','QA','IL','IQ','OM','KZ','JO','MC','LU','CY','CZ','PE','AO'];

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '*** --apply: SẼ GHI ***' : 'DRY-RUN — chỉ in, không ghi.');
  const rows = await db.execute(sql`
    SELECT ca.name AS account, cs.id, cs.value::int, cs.apply_mode,
           cs.starts_at::date AS from_d, cs.ends_at::date AS to_d, cs.excluded_country_codes
    FROM carrier_surcharges cs JOIN carrier_accounts ca ON ca.id = cs.carrier_account_id
    WHERE ca.name = ${FEDEX_ACCOUNT} AND cs.kind = 'addon_fixed'
      AND cs.note ILIKE '%Direct Signature%'
    ORDER BY cs.value, cs.starts_at NULLS FIRST`);
  console.table(rows.rows);
  const hasPreJune = rows.rows.some((r) => Number((r as { value: number }).value) === 92700
    && (r as { to_d: string | null }).to_d !== null);
  console.log(`Dòng hiện có: ${rows.rows.length} — pre-June row: ${hasPreJune ? 'CÓ' : 'CHƯA (sẽ insert)'}`);
  if (!apply) { console.log('DRY-RUN XONG.'); process.exit(0); }

  // (1) Sửa mốc 2 dòng hiện có + set excluded list
  const u88 = await db.execute(sql`
    UPDATE carrier_surcharges cs SET
      starts_at = '2025-06-01'::timestamp, ends_at = '2026-01-01'::timestamp,
      excluded_country_codes = ${JSON.stringify(EXCLUDED)}::jsonb,
      note = 'Direct Signature — 88k 01/06/2025→31/12/2025, miễn 13 nước (when_billed)'
    FROM carrier_accounts ca
    WHERE ca.id = cs.carrier_account_id AND ca.name = ${FEDEX_ACCOUNT}
      AND cs.kind = 'addon_fixed' AND cs.value = 88000`);
  const u927 = await db.execute(sql`
    UPDATE carrier_surcharges cs SET
      starts_at = '2026-01-01'::timestamp, ends_at = NULL,
      excluded_country_codes = ${JSON.stringify(EXCLUDED)}::jsonb,
      note = 'Direct Signature — 92.7k từ 01/01/2026, miễn 13 nước (when_billed)'
    FROM carrier_accounts ca
    WHERE ca.id = cs.carrier_account_id AND ca.name = ${FEDEX_ACCOUNT}
      AND cs.kind = 'addon_fixed' AND cs.value = 92700 AND cs.ends_at IS NULL`);
  if (Number(u88.rowCount ?? 0) !== 1 || Number(u927.rowCount ?? 0) !== 1) {
    throw new Error(`UPDATE lệch kỳ vọng: 88k=${u88.rowCount}, 92.7k=${u927.rowCount} (mỗi cái phải 1)`);
  }
  console.log('✓ Sửa mốc 2 dòng hiện có');
  // (2) Insert dòng pre-June nếu chưa có
  if (!hasPreJune) {
    const ins = await db.execute(sql`
      INSERT INTO carrier_surcharges
        (carrier_account_id, kind, value, fuelable, active, apply_mode, ends_at, excluded_country_codes, note)
      SELECT ca.id, 'addon_fixed', 92700, true, true, 'when_billed',
             '2025-06-01'::timestamp, ${JSON.stringify(EXCLUDED)}::jsonb,
             'Direct Signature — 92.7k đến trước 01/06/2025, miễn 13 nước (when_billed)'
      FROM carrier_accounts ca WHERE ca.name = ${FEDEX_ACCOUNT}`);
    if (Number(ins.rowCount ?? 0) !== 1) throw new Error(`Insert pre-June được ${ins.rowCount}/1`);
    console.log('✓ Insert dòng pre-June 92.7k');
  } else console.log('Dòng pre-June đã có — bỏ qua.');
  console.log('ÁP DỤNG XONG. Refresh cache đối soát (?refresh=1).');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
