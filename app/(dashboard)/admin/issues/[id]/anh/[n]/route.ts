import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { phucVuAnh } from '@/features/issue-report/doc-anh';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Ảnh báo lỗi cho admin xem trong `/admin/issues` — cần phiên đăng nhập + `manage_users`. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; n: string }> }): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_users')) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  const { id, n } = await ctx.params;
  return phucVuAnh(id, n);
}
