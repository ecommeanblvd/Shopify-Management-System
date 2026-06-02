/**
 * Gift Registry storefront actions. Pure server functions (NOT
 * 'use server') so they're unit-testable and reusable.
 *
 * Multi-store isolation: every lookup scopes by storeId OR by the
 * registry's share token (which implies a single store). Cross-store
 * leaks would require a bug in THIS file, not elsewhere.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type {
  CreateRegistryInput, GiftRegistryItemRow, GiftRegistryItemSnapshot,
  GiftRegistryReservationInput, GiftRegistryReservationRow, GiftRegistryRow,
  PublicRegistryView,
} from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^gr_[a-zA-Z0-9]{8,}$/;

function assertEmail(email: string, label = 'email'): void {
  if (!email || !EMAIL_RE.test(email)) {
    throw new Error(`Invalid ${label} format`);
  }
}

export function assertCreateInput(input: CreateRegistryInput): void {
  assertEmail(input.ownerEmail, 'ownerEmail');
  if (!input.eventName?.trim()) throw new Error('eventName is required');
  if (input.eventName.length > 200) throw new Error('eventName too long (max 200)');
  if (input.eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) {
    throw new Error('eventDate must be YYYY-MM-DD');
  }
  if (input.message && input.message.length > 2000) {
    throw new Error('message too long (max 2000)');
  }
}

function generateToken(): string {
  const u = crypto.randomUUID().replace(/-/g, '');
  return `gr_${u.slice(0, 22)}`;
}

/** Redacts an email for public display: `jane@example.com` → `ja***@example.com`. */
function redactEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export async function createRegistry(
  storeId: string, input: CreateRegistryInput,
): Promise<GiftRegistryRow> {
  assertCreateInput(input);
  const token = generateToken();
  const [row] = await db
    .insert(schema.giftRegistries)
    .values({
      storeId,
      ownerEmail: input.ownerEmail.toLowerCase(),
      ownerName: input.ownerName?.trim() || null,
      eventName: input.eventName.trim(),
      eventDate: input.eventDate ?? null,
      message: input.message?.trim() || null,
      shareToken: token,
    })
    .returning();
  return mapRegistryRow(row!);
}

function mapRegistryRow(r: typeof schema.giftRegistries.$inferSelect): GiftRegistryRow {
  return {
    id: r.id,
    storeId: r.storeId,
    ownerEmail: r.ownerEmail,
    ownerName: r.ownerName,
    eventName: r.eventName,
    eventDate: r.eventDate,
    message: r.message,
    shareToken: r.shareToken,
    createdAt: r.createdAt,
  };
}

export async function getRegistryByToken(token: string): Promise<GiftRegistryRow | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const [row] = await db
    .select()
    .from(schema.giftRegistries)
    .where(eq(schema.giftRegistries.shareToken, token));
  return row ? mapRegistryRow(row) : null;
}

/** Builds the public-facing view of a registry. Owner email is NEVER
 *  returned — only the redacted form on reservations. */
export async function getPublicView(token: string): Promise<PublicRegistryView | null> {
  const registry = await getRegistryByToken(token);
  if (!registry) return null;
  const [store] = await db
    .select({ name: schema.stores.name, shopDomain: schema.stores.shopDomain })
    .from(schema.stores)
    .where(eq(schema.stores.id, registry.storeId));
  if (!store) return null;

  const items = await loadItems(registry.id);
  const reservations = await loadReservations(registry.id, /* redact */ true);

  return {
    registry: {
      eventName: registry.eventName,
      eventDate: registry.eventDate,
      message: registry.message,
      ownerName: registry.ownerName,
      storeName: store.name,
      shopDomain: store.shopDomain,
    },
    items,
    reservations,
  };
}

