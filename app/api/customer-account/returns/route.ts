/** GET/POST /api/customer-account/returns — list + tạo yêu cầu đổi/trả (scoped từ token). */
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../_shared';
import { listCustomerReturns, createCustomerReturn } from '@/features/customer-account/customer-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function GET(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  return caJson({ returns: await listCustomerReturns(auth.store.id, auth.customerId) });
}
export async function POST(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  let body: { orderId?: string; reason?: string; note?: string };
  try { body = await req.json(); } catch { return caJson({ error: 'invalid json' }, 400); }
  if (!body.orderId || !body.reason) return caJson({ error: 'orderId + reason required' }, 400);
  const r = await createCustomerReturn(auth.store.id, auth.customerId, body.orderId, body.reason, body.note ?? null);
  return caJson(r, r.ok ? 200 : 400);
}
