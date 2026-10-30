import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { getObject } from '@/lib/storage/s3';
import type { AnhBaoLoi } from './anh';

/**
 * Khoá UUID của một báo lỗi. Chặt theo khuôn 8-4-4-4-12 chữ số hex, KHÔNG phải
 * `/^[0-9a-f-]{36}$/` — khuôn lỏng đó nhận cả `------------------------------------`.
 *
 * Export để nơi gọi chặn TRƯỚC khi id tới Postgres: route ảnh của nhân sự phải đọc
 * `reporter_id` trước khi quyết quyền, nên một id rác đi thẳng vào `eq(id, …)` làm Postgres
 * ném "invalid input syntax for type uuid" ⇒ 500 thay vì 404.
 */
export function laUuidBaoLoi(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * 404 cho mọi nhánh "không được xem / không có" của route ảnh.
 *
 * HÀM, không phải hằng mức module: thân một `Response` là stream **dùng một lần**, nên giữ một
 * đối tượng rồi trả nhiều lượt làm lượt đầu đúng 404 và **mọi lượt sau ném "Body is unusable"
 * ⇒ 500**. Đo thật 30/10/2026. Nó biến một nhánh gác cố ý thành lỗi hệ thống — và một mã 500
 * ổn định cũng là dấu hiệu bất thường, đúng thứ việc trả 404 sinh ra để tránh.
 */
export function khongTimThayAnh(): Response {
  return NextResponse.json({ ok: false, error: 'không tìm thấy' }, { status: 404 });
}

/**
 * Trả bytes của ảnh thứ `n` (bắt đầu từ 1) của một báo lỗi. KHÔNG kiểm quyền — nơi gọi phải
 * kiểm trước (phiên admin hoặc token). Stream qua app thay vì chuyển hướng sang URL S3 ký sẵn:
 * phiên chạy đêm chỉ được phép gọi tới domain của app, không tới domain kho lưu trữ.
 */
export async function phucVuAnh(id: string, n: string): Promise<Response> {
  const thuTu = Number(n);
  if (!laUuidBaoLoi(id) || !Number.isInteger(thuTu) || thuTu < 1) {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }
  const [r] = await db.select({ anh: schema.issueReports.anh }).from(schema.issueReports)
    .where(eq(schema.issueReports.id, id)).limit(1);
  const a = (r?.anh as AnhBaoLoi[] | undefined)?.[thuTu - 1];
  if (!a) return khongTimThayAnh();
  try {
    const bytes = await getObject(a.key);
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': a.loai,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, max-age=300',
        // Ảnh do người dùng tải lên: không cho trình duyệt đoán kiểu, và chỉ hiện — không chạy.
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'inline',
      },
    });
  } catch (e) {
    console.error('[issue-report] đọc ảnh lỗi:', e);
    return NextResponse.json({ ok: false, error: 'không đọc được ảnh' }, { status: 502 });
  }
}
