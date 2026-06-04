/**
 * Read-only DB queries powering the MMP Products UI. Server-side
 * only — pulled directly from the dashboard pages via `await`.
 *
 * Keeps the page components free of inline Drizzle so the SQL is
 * easy to test, refactor, and inspect without re-rendering React.
 */

import { and, count, desc, eq, sql, ilike } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/** Brand card on the landing page. */
export interface BrandSummary {
  slug: string;
  displayName: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  totalProducts: number;
  byCuration: {
    received: number;
    approved: number;
    rejected: number;
    pushed: number;
  };
}

/** Returns every brand currently in the system + a per-curation
 *  status breakdown. Ordered by most-recent activity first. */
export async function listBrandsWithCounts(): Promise<BrandSummary[]> {
  const rows = await db.execute<{
    slug: string;
    display_name: string;
    first_seen_at: Date;
    last_seen_at: Date;
    total: number;
    received: number;
    approved: number;
    rejected: number;
    pushed: number;
  }>(sql`
    SELECT
      b.slug,
      b.display_name,
      b.first_seen_at,
      b.last_seen_at,
      COUNT(p.id)::int AS total,
      COUNT(p.id) FILTER (WHERE p.curation_status = 'received')::int AS received,
      COUNT(p.id) FILTER (WHERE p.curation_status = 'approved')::int AS approved,
      COUNT(p.id) FILTER (WHERE p.curation_status = 'rejected')::int AS rejected,
      COUNT(p.id) FILTER (WHERE p.curation_status = 'pushed')::int   AS pushed
    FROM ${schema.mmpBrands} b
    LEFT JOIN ${schema.mmpProducts} p ON p.brand_slug = b.slug
    GROUP BY b.slug, b.display_name, b.first_seen_at, b.last_seen_at
    ORDER BY b.last_seen_at DESC
  `);
  // pg's raw-query path returns timestamp columns as strings — Drizzle's
  // typed `select()` path coerces them but `db.execute()` does not. Wrap
  // to Date so callers can use Intl.DateTimeFormat directly.
  return rows.rows.map((r) => ({
    slug: r.slug,
    displayName: r.display_name,
    firstSeenAt: new Date(r.first_seen_at),
    lastSeenAt: new Date(r.last_seen_at),
    totalProducts: r.total,
    byCuration: {
      received: r.received,
      approved: r.approved,
      rejected: r.rejected,
      pushed: r.pushed,
    },
  }));
}

/** Single-brand metadata. NULL when slug is unknown. */
export async function getBrand(slug: string): Promise<{
  slug: string;
  displayName: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
} | null> {
  const [b] = await db
    .select({
      slug: schema.mmpBrands.slug,
      displayName: schema.mmpBrands.displayName,
      firstSeenAt: schema.mmpBrands.firstSeenAt,
      lastSeenAt: schema.mmpBrands.lastSeenAt,
    })
    .from(schema.mmpBrands)
    .where(eq(schema.mmpBrands.slug, slug));
  return b ?? null;
}

export type CurationFilter =
  | 'all' | 'received' | 'approved' | 'rejected' | 'pushed';

/** Card-row product summary for the brand listing page. */
export interface ProductListItem {
  portalProductId: string;
  sku: string;
  name: string;
  productType: string | null;
  collection: string | null;
  status: 'live' | 'draft' | 'archived';
  curationStatus: 'received' | 'approved' | 'rejected' | 'pushed';
  basePrice: string; // VND as string (drizzle numeric)
  variantCount: number;
  thumbnailUrl: string | null;
  lastReceivedAt: Date;
  shopifyProductId: string | null;
}

export interface ListProductsArgs {
  brandSlug: string;
  curation: CurationFilter;
  search: string;
  limit: number;
  offset: number;
}

/** Products for the brand list view. Joins thumbnail + variant count
 *  in a single roundtrip.
 *
 *  Why the raw SQL with manual `p.` aliases: Drizzle's `eq(schema.x, …)`
 *  helper renders the fully-qualified `"mmp_products"."brand_slug"`,
 *  which Postgres rejects when the outer query has aliased the same
 *  table as `p` (`error 42P01 invalid reference to FROM-clause entry`).
 *  We build the predicate fragments by hand so they reference `p.*`. */
