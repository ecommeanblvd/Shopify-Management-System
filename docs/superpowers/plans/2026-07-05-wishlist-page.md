# Wishlist Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trang full-page **Wishlist** trong Customer Account: khách xem sản phẩm đã lưu (thu thập bởi function wishlist sẵn có), bỏ item, và nhận **gợi ý sản phẩm tương tự** (rule-based). Menu account có mục "Wishlist" riêng cạnh "Customer Account Hub". Theo spec `docs/superpowers/specs/2026-07-05-wishlist-page-design.md`. Nền catalog + recommendation engine xây ở đây TÁI DÙNG cho sub-project C (Style Quiz).

**Architecture:** Recommendation engine THUẦN (`recommend.ts`, một nơi tính điểm) + bảng catalog mới `shopify_products` (sync Admin GraphQL, cron daily) + bảng cache `customer_identities` (customerId → email, TTL 7 ngày) + layer identity-resolve THUẦN (chọn wishlist theo email HOẶC shopifyCustomerId) + 2 API extension (Bearer session token, pattern `_shared`) + extension Preact RIÊNG `customer-account-wishlist` render grid + recommendations. Tái dùng `getWishlistWithItems`/`removeItem` từ `features/functions/wishlist/storefront.ts` khi đã resolve được email.

**Tech Stack:** Next.js 16 App Router, Drizzle + Postgres, Vitest, Zod; extension: Preact + `@shopify/ui-extensions` (`s-*`), api_version 2026-04.

## Global Constraints

- **KHÔNG inline `'use server'`** per-function. Client component KHÔNG được import module có `@/db/client`. Theo pattern 3 file `*-shared.ts` (const/type, không db) / `*-admin.ts` (query, server-only) / `*-actions.ts` (`'use server'` đầu file) như `features/customer-account/returns-*.ts` cũ. Feature này KHÔNG có admin UI mới nên chỉ áp dụng nguyên tắc "client không import db" cho extension (extension gọi API, không import db).
- **Trước khi push: root `npx tsc --noEmit` + `npx vitest run` + `npm run build` (next build THẬT) đều xanh; extension `cd shopify-extension && npm run typecheck && npm test` đều xanh** (bài học 2026-07-05: 9 deploy fail vì bỏ qua next build).
- **Migration đăng ký journal:** `drizzle-kit migrate` đọc `db/migrations/meta/_journal.json`, KHÔNG scan thư mục. File kế tiếp `db/migrations/0093_wishlist-catalog.sql`; entry mới `idx: 93`, `tag: "0093_wishlist-catalog"`, `when: 1784464800000` (= entry idx 92 `1784378400000` + 86400000). Chạy local: `npm run db:migrate`.
- **Extension full-page = extension RIÊNG** trong `shopify-extension/extensions/customer-account-wishlist/` (Shopify: full-page target không được ở chung extension với target khác — bài học Order Journey). `shopify.extension.toml` `api_version = "2026-04"`, setting field type `single_line_text_field`, `DEFAULT_BACKEND_URL` fallback như hub. Package `shopify-extension/` độc lập; `tsconfig.include = ["extensions/*/src"]` + `vitest include = ['extensions/*/src/**/*.test.ts']` tự bắt file mới, KHÔNG sửa config root.
- **drizzle 0.45 wrap lỗi pg vào `.cause`** — dùng `pgErrorCode` từ `features/customer-account/request-status.ts` nếu cần catch unique-violation.
- **Copy phía khách: tiếng Anh.** Copy admin/log: tiếng Việt.
- **Store thiếu `read_customers`:** resolve email fail → degrade (chỉ match theo `shopifyCustomerId`), KHÔNG lỗi. Field GraphQL customer chỉ query khi có scope (bài học ORDER_NODE_FIELDS). Với catalog: field GraphQL `products` cần VERIFY khi implement (introspection / thử 1 sản phẩm thật) TRƯỚC khi viết mapper — có step riêng ở Task 3.
- Link sản phẩm phía khách: `https://{shopDomain}/products/{handle}` (myshopify domain redirect về primary) — v1 chấp nhận, không lookup primary domain.

## File Structure (mới/sửa chính)

```
features/customer-account/
  recommend.ts                 # Task 1 — engine thuần scoreProducts + types
  recommend.test.ts            # Task 1
  wishlist-identity.ts         # Task 4 — resolve customerId→email (thuần chọn wishlist + db resolve + cache)
  wishlist-identity.test.ts    # Task 4 — test phần thuần selectWishlistMatch
  wishlist-page.ts             # Task 5 — domain (db): getWishlistPage, removeWishlistItem
db/schema.ts                   # Task 2 — shopifyProducts + customerIdentities
db/migrations/0093_wishlist-catalog.sql            # Task 2
db/migrations/meta/_journal.json                   # Task 2 — entry idx 93
scripts/sync-shopify-products.ts                   # Task 3 — sync catalog (pattern sync-shopify-variants.ts)
app/api/cron/sync-products/route.ts                # Task 3 — cron daily, bearer CRON_SECRET
app/api/customer-account/wishlist/route.ts         # Task 5 — GET wishlist + recommendations
app/api/customer-account/wishlist/remove/route.ts  # Task 5 — POST remove
features/customer-account/routes-data-auth.test.ts # Task 5 — thêm case wishlist + remove
package.json                                        # Task 3 — thêm script cron:sync-products
shopify-extension/extensions/customer-account-wishlist/
  shopify.extension.toml       # Task 6
  src/Page.tsx                 # Task 6 — render(<Wishlist/>, document.body)
  src/lib/api.ts               # Task 6 — smsFetch + getConfig/getWishlist/postRemove
  src/lib/wishlist-vm.ts       # Task 6 — thuần: fmtMoney, productUrl, badge
  src/lib/wishlist-vm.test.ts  # Task 6
```

---

### Task 1: Recommendation engine thuần (`recommend.ts`)

**Files:**
- Create: `features/customer-account/recommend.ts`
- Test: `features/customer-account/recommend.test.ts`

**Interfaces:**
- Consumes: không gì (thuần).
- Produces:

```ts
export interface CatalogProduct {
  shopifyProductId: string;
  title: string;
  handle: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  imageUrl: string | null;
  priceMin: string | null;      // numeric string "12.00" | null
  currency: string | null;
  availableForSale: boolean;
  status: string;               // ACTIVE | ARCHIVED | DRAFT
  syncedAt: Date;
}
export interface SeedSignals {
  vendors: string[];
  productTypes: string[];
  tags: string[];
  excludeProductIds: string[];
}
export interface ScoredProduct extends CatalogProduct { score: number; }
export function scoreProducts(seed: SeedSignals, candidates: CatalogProduct[], topN?: number): ScoredProduct[];
```

