/** GET /api/customer-account/config — extension đọc config per-store. Bearer session token. */
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../_shared';
import { getPublicConfig } from '@/features/customer-account/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function GET(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  return caJson(await getPublicConfig(auth.store.id));
}
