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
import sharp from 'sharp';
import { taiFileLark } from '@/features/lark/client';

export const dynamic = 'force-dynamic';
/** sharp là thư viện native — KHÔNG chạy được trên edge runtime. */
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
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

  /* `?w=` để lấy bản THU NHỎ cho ô trên bảng. Ảnh gốc kho chụp bằng điện
   * thoại nặng ~2MB; một màn hình có hơn hai chục ô ảnh, bê nguyên bản gốc là
   * vài chục MB mỗi lần mở trang. Modal xem to thì gọi không kèm `w`. */
  const wRaw = Number(req.nextUrl.searchParams.get('w'));
  const w = Number.isInteger(wRaw) && wRaw >= 16 && wRaw <= 512 ? wRaw : null;

  try {
    const r = await taiFileLark(token);
    if (!r.ok || !r.body) {
      console.error(`[kho-nhan] Lark tra ${r.status} cho file ${token}`);
      return new Response('Không tải được file', { status: 502 });
    }
    const kieu = r.headers.get('content-type') ?? 'application/octet-stream';
    // Dữ liệu nội bộ: chỉ trình duyệt của CHÍNH người xem được giữ lại, không
    // để proxy dùng chung nào cache.
    const cache = 'private, max-age=3600';

    if (w && kieu.startsWith('image/')) {
      const nho = await sharp(Buffer.from(await r.arrayBuffer()))
        .rotate()                       // theo EXIF — ảnh điện thoại hay xoay ngang
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: 72 })
        .toBuffer();
      return new Response(new Uint8Array(nho), {
        headers: { 'Content-Type': 'image/webp', 'Cache-Control': cache },
      });
    }

    return new Response(r.body, { headers: { 'Content-Type': kieu, 'Cache-Control': cache } });
  } catch (e) {
    console.error('[kho-nhan] tải ảnh Lark lỗi:', e);
    return new Response('Không tải được file', { status: 502 });
  }
}