- [ ] **Step 1: Viết test fail** — `features/customer-account/recommend.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scoreProducts, type CatalogProduct, type SeedSignals } from './recommend';

function p(over: Partial<CatalogProduct> & { shopifyProductId: string }): CatalogProduct {
  return {
    title: 'T', handle: 'h', vendor: null, productType: null, tags: [],
    imageUrl: null, priceMin: '10.00', currency: 'USD',
    availableForSale: true, status: 'ACTIVE', syncedAt: new Date('2026-07-01T00:00:00Z'),
    ...over,
  };
}
const seed: SeedSignals = {
  vendors: ['Nike'], productTypes: ['Shoes'], tags: ['red', 'summer'],
  excludeProductIds: ['gid://shopify/Product/1'],
};

describe('scoreProducts', () => {
  it('cùng vendor +2, cùng productType +2, mỗi tag chung +1', () => {
    const r = scoreProducts(seed, [
      p({ shopifyProductId: 'gid://shopify/Product/2', vendor: 'Nike', productType: 'Shoes', tags: ['red', 'summer'] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].score).toBe(6); // 2 + 2 + 1 + 1
  });
  it('loại excludeProductIds (seed sản phẩm)', () => {
    const r = scoreProducts(seed, [p({ shopifyProductId: 'gid://shopify/Product/1', vendor: 'Nike' })]);
    expect(r).toHaveLength(0);
  });
  it('loại !availableForSale, status != ACTIVE, và điểm 0', () => {
    const r = scoreProducts(seed, [
      p({ shopifyProductId: 'gid://shopify/Product/3', vendor: 'Nike', availableForSale: false }),
      p({ shopifyProductId: 'gid://shopify/Product/4', vendor: 'Nike', status: 'DRAFT' }),
      p({ shopifyProductId: 'gid://shopify/Product/5', vendor: 'Adidas', productType: 'Hat', tags: [] }), // điểm 0
    ]);
    expect(r).toHaveLength(0);
  });
  it('tie-break: syncedAt mới hơn đứng trước', () => {
    const r = scoreProducts(seed, [
      p({ shopifyProductId: 'gid://shopify/Product/6', vendor: 'Nike', syncedAt: new Date('2026-07-01T00:00:00Z') }),
      p({ shopifyProductId: 'gid://shopify/Product/7', vendor: 'Nike', syncedAt: new Date('2026-07-05T00:00:00Z') }),
    ]);
    expect(r.map((x) => x.shopifyProductId)).toEqual(['gid://shopify/Product/7', 'gid://shopify/Product/6']);
  });
  it('mặc định top 8, override topN', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      p({ shopifyProductId: `gid://shopify/Product/1${i}`, vendor: 'Nike' }));
    expect(scoreProducts(seed, many)).toHaveLength(8);
    expect(scoreProducts(seed, many, 3)).toHaveLength(3);
  });
  it('sort điểm giảm dần', () => {
    const r = scoreProducts(seed, [
      p({ shopifyProductId: 'gid://shopify/Product/8', vendor: 'Nike' }),                 // +2
      p({ shopifyProductId: 'gid://shopify/Product/9', vendor: 'Nike', productType: 'Shoes' }), // +4
    ]);
    expect(r.map((x) => x.score)).toEqual([4, 2]);
  });
});
```

- [ ] **Step 2: Chạy fail** — `npx vitest run features/customer-account/recommend.test.ts` → FAIL (module chưa tồn tại).
- [ ] **Step 3: Implement** — `features/customer-account/recommend.ts`:

```ts
/** THUẦN: recommendation engine rule-based (spec 2026-07-05-wishlist-page §5).
 *  NƠI DUY NHẤT tính điểm gợi ý sản phẩm — tái dùng cho sub-project C (Style Quiz).
 *  Điểm: cùng vendor +2, cùng productType +2, mỗi tag chung +1. Loại: seed, !availableForSale,
 *  status != ACTIVE, điểm 0. Trả top N (mặc định 8), tie-break syncedAt mới hơn trước. */

export interface CatalogProduct {
  shopifyProductId: string;
  title: string;
  handle: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  imageUrl: string | null;
  priceMin: string | null;
  currency: string | null;
  availableForSale: boolean;
  status: string;
  syncedAt: Date;
}
export interface SeedSignals {
  vendors: string[];
  productTypes: string[];
  tags: string[];
  excludeProductIds: string[];
}
export interface ScoredProduct extends CatalogProduct { score: number; }

const DEFAULT_TOP_N = 8;

export function scoreProducts(seed: SeedSignals, candidates: CatalogProduct[], topN = DEFAULT_TOP_N): ScoredProduct[] {
  const vendorSet = new Set(seed.vendors.filter(Boolean));
  const typeSet = new Set(seed.productTypes.filter(Boolean));
  const tagSet = new Set(seed.tags.filter(Boolean));
  const excludeSet = new Set(seed.excludeProductIds);

  const scored: ScoredProduct[] = [];
  for (const c of candidates) {
    if (excludeSet.has(c.shopifyProductId)) continue;
    if (!c.availableForSale) continue;
    if (c.status !== 'ACTIVE') continue;
    let score = 0;
    if (c.vendor && vendorSet.has(c.vendor)) score += 2;
    if (c.productType && typeSet.has(c.productType)) score += 2;
    for (const t of c.tags) if (tagSet.has(t)) score += 1;
    if (score === 0) continue;
    scored.push({ ...c, score });
  }
  scored.sort((a, b) => b.score - a.score || b.syncedAt.getTime() - a.syncedAt.getTime());
  return scored.slice(0, topN);
}
```

- [ ] **Step 4: Chạy pass** — `npx vitest run features/customer-account/recommend.test.ts` → PASS toàn bộ.
- [ ] **Step 5: Commit** — `git add features/customer-account/recommend.ts features/customer-account/recommend.test.ts && git commit -m "feat(wishlist-page): recommendation engine thuần (vendor/type/tag scoring, tie-break syncedAt)"`

---

### Task 2: Schema + migration 0093 (`shopify_products`, `customer_identities`)

**Files:**
- Modify: `db/schema.ts` (thêm 2 bảng SAU `wishlistEvents`)
- Create: `db/migrations/0093_wishlist-catalog.sql`
- Modify: `db/migrations/meta/_journal.json` (thêm entry idx 93)

**Interfaces:**
- Produces: `schema.shopifyProducts`, `schema.customerIdentities` (drizzle) — cột đúng như SQL dưới.

- [ ] **Step 1: Thêm vào `db/schema.ts`** (sau `wishlistEvents`, trước `functionAuditLog`). Các import `pgTable, uuid, text, numeric, boolean, timestamp, index, uniqueIndex` đã có sẵn trong file:

```ts
// ---------- Wishlist Page: catalog sản phẩm (spec 2026-07-05-wishlist-page §3) ----------
// Snapshot catalog Shopify cho recommendation engine. Sync Admin GraphQL products
// (scope read_products — cả 4 store đã có), cron daily. Upsert theo (store_id, shopify_product_id).
export const shopifyProducts = pgTable('shopify_products', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  shopifyProductId: text('shopify_product_id').notNull(),
  title: text('title').notNull(),
  handle: text('handle').notNull(),
  vendor: text('vendor'),
  productType: text('product_type'),
  tags: text('tags').array(),
  imageUrl: text('image_url'),
  priceMin: numeric('price_min', { precision: 14, scale: 2 }),
  currency: text('currency'),
  availableForSale: boolean('available_for_sale').notNull().default(false),
  status: text('status').notNull(),          // ACTIVE | ARCHIVED | DRAFT
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('shopify_products_store_product_idx').on(t.storeId, t.shopifyProductId),
  index('shopify_products_store_status_idx').on(t.storeId, t.status),
  index('shopify_products_store_vendor_idx').on(t.storeId, t.vendor),
]);

