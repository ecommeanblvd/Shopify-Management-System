/** GET /api/customer-account/wishlist — items đã lưu + recommendations. Bearer session token. */
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../_shared';
import { getWishlistPage } from '@/features/customer-account/wishlist-page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function GET(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  const data = await getWishlistPage(auth.store.id, auth.customerId);
  return caJson(data);
}
