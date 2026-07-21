/**
 * MMP product upsert. Pure orchestration over the schema-validated
 * envelope — no HTTP, no auth. Endpoint calls this after passing HMAC
 * + Zod gates.
 *
 * Per-product transaction so a single bad row doesn't tank an entire
 * batch (MMP spec asks for per-item results, not all-or-nothing).
 *
 * Idempotency:
 *   - mmp_products.portal_product_id is UNIQUE → upsert by it
 *   - mmp_product_variants UNIQUE on (product_id, sku) → upsert by it
 *   - mmp_product_images UNIQUE on (product_id, url) → upsert by it
 *
 * Removed variants / images:
 *   - Anything previously stored for the product but NOT in the new
 *     payload is DELETED (the MMP feed is authoritative).
 */

import { normalizeBrandDisplayName } from './brand-name';
import crypto from 'node:crypto';
import { eq, sql, and, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { MmpEnvelope, MmpProduct } from './schema';

export interface UpsertItemResult {
  portalProductId: string;
  status: 'live' | 'failed';
  /** Per-spec mapping: SMS-local row id + Shopify gid when already pushed. */
  shopifyProductId: string | null;
  variantMap: Array<{ sku: string; shopifyVariantId: string | null }>;
  /** Populated when status === 'failed'. */
  error: string | null;
}

export interface UpsertSummary {
  results: UpsertItemResult[];
  accepted: number;
  rejected: number;
}

/** SHA-256 of the canonical product payload, used to skip re-processing
 *  identical rows on retries. Sorts keys so equivalent JSON objects
 *  produced by different MMP serialisers hash the same. */
function canonicalHash(p: MmpProduct): string {
  const canonical = JSON.stringify(p, Object.keys(p).sort());
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Ensure a brand row exists for the slug; touch lastSeenAt. */
async function ensureBrand(slug: string): Promise<void> {
  await db
    .insert(schema.mmpBrands)
    // Placeholder từ slug theo quy tắc tên chuẩn ("tom-fried" → "Tom Fried").
    .values({ slug, displayName: normalizeBrandDisplayName(slug.replace(/-/g, ' ')), lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: schema.mmpBrands.slug,
      set: { lastSeenAt: new Date() },
    });
}

/** Upsert one product + its variants + images in a single transaction.
 *  Throws on DB error so the caller can record a per-item failure. */
async function upsertOne(p: MmpProduct): Promise<UpsertItemResult> {
  const hash = canonicalHash(p);

  await ensureBrand(p.brandSlug);

  // Use a transaction so partial writes don't leak.
  const productRow = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.mmpProducts)
      .values({
        portalProductId: p.portalProductId,
        brandSlug: p.brandSlug,
        sku: p.sku,
        name: p.name,
        globalName: p.globalName ?? null,
        shortSummary: p.shortSummary ?? null,
        description: p.description ?? null,
        collection: p.collection ?? null,
        productType: p.productType ?? null,
        status: p.status,
        basePrice: String(p.basePrice),
        currency: 'VND',
        priceUsd: p.priceUsd !== undefined ? String(p.priceUsd) : null,
        attributes: p.attributes ?? null,
        details: p.details ?? null,
        lastReceivedAt: new Date(),
        sourceHash: hash,
      })
      .onConflictDoUpdate({
        target: schema.mmpProducts.portalProductId,
        set: {
          // Update every mutable field; preserve curation columns
          // (shopifyProductId / pushedToShopifyAt / curationStatus)
          // because those are SMS-owned and shouldn't get clobbered
          // by an MMP re-push.
          brandSlug: p.brandSlug,
          sku: p.sku,
          name: p.name,
          globalName: p.globalName ?? null,
          shortSummary: p.shortSummary ?? null,
          description: p.description ?? null,
          collection: p.collection ?? null,
          productType: p.productType ?? null,
          status: p.status,
          basePrice: String(p.basePrice),
          currency: 'VND',
          priceUsd: p.priceUsd !== undefined ? String(p.priceUsd) : null,
          attributes: p.attributes ?? null,
          details: p.details ?? null,
          lastReceivedAt: new Date(),
          sourceHash: hash,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: schema.mmpProducts.id,
        shopifyProductId: schema.mmpProducts.shopifyProductId,
      });

    const productId = inserted[0]?.id;
    if (!productId) throw new Error('product upsert returned no id');

    // Variants — upsert + drop stale.
    const variantSkus = p.variants.map((v) => v.sku);
    for (const v of p.variants) {
      await tx
        .insert(schema.mmpProductVariants)
        .values({
          productId,
          sku: v.sku,
          color: v.color ?? null,
          size: v.size ?? null,
          inventory: v.inventory,
          price: String(v.price),
          lengthCm: v.lengthCm !== undefined ? String(v.lengthCm) : null,
          lengthCmMax: v.lengthCmMax !== undefined ? String(v.lengthCmMax) : null,
          position: v.position ?? 0,
        })
        .onConflictDoUpdate({
          target: [schema.mmpProductVariants.productId, schema.mmpProductVariants.sku],
          set: {
            color: v.color ?? null,
            size: v.size ?? null,
            inventory: v.inventory,
            price: String(v.price),
            lengthCm: v.lengthCm !== undefined ? String(v.lengthCm) : null,
            lengthCmMax: v.lengthCmMax !== undefined ? String(v.lengthCmMax) : null,
            position: v.position ?? 0,
            updatedAt: new Date(),
          },
        });
    }
    await tx
      .delete(schema.mmpProductVariants)
      .where(and(
        eq(schema.mmpProductVariants.productId, productId),
        sql`${schema.mmpProductVariants.sku} NOT IN ${variantSkus}`,
      ));

    // Images — same pattern.
    const imageUrls = (p.images ?? []).map((i) => i.url);
    for (const img of p.images ?? []) {
      await tx
        .insert(schema.mmpProductImages)
        .values({
          productId,
          url: img.url,
          position: img.position ?? 0,
          role: img.role ?? null,
          isThumbnail: img.isThumbnail ?? false,
          altText: img.altText ?? null,
        })
        .onConflictDoUpdate({
          target: [schema.mmpProductImages.productId, schema.mmpProductImages.url],
          set: {
            position: img.position ?? 0,
            role: img.role ?? null,
            isThumbnail: img.isThumbnail ?? false,
            altText: img.altText ?? null,
          },
        });
    }
    if (imageUrls.length > 0) {
      await tx
        .delete(schema.mmpProductImages)
        .where(and(
          eq(schema.mmpProductImages.productId, productId),
          sql`${schema.mmpProductImages.url} NOT IN ${imageUrls}`,
        ));
    } else {
      // Clear all images if MMP sent an empty list (intentional drop).
      await tx
        .delete(schema.mmpProductImages)
        .where(eq(schema.mmpProductImages.productId, productId));
    }

    return inserted[0];
  });

  // Pull final variant rows for the response — MMP expects to receive
  // back the Shopify gid mapping per variant (NULL until SMS pushes).
  const variantRows = await db
    .select({ sku: schema.mmpProductVariants.sku, shopifyVariantId: schema.mmpProductVariants.shopifyVariantId })
    .from(schema.mmpProductVariants)
    .where(eq(schema.mmpProductVariants.productId, productRow.id))
    .orderBy(schema.mmpProductVariants.position, schema.mmpProductVariants.sku);

  // The unused inArray import keeps drizzle's typegen happy if a future
  // caller wants explicit lists — silence the lint.
  void inArray;

  return {
    portalProductId: p.portalProductId,
    status: 'live',
    shopifyProductId: productRow.shopifyProductId,
    variantMap: variantRows.map((v) => ({ sku: v.sku, shopifyVariantId: v.shopifyVariantId })),
    error: null,
  };
}

/**
 * Process the whole envelope. Each product gets its own
 * try/catch so one bad row doesn't block the rest.
 */
export async function upsertMmpEnvelope(envelope: MmpEnvelope): Promise<UpsertSummary> {
  const results: UpsertItemResult[] = [];
  let accepted = 0, rejected = 0;
  for (const product of envelope.products) {
    try {
      const r = await upsertOne(product);
      results.push(r);
      accepted += 1;
    } catch (err) {
      results.push({
        portalProductId: product.portalProductId,
        status: 'failed',
        shopifyProductId: null,
        variantMap: [],
        error: err instanceof Error ? err.message : String(err),
      });
      rejected += 1;
    }
  }
  return { results, accepted, rejected };
}