// Cache resolve Shopify customer GID → email (spec §4). Token extension chỉ có customerId;
// wishlist match theo email HOẶC shopifyCustomerId. TTL 7 ngày (quá hạn resolve lại qua Admin API).
export const customerIdentities = pgTable('customer_identities', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  shopifyCustomerId: text('shopify_customer_id').notNull(),
  email: text('email'),
  resolvedAt: timestamp('resolved_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('customer_identities_store_customer_idx').on(t.storeId, t.shopifyCustomerId),
]);
```

- [ ] **Step 2: Viết `db/migrations/0093_wishlist-catalog.sql`** (idempotent `IF NOT EXISTS`):

```sql
-- Wishlist Page (spec 2026-07-05): catalog sản phẩm cho recommendation + cache identity.
CREATE TABLE IF NOT EXISTS shopify_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shopify_product_id text NOT NULL,
  title text NOT NULL,
  handle text NOT NULL,
  vendor text,
  product_type text,
  tags text[],
  image_url text,
  price_min numeric(14,2),
  currency text,
  available_for_sale boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  synced_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shopify_products_store_product_idx ON shopify_products(store_id, shopify_product_id);
CREATE INDEX IF NOT EXISTS shopify_products_store_status_idx ON shopify_products(store_id, status);
CREATE INDEX IF NOT EXISTS shopify_products_store_vendor_idx ON shopify_products(store_id, vendor);

CREATE TABLE IF NOT EXISTS customer_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shopify_customer_id text NOT NULL,
  email text,
  resolved_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_identities_store_customer_idx ON customer_identities(store_id, shopify_customer_id);
```

- [ ] **Step 3: Đăng ký journal** — thêm object SAU entry idx 92 trong mảng `entries` của `db/migrations/meta/_journal.json` (dùng cùng style `},{` như các entry hiện có; đóng mảng đúng):

```json
    },{
      "idx": 93,
      "version": "7",
      "when": 1784464800000,
      "tag": "0093_wishlist-catalog",
      "breakpoints": true
    }
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` xanh; `npm run db:migrate` local chạy OK (áp 0093, idempotent).
- [ ] **Step 5: Commit** — `git add db/schema.ts db/migrations/0093_wishlist-catalog.sql db/migrations/meta/_journal.json && git commit -m "feat(wishlist-page): schema + migration 0093 (shopify_products, customer_identities)"`

---

### Task 3: Sync catalog script + cron route daily

**Files:**
- Create: `scripts/sync-shopify-products.ts` (pattern `scripts/sync-shopify-variants.ts`)
- Create: `app/api/cron/sync-products/route.ts` (pattern `app/api/cron/sync-orders/route.ts`, bearer CRON_SECRET)
- Modify: `package.json` — thêm script `"cron:sync-products": "dotenv -- tsx scripts/sync-shopify-products.ts --all"` (KHÔNG dùng tên `cron:sync-catalog` — đã bị `scripts/import-shopify-catalog.ts` chiếm).

**Interfaces:**
- Consumes: `graphqlCall`, `getStoreToken` (`lib/shopify/client.ts`); `db, schema` (`@/db/client`).
- Produces: `syncStoreProducts(domain: string, limit: number): Promise<{ products: number }>` (export named, cron route gọi lại được).

- [ ] **Step 1: VERIFY field GraphQL bằng 1 sản phẩm thật TRƯỚC khi viết mapper.** Chạy introspection nhỏ để chốt shape `Product` (spec §3 ghi field "lấy theo khả năng schema thật"). Query thử (chạy local, cần env store token):

```bash
npx tsx -e '
import { graphqlCall, getStoreToken } from "@/lib/shopify/client";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
(async () => {
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.shopDomain, "cici-mean.myshopify.com"));
  const token = await getStoreToken(s.id);
  const q = `{ products(first: 1) { nodes {
    id title handle vendor productType tags status
    featuredImage { url }
    priceRangeV2 { minVariantPrice { amount currencyCode } }
    variants(first: 1) { nodes { availableForSale } }
  } } }`;
  const r = await graphqlCall({ shopDomain: s.shopDomain, apiVersion: s.apiVersion, token, query: q });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})();
' 2>&1 | head -60
```
Xác nhận các field trả về đúng (đặc biệt: `availableForSale` KHÔNG có trực tiếp trên `Product` ở nhiều version → suy ra từ `variants.nodes.some(v => v.availableForSale)`; `productType` string; `tags` array; `status` enum ACTIVE/ARCHIVED/DRAFT; `priceRangeV2.minVariantPrice`). Nếu field khác → điều chỉnh query + mapper Step 2 cho khớp response thật.

- [ ] **Step 2: Implement `scripts/sync-shopify-products.ts`:**

```ts
/* eslint-disable no-console */
/**
 * Sync Shopify products → `shopify_products` table (catalog cho recommendation engine).
 *
 * Walks every product via Admin GraphQL `products(first: 50)` paginated. Upsert
 * theo (store_id, shopify_product_id). available_for_sale = có ít nhất 1 variant
 * còn bán. Idempotent — Shopify là nguồn sự thật, không giữ lịch sử.
 *
 * Usage:
 *   pnpm tsx scripts/sync-shopify-products.ts --store cici-mean.myshopify.com
 *   pnpm tsx scripts/sync-shopify-products.ts --all
 *   pnpm tsx scripts/sync-shopify-products.ts --store cici-mean.myshopify.com --limit 100
 */
import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { graphqlCall, getStoreToken } from '@/lib/shopify/client';

interface Args { store?: string; all: boolean; limit: number; }

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const out: Args = { all: false, limit: Number.POSITIVE_INFINITY };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--store') out.store = a[++i];
    else if (a[i] === '--all') out.all = true;
    else if (a[i] === '--limit') out.limit = Number(a[++i]);
  }
  if (!out.store && !out.all) throw new Error('Pass --store <domain> or --all');
  return out;
}

// LƯU Ý: query này đã được VERIFY ở Step 1 với 1 sản phẩm thật. Nếu Step 1 cho
// thấy field khác thì đồng bộ lại cả query lẫn interface + mapper bên dưới.
const PRODUCTS_QUERY = /* GraphQL */ `
  query CatalogProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle vendor productType tags status
        featuredImage { url }
        priceRangeV2 { minVariantPrice { amount currencyCode } }
        variants(first: 100) { nodes { availableForSale } }
      }
    }
  }
`;

interface ProductNode {
  id: string; title: string; handle: string;
  vendor: string | null; productType: string | null; tags: string[]; status: string;
  featuredImage: { url: string } | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } } | null;
  variants: { nodes: { availableForSale: boolean }[] };
}
interface QueryData {
  products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductNode[] };
}

