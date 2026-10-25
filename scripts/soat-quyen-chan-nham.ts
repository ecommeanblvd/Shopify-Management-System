/**
 * Soát CHẶN NHẦM: sau khi đặt cổng quyền vào thân các hàm ghi (25/10/2026), vai nào mất
 * đường làm việc?
 *
 * Chỉ ĐỌC. Không ghi gì. `npx dotenv -- npx tsx scripts/soat-quyen-chan-nham.ts`
 *
 * Vì sao cần script chứ không đọc mã: `hasPermission(vai, quyenCu)` đi qua shim
 * `OLD_TO_NEW` rồi kiểm `.every()` (`lib/auth/rbac.ts:131`). Một quyền cũ như
 * `manage_carrier_rates` ánh xạ ra BA khoá mới, nên vai có 2/3 khoá là `hasPermission`
 * trả về FALSE — mà nhìn danh sách tích trên màn phân quyền thì tưởng là có. Đó là cách
 * chặn nhầm xảy ra mà không ai thấy trước. Script gọi CHÍNH hàm của hệ thống, không
 * diễn giải lại luật.
 */
import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';
import { refreshRoleCache } from '@/lib/auth/access';
import { permissionsForRoleKey } from '@/lib/auth/role-cache';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { OLD_TO_NEW } from '@/lib/auth/permission-map';

/** Mỗi dòng: màn làm việc · cổng VÀO trang (trước đây) · quyền hàm ĐÒI (bây giờ). */
const MAN: Array<{ man: string; vao: Permission; doi: Permission[] }> = [
  { man: 'Markets · lưu/xoá bản mẫu', vao: 'view_markets_history', doi: ['manage_markets_template'] },
  { man: 'Markets · seed bản mẫu', vao: 'view_markets_history', doi: ['manage_markets_template'] },
  { man: 'Markets · override theo store', vao: 'apply_markets', doi: ['apply_markets'] },
  { man: 'Markets · ÁP DỤNG lên store thật', vao: 'apply_markets', doi: ['apply_markets'] },
  { man: 'Settings-sync · áp dụng', vao: 'apply_settings', doi: ['apply_settings'] },
  { man: 'Settings-sync · đối soát store', vao: 'reconcile_store', doi: ['reconcile_store'] },
  { man: 'Settings-sync · sửa bản mẫu', vao: 'manage_settings_template', doi: ['manage_settings_template'] },
  { man: 'Carrier · sửa/xoá tài khoản', vao: 'view_carrier_rates', doi: ['manage_carrier_rates'] },
  { man: 'Carrier · tạo tài khoản', vao: 'manage_carrier_rates', doi: ['manage_carrier_rates'] },
  { man: 'Carrier · zone', vao: 'view_carrier_rates', doi: ['manage_carrier_rates'] },
  { man: 'Carrier · bậc cân', vao: 'view_carrier_rates', doi: ['manage_carrier_rates'] },
  { man: 'Carrier · ô giá (matrix)', vao: 'view_carrier_rates', doi: ['manage_carrier_rates'] },
  { man: 'Carrier · phụ phí & fuel', vao: 'view_carrier_rates', doi: ['manage_carrier_rates'] },
  { man: 'Carrier · nối link market', vao: 'view_carrier_rates', doi: ['manage_carrier_rates'] },
  { man: 'Carrier · đẩy bảng giá (commit)', vao: 'view_carrier_rates', doi: ['manage_carrier_rates', 'apply_markets'] },
  { man: 'Carrier · THANH TOÁN & xoá hoá đơn', vao: 'view_carrier_rates', doi: ['manage_carrier_rates'] },
  { man: 'Đơn · áp giá vốn SKU', vao: 'manage_sku_costs', doi: ['manage_sku_costs'] },
  { man: 'Đơn · áp hoá đơn cước', vao: 'manage_shipping_invoices', doi: ['manage_shipping_invoices'] },
];

/** Luồng NHẬP hoá đơn nhận MỘT TRONG hai khoá (`ap/perm.ts`), nên xét riêng. */
const MOT_TRONG: Permission[] = ['manage_shipping_invoices', 'manage_carrier_rates'];

