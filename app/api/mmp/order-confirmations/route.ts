/**
 * POST /api/mmp/order-confirmations
 * MMP → SMS: brand confirms/rejects a production request + expected delivery date.
 * HMAC SHA-256 over `${timestamp}.${rawBody}` (x-mean-signature, x-mean-timestamp).
 * Body: { requestId, status: 'confirmed'|'rejected', expectedDeliveryDate?, note? }
 */
import { NextResponse, type NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { applyConfirmation } from '@/features/fulfillment/brand-logic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'MMP_WEBHOOK_SECRET not configured' }, { status: 500 });

  const rawBody = await req.text();
  const hmac = verifyMmpSignature({
    secret, rawBody,
    signatureHeader: req.headers.get('x-mean-signature'),
    timestampHeader: req.headers.get('x-mean-timestamp'),
  });
  if (!hmac.ok) return NextResponse.json({ error: 'signature verification failed', reason: hmac.reason }, { status: 401 });

  let body: { requestId?: string; status?: string; expectedDeliveryDate?: string | null; note?: string | null };
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  if (!body.requestId || (body.status !== 'confirmed' && body.status !== 'rejected')) {
    return NextResponse.json({ error: 'requestId + status(confirmed|rejected) required' }, { status: 400 });
  }
  if (body.status === 'confirmed' && body.expectedDeliveryDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(body.expectedDeliveryDate)) {
    return NextResponse.json({ error: 'expectedDeliveryDate must be YYYY-MM-DD' }, { status: 400 });
  }

  const [reqRow] = await db.select().from(schema.brandOrderRequests)
    .where(eq(schema.brandOrderRequests.id, body.requestId)).limit(1);
  if (!reqRow) return NextResponse.json({ error: 'request not found' }, { status: 404 });

  if (reqRow.confirmStatus === body.status) return NextResponse.json({ ok: true, idempotent: true });

  const applied = applyConfirmation({ status: body.status, expectedDeliveryDate: body.expectedDeliveryDate, note: body.note });

  // Resolve the fulfillment id for the audit event (avoid an awkward inline subquery).
  const [line] = await db.select({ fulfillmentId: schema.orderFulfillmentLines.fulfillmentId })
    .from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.id, reqRow.fulfillmentLineId)).limit(1);

  await db.transaction(async (tx) => {
    await tx.update(schema.brandOrderRequests)
      .set({ confirmStatus: applied.confirmStatus, expectedDeliveryDate: applied.expectedDeliveryDate,
             note: applied.note, confirmedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(schema.brandOrderRequests.id, reqRow.id));
    await tx.update(schema.orderFulfillmentLines)
      .set({ status: applied.lineStatus, updatedAt: sql`now()` })
      .where(eq(schema.orderFulfillmentLines.id, reqRow.fulfillmentLineId));
    if (line) {
      await tx.insert(schema.orderFulfillmentEvents)
        .values({ fulfillmentId: line.fulfillmentId, lineId: reqRow.fulfillmentLineId,
                  fromStatus: 'brand_requested', toStatus: applied.lineStatus, actor: 'mmp-webhook' });
    }
  });
  return NextResponse.json({ ok: true });
}