export async function syncStoreProducts(domain: string, limit: number): Promise<{ products: number }> {
  const [storeRow] = await db.select().from(schema.stores).where(eq(schema.stores.shopDomain, domain));
  if (!storeRow) throw new Error(`Store not connected: ${domain}`);
  console.log(`[products-sync] ${domain} → store ${storeRow.id}`);
  const token = await getStoreToken(storeRow.id);

  let cursor: string | null = null;
  let total = 0;
  const BATCH = 200;
  let buffer: typeof schema.shopifyProducts.$inferInsert[] = [];

  async function flush(): Promise<void> {
    if (buffer.length === 0) return;
    await db.insert(schema.shopifyProducts).values(buffer).onConflictDoUpdate({
      target: [schema.shopifyProducts.storeId, schema.shopifyProducts.shopifyProductId],
      set: {
        title: sql`excluded.title`, handle: sql`excluded.handle`,
        vendor: sql`excluded.vendor`, productType: sql`excluded.product_type`,
        tags: sql`excluded.tags`, imageUrl: sql`excluded.image_url`,
        priceMin: sql`excluded.price_min`, currency: sql`excluded.currency`,
        availableForSale: sql`excluded.available_for_sale`, status: sql`excluded.status`,
        syncedAt: sql`now()`,
      },
    });
    buffer = [];
  }

  while (total < limit) {
    const result = await graphqlCall({
      shopDomain: storeRow.shopDomain, apiVersion: storeRow.apiVersion, token,
      query: PRODUCTS_QUERY, variables: { cursor },
    });
    if (result.errors) throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    const data = result.data as QueryData;

    for (const p of data.products.nodes) {
      const price = p.priceRangeV2?.minVariantPrice;
      buffer.push({
        storeId: storeRow.id,
        shopifyProductId: p.id,
        title: p.title,
        handle: p.handle,
        vendor: p.vendor ?? null,
        productType: p.productType ?? null,
        tags: p.tags ?? [],
        imageUrl: p.featuredImage?.url ?? null,
        priceMin: price ? String(price.amount) : null,
        currency: price?.currencyCode ?? null,
        availableForSale: p.variants.nodes.some((v) => v.availableForSale),
        status: p.status,
      });
      total++;
      if (buffer.length >= BATCH) await flush();
      if (total >= limit) break;
    }

    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
    await new Promise((r) => setTimeout(r, 200)); // pacing GraphQL points
  }
  await flush();
  console.log(`[products-sync] ${domain} done: ${total} products`);
  return { products: total };
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.all) {
    const stores = await db.select({ shopDomain: schema.stores.shopDomain })
      .from(schema.stores).where(eq(schema.stores.status, 'active'));
    for (const s of stores) {
      try { await syncStoreProducts(s.shopDomain, args.limit); }
      catch (e) { console.error(`[products-sync] ${s.shopDomain} failed:`, e); }
    }
  } else if (args.store) {
    await syncStoreProducts(args.store, args.limit);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit());
```

- [ ] **Step 3: Implement `app/api/cron/sync-products/route.ts`** (bearer CRON_SECRET, chạy mọi store active):

```ts
/**
 * HTTP endpoint cron đồng bộ catalog sản phẩm daily cho mọi store active.
 * Bảo vệ bằng bearer CRON_SECRET.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<railway-url>/api/cron/sync-products
 *
 * Response: { ok: true, ran, results: [{ shopDomain, products, error? }] }
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { syncStoreProducts } from '@/scripts/sync-shopify-products';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET is not configured on this deployment.' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const stores = await db.select({ shopDomain: schema.stores.shopDomain })
      .from(schema.stores).where(eq(schema.stores.status, 'active'));
    const results: Array<{ shopDomain: string; products: number; error?: string }> = [];
    for (const s of stores) {
      try {
        const { products } = await syncStoreProducts(s.shopDomain, Number.POSITIVE_INFINITY);
        results.push({ shopDomain: s.shopDomain, products });
      } catch (e) {
        results.push({ shopDomain: s.shopDomain, products: 0, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return NextResponse.json({ ok: true, ran: results.length, results });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

Ghi chú: import `@/scripts/sync-shopify-products` từ route buộc script KHÔNG chạy `main()` khi được import (module có `main()` gọi ở top-level). Bảo vệ bằng guard: bọc lời gọi `main()` cuối file trong `if (process.argv[1] && process.argv[1].includes('sync-shopify-products'))`. Cập nhật Step 2 tương ứng:

```ts
// cuối file thay cho main().catch(...):
if (process.argv[1]?.includes('sync-shopify-products')) {
  main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit());
}
```

- [ ] **Step 4: Thêm script vào `package.json`** trong khối `"scripts"` (cạnh các `cron:*`):

```json
    "cron:sync-products": "dotenv -- tsx scripts/sync-shopify-products.ts --all",
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit` xanh. Chạy thử local với 1 store nhỏ: `npm run cron:sync-products -- --store cici-mean.myshopify.com --limit 20` → in `done: N products`; kiểm tra `SELECT count(*) FROM shopify_products` > 0. `npx vitest run` toàn repo xanh.
- [ ] **Step 6: Commit** — `git add scripts/sync-shopify-products.ts app/api/cron/sync-products/route.ts package.json && git commit -m "feat(wishlist-page): sync catalog shopify_products + cron route daily"`

---

### Task 4: Identity resolve (`wishlist-identity.ts`)

**Files:**
- Create: `features/customer-account/wishlist-identity.ts`
- Test: `features/customer-account/wishlist-identity.test.ts` (test phần THUẦN `selectWishlistMatch`)

**Interfaces:**
- Consumes: `graphqlCall`, `getStoreToken` (`lib/shopify/client.ts`); `db, schema` (`@/db/client`); `wishlists` schema.
- Produces:

```ts
export interface WishlistMatchRow { id: string; customerEmail: string | null; shopifyCustomerId: string | null; }
/** THUẦN: chọn 1 wishlist match theo email HOẶC shopifyCustomerId, ưu tiên wishlist có email. */
export function selectWishlistMatch(rows: WishlistMatchRow[], email: string | null, customerId: string): WishlistMatchRow | null;
/** DB + Admin API + cache: resolve customerId → email (null nếu store thiếu read_customers / customer không có email). */
export async function resolveCustomerEmail(storeId: string, customerId: string): Promise<string | null>;
/** DB: tìm wishlist của khách (resolve email trước, rồi selectWishlistMatch trên union email/customerId). */
export async function findCustomerWishlist(storeId: string, customerId: string): Promise<{ wishlistId: string; email: string | null } | null>;
```

- [ ] **Step 1: Viết test fail** — `features/customer-account/wishlist-identity.test.ts` (chỉ test THUẦN — `resolveCustomerEmail`/`findCustomerWishlist` chạm db, verify ở integration Task 7):

```ts
import { describe, it, expect } from 'vitest';
import { selectWishlistMatch, type WishlistMatchRow } from './wishlist-identity';

const CID = 'gid://shopify/Customer/5812012056758';

