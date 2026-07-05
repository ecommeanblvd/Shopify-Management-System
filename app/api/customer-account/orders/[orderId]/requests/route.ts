/** POST /api/customer-account/orders/[orderId]/requests — tạo cancel/claim request. */
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateExtension, caJson, preflight } from '../../../_shared';
import { createOrderRequest } from '@/features/customer-account/order-requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cancel') }),
  z.object({
    kind: z.literal('claim'),
    reasonCodes: z.array(z.string()).min(1).max(6),
    description: z.string().max(2000).optional().default(''),
    photoKeys: z.array(z.string().regex(/^customer-claims\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg)$/)).min(1).max(5),
  }),
]);

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function POST(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);

  const { orderId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return caJson({ error: 'bad id' }, 400);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return caJson({ error: 'invalid json' }, 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return caJson({ error: 'validation failed', issues: parsed.error.issues }, 400);

  const input = parsed.data;

  // Extra validation: photoKeys must start with customer-claims/${storeId}/
  if (input.kind === 'claim') {
    const expectedPrefix = `customer-claims/${auth.store.id}/`;
    for (const key of input.photoKeys) {
      if (!key.startsWith(expectedPrefix)) {
        return caJson({ error: 'invalid photo key' }, 400);
      }
    }
  }

  const result = await createOrderRequest(auth.store.id, auth.customerId, orderId, input);
  if (!result.ok) {
    if (result.error.includes('already in progress')) {
      return caJson({ error: result.error }, 409);
    }
    return caJson({ error: result.error }, 400);
  }

  return caJson({ ok: true, id: result.id }, 201);
}
