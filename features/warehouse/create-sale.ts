/**
 * Auto tạo product "-Sale" MEAN BLVD trên store meanblvd.myshopify.com cho hàng
 * warehouse return-stock mà bản gốc của brand ĐÃ archived (brand ngừng bán).
 * GHI vào store production.
 *
 * Toàn bộ quyết định thuần ở `create-sale-logic.ts`; module này chỉ lo I/O:
 * load store + token, resolve active location, đọc tồn warehouse, đọc Lark
 * WH-Inventory eligibility, query Shopify dedup/bản gốc, rồi productSet +
 * inventorySetQuantities + publishablePublish theo nhóm bản gốc.
 *
 * Lỗi từng nhóm được gom vào `errors` và KHÔNG abort toàn bộ run.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { larkText } from '@/features/lark/parse-pack-row';
import { isCustomizeSku, normSku } from './meanblvd-sync-logic';
import {
  buildProductSetInput,
  larkRowEligible,
  shouldCreateSale,
  type OrigProduct,
  type OrigVariant,
} from './create-sale-logic';

const SHOP_DOMAIN = 'meanblvd.myshopify.com';
const VENDOR = 'MEAN BLVD';
const RATE_LIMIT_SLEEP_MS = 500;

// Lark WH-Inventory (cùng base LARK_BASE_APP_TOKEN với logistics).
const LARK_WH_TABLE_ID = process.env.LARK_WH_TABLE_ID ?? 'tblfnOiEwzcXmemM';
const LARK_WH_VIEW_ID = process.env.LARK_WH_VIEW_ID ?? 'vewFAl8NQG';

export interface Summary {
  warehouseSkus: number;
  eligible: number;
  created: number;
  skippedByReason: Record<string, number>;
  errors: string[];
  dryRun: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertNoGraphqlErrors(res: { errors?: unknown }, context: string): void {
  if (res.errors && (!Array.isArray(res.errors) || res.errors.length > 0)) {
    throw new Error(`${context}: GraphQL errors ${JSON.stringify(res.errors)}`);
  }
}

// ---- Shopify shapes -------------------------------------------------------

interface LocationsResponse {
  locations?: { nodes?: Array<{ id: string; name: string; isActive: boolean; shipsInventory: boolean }> };
}

interface PublicationsResponse {
  publications?: { nodes?: Array<{ id: string; name: string }> };
}

interface VariantNode {
  sku: string | null;
  price: string | null;
  selectedOptions?: Array<{ name: string; value: string }>;
  product?: {
    id: string;
    title: string;
    vendor: string | null;
    status: string;
    productType: string | null;
    tags?: string[];
    descriptionHtml: string | null;
    options?: Array<{ name: string }>;
    media?: { nodes?: Array<{ image?: { url: string } | null }> };
  } | null;
}

interface ProductVariantsResponse {
  productVariants?: { nodes?: VariantNode[] };
}

interface ProductSetResponse {
  productSet?: {
    product?: { id: string; handle: string; variants?: { nodes?: Array<{ sku: string | null; inventoryItem?: { id: string } | null }> } } | null;
    userErrors?: Array<{ field?: string[] | null; message: string }>;
  };
}

// ---- GraphQL documents ----------------------------------------------------

const LOCATIONS_QUERY = /* GraphQL */ `
  { locations(first: 10) { nodes { id name isActive shipsInventory } } }
`;

const PUBLICATIONS_QUERY = /* GraphQL */ `
  { publications(first: 10) { nodes { id name } } }
`;

const VARIANTS_QUERY = /* GraphQL */ `
  query VariantsBySku($q: String!) {
    productVariants(first: 30, query: $q) {
      nodes {
        sku
        price
        selectedOptions { name value }
        product {
          id
          title
          vendor
          status
          productType
          tags
          descriptionHtml
          options { name }
          media(first: 20) { nodes { ... on MediaImage { image { url } } } }
        }
      }
    }
  }
`;

const PRODUCT_SET_MUTATION = /* GraphQL */ `
  mutation CreateSale($input: ProductSetInput!) {
    productSet(synchronous: true, input: $input) {
      product { id handle variants(first: 50) { nodes { sku inventoryItem { id } } } }
      userErrors { field message }
    }
  }
`;

const INVENTORY_MUTATION = /* GraphQL */ `
  mutation SetOnHand($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) { userErrors { field message } }
  }
`;

const PUBLISH_MUTATION = /* GraphQL */ `
  mutation Publish($id: ID!, $pid: ID!) {
    publishablePublish(id: $id, input: { publicationId: $pid }) {
      userErrors { message }
    }
  }
`;