async function main(): Promise<void> {
  await refreshRoleCache();

  const vais = await db.select({ id: schema.appRoles.id, key: schema.appRoles.key, name: schema.appRoles.name })
    .from(schema.appRoles).orderBy(schema.appRoles.key);
  const dem = await db.select({ roleId: schema.roles.roleId, n: sql<number>`count(*)::int` })
    .from(schema.roles).groupBy(schema.roles.roleId);
  const soNguoi = new Map(dem.map((d) => [d.roleId, d.n]));

  console.log('=== VAI TRÊN PRODUCTION ===');
  for (const v of vais) {
    console.log(`  ${v.key.padEnd(12)} ${String(soNguoi.get(v.id) ?? 0).padStart(2)} người  (${v.name})  ${permissionsForRoleKey(v.key).size} khoá`);
  }

  /* ĐỌC KẾT QUẢ CHO ĐÚNG: một dòng ở đây CHƯA phải chặn nhầm. Nó chỉ nói "vai này vào được
   * trang mà hàm thì chặn". Muốn biết có chặn nhầm THẬT phải xem phần GHI của trang đó có
   * hiện ra cho vai đó không — mọi trang trong danh sách đều tính `canManage` bằng CHÍNH
   * `hasPermission(role, <khoá hàm đòi>)` rồi ẩn nút theo nó (soát tay 25/10/2026, lần tới
   * tận `components/carrier-rates/InvoiceDetailModal.tsx:145,160,172`). Nút đã ẩn nghĩa là
   * vai đó chưa từng làm việc này qua giao diện, nên cổng ở server chỉ khớp lại với giao
   * diện. Phần dưới in ra để BIẾT ai mất đường gọi thẳng, không phải để kết luận. */
  console.log('\n=== VÀO được trang mà hàm CHẶN (xem chú thích: chưa chắc là chặn nhầm) ===');
  let chanNham = 0;
  for (const m of MAN) {
    for (const v of vais) {
      const nguoi = soNguoi.get(v.id) ?? 0;
      if (!hasPermission(v.key, m.vao)) continue;              // trước đây cũng không vào được
      const thieu = m.doi.filter((p) => !hasPermission(v.key, p));
      if (thieu.length === 0) continue;                        // vẫn làm được
      chanNham++;
      const chiTiet = thieu.map((p) => {
        const perms = permissionsForRoleKey(v.key);
        const can = (OLD_TO_NEW[p] ?? []).filter((k) => !perms.has(k));
        return `${p} (thiếu khoá: ${can.join(', ') || '—'})`;
      });
      console.log(`  ${nguoi > 0 ? '⚠ CÓ NGƯỜI' : '· trống  '} ${v.key.padEnd(12)} ${m.man}`);
      for (const c of chiTiet) console.log(`              ↳ ${c}`);
    }
  }
  if (chanNham === 0) console.log('  (không có)');

  console.log('\n=== LUỒNG NHẬP HOÁ ĐƠN (nhận một trong hai khoá) ===');
  for (const v of vais) {
    const ok = MOT_TRONG.some((p) => hasPermission(v.key, p));
    const nguoi = soNguoi.get(v.id) ?? 0;
    const vao = hasPermission(v.key, 'view_carrier_rates');
    console.log(`  ${v.key.padEnd(12)} ${nguoi} người · vào trang: ${vao ? 'CÓ' : 'không'} · nhập hoá đơn: ${ok ? 'ĐƯỢC' : 'BỊ CHẶN'}`);
  }

  console.log('\n=== BẪY .every(): khoá nào vai có MỘT PHẦN ===');
  let bay = 0;
  for (const v of vais) {
    const perms = permissionsForRoleKey(v.key);
    for (const [cu, moi] of Object.entries(OLD_TO_NEW)) {
      if (moi.length < 2) continue;
      const co = moi.filter((k) => perms.has(k));
      if (co.length === 0 || co.length === moi.length) continue;
      bay++;
      console.log(`  ${v.key.padEnd(12)} ${cu}: có ${co.length}/${moi.length} → hasPermission = FALSE`);
      console.log(`              ↳ thiếu: ${moi.filter((k) => !perms.has(k)).join(', ')}`);
    }
  }
  if (bay === 0) console.log('  (không có vai nào có một phần — mọi chùm đều đủ hoặc trống)');

  process.exit(0);
}
void main().catch((e) => { console.error(e); process.exit(1); });
