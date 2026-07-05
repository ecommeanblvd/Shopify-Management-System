/** POST /api/customer-account/requests/[id]/tracking — add return tracking info. */
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateExtension, caJson, preflight } from '../../../_shared';
import { addReturnTracking } from '@/features/customer-account/order-requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  carrier: z.string().min(1).max(64),
  tracking: z.string().min(4).max(64),
});

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return caJson({ error: 'bad id' }, 400);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return caJson({ error: 'invalid json' }, 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return caJson({ error: 'validation failed', issues: parsed.error.issues }, 400);

  const { carrier, tracking } = parsed.data;
  const result = await addReturnTracking(auth.store.id, auth.customerId, id, carrier, tracking);

  if (!result.ok) {
    if (result.error === 'not found') {
      return caJson({ error: result.error }, 404);
    }
    return caJson({ error: result.error }, 400);
  }

  return caJson({ ok: true });
}
