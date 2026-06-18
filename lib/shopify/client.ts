import '@shopify/shopify-api/adapters/node';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getEnv } from '@/lib/env';
import { decrypt, encrypt, needsReEncryption, type KeyConfig } from '@/lib/crypto';
import { parseShopifyGraphql } from './parse-graphql';

// Lazily constructed and memoized so `next build` does not require Shopify
// env vars at module import time.
let _shopify: ReturnType<typeof shopifyApi> | undefined;

export function getShopify(): ReturnType<typeof shopifyApi> {
  if (!_shopify) {
    const env = getEnv();
    _shopify = shopifyApi({
      apiKey: env.SHOPIFY_API_KEY,
      apiSecretKey: env.SHOPIFY_API_SECRET,
      scopes: env.SHOPIFY_SCOPES.split(','),
      hostName: new URL(env.SHOPIFY_APP_URL).host,
      apiVersion: env.SHOPIFY_API_VERSION as ApiVersion,
      isEmbeddedApp: false,
    });
  }
  return _shopify;
}

// Builds the versioned-key config from ENCRYPTION_KEY_V<n> env vars.
function keyConfig(): KeyConfig {
  const keys: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    const match = name.match(/^ENCRYPTION_KEY_(V\d+)$/i);
    if (match && value) keys[match[1].toLowerCase()] = value;
  }
  return { keys, current: getEnv().ENCRYPTION_KEY_CURRENT };
}

/** Decrypts a store's token; lazily re-encrypts under the current key if stale. */
export async function getStoreToken(storeId: string): Promise<string> {
  const [store] = await db
    .select()
    .from(schema.stores)
    .where(eq(schema.stores.id, storeId))
    .limit(1);
  if (!store) throw new Error(`Store not found: ${storeId}`);
  const config = keyConfig();
  const token = decrypt(store.encryptedToken, config);
  if (needsReEncryption(store.encryptedToken, config.current)) {
    await db
      .update(schema.stores)
      .set({ encryptedToken: encrypt(token, config) })
      .where(eq(schema.stores.id, storeId));
  }
  return token;
}

/** Raw GraphQL call. Used only via the connector — never call directly from features. */
export async function graphqlCall(args: {
  shopDomain: string;
  apiVersion: string;
  token: string;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<{ data: unknown; errors?: unknown }> {
  const res = await fetch(
    `https://${args.shopDomain}/admin/api/${args.apiVersion}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': args.token,
      },
      body: JSON.stringify({ query: args.query, variables: args.variables ?? {} }),
    },
  );
  if (res.status === 429) throw new Error('Shopify rate limit (429)');
  // KHÔNG gọi res.json() trần: body rỗng/non-JSON (5xx HTML, gateway timeout) sẽ
  // ném "Unexpected end of JSON input" cụt ngủn → bubble lên thành lỗi digest khó
  // hiểu. parseShopifyGraphql ném lỗi rõ ràng (kèm status) + khớp retry TRANSIENT.
  return parseShopifyGraphql(res, args.shopDomain);
}

export function encryptToken(plaintext: string): string {
  return encrypt(plaintext, keyConfig());
}