describe('selectWishlistMatch', () => {
  it('ưu tiên wishlist có email khi cả hai cùng match', () => {
    const rows: WishlistMatchRow[] = [
      { id: 'w-cid', customerEmail: null, shopifyCustomerId: CID },
      { id: 'w-email', customerEmail: 'a@b.com', shopifyCustomerId: null },
    ];
    expect(selectWishlistMatch(rows, 'a@b.com', CID)?.id).toBe('w-email');
  });
  it('match theo email khi có email', () => {
    const rows: WishlistMatchRow[] = [{ id: 'w1', customerEmail: 'a@b.com', shopifyCustomerId: null }];
    expect(selectWishlistMatch(rows, 'a@b.com', CID)?.id).toBe('w1');
  });
  it('degrade: email null → match theo shopifyCustomerId', () => {
    const rows: WishlistMatchRow[] = [{ id: 'w-cid', customerEmail: null, shopifyCustomerId: CID }];
    expect(selectWishlistMatch(rows, null, CID)?.id).toBe('w-cid');
  });
  it('không match → null', () => {
    const rows: WishlistMatchRow[] = [{ id: 'w-other', customerEmail: 'x@y.com', shopifyCustomerId: 'gid://shopify/Customer/999' }];
    expect(selectWishlistMatch(rows, 'a@b.com', CID)).toBeNull();
  });
  it('email không khớp nhưng customerId khớp → match theo customerId', () => {
    const rows: WishlistMatchRow[] = [{ id: 'w-cid', customerEmail: 'other@x.com', shopifyCustomerId: CID }];
    expect(selectWishlistMatch(rows, 'a@b.com', CID)?.id).toBe('w-cid');
  });
});
```

- [ ] **Step 2: Chạy fail** — `npx vitest run features/customer-account/wishlist-identity.test.ts` → FAIL.
- [ ] **Step 3: Implement `features/customer-account/wishlist-identity.ts`:**

```ts
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
```

- [ ] **Step 4: Chạy pass** — `npx vitest run features/customer-account/wishlist-identity.test.ts` + `npx tsc --noEmit` xanh.
- [ ] **Step 5: Commit** — `git add features/customer-account/wishlist-identity.ts features/customer-account/wishlist-identity.test.ts && git commit -m "feat(wishlist-page): identity resolve (email/customerId match + Admin API cache TTL 7d, degrade)"`

---

### Task 5: API GET wishlist + POST remove + auth test

**Files:**
- Create: `features/customer-account/wishlist-page.ts` (domain db — build items + recommendations, remove item)
- Create: `app/api/customer-account/wishlist/route.ts` (GET)
- Create: `app/api/customer-account/wishlist/remove/route.ts` (POST)
- Modify: `features/customer-account/routes-data-auth.test.ts` (thêm case wishlist GET + remove POST)

**Interfaces:**
- Consumes: `findCustomerWishlist` (Task 4); `scoreProducts`, `CatalogProduct`, `SeedSignals` (Task 1); `authenticateExtension`, `caJson`, `preflight` (`_shared`); `db, schema`; zod.
- Produces (`wishlist-page.ts`):

```ts
export interface WishlistPageItem {
  shopifyProductId: string; variantId: string | null;
  productTitle: string; variantTitle: string | null; productHandle: string;
  imageUrl: string | null; price: string | null; currency: string | null;
  availableForSale: boolean | null; addedAt: string;
}
export interface WishlistPageRec {
  shopifyProductId: string; title: string; handle: string; vendor: string | null;
  imageUrl: string | null; price: string | null; currency: string | null; score: number;
}
export interface WishlistPageData { items: WishlistPageItem[]; recommendations: WishlistPageRec[]; }
export async function getWishlistPage(storeId: string, customerId: string): Promise<WishlistPageData>;
export async function removeWishlistItem(storeId: string, customerId: string, productId: string, variantId?: string): Promise<{ removed: boolean }>;
```

- [ ] **Step 1: Implement `features/customer-account/wishlist-page.ts`:**

```ts
/** Domain Wishlist Page (db): build items + recommendations, remove item.
 *  Recommendations: seed từ shopify_products của các item trong wishlist (vendor/type/tags),
 *  loại chính các sản phẩm đã lưu, chạy scoreProducts. Không có seed → recommendations []. */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { scoreProducts, type CatalogProduct, type SeedSignals } from './recommend';
import { findCustomerWishlist } from './wishlist-identity';

export interface WishlistPageItem {
  shopifyProductId: string; variantId: string | null;
  productTitle: string; variantTitle: string | null; productHandle: string;
  imageUrl: string | null; price: string | null; currency: string | null;
  availableForSale: boolean | null; addedAt: string;
}
export interface WishlistPageRec {
  shopifyProductId: string; title: string; handle: string; vendor: string | null;
  imageUrl: string | null; price: string | null; currency: string | null; score: number;
}
export interface WishlistPageData { items: WishlistPageItem[]; recommendations: WishlistPageRec[]; }

function toCatalogProduct(r: typeof schema.shopifyProducts.$inferSelect): CatalogProduct {
  return {
    shopifyProductId: r.shopifyProductId, title: r.title, handle: r.handle,
    vendor: r.vendor, productType: r.productType, tags: r.tags ?? [],
    imageUrl: r.imageUrl, priceMin: r.priceMin, currency: r.currency,
    availableForSale: r.availableForSale, status: r.status, syncedAt: r.syncedAt,
  };
}

export async function getWishlistPage(storeId: string, customerId: string): Promise<WishlistPageData> {
  const match = await findCustomerWishlist(storeId, customerId);
  if (!match) return { items: [], recommendations: [] };

  const items = await db.select().from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.wishlistId, match.wishlistId));

  const pageItems: WishlistPageItem[] = items.map((i) => ({
    shopifyProductId: i.shopifyProductId,
    variantId: i.shopifyVariantId,
    productTitle: i.productTitle,
    variantTitle: i.variantTitle,
    productHandle: i.productHandle,
    imageUrl: i.imageUrl,
    price: i.priceAmount,
    currency: i.priceCurrency,
    availableForSale: i.availableForSale,
    addedAt: i.addedAt.toISOString(),
  }));

  const seedProductIds = [...new Set(items.map((i) => i.shopifyProductId))];
  if (seedProductIds.length === 0) return { items: pageItems, recommendations: [] };

  // Seed signals từ catalog của các sản phẩm đã lưu (join shopify_products).
  const seedProducts = await db.select().from(schema.shopifyProducts).where(and(
    eq(schema.shopifyProducts.storeId, storeId),
    inArray(schema.shopifyProducts.shopifyProductId, seedProductIds),
  ));
  const seed: SeedSignals = {
    vendors: [...new Set(seedProducts.map((p) => p.vendor).filter((v): v is string => !!v))],
    productTypes: [...new Set(seedProducts.map((p) => p.productType).filter((v): v is string => !!v))],
    tags: [...new Set(seedProducts.flatMap((p) => p.tags ?? []))],
    excludeProductIds: seedProductIds,
  };
  if (seed.vendors.length === 0 && seed.productTypes.length === 0 && seed.tags.length === 0) {
    return { items: pageItems, recommendations: [] };
  }

  // Candidate pool: sản phẩm ACTIVE của store. N nhỏ (vài nghìn) — quét in-memory chấp nhận v1.
  const candidates = await db.select().from(schema.shopifyProducts).where(and(
    eq(schema.shopifyProducts.storeId, storeId),
    eq(schema.shopifyProducts.status, 'ACTIVE'),
  ));
  const scored = scoreProducts(seed, candidates.map(toCatalogProduct));

  const recommendations: WishlistPageRec[] = scored.map((s) => ({
    shopifyProductId: s.shopifyProductId, title: s.title, handle: s.handle, vendor: s.vendor,
    imageUrl: s.imageUrl, price: s.priceMin, currency: s.currency, score: s.score,
  }));
  return { items: pageItems, recommendations };
}