export async function listProductsForBrand(args: ListProductsArgs): Promise<{
  items: ProductListItem[];
  total: number;
}> {
  const filters = [sql`p.brand_slug = ${args.brandSlug}`];
  if (args.curation !== 'all') {
    filters.push(sql`p.curation_status = ${args.curation}`);
  }
  if (args.search.trim()) {
    const q = `%${args.search.trim()}%`;
    filters.push(sql`(
      p.name ILIKE ${q}
      OR p.sku ILIKE ${q}
      OR p.portal_product_id ILIKE ${q}
    )`);
  }
  // Compose AND chain manually — `sql.join` keeps the parameter
  // bindings intact and avoids accidental string interpolation.
  const whereSql = sql.join(filters, sql` AND `);

  // Total uses Drizzle-typed select so we get a proper count() output.
  // The conditions here MUST use the unaliased schema columns because
  // there's no `p` alias on this query path.
  const totalConditions = [eq(schema.mmpProducts.brandSlug, args.brandSlug)];
  if (args.curation !== 'all') {
    totalConditions.push(eq(schema.mmpProducts.curationStatus, args.curation));
  }
  if (args.search.trim()) {
    const q = `%${args.search.trim()}%`;
    totalConditions.push(sql`(
      ${ilike(schema.mmpProducts.name, q)}
      OR ${ilike(schema.mmpProducts.sku, q)}
      OR ${ilike(schema.mmpProducts.portalProductId, q)}
    )`);
  }
  const [totalRow] = await db
    .select({ n: count() })
    .from(schema.mmpProducts)
    .where(and(...totalConditions));

  const rows = await db.execute<{
    portal_product_id: string;
    sku: string;
    name: string;
    product_type: string | null;
    collection: string | null;
    status: 'live' | 'draft' | 'archived';
    curation_status: 'received' | 'approved' | 'rejected' | 'pushed';
    base_price: string;
    variant_count: number;
    thumbnail_url: string | null;
    last_received_at: Date;
    shopify_product_id: string | null;
  }>(sql`
    SELECT
      p.portal_product_id,
      p.sku,
      p.name,
      p.product_type,
      p.collection,
      p.status,
      p.curation_status,
      p.base_price,
      p.last_received_at,
      p.shopify_product_id,
      (
        SELECT COUNT(*)::int FROM ${schema.mmpProductVariants} v
        WHERE v.product_id = p.id
      ) AS variant_count,
      (
        SELECT i.url FROM ${schema.mmpProductImages} i
        WHERE i.product_id = p.id
        ORDER BY i.is_thumbnail DESC, i.position ASC
        LIMIT 1
      ) AS thumbnail_url
    FROM ${schema.mmpProducts} p
    WHERE ${whereSql}
    ORDER BY p.last_received_at DESC
    LIMIT ${args.limit}
    OFFSET ${args.offset}
  `);

  return {
    total: totalRow?.n ?? 0,
    items: rows.rows.map((r) => ({
      portalProductId: r.portal_product_id,
      sku: r.sku,
      name: r.name,
      productType: r.product_type,
      collection: r.collection,
      status: r.status,
      curationStatus: r.curation_status,
      basePrice: r.base_price,
      variantCount: r.variant_count,
      thumbnailUrl: r.thumbnail_url,
      // Raw query → coerce timestamp string → Date (see brand list above).
      lastReceivedAt: new Date(r.last_received_at),
      shopifyProductId: r.shopify_product_id,
    })),
  };
}

/** Product detail (header). Variants/images loaded separately to keep
 *  the SQL readable. */
