/**
 * Ghi quy tắc "fuel base" (cách tính phí xăng dầu) vào notes của từng carrier
 * account, để engine/operator nhớ thành phần nào VÀO fuel base và sự bất đối
 * xứng DHL ⇄ FedEx. Idempotent: chỉ append nếu chưa có marker. Dry-run mặc định,
 * --apply để ghi.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

const MARKER = 'FUEL BASE (xác minh 2026-06-12)';

const DHL_NOTE = `${MARKER}: fuel = fuel% × (base + vùng xa/remote + demand + Elevated Risk). Elevated Risk (country_fixed) ĐƯỢC tính fuel — fuelable=true. KHÔNG vào fuel base: GoGreen (per_step), ký nhận/signature (addon_fixed fuelable=false), VAT, markup, discount. Đối chiếu: 2990/3016 đơn base-đúng khớp fuel (99%).`;

const FEDEX_NOTE = `${MARKER}: fuel = fuel% × (base + vùng xa ODA/remote + demand + ký nhận/signature). Signature (addon_fixed) ĐƯỢC tính fuel — fuelable=true, KHÁC DHL. KHÔNG vào fuel base: phí xử lý nhập US/import-handling (country_fixed), VAT, markup, discount. BẤT ĐỐI XỨNG với DHL: FedEx fuel signature / KHÔNG fuel import-handling; DHL fuel Elevated Risk / KHÔNG fuel signature. Đối chiếu: 1054/1403 đơn base-đúng khớp fuel (75%); phần lệch còn lại do remote ODA/demand/import-handling của engine ≠ hoá đơn cascade vào fuel — KHÔNG phải sai công thức fuel.`;

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = (
    await db.execute(sql`
      select ca.id, cr.key as carrier, ca.notes
      from carrier_accounts ca join carriers cr on cr.id = ca.carrier_id
      order by cr.key`)
  ).rows as Array<{ id: string; carrier: string; notes: string | null }>;

  for (const r of rows) {
    const note = r.carrier === 'dhl' ? DHL_NOTE : r.carrier === 'fedex' ? FEDEX_NOTE : null;
    if (!note) continue;
    if ((r.notes ?? '').includes(MARKER)) {
      console.log(`[skip] ${r.carrier}: đã có marker.`);
      continue;
    }
    const next = `${(r.notes ?? '').trim()}\n\n${note}`.trim();
    console.log(`\n=== ${r.carrier} (${apply ? 'APPLY' : 'dry-run'}) ===`);
    console.log(next);
    if (apply) {
      await db.execute(sql`update carrier_accounts set notes = ${next}, updated_at = now() where id = ${r.id}`);
      console.log('[written]');
    }
  }
  console.log(apply ? '\n✅ Đã ghi.' : '\n(dry-run — thêm --apply để ghi.)');
  process.exit(0);
}
main();
