/**
 * Backfill the SMS catalog (mmp_brands + mmp_products + variants + images) from
 * an existing Shopify store's products — "history" for products that were live
 * on Shopify before the MMP→SMS→Shopify flow existed.
 *
 * - Brand = Shopify product `vendor` (slugified).
 * - source='shopify', portal_product_id='shopify-<gid#>' (synthesised — these
 *   never came from MMP). Dedup by shopify_product_id: a product already
 *   represented (e.g. an MMP-pushed row) is skipped, so this is resumable and
 *   won't duplicate the existing 162 MMP rows.
 * - Shopify status → mmp status + curation: ACTIVE→live/approved,
 *   ARCHIVED→archived/archived, DRAFT→draft/received.
 *
 * Defaults to dry-run. Pass --apply to write. --limit N caps products.
 *
 *   pnpm tsx scripts/import-shopify-catalog.ts --store meanblvd.myshopify.com --apply
 */
import 'dotenv/config';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { graphqlCall, getStoreToken } from '@/lib/shopify/client';

function parseArgs() {
  const a = process.argv.slice(2);
  let store = 'meanblvd.myshopify.com', apply = false, limit = Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--store') store = a[++i];
    else if (a[i] === '--apply') apply = true;
    else if (a[i] === '--limit') limit = Number(a[++i]);
  }
  return { store, apply, limit };
}

const slugify = (s: string) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'no-brand';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STATUS_MAP: Record<string, { status: 'live' | 'draft' | 'archived'; curation: 'approved' | 'received' | 'archived' }> = {
  ACTIVE: { status: 'live', curation: 'approved' },
  ARCHIVED: { status: 'archived', curation: 'archived' },
  DRAFT: { status: 'draft', curation: 'received' },
};

const PRODUCTS_Q = `
query($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title vendor status handle productType
      images(first: 10) { edges { node { url altText } } }
      variants(first: 50) { edges { node { id sku price inventoryQuantity selectedOptions { name value } } } }
    } }
  }
}`;

/** Retry on ANY transient failure (429/throttle, fetch failed, stream/socket
 *  timeout, connection reset) — a long catalog crawl WILL hit these. */
async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 8): Promise<T> {
  let lastErr: unknown;
  for (let t = 0; t < tries; t++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const msg = String((e as Error)?.message ?? e) + String((e as { cause?: unknown })?.cause ?? '');
      const transient = /429|throttle|fetch failed|timeout|ECONNRESET|ETIMEDOUT|terminated|socket|stream/i.test(msg);
      if (!transient) throw e;
      const wait = Math.min(15000, 1500 * (t + 1));
      process.stdout.write(`\n[retry ${label} ${t + 1}/${tries} in ${wait}ms] ${msg.slice(0, 80)}\n`);
      await sleep(wait);
    }
  }
  throw lastErr;
}
const callWithRetry = (args: Parameters<typeof graphqlCall>[0]) => withRetry('gql', () => graphqlCall(args));