export async function removeWishlistItem(
  storeId: string, customerId: string, productId: string, variantId?: string,
): Promise<{ removed: boolean }> {
  const match = await findCustomerWishlist(storeId, customerId);
  if (!match) return { removed: false };
  await db.delete(schema.wishlistItems).where(and(
    eq(schema.wishlistItems.wishlistId, match.wishlistId),
    eq(schema.wishlistItems.shopifyProductId, productId),
    variantId
      ? eq(schema.wishlistItems.shopifyVariantId, variantId)
      : isNull(schema.wishlistItems.shopifyVariantId),
  ));
  await db.insert(schema.wishlistEvents).values({
    storeId, wishlistId: match.wishlistId, eventType: 'remove',
    payload: { productId, variantId, source: 'account_page' } as never,
  });
  return { removed: true };
}
```

- [ ] **Step 2: Implement `app/api/customer-account/wishlist/route.ts`** (GET — pattern journey route: OPTIONS preflight, 403 khi token thiếu customer):

```ts
/** GET /api/customer-account/wishlist — items đã lưu + recommendations. Bearer session token. */
import { type NextRequest } from 'next/server';
import { authenticateExtension, caJson, preflight } from '../_shared';
import { getWishlistPage } from '@/features/customer-account/wishlist-page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function GET(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  const data = await getWishlistPage(auth.store.id, auth.customerId);
  return caJson(data);
}
```

- [ ] **Step 3: Implement `app/api/customer-account/wishlist/remove/route.ts`** (POST):

```ts
/** POST /api/customer-account/wishlist/remove — xóa item khỏi wishlist khách. Bearer session token. */
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateExtension, caJson, preflight } from '../../_shared';
import { removeWishlistItem } from '@/features/customer-account/wishlist-page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  shopifyProductId: z.string().min(1).max(255),
  shopifyVariantId: z.string().min(1).max(255).optional(),
});

export async function OPTIONS(): Promise<Response> { return preflight(); }
export async function POST(req: NextRequest): Promise<Response> {
  const auth = await authenticateExtension(req);
  if (auth instanceof Response) return auth;
  if (!auth.customerId) return caJson({ error: 'no customer in token' }, 403);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return caJson({ error: 'invalid body' }, 400);
  const res = await removeWishlistItem(
    auth.store.id, auth.customerId, parsed.data.shopifyProductId, parsed.data.shopifyVariantId,
  );
  return caJson(res);
}
```

- [ ] **Step 4: Thêm auth test** vào `features/customer-account/routes-data-auth.test.ts`. Thêm import + 2 case (wishlist GET vào mảng `cases`; remove POST một block riêng vì là POST):

```ts
// thêm import đầu file:
import { GET as wishlistGET, OPTIONS as wishlistOPTIONS } from '@/app/api/customer-account/wishlist/route';
import { POST as wishlistRemovePOST, OPTIONS as wishlistRemoveOPTIONS } from '@/app/api/customer-account/wishlist/remove/route';

// thêm vào mảng `cases`:
  { name: 'wishlist', OPTIONS: wishlistOPTIONS, GET: () => wishlistGET(req('wishlist')), noAuth: () => wishlistGET(req('wishlist')) },

// thêm block mới cuối file:
describe('wishlist remove route auth', () => {
  it('OPTIONS → 204 + CORS', async () => {
    const r = await wishlistRemoveOPTIONS();
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe(CORS);
  });
  it('thiếu bearer → 401 + CORS', async () => {
    const r = await wishlistRemovePOST(req('wishlist/remove', { method: 'POST' }));
    expect(r.status).toBe(401);
    expect(r.headers.get('access-control-allow-origin')).toBe(CORS);
  });
});
```

- [ ] **Step 5: Verify** — `npx vitest run features/customer-account` + `npx tsc --noEmit` xanh.
- [ ] **Step 6: Commit** — `git add features/customer-account/wishlist-page.ts app/api/customer-account/wishlist features/customer-account/routes-data-auth.test.ts && git commit -m "feat(wishlist-page): API GET wishlist (+recommendations) + POST remove + auth test"`

---

### Task 6: Extension `customer-account-wishlist`

**Files (trong `shopify-extension/`):**
- Create: `extensions/customer-account-wishlist/shopify.extension.toml`
- Create: `extensions/customer-account-wishlist/src/lib/api.ts`
- Create: `extensions/customer-account-wishlist/src/lib/wishlist-vm.ts` + `wishlist-vm.test.ts`
- Create: `extensions/customer-account-wishlist/src/Page.tsx`

**Interfaces:**
- `api.ts`: `getConfig()`, `getWishlist()`, `postRemove(productId, variantId?)` — dùng `smsFetch` + `DEFAULT_BACKEND_URL` như hub. Types khớp JSON Task 5.
- `wishlist-vm.ts` (THUẦN): `fmtMoney(amount, currency)`, `productUrl(shopDomain, handle)`, `soldOutBadge(available)`.

- [ ] **Step 1: `shopify.extension.toml`** (extension RIÊNG, full-page):

```toml
api_version = "2026-04"

# Full-page extension RIÊNG (Shopify: full-page target không được ở chung extension
# với target khác). Menu account có mục "Wishlist" cạnh "Customer Account Hub".

[[extensions]]
type = "ui_extension"
name = "Customer Account Wishlist"
handle = "customer-account-wishlist"
uid = "customer-account-wishlist"
description = "MEAN customer account wishlist page: saved products + similar recommendations."

  [[extensions.targeting]]
  target = "customer-account.page.render"
  module = "./src/Page.tsx"

  [extensions.capabilities]
  network_access = true

  [extensions.settings]
    [[extensions.settings.fields]]
    key = "backend_url"
    type = "single_line_text_field"
    name = "SMS backend URL"
    description = "Base URL của SMS (vd https://shopify-management-system-production.up.railway.app)."
```

- [ ] **Step 2: `src/lib/api.ts`:**

```ts
declare const shopify: { sessionToken: { get(): Promise<string> }; settings: { backend_url?: string } };

const DEFAULT_BACKEND_URL = 'https://shopify-management-system-production.up.railway.app';

async function smsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = (shopify.settings.backend_url ?? '').trim() || DEFAULT_BACKEND_URL;
  const token = await shopify.sessionToken.get();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`SMS ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export type ModuleKey = 'tracking' | 'wishlist';
export interface ConfigModule { key: ModuleKey; title: string | null; iconUrl: string | null; }
export interface AccountConfig {
  enabled: boolean;
  branding: { logoUrl: string | null; heroUrl: string | null; supportEmail: string | null; announcement: string | null };
  modules: ConfigModule[];
}

export interface WishlistItem {
  shopifyProductId: string; variantId: string | null;
  productTitle: string; variantTitle: string | null; productHandle: string;
  imageUrl: string | null; price: string | null; currency: string | null;
  availableForSale: boolean | null; addedAt: string;
}
export interface WishlistRec {
  shopifyProductId: string; title: string; handle: string; vendor: string | null;
  imageUrl: string | null; price: string | null; currency: string | null; score: number;
}
export interface WishlistData { items: WishlistItem[]; recommendations: WishlistRec[]; }

export const getConfig = () => smsFetch<AccountConfig>('/api/customer-account/config');
export const getWishlist = () => smsFetch<WishlistData>('/api/customer-account/wishlist');
export const postRemove = (shopifyProductId: string, shopifyVariantId?: string) =>
  smsFetch<{ removed: boolean }>('/api/customer-account/wishlist/remove', {
    method: 'POST',
    body: JSON.stringify(shopifyVariantId ? { shopifyProductId, shopifyVariantId } : { shopifyProductId }),
  });
```

