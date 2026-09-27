/**
 * Ai đang xem, thuộc bộ phận nào, có được ghi hộ không.
 *
 * CỐ Ý KHÔNG có `'use server'`: đây là helper dùng chung cho cả `queries.ts` và
 * `actions.ts`. Nếu đặt directive ở đây thì mỗi export thành MỘT endpoint công
 * khai — không ai muốn `nguoiHienTai` gọi được từ ngoài.
 */
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';

export interface NguoiCx {
  userId: string;
  roleKey: string;
  /** Bộ phận của vai trò — null khi vai trò không thuộc bộ phận nào (admin, viewer). */
  boPhan: string | null;
  /** Có `manage_cx_ticket` → ghi được phần việc của MỌI bộ phận (CX ghi hộ). */
  toanQuyen: boolean;
}

export async function nguoiHienTai(): Promise<NguoiCx> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập.');
  const roleKey = await getRole(session.user.id);
  if (!roleKey || !hasPermission(roleKey, 'view_cx_ticket')) {
    throw new Error('Không có quyền xem ticket CX.');
  }
  const [r] = await db.select({ boPhan: schema.appRoles.boPhan })
    .from(schema.appRoles).where(eq(schema.appRoles.key, roleKey)).limit(1);
  return {
    userId: session.user.id,
    roleKey,
    boPhan: r?.boPhan ?? null,
    toanQuyen: hasPermission(roleKey, 'manage_cx_ticket'),
  };
}

/** Như trên nhưng đòi quyền GHI. Dùng ở mọi action làm thay đổi dữ liệu. */
export async function nguoiGhi(): Promise<NguoiCx> {
  const n = await nguoiHienTai();
  if (!n.toanQuyen && n.boPhan == null) {
    // Không toàn quyền mà cũng chưa gắn bộ phận thì không có phần việc nào của
    // mình để ghi — chặn ở đây cho lỗi rõ ràng, thay vì để từng action tự đoán.
    throw new Error('Vai trò của bạn chưa được gắn bộ phận, chưa ghi được ticket.');
  }
  return n;
}
