/** THUẦN(ish): CORS + auth extension dùng chung cho route Customer Account. */
import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { verifySessionToken } from '@/features/customer-account/session-token';

export const CA_CORS = {
  'Access-Control-Allow-Origin': 'https://extensions.shopifycdn.com',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};
export function preflight(): Response { return new Response(null, { status: 204, headers: CA_CORS }); }
export const caJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CA_CORS });

export async function authenticateExtension(req: NextRequest): Promise<{ store: { id: string }; customerId: string | null } | Response> {
  const secrets = (process.env.CUSTOMER_ACCOUNT_APP_SECRETS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (secrets.length === 0) return caJson({ error: 'CUSTOMER_ACCOUNT_APP_SECRETS not configured' }, 500);
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return caJson({ error: 'missing bearer token' }, 401);
  const clientIds = (process.env.CUSTOMER_ACCOUNT_APP_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const v = verifySessionToken(token, secrets, { allowedClientIds: clientIds });
  if (!v.ok) return caJson({ error: 'invalid token', reason: v.reason }, 401);
  const [store] = await db.select({ id: schema.stores.id }).from(schema.stores)
    .where(eq(schema.stores.shopDomain, v.shopDomain)).limit(1);
  if (!store) return caJson({ error: 'unknown shop' }, 404);
  return { store, customerId: v.customerId };
}