- [ ] **Step 3: Viết `src/lib/wishlist-vm.test.ts` → fail:**

```ts
import { describe, it, expect } from 'vitest';
import { fmtMoney, productUrl, soldOutBadge } from './wishlist-vm';

describe('fmtMoney', () => {
  it('USD → $x.xx', () => { expect(fmtMoney('263.98', 'USD')).toBe('$263.98'); });
  it('null amount → chuỗi rỗng', () => { expect(fmtMoney(null, 'USD')).toBe(''); });
  it('currency khác → "amount CUR"', () => { expect(fmtMoney('100.00', 'AED')).toBe('100.00 AED'); });
  it('currency null → chỉ amount', () => { expect(fmtMoney('100.00', null)).toBe('100.00'); });
});

describe('productUrl', () => {
  it('build storefront URL', () => {
    expect(productUrl('cici-mean.myshopify.com', 'red-dress')).toBe('https://cici-mean.myshopify.com/products/red-dress');
  });
});

describe('soldOutBadge', () => {
  it('false → Sold out', () => { expect(soldOutBadge(false)).toBe('Sold out'); });
  it('true → null', () => { expect(soldOutBadge(true)).toBeNull(); });
  it('null (unknown) → null', () => { expect(soldOutBadge(null)).toBeNull(); });
});
```

- [ ] **Step 4: Implement `src/lib/wishlist-vm.ts` → pass** (`cd shopify-extension && npm test`):

```ts
/** THUẦN: view helpers cho Wishlist Page extension. */
export function fmtMoney(amount: string | null, currency: string | null): string {
  if (amount === null) return '';
  if (currency === 'USD') return `$${amount}`;
  return currency ? `${amount} ${currency}` : amount;
}

export function productUrl(shopDomain: string, handle: string): string {
  return `https://${shopDomain}/products/${handle}`;
}

export function soldOutBadge(availableForSale: boolean | null): string | null {
  return availableForSale === false ? 'Sold out' : null;
}
```

- [ ] **Step 5: Implement `src/Page.tsx`** (English copy; grid card ảnh object-fit contain; Remove confirm inline; "You may also like"; empty state; error → `s-banner tone="critical"`; gate module wishlist qua `getConfig`). `shopDomain` cho `productUrl`: lấy từ `shopify` global — dùng `shopify.storefrontUrl`/`shop.myshopifyDomain` nếu có; fallback lấy host từ `location`. Để đơn giản và không phụ thuộc API chưa chắc: dùng `<s-link href>` mở tab mới bằng chính `productHandle` tương đối `/products/${handle}` (customer account chạy trên cùng storefront domain), tránh cần shopDomain:

```tsx
import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getConfig, getWishlist, postRemove, type WishlistData, type WishlistItem, type WishlistRec } from './lib/api';
import { fmtMoney, soldOutBadge } from './lib/wishlist-vm';

function Wishlist() {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getConfig>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getConfig()
      .then((c) => { if (active) setConfig(c); })
      .catch((e) => { if (active) setError(String(e?.message ?? e)); });
    return () => { active = false; };
  }, []);

  if (error) return <s-banner tone="critical"><s-text>{error}</s-text></s-banner>;
  if (!config) return <s-spinner accessibilityLabel="Loading your wishlist" />;
  if (!config.enabled) {
    return <s-section heading="Wishlist"><s-text tone="subdued">Wishlist is not enabled for this store.</s-text></s-section>;
  }
  if (!config.modules.some((m) => m.key === 'wishlist')) {
    return <s-section heading="Wishlist"><s-text tone="subdued">Wishlist is not enabled for this store.</s-text></s-section>;
  }

  return (
    <s-stack direction="block" gap="large-100">
      <s-heading>Wishlist</s-heading>
      {config.branding.announcement ? <s-banner><s-text>{config.branding.announcement}</s-text></s-banner> : null}
      <WishlistBody />
    </s-stack>
  );
}

function WishlistBody() {
  const [data, setData] = useState<WishlistData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => getWishlist().then(setData);
  const reload = () => { setData(null); load().catch((e) => setError(String((e as Error)?.message ?? e))); };
  useEffect(() => {
    let active = true;
    load().catch((e) => { if (active) setError(String(e?.message ?? e)); });
    return () => { active = false; };
  }, []);

  if (error) return <s-banner tone="critical"><s-text>We couldn't load your wishlist right now.</s-text></s-banner>;
  if (!data) return <s-spinner accessibilityLabel="Loading your wishlist" />;

  if (data.items.length === 0) {
    return (
      <s-section heading="Your wishlist is empty">
        <s-text tone="subdued">Tap the heart on any product to save it here.</s-text>
      </s-section>
    );
  }

  return (
    <s-stack direction="block" gap="large">
      <s-section heading="Saved products">
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          {data.items.map((it) => (
            <SavedCard key={`${it.shopifyProductId}:${it.variantId ?? ''}`} item={it} onRemoved={reload} />
          ))}
        </s-grid>
      </s-section>

      {data.recommendations.length > 0 ? (
        <s-section heading="You may also like">
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            {data.recommendations.map((r) => <RecCard key={r.shopifyProductId} rec={r} />)}
          </s-grid>
        </s-section>
      ) : null}
    </s-stack>
  );
}

function SavedCard({ item, onRemoved }: { item: WishlistItem; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badge = soldOutBadge(item.availableForSale);

  const remove = async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await postRemove(item.shopifyProductId, item.variantId ?? undefined);
      if (!res.removed) throw new Error('Could not remove item.');
      onRemoved();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setRemoving(false);
    }
  };

  return (
    <s-stack direction="block" gap="small-500">
      {item.imageUrl ? (
        <s-image src={item.imageUrl} alt={item.productTitle} objectFit="contain" />
      ) : null}
      <s-text type="strong">{item.productTitle}</s-text>
      {item.variantTitle ? <s-text tone="subdued">{item.variantTitle}</s-text> : null}
      {item.price ? <s-text>{fmtMoney(item.price, item.currency)}</s-text> : null}
      {badge ? <s-badge tone="critical">{badge}</s-badge> : null}
      {error ? <s-text tone="critical">{error}</s-text> : null}
      <s-stack direction="inline" gap="small-500">
        <s-link href={`shopify://storefront/products/${item.productHandle}`} target="_blank">View product</s-link>
      </s-stack>
      {!confirming ? (
        <s-button tone="critical" onClick={() => setConfirming(true)}>Remove</s-button>
      ) : (
        <s-stack direction="inline" gap="small-500">
          <s-button tone="critical" disabled={removing} onClick={remove}>{removing ? 'Removing…' : 'Confirm'}</s-button>
          <s-button disabled={removing} onClick={() => setConfirming(false)}>Keep</s-button>
        </s-stack>
      )}
    </s-stack>
  );
}

function RecCard({ rec }: { rec: WishlistRec }) {
  return (
    <s-stack direction="block" gap="small-500">
      {rec.imageUrl ? <s-image src={rec.imageUrl} alt={rec.title} objectFit="contain" /> : null}
      <s-text type="strong">{rec.title}</s-text>
      {rec.vendor ? <s-text tone="subdued">{rec.vendor}</s-text> : null}
      {rec.price ? <s-text>{fmtMoney(rec.price, rec.currency)}</s-text> : null}
      <s-link href={`shopify://storefront/products/${rec.handle}`} target="_blank">View product</s-link>
    </s-stack>
  );
}

