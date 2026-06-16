/**
 * Migration + backfill cột address_correction cho shipment_charges.
 *  1. ADD COLUMN IF NOT EXISTS.
 *  2. Backfill đơn FBO cũ: residual (totalAmount − Σ cột đã biết) đúng bằng giá
 *     Address Correction đã xác nhận (289.200 / 274.700) → đẩy vào cột mới.
 *     totalAmount KHÔNG đổi (đã gồm khoản này) → chỉ chuyển từ residual sang cột.
 *
 *   railway run -- npx tsx scripts/migrate-address-correction.ts [--apply]
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

const AC_VALUES = [289200, 274700]; // giá Address Correction đã xác nhận (2 kỳ)

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  // Cột nullable — ADD luôn (idempotent, app cần cột này để chạy). Chỉ phần
  // UPDATE dữ liệu mới gate sau --apply.
  await db.execute(sql`ALTER TABLE shipment_charges ADD COLUMN IF NOT EXISTS address_correction numeric(14,2)`);
  console.log('✓ ADD COLUMN address_correction (idempotent).');

  // residual hiện tại (chỉ tính khi cột đã tồn tại)
  const residualExpr = sql`total_amount::numeric - (coalesce(base,0)+coalesce(discount,0)+coalesce(fuel,0)
    +coalesce(remote,0)+coalesce(demand,0)+coalesce(direct_signature,0)+coalesce(residential,0)
    +coalesce(vat,0)+coalesce(elevated_risk,0)+coalesce(import_handling,0)+coalesce(gogreen,0)
    +coalesce(address_correction,0))`;

  const rows = await db.execute(sql`
    select id, tracking_number, round(${residualExpr}) as resid
    from shipment_charges
    where source='fedex_fbo' and coalesce(address_correction,0)=0
      and round(${residualExpr}) = any(array[289200,274700]::numeric[])`);
  const list = (rows.rows ?? rows) as Array<{ id: string; tracking_number: string; resid: string }>;
  console.log(`Đơn cần backfill address_correction: ${list.length}`);
  for (const r of list) console.log(`  ${r.tracking_number}: ${r.resid}`);

  if (apply) {
    for (const r of list) {
      await db.execute(sql`update shipment_charges set address_correction = ${r.resid} where id = ${r.id}`);
    }
    console.log(`✓ Backfill ${list.length} đơn (updated_at bump → cache reconcile tự tính lại).`);
  } else {
    console.log('[DRY-RUN] thêm --apply để ghi.');
    void AC_VALUES;
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
