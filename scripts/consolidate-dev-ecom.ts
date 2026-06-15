/**
 * Đồng bộ lại brand test của bên DEV theo Shopify: trước đây meanblvd để
 * 2 vendor "DEV global" + "Dev domestic", DEV đã gộp về 1 vendor "DEV Ecom".
 * Script này phản ánh đúng Shopify vào SMS:
 *
 *  1. Upsert brand `dev-ecom`.
 *  2. Chuyển mọi sản phẩm vendor "DEV Ecom" trên Shopify về brand này
 *     (refresh tên + status/curation theo Shopify), keyed theo shopify gid.
 *  3. Xoá 2 brand rỗng `dev-global`, `dev-domestic`.
 *
 * Mặc định dry-run. Thêm --apply để ghi.
 *
 *   pnpm exec dotenv -- tsx scripts/consolidate-dev-ecom.ts [--apply]
 */
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { graphqlCall, getStoreToken } from '@/lib/shopify/client';

const STORE_ID = '679aacbb-f563-4725-9d2f-65b9fddac22f';
const SHOP = 'meanblvd.myshopify.com';
const VENDOR = 'DEV Ecom';
const TARGET_SLUG = 'dev-ecom';
const OLD_SLUGS = ['dev-global', 'dev-domestic'];

const STATUS_MAP: Record<string, { status: 'live' | 'draft' | 'archived'; curation: 'approved' | 'received' | 'archived' }> = {
  ACTIVE: { status: 'live', curation: 'approved' },
  ARCHIVED: { status: 'archived', curation: 'archived' },
  DRAFT: { status: 'draft', curation: 'received' },
};

const Q = `
query($q: String!, $cursor: String) {
  products(first: 50, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    edges { node { id title vendor status } }
  }
}`;

interface ShopProduct { gid: string; pid: string; title: string; status: string }

async function fetchVendor(token: string): Promise<ShopProduct[]> {
  const out: ShopProduct[] = [];
  let cursor: string | null = null;
  do {
    const r = (await graphqlCall({ shopDomain: SHOP, apiVersion: '2024-10', token, query: Q, variables: { q: `vendor:'${VENDOR}'`, cursor } })) as {
      data?: { products?: { pageInfo: { hasNextPage: boolean; endCursor: string }; edges: Array<{ node: { id: string; title: string; status: string } }> } };
    };
    const p = r?.data?.products;
    if (!p) throw new Error('Shopify trả về rỗng: ' + JSON.stringify(r));
    for (const e of p.edges) out.push({ gid: e.node.id, pid: e.node.id.split('/').pop()!, title: e.node.title, status: e.node.status });
    cursor = p.pageInfo.hasNextPage ? p.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const token = await getStoreToken(STORE_ID);
  const prods = await fetchVendor(token);

  console.log(`Shopify vendor "${VENDOR}": ${prods.length} sản phẩm`);
  for (const p of prods) console.log(`  ${p.pid}\t${p.status}\t${p.title}`);

  if (prods.length === 0) {
    console.log('\nKhông có sản phẩm DEV Ecom trên Shopify — dừng (không xoá gì).');
    process.exit(0);
  }

  if (!apply) {
    console.log(`\n[DRY-RUN] Sẽ: tạo brand '${TARGET_SLUG}', chuyển ${prods.length} sp về brand này, xoá ${OLD_SLUGS.join(', ')}.`);
    console.log('Thêm --apply để ghi.');
    process.exit(0);
  }

  // 1. Upsert brand đích (phải tồn tại trước vì brand_slug là FK).
  await db.insert(schema.mmpBrands)
    .values({ slug: TARGET_SLUG, displayName: VENDOR, status: 'active', note: 'Brand test của DEV (gộp từ DEV global + Dev domestic)' })
    .onConflictDoUpdate({ target: schema.mmpBrands.slug, set: { displayName: VENDOR, lastSeenAt: new Date() } });

  // 2. Chuyển sản phẩm về brand đích + refresh status/curation/name theo Shopify.
  let moved = 0;
  for (const p of prods) {
    const portal = `shopify-${p.pid}`;
    const m = STATUS_MAP[p.status] ?? STATUS_MAP.DRAFT;
    const r = await db.update(schema.mmpProducts)
      .set({ brandSlug: TARGET_SLUG, name: p.title, status: m.status, curationStatus: m.curation, updatedAt: new Date() })
      .where(eq(schema.mmpProducts.portalProductId, portal));
    moved += (r as unknown as { rowCount?: number }).rowCount ?? 0;
  }
  console.log(`\n✓ Chuyển ${moved} sp về '${TARGET_SLUG}'.`);

  // 3. Xoá 2 brand cũ nếu đã rỗng.
  const leftover = await db.select({ slug: schema.mmpProducts.brandSlug })
    .from(schema.mmpProducts).where(inArray(schema.mmpProducts.brandSlug, OLD_SLUGS)).limit(1);
  if (leftover.length > 0) {
    console.log(`⚠ Còn sp ở brand cũ (${leftover[0].slug}) — KHÔNG xoá brand cũ. Kiểm tra lại.`);
  } else {
    const del = await db.delete(schema.mmpBrands).where(inArray(schema.mmpBrands.slug, OLD_SLUGS));
    console.log(`✓ Xoá ${(del as unknown as { rowCount?: number }).rowCount ?? 0} brand rỗng: ${OLD_SLUGS.join(', ')}.`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
