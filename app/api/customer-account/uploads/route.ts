/** POST /api/customer-account/uploads — ảnh bằng chứng claim → S3. Bearer session token. */
import { randomUUID } from 'node:crypto';
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../_shared';
import { isStorageConfigured, putObject } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function POST(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  if (!isStorageConfigured()) return caJson({ error: 'storage not configured' }, 503);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return caJson({ error: 'file required' }, 400);
  const ext = TYPES[file.type];
  if (!ext) return caJson({ error: 'png/jpg only' }, 415);
  if (file.size > MAX_BYTES) return caJson({ error: 'max 5MB' }, 413);
  const key = `customer-claims/${auth.store.id}/${randomUUID()}.${ext}`;
  await putObject(key, new Uint8Array(await file.arrayBuffer()), file.type);
  return caJson({ key });
}
