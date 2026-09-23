import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

/**
 * Cổng cho MỌI server action ghi dữ liệu của luồng KOL.
 *
 * Vì sao kiểm lại dù trang đã kiểm: server action gọi được ĐỘC LẬP với trang,
 * nên không được tin trang đã gác hộ (đúng nếp features/ship-ho/require-manage.ts).
 */
export async function requireQuanLyKol(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập.');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_kol')) {
    throw new Error('Bạn không có quyền quản lý đơn KOL.');
  }
  return session.user.id;
}

/** Cổng cho thao tác chỉ ĐỌC gọi từ client (ví dụ tra giá vốn khi gõ form). */
export async function requireXemKol(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập.');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_kol')) {
    throw new Error('Bạn không có quyền xem đơn KOL.');
  }
  return session.user.id;
}
