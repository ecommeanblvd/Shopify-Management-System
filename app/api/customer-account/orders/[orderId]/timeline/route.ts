/** GET /api/customer-account/orders/[orderId]/timeline — timeline public-safe của 1 đơn. */
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../../../_shared';
import { getCustomerOrderLifecycle } from '@/features/customer-account/customer-queries';
import { toPublicTimeline } from '@/features/customer-account/public-timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  const { orderId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return caJson({ error: 'bad id' }, 400);
  const lc = await getCustomerOrderLifecycle(auth.store.id, auth.customerId, orderId);
  if (!lc) return caJson({ error: 'not found' }, 404);
  return caJson({ timeline: toPublicTimeline(lc) });
}
