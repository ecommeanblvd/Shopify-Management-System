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

/** Resolve customerId → email qua cache + Admin API. Store thiếu read_customers → GraphQL
 *  báo lỗi access denied → nuốt, trả null (degrade, không ném). */
export async function resolveCustomerEmail(storeId: string, customerId: string): Promise<string | null> {
  const [cached] = await db.select().from(schema.customerIdentities).where(and(
    eq(schema.customerIdentities.storeId, storeId),
    eq(schema.customerIdentities.shopifyCustomerId, customerId),
  )).limit(1);
  if (cached && Date.now() - cached.resolvedAt.getTime() < EMAIL_TTL_MS) {
    return cached.email;
  }

  let email: string | null = null;
  try {
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    if (store) {
      const token = await getStoreToken(storeId);
      const res = await graphqlCall({
        shopDomain: store.shopDomain, apiVersion: store.apiVersion, token,
        query: CUSTOMER_EMAIL_QUERY, variables: { id: customerId },
      });
      if (!res.errors) {
        email = (res.data as { customer: { email: string | null } | null } | null)?.customer?.email ?? null;
      }
    }
  } catch {
    email = null; // read_customers thiếu / lỗi transient → degrade
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
