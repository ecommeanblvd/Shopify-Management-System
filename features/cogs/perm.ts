import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

/** Trả userId nếu có quyền; ném lỗi nếu chưa đăng nhập / thiếu quyền. Dùng chung cho mọi action giá vốn/lãi gộp. */
export async function requireCogs(perm: 'view_cogs' | 'manage_cogs'): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}
