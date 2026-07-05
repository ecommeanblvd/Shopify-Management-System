/** GET — public ảnh PNG (302 → signed URL S3). Không cần token (chỉ ảnh). */
import { NextResponse, type NextRequest } from 'next/server';
import { getAsset } from '@/features/customer-account/queries';
import { getSignedDownloadUrl } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ assetId: string }> }): Promise<Response> {
  const { assetId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(assetId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const asset = await getAsset(assetId);
  if (!asset) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const url = await getSignedDownloadUrl(asset.fileKey, 300);
  return NextResponse.redirect(url, 302);
}