export interface ProductDetail {
  portalProductId: string;
  brandSlug: string;
  brandDisplayName: string;
  sku: string;
  name: string;
  globalName: string | null;
  shortSummary: string | null;
  description: string | null;
  collection: string | null;
  productType: string | null;
  status: 'live' | 'draft' | 'archived';
  curationStatus: 'received' | 'approved' | 'rejected' | 'pushed';
  curationNote: string | null;
  basePrice: string;
  currency: string;
  priceUsd: string | null;
  attributes: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  shopifyProductId: string | null;
  pushedToShopifyAt: Date | null;
  lastReceivedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface VariantRow {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  inventory: number;
  price: string;
  lengthCm: string | null;
  lengthCmMax: string | null;
  position: number;
  shopifyVariantId: string | null;
}

export interface ImageRow {
  id: string;
  url: string;
  position: number;
  role: string | null;
  isThumbnail: boolean;
  altText: string | null;
}

export async function getProductByPortalId(
  brandSlug: string,
  portalProductId: string,
): Promise<{ product: ProductDetail; variants: VariantRow[]; images: ImageRow[] } | null> {
  const [pj] = await db
    .select({
      // Product columns
      id: schema.mmpProducts.id,
      portalProductId: schema.mmpProducts.portalProductId,
      brandSlug: schema.mmpProducts.brandSlug,
      sku: schema.mmpProducts.sku,
      name: schema.mmpProducts.name,
      globalName: schema.mmpProducts.globalName,
      shortSummary: schema.mmpProducts.shortSummary,
      description: schema.mmpProducts.description,
      collection: schema.mmpProducts.collection,
      productType: schema.mmpProducts.productType,
      status: schema.mmpProducts.status,
      curationStatus: schema.mmpProducts.curationStatus,
      curationNote: schema.mmpProducts.curationNote,
      basePrice: schema.mmpProducts.basePrice,
      currency: schema.mmpProducts.currency,
      priceUsd: schema.mmpProducts.priceUsd,
      attributes: schema.mmpProducts.attributes,
      details: schema.mmpProducts.details,
      shopifyProductId: schema.mmpProducts.shopifyProductId,
      pushedToShopifyAt: schema.mmpProducts.pushedToShopifyAt,
      lastReceivedAt: schema.mmpProducts.lastReceivedAt,
      createdAt: schema.mmpProducts.createdAt,
      updatedAt: schema.mmpProducts.updatedAt,
      brandDisplayName: schema.mmpBrands.displayName,
    })
    .from(schema.mmpProducts)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.mmpProducts.brandSlug))
    .where(and(
      eq(schema.mmpProducts.brandSlug, brandSlug),
      eq(schema.mmpProducts.portalProductId, portalProductId),
    ));
  if (!pj) return null;

  const [variants, images] = await Promise.all([
    db
      .select({
        id: schema.mmpProductVariants.id,
        sku: schema.mmpProductVariants.sku,
        color: schema.mmpProductVariants.color,
        size: schema.mmpProductVariants.size,
        inventory: schema.mmpProductVariants.inventory,
        price: schema.mmpProductVariants.price,
        lengthCm: schema.mmpProductVariants.lengthCm,
        lengthCmMax: schema.mmpProductVariants.lengthCmMax,
        position: schema.mmpProductVariants.position,
        shopifyVariantId: schema.mmpProductVariants.shopifyVariantId,
      })
      .from(schema.mmpProductVariants)
      .where(eq(schema.mmpProductVariants.productId, pj.id))
      .orderBy(schema.mmpProductVariants.position, schema.mmpProductVariants.sku),
    db
      .select({
        id: schema.mmpProductImages.id,
        url: schema.mmpProductImages.url,
        position: schema.mmpProductImages.position,
        role: schema.mmpProductImages.role,
        isThumbnail: schema.mmpProductImages.isThumbnail,
        altText: schema.mmpProductImages.altText,
      })
      .from(schema.mmpProductImages)
      .where(eq(schema.mmpProductImages.productId, pj.id))
      .orderBy(desc(schema.mmpProductImages.isThumbnail), schema.mmpProductImages.position),
  ]);

  const product: ProductDetail = {
    portalProductId: pj.portalProductId,
    brandSlug: pj.brandSlug,
    brandDisplayName: pj.brandDisplayName ?? pj.brandSlug,
    sku: pj.sku,
    name: pj.name,
    globalName: pj.globalName,
    shortSummary: pj.shortSummary,
    description: pj.description,
    collection: pj.collection,
    productType: pj.productType,
    status: pj.status,
    curationStatus: pj.curationStatus,
    curationNote: pj.curationNote,
    basePrice: pj.basePrice,
    currency: pj.currency,
    priceUsd: pj.priceUsd,
    attributes: (pj.attributes as Record<string, unknown> | null) ?? null,
    details: (pj.details as Record<string, unknown> | null) ?? null,
    shopifyProductId: pj.shopifyProductId,
    pushedToShopifyAt: pj.pushedToShopifyAt,
    lastReceivedAt: pj.lastReceivedAt,
    createdAt: pj.createdAt,
    updatedAt: pj.updatedAt,
  };

  return { product, variants, images };
}
