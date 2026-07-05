/** POST /api/customer-account/wishlist/remove — xóa item khỏi wishlist khách. Bearer session token. */
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateExtension, caJson, preflight } from '../../_shared';
import { removeWishlistItem } from '@/features/customer-account/wishlist-page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  shopifyProductId: z.string().min(1).max(255),
  shopifyVariantId: z.string().min(1).max(255).optional(),
});

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function POST(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return caJson({ error: 'invalid body' }, 400);
  const res = await removeWishlistItem(
    auth.store.id, auth.customerId, parsed.data.shopifyProductId, parsed.data.shopifyVariantId,
  );
  return caJson(res);
}
