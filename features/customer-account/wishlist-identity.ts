/** Resolve identity cho Wishlist Page (spec §4): token chỉ có customerId; wishlist match
 *  theo email HOẶC shopifyCustomerId. Resolve email qua Admin API + cache customer_identities
 *  (TTL 7 ngày). Store thiếu read_customers → email null → degrade match theo customerId. */
import { and, eq, or } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { graphqlCall, getStoreToken } from '@/lib/shopify/client';

const EMAIL_TTL_MS = 7 * 24 * 3600 * 1000;

export interface WishlistMatchRow { id: string; customerEmail: string | null; shopifyCustomerId: string | null; }

/** THUẦN: ưu tiên wishlist có email khớp; nếu không, wishlist match theo customerId. */
export function selectWishlistMatch(
  rows: WishlistMatchRow[], email: string | null, customerId: string,
): WishlistMatchRow | null {
  if (email) {
    const byEmail = rows.find((r) => r.customerEmail === email);
    if (byEmail) return byEmail;
  }
  const byCid = rows.find((r) => r.shopifyCustomerId === customerId);
  return byCid ?? null;
}

const CUSTOMER_EMAIL_QUERY = /* GraphQL */ `
  query CustomerEmail($id: ID!) { customer(id: $id) { email } }
`;

export type ResolveOutcome =
  | { action: 'use-cache'; email: string | null }
  | { action: 'skip-no-scope' }
  | { action: 'query' };

/** THUẦN: quyết định resolveCustomerEmail nên dùng cache, bỏ qua (thiếu scope), hay query Admin API.
 *  Ưu tiên: cache còn hạn dùng được ngay (kể cả khi store hiện thiếu scope — đỡ 1 query); nếu
 *  cache hết hạn/không có mà thiếu read_customers → skip (không query, không ghi cache) vì thiếu
 *  scope là trạng thái của STORE, không phải của customer — store re-install có scope thì resolve
 *  ngay lần sau, không vướng cache null 7 ngày. */
export function planResolve(
  cached: { email: string | null; resolvedAt: Date } | undefined,
  scopes: string[],
  now: Date,
): ResolveOutcome {
  if (cached && now.getTime() - cached.resolvedAt.getTime() < EMAIL_TTL_MS) {
    return { action: 'use-cache', email: cached.email };
  }
  if (!scopes.includes('read_customers')) {
    return { action: 'skip-no-scope' };
  }
  return { action: 'query' };
}

/** Resolve customerId → email qua cache + Admin API. Store thiếu read_customers → skip trước khi
 *  query (xem planResolve). Lỗi transient (throw / res.errors) → trả null nhưng KHÔNG ghi cache,
 *  để lần sau thử lại thay vì bị khoá null 7 ngày. */
export async function resolveCustomerEmail(storeId: string, customerId: string): Promise<string | null> {
  const [cached] = await db.select().from(schema.customerIdentities).where(and(
    eq(schema.customerIdentities.storeId, storeId),
    eq(schema.customerIdentities.shopifyCustomerId, customerId),
  )).limit(1);

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  const scopes = store?.scopes ?? [];

  const plan = planResolve(cached, scopes, new Date());
  if (plan.action === 'use-cache') return plan.email;
  if (plan.action === 'skip-no-scope') return null;

  if (!store) return null;

  let email: string | null;
  try {
    const token = await getStoreToken(storeId);
    const res = await graphqlCall({
      shopDomain: store.shopDomain, apiVersion: store.apiVersion, token,
      query: CUSTOMER_EMAIL_QUERY, variables: { id: customerId },
    });
    if (res.errors) return null; // lỗi GraphQL-level (transient/access) → không cache, thử lại lần sau
    email = (res.data as { customer: { email: string | null } | null } | null)?.customer?.email ?? null;
  } catch {
    return null; // lỗi transient (network/5xx) → không cache, thử lại lần sau
  }

  await db.insert(schema.customerIdentities)
    .values({ storeId, shopifyCustomerId: customerId, email })
    .onConflictDoUpdate({
      target: [schema.customerIdentities.storeId, schema.customerIdentities.shopifyCustomerId],
      set: { email, resolvedAt: new Date() },
    });
  return email;
}

/** Tìm wishlist của khách: resolve email → union select (email OR customerId) → selectWishlistMatch. */
export async function findCustomerWishlist(
  storeId: string, customerId: string,
): Promise<{ wishlistId: string; email: string | null } | null> {
  const email = await resolveCustomerEmail(storeId, customerId);
  const conds = email
    ? or(eq(schema.wishlists.customerEmail, email), eq(schema.wishlists.shopifyCustomerId, customerId))
    : eq(schema.wishlists.shopifyCustomerId, customerId);
  const rows = await db.select({
    id: schema.wishlists.id,
    customerEmail: schema.wishlists.customerEmail,
    shopifyCustomerId: schema.wishlists.shopifyCustomerId,
  }).from(schema.wishlists).where(and(eq(schema.wishlists.storeId, storeId), conds!));

  const match = selectWishlistMatch(rows, email, customerId);
  return match ? { wishlistId: match.id, email } : null;
}