async function loadItems(registryId: string): Promise<GiftRegistryItemRow[]> {
  const rows = await db.execute<{
    id: string;
    shopify_product_id: string;
    shopify_variant_id: string | null;
    product_title: string;
    variant_title: string | null;
    product_handle: string;
    image_url: string | null;
    price_amount: string | null;
    price_currency: string | null;
    qty_wanted: number;
    qty_reserved: string;
    notes: string | null;
  }>(sql`
    SELECT i.id,
           i.shopify_product_id, i.shopify_variant_id,
           i.product_title, i.variant_title, i.product_handle,
           i.image_url, i.price_amount::text, i.price_currency,
           i.qty_wanted, i.notes,
           COALESCE(SUM(r.qty) FILTER (WHERE r.status <> 'cancelled'), 0)::text AS qty_reserved
      FROM gift_registry_items i
      LEFT JOIN gift_registry_reservations r ON r.item_id = i.id
     WHERE i.registry_id = ${registryId}
     GROUP BY i.id
     ORDER BY i.added_at;
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    shopifyProductId: r.shopify_product_id,
    shopifyVariantId: r.shopify_variant_id,
    productTitle: r.product_title,
    variantTitle: r.variant_title,
    productHandle: r.product_handle,
    imageUrl: r.image_url,
    priceAmount: r.price_amount !== null ? Number(r.price_amount) : null,
    priceCurrency: r.price_currency,
    qtyWanted: r.qty_wanted,
    qtyReserved: Number(r.qty_reserved),
    notes: r.notes,
  }));
}

async function loadReservations(
  registryId: string, redact: boolean,
): Promise<GiftRegistryReservationRow[]> {
  const rows = await db
    .select()
    .from(schema.giftRegistryReservations)
    .where(eq(schema.giftRegistryReservations.registryId, registryId));
  return rows.map((r) => ({
    id: r.id,
    itemId: r.itemId,
    reserverName: r.reserverName,
    reserverEmailRedacted: redact ? redactEmail(r.reserverEmail) : r.reserverEmail,
    qty: r.qty,
    message: r.message,
    status: r.status as 'reserved' | 'purchased' | 'cancelled',
    createdAt: r.createdAt,
  }));
}

/** Owner-only: add an item. Owner is identified by email match against
 *  the registry — pragma works for nội bộ use; future PR can swap in
 *  a signed JWT once we have email infra. */
export async function addItem(
  token: string, ownerEmail: string, snap: GiftRegistryItemSnapshot,
): Promise<{ itemId: string }> {
  const registry = await assertOwner(token, ownerEmail);
  if (!snap?.shopifyProductId || !snap.productTitle || !snap.productHandle) {
    throw new Error('snapshot.{shopifyProductId, productTitle, productHandle} required');
  }
  const qty = snap.qtyWanted ?? 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
    throw new Error('qtyWanted must be 1-99');
  }
  const [row] = await db
    .insert(schema.giftRegistryItems)
    .values({
      registryId: registry.id,
      shopifyProductId: snap.shopifyProductId,
      shopifyVariantId: snap.shopifyVariantId ?? null,
      productTitle: snap.productTitle,
      variantTitle: snap.variantTitle ?? null,
      productHandle: snap.productHandle,
      imageUrl: snap.imageUrl ?? null,
      priceAmount: snap.priceAmount !== undefined ? snap.priceAmount.toString() : null,
      priceCurrency: snap.priceCurrency ?? null,
      qtyWanted: qty,
      notes: snap.notes?.trim() || null,
    })
    .returning({ id: schema.giftRegistryItems.id });
  return { itemId: row!.id };
}

export async function removeItem(
  token: string, ownerEmail: string, itemId: string,
): Promise<{ removed: boolean }> {
  const registry = await assertOwner(token, ownerEmail);
  const result = await db
    .delete(schema.giftRegistryItems)
    .where(and(
      eq(schema.giftRegistryItems.id, itemId),
      eq(schema.giftRegistryItems.registryId, registry.id),
    ))
    .returning({ id: schema.giftRegistryItems.id });
  return { removed: result.length > 0 };
}

/** Public reservation flow. Anyone with the share link can reserve up
 *  to (qtyWanted - qtyAlreadyReserved) of an item. */
export async function reserveItem(
  token: string, itemId: string, input: GiftRegistryReservationInput,
): Promise<{ reservationId: string }> {
  const registry = await getRegistryByToken(token);
  if (!registry) throw new Error('registry not found');
  if (!input.reserverName?.trim()) throw new Error('reserverName is required');
  assertEmail(input.reserverEmail, 'reserverEmail');
  const qty = input.qty ?? 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
    throw new Error('qty must be 1-99');
  }

  // Re-check capacity inside a single statement. Race conditions still
  // possible without a transaction, but tolerable for internal use.
  const [item] = await db
    .select({ qtyWanted: schema.giftRegistryItems.qtyWanted })
    .from(schema.giftRegistryItems)
    .where(and(
      eq(schema.giftRegistryItems.id, itemId),
      eq(schema.giftRegistryItems.registryId, registry.id),
    ));
  if (!item) throw new Error('item not found');

  const existing = await db.execute<{ n: string }>(sql`
    SELECT COALESCE(SUM(qty), 0)::text AS n
      FROM gift_registry_reservations
     WHERE item_id = ${itemId}
       AND status <> 'cancelled';
  `);
  const reservedSoFar = Number(existing.rows[0]?.n ?? '0');
  if (reservedSoFar + qty > item.qtyWanted) {
    throw new Error('reservation exceeds remaining quantity');
  }

  const [row] = await db
    .insert(schema.giftRegistryReservations)
    .values({
      registryId: registry.id,
      itemId,
      reserverName: input.reserverName.trim(),
      reserverEmail: input.reserverEmail.toLowerCase(),
      qty,
      message: input.message?.trim() || null,
    })
    .returning({ id: schema.giftRegistryReservations.id });
  return { reservationId: row!.id };
}

export async function cancelReservation(
  reservationId: string, reserverEmail: string,
): Promise<{ cancelled: boolean }> {
  assertEmail(reserverEmail);
  const result = await db
    .update(schema.giftRegistryReservations)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(
      eq(schema.giftRegistryReservations.id, reservationId),
      eq(schema.giftRegistryReservations.reserverEmail, reserverEmail.toLowerCase()),
    ))
    .returning({ id: schema.giftRegistryReservations.id });
  return { cancelled: result.length > 0 };
}

/** Lists registries for an owner — used by /gr/find?email=… so an
 *  owner who lost their tokens can recover their share links. */
export async function listRegistriesForOwner(
  storeId: string, email: string,
): Promise<GiftRegistryRow[]> {
  assertEmail(email);
  const rows = await db
    .select()
    .from(schema.giftRegistries)
    .where(and(
      eq(schema.giftRegistries.storeId, storeId),
      eq(schema.giftRegistries.ownerEmail, email.toLowerCase()),
    ));
  return rows.map(mapRegistryRow);
}

async function assertOwner(token: string, ownerEmail: string): Promise<GiftRegistryRow> {
  assertEmail(ownerEmail, 'ownerEmail');
  const registry = await getRegistryByToken(token);
  if (!registry) throw new Error('registry not found');
  if (registry.ownerEmail !== ownerEmail.toLowerCase()) {
    throw new Error('forbidden');
  }
  return registry;
}
