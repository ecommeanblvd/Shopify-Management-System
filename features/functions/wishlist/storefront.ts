/**
 * Wishlist storefront actions — called by the REST API handlers in
 * `app/api/storefront/wishlist/*`. Kept as plain server functions
 * (NOT marked 'use server') so they're unit-testable in isolation
 * and reusable from internal cron jobs / analytics queries later.
 *
 * Multi-store isolation is enforced at every call: every lookup
 * scopes by `storeId`. Cross-store leaks would require a bug in
 * THIS file, not elsewhere.
 */

import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type {
  WishlistIdentity, WishlistItemRow, WishlistItemSnapshot, WishlistRow,
} from './types';

/** Server-side validation of the identity envelope. Throws on bad input
 *  so handlers can map to 400. */
export function assertIdentity(id: WishlistIdentity): void {
  if (!id.email && !id.deviceId) {
    throw new Error('Identity required: email or deviceId');
  }
  if (id.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id.email)) {
    throw new Error('Invalid email format');
  }
  // Device id is a UUID v4 generated client-side. Accept any non-empty
  // 8-64 char string — we don't want to be strict about the source.
  if (id.deviceId && (id.deviceId.length < 8 || id.deviceId.length > 64)) {
    throw new Error('Invalid deviceId');
  }
}

/** Look up or create a wishlist for the given identity. Idempotent —
 *  safe to call from the storefront on every page load. */
export async function getOrCreateWishlist(
  storeId: string, id: WishlistIdentity,
): Promise<{ id: string; created: boolean }> {
  assertIdentity(id);
  // Prefer email-keyed wishlist when present (survives device wipes).
  const where = id.email
    ? and(
        eq(schema.wishlists.storeId, storeId),
        eq(schema.wishlists.customerEmail, id.email),
      )
    : and(
        eq(schema.wishlists.storeId, storeId),
        eq(schema.wishlists.deviceId, id.deviceId!),
      );
  const [existing] = await db.select({ id: schema.wishlists.id }).from(schema.wishlists).where(where);
  if (existing) return { id: existing.id, created: false };

  const [row] = await db
    .insert(schema.wishlists)
    .values({
      storeId,
      customerEmail: id.email ?? null,
      shopifyCustomerId: id.shopifyCustomerId ?? null,
      deviceId: id.deviceId ?? null,
    })
    .returning({ id: schema.wishlists.id });
  return { id: row!.id, created: true };
}

export async function getWishlistWithItems(
  storeId: string, id: WishlistIdentity,
): Promise<{ wishlist: WishlistRow; items: WishlistItemRow[] } | null> {
  assertIdentity(id);
  const where = id.email
    ? and(
        eq(schema.wishlists.storeId, storeId),
        eq(schema.wishlists.customerEmail, id.email),
      )
    : and(
        eq(schema.wishlists.storeId, storeId),
        eq(schema.wishlists.deviceId, id.deviceId!),
      );
  const [w] = await db.select().from(schema.wishlists).where(where);
  if (!w) return null;
  const items = await db
    .select()
    .from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.wishlistId, w.id));
  return {
    wishlist: {
      id: w.id,
      storeId: w.storeId,
      customerEmail: w.customerEmail,
      deviceId: w.deviceId,
      itemCount: items.length,
    },
    items: items.map((i) => ({
      id: i.id,
      shopifyProductId: i.shopifyProductId,
      shopifyVariantId: i.shopifyVariantId,
      productTitle: i.productTitle,
      variantTitle: i.variantTitle,
      productHandle: i.productHandle,
      imageUrl: i.imageUrl,
      priceAmount: i.priceAmount !== null ? Number(i.priceAmount) : null,
      priceCurrency: i.priceCurrency,
      availableForSale: i.availableForSale,
      addedAt: i.addedAt,
    })),
  };
}

