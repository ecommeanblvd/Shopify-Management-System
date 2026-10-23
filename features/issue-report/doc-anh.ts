import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { getObject } from '@/lib/storage/s3';
import type { AnhBaoLoi } from './anh';

const UUID = /^[0-9a-f-]{36}$/;

/**
 * Trả bytes của ảnh thứ `n` (bắt đầu từ 1) của một báo lỗi. KHÔNG kiểm quyền — nơi gọi phải
 * kiểm trước (phiên admin hoặc token). Stream qua app thay vì chuyển hướng sang URL S3 ký sẵn:
 * phiên chạy đêm chỉ được phép gọi tới domain của app, không tới domain kho lưu trữ.
 */
export async function phucVuAnh(id: string, n: string): Promise<Response> {
  const thuTu = Number(n);
  if (!UUID.test(id) || !Number.isInteger(thuTu) || thuTu < 1) {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }
  const [r] = await db.select({ anh: schema.issueReports.anh }).from(schema.issueReports)
    .where(eq(schema.issueReports.id, id)).limit(1);
  const a = (r?.anh as AnhBaoLoi[] | undefined)?.[thuTu - 1];
  if (!a) return NextResponse.json({ ok: false, error: 'không tìm thấy' }, { status: 404 });
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
