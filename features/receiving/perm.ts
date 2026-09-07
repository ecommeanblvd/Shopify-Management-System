import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';

/** Trả userId nếu có quyền; ném lỗi nếu chưa đăng nhập / thiếu quyền. Dùng chung cho mọi action nhập kho. */
export async function requirePerm(perm: Permission): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}

/** Retry a unit-of-work on a Postgres unique-violation (23505) — covers the
 *  read-max-then-insert race on generated sequential codes. */
export async function withUniqueRetry<R>(fn: () => Promise<R>, attempts = 4): Promise<R> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const code = (e as { code?: string; cause?: { code?: string } })?.code
        ?? (e as { cause?: { code?: string } })?.cause?.code;
      if (code === '23505' && i < attempts - 1) continue;
      throw e;
    }
  }
  throw new Error('unreachable');
}
