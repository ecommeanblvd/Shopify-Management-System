import { type NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { auth } from '@/lib/auth/auth';
import { hasPermission } from '@/lib/auth/rbac';
import { getRole } from '@/lib/auth/role';
import { getEnv } from '@/lib/env';

// OAuth approach: HAND-ROLLED redirect.
//
// @shopify/shopify-api v13's auth.begin() is built around the Node.js adapter
// (rawRequest: IncomingMessage, rawResponse: ServerResponse). Next.js App Router
// exposes only Web Request/Response — there is no IncomingMessage or ServerResponse
// available inside a route handler. Bridging them would require reconstructing
// Node-style objects from scratch and wiring the ServerResponse write/end calls
// back to a Web Response body, which is fragile and unsupported.
//
// The standard Shopify OAuth authorize redirect is simple and well-documented,
// so we build the URL ourselves. We store the nonce in a signed, HttpOnly cookie
// so the callback handler (Task 13) can verify it against the `state` query param.

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com$/;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // 1. Require an authenticated Better-Auth session.
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.redirect(new URL('/sign-in', req.url));
  }

  // 2. Check the user's role — must have manage_stores permission.
  // getRole resolves the app_role KEY (from role_id, not the legacy enum) AND warms
  // the permission cache that the synchronous hasPermission() reads. Querying
  // schema.roles directly + passing the legacy `role` string skipped both, so on a
  // cold process the cache was empty → hasPermission returned false → spurious 403.
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_stores')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // 3. Validate the `shop` query parameter.
  const shop = req.nextUrl.searchParams.get('shop') ?? '';
  if (!SHOP_DOMAIN_RE.test(shop)) {
    return NextResponse.json({ error: 'invalid shop domain' }, { status: 400 });
  }

  // 4. Begin the OAuth flow — hand-rolled authorize redirect.
  const env = getEnv();
  const nonce = randomBytes(16).toString('hex');
  const callbackUrl = `${env.SHOPIFY_APP_URL}/api/auth/shopify/callback`;

  const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', env.SHOPIFY_API_KEY);
  authorizeUrl.searchParams.set('scope', env.SHOPIFY_SCOPES);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
  authorizeUrl.searchParams.set('state', nonce);
  // Empty grant_options[] signals an offline (permanent) token.
  authorizeUrl.searchParams.set('grant_options[]', '');

  const response = NextResponse.redirect(authorizeUrl.toString());

  // Store the nonce in an HttpOnly, SameSite=Lax, Secure cookie so the callback
  // handler can verify the `state` param and prevent CSRF.
  response.cookies.set('shopify_oauth_state', nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/api/auth/shopify/callback',
    maxAge: 300, // 300 seconds (5 minutes) — enough time to complete the OAuth redirect
  });

  return response;
}
