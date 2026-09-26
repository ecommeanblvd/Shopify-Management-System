/**
 * GET /api/kho-nhan/anh-lark/:token
 *   → nội dung file đính kèm trên bảng Lark WH - Inventory
 *
 * Vì sao phải đi vòng qua máy chủ mình: file trên Lark Drive chỉ tải được kèm
 * header Authorization của app. Dán URL của Lark thẳng vào thẻ <img> là 401.
 *
 * Đường này ĐỌC THÔI và chỉ mở cho người có quyền xem kho — không phải ảnh
 * công khai, trong đó có biên bản bàn giao mang thông tin thương mại.
 */
import type { NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { taiFileLark } from '@/features/lark/client';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response('Chưa đăng nhập', { status: 401 });
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_receiving')) {
    return new Response('Không có quyền', { status: 403 });
  }

  const { token } = await params;
  // Token của Lark là chuỗi chữ-số; chặn ở đây để không chuyển tiếp thứ lạ.
  if (!/^[A-Za-z0-9]{10,64}$/.test(token)) return new Response('Token không hợp lệ', { status: 400 });

  try {
    const r = await taiFileLark(token);
    if (!r.ok || !r.body) return new Response('Không tải được file', { status: 502 });
    return new Response(r.body, {
      headers: {
        'Content-Type': r.headers.get('content-type') ?? 'application/octet-stream',
        // File trên Lark không đổi nội dung theo token, nhưng vẫn là dữ liệu
        // nội bộ nên chỉ cho trình duyệt của CHÍNH người xem giữ lại.
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (e) {
    console.error('[kho-nhan] tải ảnh Lark lỗi:', e);
    return new Response('Không tải được file', { status: 502 });
  }
}
