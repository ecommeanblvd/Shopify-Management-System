import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { verifyShopifyHmac } from '@/features/shopify-orders/webhook/verify-hmac';
import { dispatchWebhook, topicFromSlug } from '@/features/shopify-orders/webhook/dispatch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Shopify webhook receiver.
 *   POST /api/webhooks/shopify/<topic-slug>
 * with headers X-Shopify-Hmac-Sha256, X-Shopify-Webhook-Id, X-Shopify-Shop-Domain.
 *
 * Must respond within 5s. Steps:
 *   1. HMAC verify (raw body, never JSON-parsed first).
 *   2. Dedup on webhook_id.
 *   3. Resolve store by shop_domain.
 *   4. Log received → dispatch by topic → log processed.
 *
 * Any failure logs `status='failed'` and returns 500 so Shopify retries.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ topic: string }> },
): Promise<Response> {
  const slug = (await params).topic;
  const topic = topicFromSlug(slug);
  if (!topic) return NextResponse.json({ ok: false, error: 'unknown topic' }, { status: 404 });

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'misconfigured' }, { status: 500 });

  const rawBody = await request.text();
  const sig = request.headers.get('x-shopify-hmac-sha256') ?? '';
  if (!verifyShopifyHmac(rawBody, sig, secret)) {
    return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 401 });
  }

  const webhookId = request.headers.get('x-shopify-webhook-id') ?? '';
  const shopDomain = request.headers.get('x-shopify-shop-domain') ?? '';
  if (!webhookId || !shopDomain) {
    return NextResponse.json({ ok: false, error: 'missing headers' }, { status: 400 });
  }

  const [store] = await db
    .select({ id: schema.stores.id })
    .from(schema.stores)
    .where(eq(schema.stores.shopDomain, shopDomain));
  if (!store) {
    return NextResponse.json({ ok: false, error: 'unknown shop' }, { status: 404 });
  }

  const existing = await db
    .select({ status: schema.shopifyWebhookLog.status })
    .from(schema.shopifyWebhookLog)
    .where(eq(schema.shopifyWebhookLog.shopifyWebhookId, webhookId));
  if (existing.length > 0 && existing[0].status === 'processed') {
    return NextResponse.json({ ok: true, skipped: 'duplicate' });
  }

  const payloadHash = createHash('sha256').update(rawBody).digest('hex');
  await db
    .insert(schema.shopifyWebhookLog)
    .values({
      storeId: store.id,
      topic,
      shopifyWebhookId: webhookId,
      status: 'received',
      payloadHash,
    })
    .onConflictDoNothing({ target: schema.shopifyWebhookLog.shopifyWebhookId });

  try {
    const payload = JSON.parse(rawBody);
    await dispatchWebhook(store.id, topic, payload);
    await db
      .update(schema.shopifyWebhookLog)
      .set({ status: 'processed', processedAt: new Date() })
      .where(eq(schema.shopifyWebhookLog.shopifyWebhookId, webhookId));
    await db
      .insert(schema.shopifySyncState)
      .values({ storeId: store.id, lastWebhookAt: new Date() })
      .onConflictDoUpdate({
        target: schema.shopifySyncState.storeId,
        set: { lastWebhookAt: new Date() },
      });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await db
      .update(schema.shopifyWebhookLog)
      .set({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
      .where(eq(schema.shopifyWebhookLog.shopifyWebhookId, webhookId));
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
