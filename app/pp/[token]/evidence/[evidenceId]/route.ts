import { NextResponse } from 'next/server';
import { tepThuocBrand } from '@/features/ship-ho/trang-phu-phi/queries';
import { getSignedDownloadUrl } from '@/lib/storage/s3';

/**
 * Tải tệp tài liệu vùng xa qua LINK BRAND — KHÔNG kiểm session.
 *
 * Giống route nội bộ cùng chức năng ở `(dashboard)/f/carrier-rates/.../evidence/[evidenceId]`,
 * nhưng phép kiểm ở đây là token + tệp phải thuộc một hãng brand đó đã đi (`tepThuocBrand`).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; evidenceId: string }> },
) {
  const { token, evidenceId } = await params;
  const key = await tepThuocBrand(token, evidenceId);
  /* Token sai, link đã thu hồi, tệp không tồn tại, hay tệp thuộc hãng brand chưa đi — CÙNG
   * một câu trả lời. Phân biệt ra là cho người giữ một link hợp lệ dò được kho tài liệu. */
  if (!key) return new NextResponse('Not found', { status: 404 });
  try {
    return NextResponse.redirect(await getSignedDownloadUrl(key, 300), 307);
  } catch {
    return new NextResponse('Không lấy được tệp, thử lại sau.', { status: 502 });
  }
}