export async function addItem(
  storeId: string, id: WishlistIdentity, snap: WishlistItemSnapshot,
): Promise<{ wishlistId: string; itemId: string; alreadyExisted: boolean }> {
  const { id: wishlistId } = await getOrCreateWishlist(storeId, id);
  // Dedup against the unique index. On conflict, return the existing row id.
  const [row] = await db
    .insert(schema.wishlistItems)
    .values({
      wishlistId,
      shopifyProductId: snap.shopifyProductId,
      shopifyVariantId: snap.shopifyVariantId ?? null,
      productTitle: snap.productTitle,
      variantTitle: snap.variantTitle ?? null,
      productHandle: snap.productHandle,
      imageUrl: snap.imageUrl ?? null,
      priceAmount: snap.priceAmount !== undefined ? snap.priceAmount.toString() : null,
      priceCurrency: snap.priceCurrency ?? null,
      availableForSale: snap.availableForSale ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.wishlistItems.id });

  if (row) {
    await logEvent(storeId, wishlistId, 'add', { productId: snap.shopifyProductId });
    return { wishlistId, itemId: row.id, alreadyExisted: false };
  }
  // Conflict — fetch the existing id for the caller.
  const [existing] = await db
    .select({ id: schema.wishlistItems.id })
    .from(schema.wishlistItems)
    .where(and(
      eq(schema.wishlistItems.wishlistId, wishlistId),
      eq(schema.wishlistItems.shopifyProductId, snap.shopifyProductId),
      snap.shopifyVariantId
        ? eq(schema.wishlistItems.shopifyVariantId, snap.shopifyVariantId)
        : isNull(schema.wishlistItems.shopifyVariantId),
    ));
  return { wishlistId, itemId: existing!.id, alreadyExisted: true };
}

export async function removeItem(
  storeId: string, id: WishlistIdentity, productId: string, variantId?: string,
): Promise<{ removed: boolean }> {
  const wl = await getWishlistWithItems(storeId, id);
  if (!wl) return { removed: false };
  await db.delete(schema.wishlistItems).where(and(
    eq(schema.wishlistItems.wishlistId, wl.wishlist.id),
    eq(schema.wishlistItems.shopifyProductId, productId),
    variantId
      ? eq(schema.wishlistItems.shopifyVariantId, variantId)
      : isNull(schema.wishlistItems.shopifyVariantId),
  ));
  await logEvent(storeId, wl.wishlist.id, 'remove', { productId, variantId });
  return { removed: true };
}

/** Merge a guest (device-keyed) wishlist into an email-keyed wishlist
 *  on login. Items dedup naturally via the unique index. */
export async function mergeGuestIntoEmail(
  storeId: string, deviceId: string, email: string, shopifyCustomerId?: string,
): Promise<{ mergedItems: number }> {
  assertIdentity({ deviceId });
  assertIdentity({ email });
  const [guest] = await db
    .select()
    .from(schema.wishlists)
    .where(and(
      eq(schema.wishlists.storeId, storeId),
      eq(schema.wishlists.deviceId, deviceId),
    ));
  if (!guest) return { mergedItems: 0 };

  // Resolve or create the email-keyed wishlist.
  const { id: emailWishlistId } = await getOrCreateWishlist(storeId, {
    email, shopifyCustomerId,
  });

  // Pull all guest items and re-insert against the email wishlist. The
  // unique index dedupes; we ignore conflicts.
  const items = await db
    .select()
    .from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.wishlistId, guest.id));
  let merged = 0;
  for (const it of items) {
    const result = await db
      .insert(schema.wishlistItems)
      .values({ ...it, id: undefined as unknown as string, wishlistId: emailWishlistId })
      .onConflictDoNothing()
      .returning({ id: schema.wishlistItems.id });
    if (result.length > 0) merged += 1;
  }

  // Delete the guest wishlist entirely (items cascade).
  await db.delete(schema.wishlists).where(eq(schema.wishlists.id, guest.id));
  await logEvent(storeId, emailWishlistId, 'merge', {
    fromDeviceId: deviceId, mergedItems: merged,
  });
  return { mergedItems: merged };
}

export async function logEvent(
  storeId: string, wishlistId: string | null, type: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await db.insert(schema.wishlistEvents).values({
    storeId,
    wishlistId,
    eventType: type,
    payload: payload as never,
  });
}

/** Generates a URL-safe opaque token. Format: `wl_<22 base62 chars>`
 *  using crypto.randomUUID() for the entropy source. */
