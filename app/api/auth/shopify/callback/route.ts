import { createHmac, timingSafeEqual } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { encryptToken } from '@/lib/shopify/client';
import { recordAudit } from '@/lib/logging/audit';
import { getEnv } from '@/lib/env';
import { registerOrderWebhooks } from '@/features/shopify-orders/webhook/register-subscriptions';
import { runBackfillForStore } from '@/features/shopify-orders/backfill/run-backfill';

// Matches the same regex used in the install route.
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com$/;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Step 1: Get Better-Auth session; userId may be null (unauthenticated callback).
  const session = await auth.api.getSession({ headers: req.headers });
  const userId: string | null = session?.user.id ?? null;

  try {
    // Step 3: Read and validate query params.
    const { searchParams } = req.nextUrl;
    const shop = searchParams.get('shop') ?? '';
    const code = searchParams.get('code') ?? '';
    const state = searchParams.get('state') ?? '';
    const hmac = searchParams.get('hmac') ?? '';

    if (!SHOP_DOMAIN_RE.test(shop)) {
      throw new Error(`Invalid shop domain: ${shop}`);
    }

    // Step 4: CSRF check — verify the state nonce from the cookie.
    const stateCookie = req.cookies.get('shopify_oauth_state');
    if (!stateCookie || !state) {
      throw new Error('Missing state cookie — possible CSRF or expired nonce');
    }
    // Use timing-safe comparison to prevent timing-based CSRF bypass.
    if (stateCookie.value.length !== state.length) {
      throw new Error('State mismatch — possible CSRF attack');
    }
    if (!timingSafeEqual(Buffer.from(stateCookie.value, 'utf8'), Buffer.from(state, 'utf8'))) {
      throw new Error('State mismatch — possible CSRF attack');
    }

    // Step 5: HMAC verification.
    // Build the message: all query params except `hmac` and `signature`, sorted by key,
    // joined as key=value&key=value (URL-decoded, standard query string form).
    const env = getEnv();
    const paramEntries: [string, string][] = [];
    searchParams.forEach((value, key) => {
      if (key !== 'hmac' && key !== 'signature') {
        paramEntries.push([key, value]);
      }
    });
    paramEntries.sort((a, b) => a[0].localeCompare(b[0]));
    const message = paramEntries.map(([k, v]) => `${k}=${v}`).join('&');

    const expectedHmacHex = createHmac('sha256', env.SHOPIFY_API_SECRET)
      .update(message)
      .digest('hex');

    // Guard against length mismatch before timingSafeEqual.
    if (expectedHmacHex.length !== hmac.length) {
      throw new Error('HMAC validation failed');
    }
    const expectedBuf = Buffer.from(expectedHmacHex, 'utf8');
    const receivedBuf = Buffer.from(hmac, 'utf8');
    if (!timingSafeEqual(expectedBuf, receivedBuf)) {
      throw new Error('HMAC validation failed');
    }

    // Step 6: Exchange the authorization code for an access token.
    const tokenResponse = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.SHOPIFY_API_KEY,
          client_secret: env.SHOPIFY_API_SECRET,
          code,
        }),
      },
    );

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed with status ${tokenResponse.status}`);
    }
    const tokenData = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      throw new Error('No access_token in Shopify token exchange response');
    }

    // Step 7: Encrypt the token; derive scopes from env.
    const encryptedToken = encryptToken(tokenData.access_token);
    const scopes = env.SHOPIFY_SCOPES.split(',');

    // Step 8: Upsert the store row, capturing the id either way so we can
    // chain webhook registration + auto-backfill against it.
    const [existing] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.shopDomain, shop))
      .limit(1);

    let storeId: string;
    if (existing) {
      await db
        .update(schema.stores)
        .set({
          encryptedToken,
          scopes,
          status: 'active',
          apiVersion: env.SHOPIFY_API_VERSION,
        })
        .where(eq(schema.stores.shopDomain, shop));
      storeId = existing.id;
    } else {
      const [inserted] = await db
        .insert(schema.stores)
        .values({
          name: shop.replace('.myshopify.com', ''),
          shopDomain: shop,
          encryptedToken,
          scopes,
          apiVersion: env.SHOPIFY_API_VERSION,
          status: 'active',
        })
        .returning({ id: schema.stores.id });
      storeId = inserted!.id;
    }

    // Step 8b: Register order-related webhooks against the freshly-issued token.
    // Non-fatal — a failure here just means the operator will have to retry
    // from /admin/shopify-sync-health. Don't lock them out of the dashboard.
    try {
      await registerOrderWebhooks({
        shopDomain: shop,
        accessToken: tokenData.access_token,
        apiVersion: env.SHOPIFY_API_VERSION,
      });
    } catch (webhookErr) {
      await recordAudit({
        userId,
        action: 'connect_store_webhook_register',
        target: shop,
        result: 'error',
        errorDetail: String(webhookErr),
      });
    }

    // Step 8c: Auto-trigger a 12-month order backfill on first connect.
    // Skip when the store already has a backfill that's running or done so
    // a re-install (token refresh, scope upgrade) doesn't burn API quota.
    // Fire-and-forget: the backfill polls Shopify for minutes-to-hours;
    // we just need the OAuth callback to return inside Shopify's timeout.
    const [syncState] = await db
      .select({ status: schema.shopifySyncState.backfillStatus })
      .from(schema.shopifySyncState)
      .where(eq(schema.shopifySyncState.storeId, storeId))
      .limit(1);
    const shouldBackfill = !syncState || syncState.status === 'idle' || syncState.status === 'failed';
    if (shouldBackfill) {
      void runBackfillForStore(storeId).catch(async (backfillErr) => {
        // Status + error are also recorded inside runBackfillForStore; this
        // catch only exists so an unhandled rejection doesn't crash the
        // Node process.
        await recordAudit({
          userId,
          action: 'connect_store_backfill',
          target: shop,
          result: 'error',
          errorDetail: String(backfillErr),
        });
      });
    }

    // Step 9: Audit success.
    await recordAudit({
      userId,
      action: 'connect_store',
      target: shop,
      result: 'success',
    });

    // Step 10–11: Redirect to home and clear the state cookie.
    // Use the configured public URL — `req.url` resolves to the internal
    // container host (e.g. 0.0.0.0:8080) when running behind a reverse proxy
    // like Railway, which would send the browser to an unreachable address.
    const response = NextResponse.redirect(new URL('/', env.SHOPIFY_APP_URL));
    response.cookies.set('shopify_oauth_state', '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/api/auth/shopify/callback',
      maxAge: 0,
    });
    return response;
  } catch (err: unknown) {
    // Step 2: Audit failure and return 400.
    await recordAudit({
      userId,
      action: 'connect_store',
      result: 'error',
      errorDetail: String(err),
    });
    return NextResponse.json(
      { error: 'OAuth callback failed' },
      { status: 400 },
    );
  }
}
