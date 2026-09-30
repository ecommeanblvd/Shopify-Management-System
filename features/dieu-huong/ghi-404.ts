'use server';

import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { recordAudit } from '@/lib/logging/audit';
import { duongDanGhiDuoc, chiLayPath } from './duong-dan-404';

/**
 * Ghi lại một lần người ĐÃ ĐĂNG NHẬP đi vào đường dẫn không tồn tại (CEO 30/09/2026).
 *
 * Chỉ ghi khi CÓ phiên. Hai lý do: (1) thứ em cần biết là nhân sự nội bộ đang gõ/bookmark sai
 * đường nào, (2) 404 của bot quét là vô hạn — ghi hết thì bảng nhật ký thành bãi rác và vẫn
 * không trả lời được câu hỏi nào.
 *
 * Không bao giờ ném lỗi ra ngoài: đây là việc phụ của một trang đang báo lỗi rồi. Một trang 404
 * mà tự nó vỡ thêm thì người dùng mất luôn đường về.
 */
export async function ghiNhan404(duongDan: string): Promise<void> {
  try {
    if (!duongDanGhiDuoc(duongDan)) return;
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return;
    await recordAudit({
      userId: session.user.id,
      action: 'nav.404',
      target: chiLayPath(duongDan),
      result: 'error',
      errorDetail: 'Người đã đăng nhập đi vào đường dẫn không khớp route nào',
    });
  } catch {
    // Im lặng CÓ CHỦ Ý, và chỉ ở đây: mất một dòng nhật ký còn hơn làm trang 404 vỡ.
  }
}
