/**
 * Gỡ khoá quyền khỏi một vai trên CSDL thật. DRY-RUN mặc định.
 *
 *   npx dotenv -- npx tsx scripts/du-lieu/sua-quyen-vai.ts            # chỉ in, không ghi
 *   npx dotenv -- npx tsx scripts/du-lieu/sua-quyen-vai.ts --ap-dung  # ghi thật
 *
 * Lượt 25/10/2026, CEO chốt sau khi đọc hậu quả:
 *  1. `operator` thôi đụng market → gỡ `markets:apply`.
 *     CEO đã được báo rõ: khoá này đang gác BẢY chỗ, phần lớn KHÔNG phải market
 *     (`push/commit.ts:288` đẩy bảng giá carrier, `carrier-service-actions.ts:44` đăng ký
 *     carrier service, `shipping-profiles-actions.ts:38`, `push-engine/actions.ts:32`,
 *     `system-shipping.ts:17`, `manual-shipping-rates/page.tsx:30`). CEO chọn gỡ và chịu mất.
 *     Đo thêm sau khi chốt: thực tế chỉ HAI chỗ mất mà người dùng thấy được —
 *     `/f/carrier-rates/[id]/push` thành chỉ-đọc (trang tự ghi lý do ở `:254`) và khối áp
 *     dụng ở `/f/functions/manual-shipping-rates` bị ẩn (`:112`). Bốn hàm còn lại KHÔNG có
 *     chỗ gọi nào từ UI, nên không ai bấm tới.
 *  2. `logistics` không làm nhập kho → gỡ `warehouse.receiving:create`.
 *     Tích này đang mở ra ĐÚNG 0 việc: `hasPermission` đi qua shim `OLD_TO_NEW` rồi kiểm
 *     `.every()` (`lib/auth/rbac.ts:131`), mà `manage_receiving` đòi đủ 3 khoá còn vai này
 *     có 2 (thiếu `warehouse.receiving:edit`). Nên gỡ KHÔNG đổi quyền thực tế một chút nào —
 *     nó chỉ bỏ một tín hiệu sai trên màn phân quyền. Giữ `:view` để họ còn xem được hàng
 *     đã về chưa trước khi lên vận đơn.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { refreshRoleCache } from '@/lib/auth/access';
import { permissionsForRoleKey } from '@/lib/auth/role-cache';
import { hasPermission, type Permission } from '@/lib/auth/rbac';

/** Việc cần làm, kèm quyền cũ để kiểm TRƯỚC/SAU cho thấy tác động thật. */
const VIEC: Array<{ vai: string; go: string; soi: Permission[] }> = [
  { vai: 'operator', go: 'markets:apply', soi: ['apply_markets', 'view_markets_history', 'manage_markets_template'] },
  { vai: 'logistics', go: 'warehouse.receiving:create', soi: ['view_receiving', 'manage_receiving'] },
];

async function main(): Promise<void> {
  const apDung = process.argv.includes('--ap-dung');
  console.log(apDung ? '*** ÁP DỤNG — GHI THẬT ***\n' : '*** DRY-RUN — không ghi gì (thêm --ap-dung để ghi) ***\n');

  await refreshRoleCache();
  const vais = await db.select({ id: schema.appRoles.id, key: schema.appRoles.key }).from(schema.appRoles);
  const idCua = new Map(vais.map((v) => [v.key, v.id]));

  for (const v of VIEC) {
    const roleId = idCua.get(v.vai);
    if (!roleId) { console.error(`✗ Không có vai '${v.vai}' — bỏ qua.`); continue; }
    const co = permissionsForRoleKey(v.vai).has(v.go as never);
    console.log(`${v.vai} · gỡ '${v.go}' — hiện ${co ? 'CÓ' : 'KHÔNG CÓ (không cần làm gì)'}`);
    console.log(`  TRƯỚC: ` + v.soi.map((p) => `${p}=${hasPermission(v.vai, p) ? 'CÓ' : 'không'}`).join(' · '));
    if (!co) { console.log(); continue; }

    if (apDung) {
      const r = await db.delete(schema.rolePermissions).where(and(
        eq(schema.rolePermissions.roleId, roleId),
        eq(schema.rolePermissions.permissionKey, v.go),
      ));
      console.log(`  đã xoá ${(r as unknown as { rowCount?: number }).rowCount ?? 0} dòng`);
    } else {
      console.log('  (dry-run: sẽ xoá 1 dòng role_permissions)');
    }
    console.log(`  HOÀN TÁC: tích lại '${v.go}' cho vai '${v.vai}' ở /admin/roles, hoặc`);
    console.log(`    INSERT INTO role_permissions (role_id, permission_key) VALUES ('${roleId}', '${v.go}');`);
    console.log();
  }

  if (apDung) {
    await refreshRoleCache();
    console.log('=== SAU khi ghi (cache đã làm ấm lại) ===');
    for (const v of VIEC) {
      console.log(`  ${v.vai}: ` + v.soi.map((p) => `${p}=${hasPermission(v.vai, p) ? 'CÓ' : 'không'}`).join(' · '));
    }
    console.log('\nLưu ý: tiến trình production có cache riêng, TTL 30s — chờ ~30s là tự khớp.');
  }
  process.exit(0);
}
void main().catch((e) => { console.error(e); process.exit(1); });
