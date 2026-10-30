import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { laUuidBaoLoi, phucVuAnh } from '@/features/issue-report/doc-anh';
import { xemDuocAnh } from '@/features/issue-report/pham-vi';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KHONG_THAY = NextResponse.json({ ok: false, error: 'không tìm thấy' }, { status: 404 });

/**
 * Ảnh báo lỗi cho NHÂN SỰ — gác bằng luật ẢNH, không phải luật chữ (thiết kế §11, lối (b)).
 *
 * KHÔNG dùng lại `/admin/issues/[id]/anh/[n]`: route đó gác bằng `manage_users`.
 *
 * Không thoả điều kiện ⇒ **404, không 403**. 403 là xác nhận ảnh đó tồn tại cho người không
 * được xem — cùng lý do `?bl=` ngoài phạm vi trả "không tìm thấy".
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; n: string }> },
): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { id, n } = await ctx.params;
  // Chặn id rác TRƯỚC khi nó tới Postgres — `eq(id, 'abc')` ném, tức 500 thay vì 404.
  if (!laUuidBaoLoi(id)) return KHONG_THAY;
  /* Phải biết AI BÁO trước khi quyết, nên đọc đúng một cột. `phucVuAnh` không kiểm quyền —
   * chú thích của chính nó nói nơi gọi phải kiểm trước. */
  const [row] = await db.select({ reporterId: schema.issueReports.reporterId })
    .from(schema.issueReports).where(eq(schema.issueReports.id, id)).limit(1);
  if (!row) return KHONG_THAY;

  const roleKey = await getRole(session.user.id);
  if (!xemDuocAnh({ roleKey, laNguoiBao: row.reporterId === session.user.id })) return KHONG_THAY;

  return phucVuAnh(id, n);
}