function generateShareToken(): string {
  const u = crypto.randomUUID().replace(/-/g, '');
  // 32 hex chars → trim to 22 to keep URLs short. 88 bits of entropy is
  // ample against guessing.
  return `wl_${u.slice(0, 22)}`;
}

/** Returns the existing share token for the identity's wishlist or
 *  creates one. Idempotent — calling twice returns the same token. */
export async function getOrCreateShareToken(
  storeId: string, id: WishlistIdentity,
): Promise<{ token: string; wishlistId: string }> {
  const { id: wishlistId } = await getOrCreateWishlist(storeId, id);
  const [existing] = await db
    .select({ shareToken: schema.wishlists.shareToken })
    .from(schema.wishlists)
    .where(eq(schema.wishlists.id, wishlistId));
  if (existing?.shareToken) {
    return { token: existing.shareToken, wishlistId };
  }
  const token = generateShareToken();
  await db
    .update(schema.wishlists)
    .set({ shareToken: token, updatedAt: new Date() })
    .where(eq(schema.wishlists.id, wishlistId));
  await logEvent(storeId, wishlistId, 'share', { token });
  return { token, wishlistId };
}

export interface PublicWishlistView {
  storeId: string;
  storeName: string;
  shopDomain: string;
  items: WishlistItemRow[];
}

/** Public read of a wishlist by its share token. Used by /wl/[token].
 *  Does NOT expose the owner's email or device id — only the items and
 *  the store branding needed to render the page. */
export async function getWishlistByShareToken(
  token: string,
): Promise<PublicWishlistView | null> {
  if (!token || !/^wl_[a-zA-Z0-9]{8,}$/.test(token)) return null;
  const [w] = await db
    .select({
      id: schema.wishlists.id,
      storeId: schema.wishlists.storeId,
    })
    .from(schema.wishlists)
    .where(eq(schema.wishlists.shareToken, token));
  if (!w) return null;
  const [store] = await db
    .select({ name: schema.stores.name, shopDomain: schema.stores.shopDomain })
    .from(schema.stores)
    .where(eq(schema.stores.id, w.storeId));
  if (!store) return null;
  const items = await db
    .select()
    .from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.wishlistId, w.id));
  // Fire-and-forget view-event log so the share page can power analytics
  // ("how many people viewed your shared wishlist?") later. Awaited to
  // surface DB failures in tests.
  await logEvent(w.storeId, w.id, 'view', { token, source: 'share_page' });
  return {
    storeId: w.storeId,
    storeName: store.name,
    shopDomain: store.shopDomain,
    items: items.map((i) => ({
      id: i.id,
      shopifyProductId: i.shopifyProductId,
      shopifyVariantId: i.shopifyVariantId,
      productTitle: i.productTitle,
      variantTitle: i.variantTitle,
      productHandle: i.productHandle,
      imageUrl: i.imageUrl,
      priceAmount: i.priceAmount !== null ? Number(i.priceAmount) : null,
      priceCurrency: i.priceCurrency,
      availableForSale: i.availableForSale,
      addedAt: i.addedAt,
    })),
  };
}

/** Convenience query for the admin dashboard. Filters out guest-only
 *  wishlists with zero items so the list isn't polluted by abandoned
 *  page-loads. */
export async function listWishlistsForStore(
  storeId: string, limit = 50,
): Promise<WishlistRow[]> {
  const rows = await db
    .select({
      id: schema.wishlists.id,
      storeId: schema.wishlists.storeId,
      customerEmail: schema.wishlists.customerEmail,
      deviceId: schema.wishlists.deviceId,
    })
    .from(schema.wishlists)
    .where(and(
      eq(schema.wishlists.storeId, storeId),
      isNotNull(schema.wishlists.customerEmail),
    ))
    .limit(limit);
  // Per-row item count via a separate batch — fine at small N. For
  // 10k+ wishlists this should move to a single grouped query.
  const out: WishlistRow[] = [];
  for (const r of rows) {
    const items = await db
      .select({ id: schema.wishlistItems.id })
      .from(schema.wishlistItems)
      .where(eq(schema.wishlistItems.wishlistId, r.id));
    out.push({ ...r, itemCount: items.length });
  }
  return out;
}
