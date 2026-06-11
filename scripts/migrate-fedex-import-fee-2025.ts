/** Sửa phí nhập US 2025: 37.400đ (sai) → 64.500đ, hiệu lực 2025-11-01 → 2026-01-01
 *  (xác nhận với operator + đo bill 12/2025: thực tế 64.500đ). Dòng 68.300đ (2026) giữ nguyên.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
const FEDEX = 'FedEx Vietnam — International Priority (IP) 2026';
async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '*** --apply: SẼ GHI ***' : 'DRY-RUN — chỉ in, không ghi.');
  const before = await db.execute(sql`
    SELECT cs.id, cs.value::int, cs.apply_mode, cs.starts_at::date AS from_d, cs.ends_at::date AS to_d, cs.note
    FROM carrier_surcharges cs JOIN carrier_accounts ca ON ca.id=cs.carrier_account_id
    WHERE ca.name=${FEDEX} AND cs.kind='country_fixed' AND cs.note ILIKE '%import handling%'
    ORDER BY cs.starts_at`);
  console.table(before.rows);
  if (!apply) { console.log('DRY-RUN XONG.'); process.exit(0); }
  await db.transaction(async (tx) => {
    const u = await tx.execute(sql`
      UPDATE carrier_surcharges cs SET
        value = 64500, starts_at = '2025-11-01'::timestamp, ends_at = '2026-01-01'::timestamp,
        note = 'Phí xử lý hàng nhập tại Hoa Kỳ (US import handling) — 64.500đ 11/2025→12/2025'
      FROM carrier_accounts ca
      WHERE ca.id=cs.carrier_account_id AND ca.name=${FEDEX}
        AND cs.kind='country_fixed' AND cs.value=37400 AND cs.note ILIKE '%import handling%'`);
    if (Number(u.rowCount ?? 0) !== 1) throw new Error(`UPDATE ${u.rowCount}/1 — rollback`);
    console.log('✓ 37.400 → 64.500 (hiệu lực 2025-11-01 → 2026-01-01)');
  });
  console.log('ÁP DỤNG XONG. Refresh cache đối soát (?refresh=1).');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