export default async () => {
  render(<Wishlist />, document.body);
};
```

Ghi chú prop ảnh: `s-image` dùng prop `objectFit="contain"` (KHÔNG phải `fit` — đã verify trong `@shopify/ui-extensions` customer-account `ImageElementProps`); thỏa yêu cầu spec §7 "ảnh object-fit contain không crop".

Ghi chú `View product` link: dùng handle tương đối qua `s-link` (customer account render trên storefront domain; nếu `shopify://storefront/products/...` không resolve trong sandbox target này khi implement → đổi sang `/products/${handle}` tương đối, KHÔNG cần shopDomain). Verify khi chạy thử extension ở Task 7; chốt dạng href lúc đó (một trong hai — KHÔNG để cả hai).

- [ ] **Step 6: Verify** — `cd shopify-extension && npm run typecheck && npm test` xanh (test bắt file mới qua `include` sẵn có).
- [ ] **Step 7: Commit** — `git add shopify-extension/extensions/customer-account-wishlist && git commit -m "feat(wishlist-page): extension customer-account-wishlist (grid saved products + recommendations + remove)"`

---

### Task 7: Build + deploy + verify end-to-end

- [ ] **Step 1: Gates root** — `npm run build` (next build THẬT) → EXIT 0; `npx tsc --noEmit` + `npx vitest run` xanh. Nếu build fail vì client-import-db → sửa (route/domain không được import bởi client) rồi build lại.
- [ ] **Step 2: Gates extension** — `cd shopify-extension && npm run typecheck && npm test` xanh.
- [ ] **Step 3: Push** — `git push` (Railway auto-deploy) → `railway deployment list` đến khi SUCCESS.
- [ ] **Step 4: Migrate prod** — `railway run npm run db:migrate` (áp 0093 lên prod). Verify: `railway run node -e "..."` hoặc psql `\d shopify_products` tồn tại.
- [ ] **Step 5: Chạy sync catalog cho cici-mean trên prod** — `railway run npm run cron:sync-products -- --store cici-mean.myshopify.com` (hoặc gọi cron route: `curl -H "Authorization: Bearer $CRON_SECRET" https://<railway-url>/api/cron/sync-products`). Verify `shopify_products` có rows cho store cici-mean.
- [ ] **Step 6: Smoke test API prod bằng token ký tay** (pattern session 2026-07-05: `railway run node -e` ký JWT HS256 bằng `SHOPIFY_API_SECRET`/`CUSTOMER_ACCOUNT_APP_SECRETS`, `dest=cici-mean.myshopify.com`, `sub=gid://shopify/Customer/5812012056758`, `aud`=client id, `exp` tương lai): `GET /api/customer-account/wishlist` → 200 có `{ items, recommendations }`; nếu khách có wishlist thật → items > 0; `POST /api/customer-account/wishlist/remove` với 1 productId thật → `{ removed: true }`.
- [ ] **Step 7: Deploy extension** — `cd shopify-extension && shopify app deploy --allow-updates --message "wishlist page extension"` (cần CEO nếu CLI đòi đăng nhập lại) → version mới released.
- [ ] **Step 8: Verify trên cici-mean** (CEO hoặc chụp màn hình): menu account có mục **"Wishlist"** riêng cạnh "Customer Account Hub"; mở → grid saved products (ảnh contain, giá, badge Sold out nếu có), nút Remove hoạt động, khối "You may also like" hiện recommendations; wishlist rỗng → "Your wishlist is empty".
- [ ] **Step 9: Docs + Second Brain** — cập nhật `docs/customer-account-deploy.md` (mục Wishlist Page: cần chạy `cron:sync-products` + đăng ký cron daily); append Second Brain `Activity Log.md`; thêm `Decisions.md` (nền catalog `shopify_products` + recommendation rule-based tái dùng cho C; identity resolve cache TTL 7d + degrade). Chỉ zone `Shared/`.
- [ ] **Step 10: Commit docs** — `git add docs/customer-account-deploy.md && git commit -m "docs(wishlist-page): deploy notes + cron sync-products"`

---

## Self-review đã chạy

- **Spec coverage:** §1 mục tiêu → T6 (extension) + T8 verify. §2 tận dụng (`wishlists`/`wishlistItems` snapshot, `wishlistEvents`, MODULE_KEYS đã có 'wishlist') → T5 (dùng wishlistItems snapshot trực tiếp, ghi wishlistEvents remove). §3 catalog `shopify_products` + sync + cron daily + migration 0093 → T2+T3. §4 identity resolve (email/customerId union, cache `customer_identities` TTL 7d, degrade khi thiếu read_customers) → T2+T4. §5 recommendation engine thuần (score vendor+2/type+2/tag+1, loại seed/!available/status/điểm 0, top 8, tie-break syncedAt) → T1, seed từ join shopify_products → T5. §6 API GET wishlist (recommendations [] khi không có seed) + POST remove → T5. §7 extension riêng `customer-account-wishlist`, English, grid contain, Sold out, Remove confirm, You may also like, empty state, gate module → T6. §8 testing (recommend đủ nhánh, identity thuần selectWishlistMatch, route auth OPTIONS 204 + 401) → T1/T4/T5; gates root+extension → T7. §9 out-of-scope tôn trọng: KHÔNG AI/embedding, KHÔNG popular fallback (recommendations [] khi rỗng), KHÔNG add-to-wishlist từ account page, cron daily (không real-time), KHÔNG primary domain lookup.
- **Type consistency giữa các task:** `CatalogProduct`/`SeedSignals`/`scoreProducts` (T1) dùng ở T5 (`toCatalogProduct` + seed). `shopifyProducts`/`customerIdentities` schema (T2) dùng ở T3/T4/T5. `selectWishlistMatch`/`findCustomerWishlist` (T4) dùng ở T5. `WishlistPageData`/`WishlistPageItem`/`WishlistPageRec` (T5) khớp `WishlistData`/`WishlistItem`/`WishlistRec` JSON ở extension api.ts (T6). `syncStoreProducts` (T3 export named) dùng ở cron route T3 + prod sync T7.
- **Placeholder scan:** sạch — mọi task có code thật + lệnh verify + commit message cụ thể; không "TBD"/"tương tự task N"/"thêm validation phù hợp".
- **Điểm cần verify khi implement (đã đưa step riêng):** T3 Step 1 introspection field GraphQL `products` trước khi viết mapper (`availableForSale` suy từ variants; `priceRangeV2.minVariantPrice`); T6 Step 5 chốt dạng href `View product` (shopify:// vs relative) khi chạy thử extension.
- **Lệch spec:** không có lệch quyết định. Hai tinh chỉnh implementation (không đổi quyết định spec): (1) `View product` dùng handle qua `s-link` (relative/`shopify://`) thay vì ghép `https://{shopDomain}/...` để tránh phụ thuộc shopDomain trong sandbox — vẫn thỏa "link mở tab mới tới product", chốt dạng cụ thể ở T6/T7. (2) npm script đặt tên `cron:sync-products` (không `cron:sync-catalog` vì tên đó đã bị `scripts/import-shopify-catalog.ts` chiếm) — không ảnh hưởng spec.
```
