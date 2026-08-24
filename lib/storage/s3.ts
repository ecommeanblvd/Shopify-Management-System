import {
  S3Client, PutObjectCommand, GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Vendor-neutral S3-compatible object storage. Works with any S3 API:
 * Supabase Storage (`https://<ref>.supabase.co/storage/v1/s3`), Cloudflare R2
 * (`https://<account>.r2.cloudflarestorage.com`), AWS S3, MinIO, etc. — pick
 * the backend purely via env. `forcePathStyle` is required by Supabase and
 * harmless for the others.
 */

/** True when every S3_* env var the client needs is present. */
export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY && process.env.S3_BUCKET,
  );
}

function client(): { s3: S3Client; bucket: string } {
  if (!isStorageConfigured()) {
    throw new Error('Object storage not configured (set S3_ENDPOINT/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_BUCKET).');
  }
  const s3 = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  return { s3, bucket: process.env.S3_BUCKET! };
}

/**
 * Dịch lỗi SDK sang câu người dùng hiểu được. Supabase Storage trả lỗi dạng
 * JSON, còn SDK S3 lại cố parse XML → ném ra "char '{' is not expected", vô
 * nghĩa với ops (24/08: quota egress bị vượt, cả app không upload được mà
 * thông báo không hề nhắc tới hạn mức). Giữ nguyên lỗi khác.
 */
function storageError(e: unknown): Error {
  const x = e as { $response?: { statusCode?: number; body?: unknown }; message?: string };
  const status = x?.$response?.statusCode;
  const raw = (() => { try { return String(x?.$response?.body ?? ''); } catch { return ''; } })();
  if (status === 402 || /quota|restricted|exceed_egress/i.test(raw)) {
    return new Error('Kho lưu trữ file đang bị KHOÁ do vượt hạn mức của nhà cung cấp — cần nâng gói/gỡ giới hạn chi tiêu rồi thử lại. (Dữ liệu hoá đơn vẫn import được, chỉ thiếu file gốc đính kèm.)');
  }
  if (status === 401 || status === 403) return new Error('Kho lưu trữ file từ chối truy cập (sai khoá hoặc hết hạn) — liên hệ quản trị.');
  if (status && status >= 500) return new Error(`Kho lưu trữ file đang lỗi (HTTP ${status}) — thử lại sau ít phút.`);
  return e instanceof Error ? e : new Error(String(e));
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const { s3, bucket } = client();
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  } catch (e) { throw storageError(e); }
}

export async function getObject(key: string): Promise<Uint8Array> {
  const { s3, bucket } = client();
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return await res.Body!.transformToByteArray();
  } catch (e) { throw storageError(e); }
}

export async function getSignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
  const { s3, bucket } = client();
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresInSeconds });
}
