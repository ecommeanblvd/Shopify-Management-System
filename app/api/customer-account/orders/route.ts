/** GET /api/customer-account/orders — list đơn của customer (scoped từ token). */
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../_shared';
import { listCustomerOrders } from '@/features/customer-account/customer-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function GET(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  return caJson({ orders: await listCustomerOrders(auth.store.id, auth.customerId) });
}