async function main() {
  const args = parseArgs();
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.shopDomain, args.store));
  if (!store) throw new Error(`store not connected: ${args.store}`);
  const token = await getStoreToken(store.id);
  console.log(`[catalog] store=${store.shopDomain} apiVersion=${store.apiVersion} apply=${args.apply} limit=${args.limit}`);

  // Existing shopify_product_id → skip (resumable, no dupes vs MMP rows).
  const existing = new Set(
    (await db.select({ sid: schema.mmpProducts.shopifyProductId }).from(schema.mmpProducts))
      .map((r) => r.sid).filter(Boolean) as string[],
  );
  const knownBrands = new Set((await db.select({ slug: schema.mmpBrands.slug }).from(schema.mmpBrands)).map((b) => b.slug));

  // Persist the page cursor so a kill/restart resumes exactly where it left off
  // instead of re-skipping the tens of thousands already done. Only written
  // after a page is fully processed, so it always points to a clean boundary.
  const cursorFile = `/tmp/shopify-catalog-${slugify(store.shopDomain)}.cursor`;
  let cursor: string | null = (args.apply && existsSync(cursorFile)) ? (readFileSync(cursorFile, 'utf8').trim() || null) : null;
  if (cursor) console.log(`[catalog] resume từ cursor đã lưu (bỏ qua re-skip)`);
  let seen = 0, inserted = 0, skipped = 0;
  const brandTally = new Map<string, number>();
  const now = new Date();

  while (seen < args.limit) {
    const res = await callWithRetry({ shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query: PRODUCTS_Q, variables: { cursor } });
    if (res.errors) { console.error('GQL errors:', JSON.stringify(res.errors).slice(0, 300)); break; }
    const conn = (res.data as any).products;
    for (const edge of conn.edges as any[]) {
      if (seen >= args.limit) break;
      seen++;
      const p = edge.node;
      if (existing.has(p.id)) { skipped++; continue; }

      const vendor = (p.vendor || '').trim();
      const brandSlug = slugify(vendor);
      brandTally.set(brandSlug, (brandTally.get(brandSlug) ?? 0) + 1);
      const variants = (p.variants?.edges ?? []).map((e: any) => e.node);
      const images = (p.images?.edges ?? []).map((e: any) => e.node);
      const masterSku = variants[0]?.sku || p.handle || p.id.split('/').pop();
      const priceUsd = variants[0]?.price ? Number(variants[0].price) : null;
      const sm = STATUS_MAP[p.status] ?? STATUS_MAP.DRAFT;
      const gidNum = p.id.split('/').pop();

      if (args.apply) {
        if (!knownBrands.has(brandSlug)) {
          await withRetry('brand', () => db.insert(schema.mmpBrands).values({ slug: brandSlug, displayName: vendor || 'Không rõ', firstSeenAt: now, lastSeenAt: now }).onConflictDoNothing());
          knownBrands.add(brandSlug);
        }
        // Upsert so a retry after a dropped connection (where the insert may have
        // committed) returns the existing id instead of failing on the unique key.
        const [prod] = await withRetry('product', () => db.insert(schema.mmpProducts).values({
          portalProductId: `shopify-${gidNum}`,
          brandSlug, sku: masterSku, name: p.title || masterSku,
          collection: null, productType: p.productType || null,
          status: sm.status, source: 'shopify',
          basePrice: '0', currency: 'USD',
          priceUsd: priceUsd != null ? String(priceUsd) : null,
          curationStatus: sm.curation, shopifyProductId: p.id,
          lastReceivedAt: now, sourceHash: createHash('sha256').update(p.id).digest('hex'),
        }).onConflictDoUpdate({ target: schema.mmpProducts.portalProductId, set: { lastReceivedAt: now } }).returning({ id: schema.mmpProducts.id }));

        if (variants.length) {
          await withRetry('variants', () => db.insert(schema.mmpProductVariants).values(variants.map((v: any, idx: number) => {
            const opts = Object.fromEntries((v.selectedOptions ?? []).map((o: any) => [o.name.toLowerCase(), o.value]));
            return {
              productId: prod.id, sku: v.sku || `${masterSku}-${idx}`,
              color: opts.color ?? opts['màu'] ?? null, size: opts.size ?? opts['kích thước'] ?? null,
              inventory: Number(v.inventoryQuantity ?? 0), price: v.price ? String(v.price) : '0',
              position: idx, shopifyVariantId: v.id,
            };
          })).onConflictDoNothing());
        }
        if (images.length) {
          await withRetry('images', () => db.insert(schema.mmpProductImages).values(images.map((im: any, idx: number) => ({
            productId: prod.id, url: im.url, position: idx, isThumbnail: idx === 0, altText: im.altText ?? null,
          }))).onConflictDoNothing());
        }
        existing.add(p.id);
      }
      inserted++;
    }
    process.stdout.write(`\r[catalog] seen=${seen} insert=${inserted} skip=${skipped} brands=${brandTally.size}   `);
    if (!conn.pageInfo.hasNextPage) { if (args.apply && existsSync(cursorFile)) unlinkSync(cursorFile); break; }
    cursor = conn.pageInfo.endCursor;
    if (args.apply) writeFileSync(cursorFile, cursor ?? ''); // checkpoint after full page
    await sleep(550); // throttle
  }

  console.log(`\n\n=== ${args.apply ? 'APPLIED' : 'DRY-RUN'} ===`);
  console.log(`seen=${seen} ${args.apply ? 'inserted' : 'would-insert'}=${inserted} skipped(existing)=${skipped}`);
  console.log(`brands (${brandTally.size}):`);
  for (const [b, n] of [...brandTally.entries()].sort((a, z) => z[1] - a[1])) console.log(`  ${b}: ${n}`);
  process.exit(0);
}

main().catch((e) => { console.error('\n', e); process.exit(1); });