// ---- Lark eligibility -----------------------------------------------------

async function getLarkTenantToken(): Promise<string> {
  const domain = process.env.LARK_DOMAIN || 'https://open.larksuite.com';
  const res = await fetch(`${domain}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: process.env.LARK_APP_ID, app_secret: process.env.LARK_APP_SECRET }),
  });
  const j = (await res.json()) as { code: number; msg: string; tenant_access_token?: string };
  if (j.code !== 0 || !j.tenant_access_token) {
    throw new Error(`[lark] token fail: code=${j.code} msg=${j.msg}`);
  }
  return j.tenant_access_token;
}

/**
 * Trả set các normSku có ĐỦ điều kiện tái bán theo Lark WH-Inventory (Tồn kho /
 * QC Pass / Lưu kho). Key theo `Lineitem SKU final`, chuẩn hoá qua normSku.
 */
async function fetchLarkEligibleSkus(): Promise<Set<string>> {
  const domain = process.env.LARK_DOMAIN || 'https://open.larksuite.com';
  const appToken = process.env.LARK_BASE_APP_TOKEN;
  if (!appToken) throw new Error('[lark] thiếu env LARK_BASE_APP_TOKEN');
  const token = await getLarkTenantToken();
  const eligible = new Set<string>();
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `${domain}/open-apis/bitable/v1/apps/${appToken}/tables/${LARK_WH_TABLE_ID}/records/search`,
    );
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ view_id: LARK_WH_VIEW_ID, page_size: 500 }),
    });
    const j = (await res.json()) as {
      code: number;
      msg: string;
      data?: { items?: Array<{ fields: Record<string, unknown> }>; page_token?: string; has_more?: boolean };
    };
    if (j.code !== 0) throw new Error(`[lark] WH search fail: code=${j.code} msg=${j.msg}`);

    for (const item of j.data?.items ?? []) {
      const f = item.fields;
      const sku = larkText(f['Lineitem SKU final']);
      if (!sku) continue;
      const row = {
        inventoryType: larkText(f['Import - Inventory type']) ?? '',
        qcCheck: larkText(f['QC Check']) ?? '',
        whAction: larkText(f['WH - Action']) ?? '',
      };
      if (larkRowEligible(row)) eligible.add(normSku(sku));
    }
    pageToken = j.data?.has_more ? j.data?.page_token : undefined;
  } while (pageToken);

  return eligible;
}

// ---- Shopify helpers ------------------------------------------------------

interface Ctx {
  apiVersion: string;
  token: string;
}

async function queryVariantsBySku(ctx: Ctx, sku: string): Promise<VariantNode[]> {
  const res = await graphqlCall({
    shopDomain: SHOP_DOMAIN,
    apiVersion: ctx.apiVersion,
    token: ctx.token,
    query: VARIANTS_QUERY,
    variables: { q: `sku:'${sku}'` },
  });
  assertNoGraphqlErrors(res, `productVariants sku:${sku}`);
  return (res.data as ProductVariantsResponse | undefined)?.productVariants?.nodes ?? [];
}

function toOrigProduct(p: NonNullable<VariantNode['product']>): OrigProduct {
  return {
    title: p.title,
    descriptionHtml: p.descriptionHtml ?? '',
    productType: p.productType ?? '',
    tags: p.tags ?? [],
    optionNames: (p.options ?? []).map((o) => o.name),
    imageUrls: (p.media?.nodes ?? [])
      .map((n) => n.image?.url)
      .filter((u): u is string => typeof u === 'string' && u.length > 0),
  };
}

async function resolveActiveLocation(ctx: Ctx): Promise<string> {
  const res = await graphqlCall({
    shopDomain: SHOP_DOMAIN,
    apiVersion: ctx.apiVersion,
    token: ctx.token,
    query: LOCATIONS_QUERY,
  });
  assertNoGraphqlErrors(res, 'locations');
  const nodes = (res.data as LocationsResponse | undefined)?.locations?.nodes ?? [];
  const active = nodes.find((n) => n.isActive && n.shipsInventory);
  if (!active) throw new Error('No active location with shipsInventory=true on meanblvd store');
  return active.id;
}

async function resolveOnlineStorePublication(ctx: Ctx): Promise<string> {
  const res = await graphqlCall({
    shopDomain: SHOP_DOMAIN,
    apiVersion: ctx.apiVersion,
    token: ctx.token,
    query: PUBLICATIONS_QUERY,
  });
  assertNoGraphqlErrors(res, 'publications');
  const nodes = (res.data as PublicationsResponse | undefined)?.publications?.nodes ?? [];
  const online = nodes.find((n) => /online store/i.test(n.name));
  if (!online) throw new Error('No "Online Store" publication on meanblvd store');
  return online.id;
}

async function loadWarehouseSellable(): Promise<Array<{ sku: string; sellable: number }>> {
  const result = await db.execute<{ sku: string; s: number }>(sql`
    SELECT sku, sum(qty_on_hand - qty_reserved)::int AS s
    FROM warehouse_inventory
    WHERE sku IS NOT NULL
    GROUP BY sku
    HAVING sum(qty_on_hand - qty_reserved) > 0
  `);
  return result.rows.map((r) => ({ sku: r.sku, sellable: r.s }));
}

// ---- Candidate evaluation -------------------------------------------------

interface EligibleVariant {
  origProductId: string;
  orig: OrigProduct;
  variant: OrigVariant;
  sellable: number;
}

/** Đánh giá 1 SKU warehouse: query Shopify, tính shouldCreateSale. */
async function evaluateSku(
  ctx: Ctx,
  wh: { sku: string; sellable: number },
  larkEligibleSkus: Set<string>,
): Promise<{ ok: true; item: EligibleVariant } | { ok: false; reason: string }> {
  const base = normSku(wh.sku);
  const isCustomize = isCustomizeSku(wh.sku);

  // Query bản gốc (base) + bất kỳ product nào có SKU = base+'-Sale'.
  const baseNodes = await queryVariantsBySku(ctx, base);
  await sleep(RATE_LIMIT_SLEEP_MS);
  const saleNodes = await queryVariantsBySku(ctx, `${base}-Sale`);

  const hasMeanBlvdProduct = baseNodes.some((n) => n.product?.vendor === VENDOR);
  const hasSaleProduct = saleNodes.some((n) => (n.sku ?? '') === `${base}-Sale`);

  // Bản gốc = variant có sku==base thuộc product KHÔNG phải MEAN BLVD.
  const originalNode = baseNodes.find(
    (n) => (n.sku ?? '') === base && n.product != null && n.product.vendor !== VENDOR,
  );
  const originalStatus =
    (originalNode?.product?.status as 'ACTIVE' | 'ARCHIVED' | 'DRAFT' | undefined) ?? null;

  const larkEligible = larkEligibleSkus.has(base);

  const decision = shouldCreateSale({
    isCustomize,
    hasMeanBlvdProduct,
    hasSaleProduct,
    originalStatus,
    larkEligible,
    sellable: wh.sellable,
  });
  if (!decision.ok) return { ok: false, reason: decision.reason };

  const p = originalNode!.product!;
  return {
    ok: true,
    item: {
      origProductId: p.id,
      orig: toOrigProduct(p),
      variant: {
        sku: originalNode!.sku ?? base,
        price: originalNode!.price ?? '0',
        selectedOptions: originalNode!.selectedOptions ?? [],
      },
      sellable: wh.sellable,
    },
  };
}

// ---- Orchestrator ---------------------------------------------------------

export async function createSaleProducts(
  opts?: { dryRun?: boolean; limit?: number },
): Promise<Summary> {
  const dryRun = opts?.dryRun ?? false;
  const limit = opts?.limit ?? Infinity;

  // 1) Store + token.
  const [store] = await db
    .select()
    .from(schema.stores)
    .where(eq(schema.stores.shopDomain, SHOP_DOMAIN))
    .limit(1);
  if (!store) throw new Error(`Store not found: ${SHOP_DOMAIN}`);
  const token = await getStoreToken(store.id);
  const ctx: Ctx = { apiVersion: store.apiVersion, token };

  // 2) Active location.
  const locationId = await resolveActiveLocation(ctx);

  // 3) Warehouse in-stock + 4) Lark eligibility.
  const warehouse = await loadWarehouseSellable();
  const larkEligibleSkus = await fetchLarkEligibleSkus();

  const skippedByReason: Record<string, number> = {};
  const errors: string[] = [];
  const eligibleItems: EligibleVariant[] = [];

  // 5) Đánh giá từng SKU.
  for (const wh of warehouse) {
    try {
      const r = await evaluateSku(ctx, wh, larkEligibleSkus);
      if (r.ok) eligibleItems.push(r.item);
      else skippedByReason[r.reason] = (skippedByReason[r.reason] ?? 0) + 1;
    } catch (e) {
      errors.push(`evaluate ${wh.sku}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(RATE_LIMIT_SLEEP_MS);
  }

  // 6) Gom theo bản gốc (1 product có thể có nhiều size còn tồn).
  const groups = new Map<string, EligibleVariant[]>();
  for (const item of eligibleItems) {
    const list = groups.get(item.origProductId);
    if (list) list.push(item);
    else groups.set(item.origProductId, [item]);
  }

  const summary: Summary = {
    warehouseSkus: warehouse.length,
    eligible: eligibleItems.length,
    created: 0,
    skippedByReason,
    errors,
    dryRun,
  };

  if (dryRun) return summary;

  // 7) Publication (chỉ cần khi thật sự ghi).
  const publicationId = await resolveOnlineStorePublication(ctx);

  let created = 0;
  for (const items of groups.values()) {
    if (created >= limit) break;
    const first = items[0];
    try {
      // Final re-check dedup: query lại base+'-Sale' và MEAN BLVD.
      const base = normSku(first.variant.sku);
      const recheck = await queryVariantsBySku(ctx, `${base}-Sale`);
      if (recheck.some((n) => (n.sku ?? '') === `${base}-Sale` || n.product?.vendor === VENDOR)) {
        skippedByReason['sale-product-exists-recheck'] =
          (skippedByReason['sale-product-exists-recheck'] ?? 0) + 1;
        await sleep(RATE_LIMIT_SLEEP_MS);
        continue;
      }

      const input = buildProductSetInput(
        first.orig,
        items.map((it) => it.variant),
      );
      const setRes = await graphqlCall({
        shopDomain: SHOP_DOMAIN,
        apiVersion: ctx.apiVersion,
        token: ctx.token,
        query: PRODUCT_SET_MUTATION,
        variables: { input },
      });
      assertNoGraphqlErrors(setRes, `productSet ${first.origProductId}`);
      const setData = (setRes.data as ProductSetResponse | undefined)?.productSet;
      for (const ue of setData?.userErrors ?? []) {
        errors.push(`productSet ${first.origProductId}: ${ue.field?.join('.') ?? ''} ${ue.message}`.trim());
      }
      const product = setData?.product;
      if (!product) {
        // userErrors đã ghi ở trên; bỏ qua nhóm này.
        await sleep(RATE_LIMIT_SLEEP_MS);
        continue;
      }

      // Map SKU -Sale → inventoryItemId → set on-hand = sellable của size đó.
      const invBySku = new Map<string, string>();
      for (const n of product.variants?.nodes ?? []) {
        if (n.sku && n.inventoryItem?.id) invBySku.set(n.sku, n.inventoryItem.id);
      }
      const quantities = items
        .map((it) => {
          const inventoryItemId = invBySku.get(`${normSku(it.variant.sku)}-Sale`);
          return inventoryItemId
            ? { inventoryItemId, locationId, quantity: it.sellable }
            : null;
        })
        .filter((q): q is { inventoryItemId: string; locationId: string; quantity: number } => q != null);

      if (quantities.length > 0) {
        const invRes = await graphqlCall({
          shopDomain: SHOP_DOMAIN,
          apiVersion: ctx.apiVersion,
          token: ctx.token,
          query: INVENTORY_MUTATION,
          variables: {
            input: { name: 'on_hand', reason: 'correction', ignoreCompareQuantity: true, quantities },
          },
        });
        assertNoGraphqlErrors(invRes, `inventorySet ${product.id}`);
        const invErrs =
          (invRes.data as { inventorySetQuantities?: { userErrors?: Array<{ field?: string[] | null; message: string }> } } | undefined)
            ?.inventorySetQuantities?.userErrors ?? [];
        for (const ue of invErrs) {
          errors.push(`inventorySet ${product.id}: ${ue.field?.join('.') ?? ''} ${ue.message}`.trim());
        }
      }

      // Publish lên Online Store.
      const pubRes = await graphqlCall({
        shopDomain: SHOP_DOMAIN,
        apiVersion: ctx.apiVersion,
        token: ctx.token,
        query: PUBLISH_MUTATION,
        variables: { id: product.id, pid: publicationId },
      });
      assertNoGraphqlErrors(pubRes, `publish ${product.id}`);
      const pubErrs =
        (pubRes.data as { publishablePublish?: { userErrors?: Array<{ message: string }> } } | undefined)
          ?.publishablePublish?.userErrors ?? [];
      for (const ue of pubErrs) errors.push(`publish ${product.id}: ${ue.message}`);

      created += 1;
    } catch (e) {
      errors.push(`create ${first.origProductId}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(RATE_LIMIT_SLEEP_MS);
  }

  return { ...summary, created, errors };
}
