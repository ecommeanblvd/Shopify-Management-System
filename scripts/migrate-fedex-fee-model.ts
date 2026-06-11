/** Migration MỘT LẦN (spec 2026-06-11 fedex-fee-model-finalization):
 *  (1) Direct Signature (addon_fixed) → apply_mode always (đã fuelable=true).
 *  (2) US import handling (country_fixed) → apply_mode always (giữ không fuel).
 *  (3) Demand (demand_per_kg) → fuelable=true (FedEx fuel cả demand+sig).
 *  DHL KHÔNG đụng.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

const FEDEX = 'FedEx Vietnam — International Priority (IP) 2026';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '*** --apply: SẼ GHI ***' : 'DRY-RUN — chỉ in, không ghi.');
  const before = await db.execute(sql`
    SELECT cs.kind, cs.value::int, cs.apply_mode, cs.fuelable, cs.country_codes
    FROM carrier_surcharges cs JOIN carrier_accounts ca ON ca.id = cs.carrier_account_id
    WHERE ca.name = ${FEDEX} AND cs.kind IN ('addon_fixed','country_fixed','demand_per_kg')
    ORDER BY cs.kind, cs.value`);
  console.table(before.rows);
  if (!apply) { console.log('DRY-RUN XONG.'); process.exit(0); }

  await db.transaction(async (tx) => {
    const sig = await tx.execute(sql`
      UPDATE carrier_surcharges cs SET apply_mode='always',
        note = replace(cs.note, 'when_billed', 'always')
      FROM carrier_accounts ca
      WHERE ca.id=cs.carrier_account_id AND ca.name=${FEDEX}
        AND cs.kind='addon_fixed' AND cs.note ILIKE '%Direct Signature%'`);
    if (Number(sig.rowCount ?? 0) !== 3) throw new Error(`signature ${sig.rowCount}/3 — rollback`);

    const imp = await tx.execute(sql`
      UPDATE carrier_surcharges cs SET apply_mode='always'
      FROM carrier_accounts ca
      WHERE ca.id=cs.carrier_account_id AND ca.name=${FEDEX}
        AND cs.kind='country_fixed' AND cs.note ILIKE '%import handling%'`);
    if (Number(imp.rowCount ?? 0) !== 2) throw new Error(`import fee ${imp.rowCount}/2 — rollback`);

    const dem = await tx.execute(sql`
      UPDATE carrier_surcharges cs SET fuelable=true
      FROM carrier_accounts ca
      WHERE ca.id=cs.carrier_account_id AND ca.name=${FEDEX}
        AND cs.kind='demand_per_kg' AND (cs.fuelable IS NULL OR cs.fuelable=false)`);
    console.log(`✓ signature→always(3), import→always(2), demand fuelable+(${dem.rowCount})`);
  });
  console.log('ÁP DỤNG XONG. Refresh cache đối soát (?refresh=1).');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
