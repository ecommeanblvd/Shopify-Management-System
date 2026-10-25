import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';

/**
 * Trả userId nếu có MỘT TRONG các quyền; ném nếu chưa đăng nhập / thiếu cả.
 *
 * Cần bản "một trong" vì `requirePerm` (`features/receiving/perm.ts:7`) chỉ nhận một khoá,
 * mà luồng hoá đơn carrier cố ý nhận hai: `app/(dashboard)/f/carrier-rates/[id]/bills/page.tsx:50`
 * tính `canAddInvoice = canManage || hasPermission(role, 'manage_shipping_invoices')`, kèm
 * chú thích tại chỗ "nhập hoá đơn chỉ cần quyền hoá đơn (logistics có), tách khỏi quyền quản
 * trị bảng giá đầy đủ". Siết luồng nhập về một khoá là chặn nhầm vai `logistics`.
 *
 * Theo nếp hàm gác nội bộ đã có ở `features/dong-hang/actions.ts:435`.
 */
export async function nguoiCoMotTrong(...perms: Permission[]): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !perms.some((p) => hasPermission(role, p))) throw new Error('Forbidden');
  return session.user.id;
}

/** Người được nhập/thêm hoá đơn carrier: quyền hoá đơn HOẶC quyền quản trị bảng giá. */
export async function nguoiNhapHoaDon(): Promise<string> {
  return nguoiCoMotTrong('manage_shipping_invoices', 'manage_carrier_rates');
}
