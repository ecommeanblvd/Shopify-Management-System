/**
 * Người đang xem được thấy module CX nào.
 *
 * CỐ Ý KHÔNG có `'use server'` — helper dùng chung cho các file truy vấn. Đặt
 * directive ở đây là biến mỗi export thành một endpoint công khai.
 */
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

export interface QuyenCx {
  userId: string;
  ticket: boolean;
  doiTra: boolean;
  tranhChap: boolean;
  suCo: boolean;
  danhGia: boolean;
}

/** Có ít nhất một module CX xem được. */
export function coGiDeXem(q: QuyenCx): boolean {
  return q.ticket || q.doiTra || q.tranhChap || q.suCo || q.danhGia;
}

/**
 * Lọc quyền ở tầng TRUY VẤN, không ở tầng hiển thị: người chỉ có `cx.review` gõ
 * mã đơn thì không được thấy số tiền tranh chấp của đơn đó. Chỉ ẩn ở UI thì dữ
 * liệu vẫn về trình duyệt.
 */
export async function quyenCx(): Promise<QuyenCx> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập.');
  const role = await getRole(session.user.id);
  if (!role) throw new Error('Không có vai trò.');
  return {
    userId: session.user.id,
    ticket: hasPermission(role, 'view_cx_ticket'),
    // Đổi trả nằm trong module Customer Account nên dùng quyền của module đó.
    doiTra: hasPermission(role, 'view_functions'),
    tranhChap: hasPermission(role, 'view_cx_dispute'),
    suCo: hasPermission(role, 'view_cx_incident'),
    danhGia: hasPermission(role, 'view_cx_review'),
  };
}
