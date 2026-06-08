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

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const { s3, bucket } = client();
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Uint8Array> {
  const { s3, bucket } = client();
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return bytes;
}

export async function getSignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
  const { s3, bucket } = client();
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresInSeconds });
}
