/** Migration MỘT LẦN (spec 2026-06-11 fedex-import-handling-when-billed):
 *  2 dòng FedEx US import handling (country_fixed) → apply_mode='when_billed'.
 *  Engine thôi tự cộng; đối soát kiểm khi bill có. DHL country_fixed (ER) KHÔNG đụng.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

const FEDEX_ACCOUNT = 'FedEx Vietnam — International Priority (IP) 2026';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '*** --apply: SẼ GHI ***' : 'DRY-RUN — chỉ in, không ghi.');
  const rows = await db.execute(sql`
    SELECT ca.name AS account, cs.id, cs.value::int, cs.apply_mode,
           cs.country_codes, cs.starts_at::date AS from_d, cs.ends_at::date AS to_d, cs.note
    FROM carrier_surcharges cs JOIN carrier_accounts ca ON ca.id = cs.carrier_account_id
    WHERE ca.name = ${FEDEX_ACCOUNT} AND cs.kind = 'country_fixed'
      AND cs.note ILIKE '%import handling%'
    ORDER BY cs.starts_at NULLS FIRST`);
  console.table(rows.rows);
  console.log(`Dòng cần chuyển: ${rows.rows.length} (kỳ vọng 2)`);
  if (!apply) { console.log('DRY-RUN XONG.'); process.exit(0); }

  await db.transaction(async (tx) => {
    const u = await tx.execute(sql`
      UPDATE carrier_surcharges cs SET apply_mode = 'when_billed'
      FROM carrier_accounts ca
      WHERE ca.id = cs.carrier_account_id AND ca.name = ${FEDEX_ACCOUNT}
        AND cs.kind = 'country_fixed' AND cs.note ILIKE '%import handling%'`);
    if (Number(u.rowCount ?? 0) !== 2) throw new Error(`UPDATE ${u.rowCount}/2 — rollback`);
    console.log('✓ 2 dòng US import handling → when_billed');
  });
  console.log('ÁP DỤNG XONG. Refresh cache đối soát (?refresh=1).');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
