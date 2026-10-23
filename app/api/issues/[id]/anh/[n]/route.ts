import { kiemTokenIssue } from '@/features/issue-report/api-auth';
import { phucVuAnh } from '@/features/issue-report/doc-anh';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** `GET /api/issues/<id>/anh/<n>` — tải ảnh đính kèm (n từ 1) bằng `ISSUE_API_TOKEN`. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string; n: string }> }): Promise<Response> {
  const tu = kiemTokenIssue(request);
  if (tu) return tu;
  const { id, n } = await ctx.params;
  return phucVuAnh(id, n);
}
