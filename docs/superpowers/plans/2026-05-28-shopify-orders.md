# Shopify Orders Ingestion + Revenue Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull every Shopify order across every connected store for the trailing 12 months, ingest cost-of-goods + shipping-invoice CSVs, and surface a per-store dashboard with real Revenue (not just GMV) metrics.

**Architecture:** Three parallel sync channels (manual backfill via Shopify `bulkOperation`, real-time webhooks, hourly safety-net cron) all write through one idempotent `upsertOrder()` function into 7 new Postgres tables. CSV uploads layer cost-of-goods (time-versioned) and carrier-invoice actuals on top of the raw order data. A per-store dashboard route computes metrics via SQL aggregation, using the existing `features/carrier-rates/engine/quote()` for live shipping-cost estimates.

**Tech Stack:** Next.js App Router · TypeScript · Drizzle ORM + Postgres · Better-Auth · `@shopify/shopify-api` (existing connector) · Vitest + Playwright · Railway (one new cron service).

**Spec reference:** `docs/superpowers/specs/2026-05-28-shopify-orders-design.md`

---

## File Structure

### New module: `features/shopify-orders/`

```
features/shopify-orders/
├── sync/
│   ├── shopify-mapper.ts            # Pure: Shopify payload → internal shape
│   ├── shopify-mapper.test.ts
│   ├── upsert-order.ts              # DB upsert (transaction)
│   └── upsert-order.test.ts
├── backfill/
│   ├── submit-bulk-query.ts         # Submits bulkOperationRunQuery
│   ├── poll-bulk-operation.ts       # Polls currentBulkOperation
│   ├── stream-jsonl.ts              # Streams + parses Shopify JSONL output
│   └── run-backfill.ts              # Orchestrates the four steps for one store
├── webhook/
│   ├── verify-hmac.ts               # Pure: HMAC SHA256 verification
│   ├── verify-hmac.test.ts
│   └── dispatch.ts                  # Maps topic → handler
├── cron/
│   └── hourly-sync.ts               # Walks every store, polls Shopify orders by updated_at
├── csv-upload/
│   ├── parse-sku-costs.ts           # Pure
│   ├── parse-sku-costs.test.ts
│   ├── parse-shipping-invoice.ts    # Pure
│   ├── parse-shipping-invoice.test.ts
│   ├── apply-sku-costs.ts           # Server actions (DB writes)
│   └── apply-shipping-invoice.ts    # Server actions (DB writes)
├── metrics/
│   ├── compute.ts                   # Pure: per-order OrderMetrics
│   ├── compute.test.ts
│   ├── aggregate.ts                 # Pure: AggregateMetrics
│   └── aggregate.test.ts
├── dashboard-actions.ts             # Server actions for the dashboard
├── shopify-types.ts                 # Shared type aliases for Shopify payload shapes
└── __fixtures__/
    ├── order-simple.json
    ├── order-refunded.json
    ├── order-multi-line.json
    ├── order-discount.json
    └── order-no-tracking.json
```

### New routes

```
app/api/webhooks/shopify/[topic]/route.ts
app/(dashboard)/f/orders/page.tsx
app/(dashboard)/f/orders/[storeId]/page.tsx
app/(dashboard)/f/orders/[storeId]/costs/page.tsx
app/(dashboard)/f/orders/[storeId]/shipping-invoices/page.tsx
app/(dashboard)/admin/shopify-sync-health/page.tsx
```

### New scripts

```
scripts/cron/backfill-shopify-orders.ts     # Manual: pnpm cron:backfill-orders --store=<id>
scripts/cron/sync-shopify-orders.ts         # Railway-cron entry: pnpm cron:sync-orders
```

### Modified files

```
db/schema.ts                                 # Add 7 tables (1 migration)
lib/auth/rbac.ts                             # Add 3 permissions, route to existing roles
lib/nav.ts                                   # Add "Orders" entry
app/api/auth/shopify/callback/route.ts       # Auto-register webhook subscriptions on connect
package.json                                 # Add probe + cron scripts
README.md                                    # Document new cron service + scope upgrade
```

### Railway

A new cron service `orders-cron` reusing the same repo + Postgres DATABASE_URL reference. Start command: `npm run cron:sync-orders`. Schedule: `5 * * * *`.

---

## Phase 1 — Foundation

### Task 1: Add the 7 Shopify-orders tables to the schema

**Files:**
- Modify: `db/schema.ts`
- Create: `db/migrations/0010_<name>.sql` (drizzle-kit generates)
- Test: deferred to Task 3 (`upsert-order.test.ts` exercises the schema)

- [ ] **Step 1: Add the table definitions at the end of `db/schema.ts`**

Append after the existing tables:

```ts
// ──────────────────────────────────────────────────────────────────────────
// Shopify orders (spec: docs/superpowers/specs/2026-05-28-shopify-orders-design.md)
// ──────────────────────────────────────────────────────────────────────────

export const shopifyOrders = pgTable('shopify_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  shopifyOrderId: text('shopify_order_id').notNull().unique(),
  shopifyOrderNumber: text('shopify_order_number').notNull(),
  createdAtShopify: timestamp('created_at_shopify').notNull(),
  processedAtShopify: timestamp('processed_at_shopify').notNull(),
  cancelledAtShopify: timestamp('cancelled_at_shopify'),
  financialStatus: text('financial_status').notNull(),
  fulfillmentStatus: text('fulfillment_status'),
  currency: text('currency').notNull(),
  // grossLineTotal = Σ(originalUnitPrice × qty), pre-any-discount; this is GMV.
  grossLineTotal: numeric('gross_line_total', { precision: 14, scale: 2 }).notNull(),
  // totalDiscount maps Shopify's totalDiscountsSet — covers line + order discounts combined.
  totalDiscount: numeric('total_discount', { precision: 14, scale: 2 }).notNull(),
  totalShipping: numeric('total_shipping', { precision: 14, scale: 2 }).notNull(),
  totalTax: numeric('total_tax', { precision: 14, scale: 2 }).notNull(),
  totalPrice: numeric('total_price', { precision: 14, scale: 2 }).notNull(),
  shipCountry: text('ship_country'),
  shipWeightKg: numeric('ship_weight_kg', { precision: 10, scale: 3 }),
  rawPayload: jsonb('raw_payload').notNull(),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
  source: text('source').notNull(),
}, (t) => [
  index('shopify_orders_store_processed_idx').on(t.storeId, t.processedAtShopify),
  index('shopify_orders_cancelled_idx').on(t.cancelledAtShopify),
]);

export const shopifyOrderLines = pgTable('shopify_order_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull(),
  shopifyLineId: text('shopify_line_id').notNull(),
  sku: text('sku'),
  vendor: text('vendor'),
  productTitle: text('product_title').notNull(),
  variantTitle: text('variant_title'),
  quantity: integer('quantity').notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
  discountAlloc: numeric('discount_alloc', { precision: 14, scale: 2 }).notNull(),
  total: numeric('total', { precision: 14, scale: 2 }).notNull(),
}, (t) => [
  index('shopify_order_lines_order_idx').on(t.orderId),
  index('shopify_order_lines_sku_idx').on(t.sku),
  index('shopify_order_lines_vendor_idx').on(t.vendor),
]);

export const shopifyOrderRefunds = pgTable('shopify_order_refunds', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull(),
  shopifyRefundId: text('shopify_refund_id').notNull().unique(),
  refundedAt: timestamp('refunded_at').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  reason: text('reason'),
}, (t) => [
  index('shopify_order_refunds_order_idx').on(t.orderId),
  index('shopify_order_refunds_refunded_at_idx').on(t.refundedAt),
]);

export const skuCosts = pgTable('sku_costs', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  sku: text('sku').notNull(),
  costPerUnit: numeric('cost_per_unit', { precision: 14, scale: 4 }).notNull(),
  currency: text('currency').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  source: text('source').notNull(),
  uploadedBy: text('uploaded_by').references(() => user.id),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('sku_costs_store_sku_from_idx').on(t.storeId, t.sku, t.effectiveFrom),
  index('sku_costs_lookup_idx').on(t.storeId, t.sku, t.effectiveFrom),
]);

export const shippingInvoices = pgTable('shipping_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id).notNull(),
  trackingNumber: text('tracking_number').notNull(),
  invoicePeriodStart: date('invoice_period_start').notNull(),
  invoicePeriodEnd: date('invoice_period_end').notNull(),
  actualCost: numeric('actual_cost', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  source: text('source').notNull(),
}, (t) => [
  uniqueIndex('shipping_invoices_store_tracking_idx').on(t.storeId, t.trackingNumber),
  index('shipping_invoices_carrier_period_idx').on(t.carrierAccountId, t.invoicePeriodStart),
]);

export const shopifySyncState = pgTable('shopify_sync_state', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull().unique(),
  backfillStatus: text('backfill_status').notNull().default('idle'),
  backfillCursor: text('backfill_cursor'),
  backfillStartedAt: timestamp('backfill_started_at'),
  backfillFinishedAt: timestamp('backfill_finished_at'),
  backfillError: text('backfill_error'),
  lastWebhookAt: timestamp('last_webhook_at'),
  lastCronSyncAt: timestamp('last_cron_sync_at'),
  lastCronCursor: text('last_cron_cursor'),
});

export const shopifyWebhookLog = pgTable('shopify_webhook_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  topic: text('topic').notNull(),
  shopifyWebhookId: text('shopify_webhook_id').notNull().unique(),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
  status: text('status').notNull(),
  error: text('error'),
  payloadHash: text('payload_hash').notNull(),
}, (t) => [
  index('shopify_webhook_log_store_received_idx').on(t.storeId, t.receivedAt),
]);
```

Make sure the existing imports already cover `pgTable`, `uuid`, `text`, `numeric`, `timestamp`, `boolean`, `jsonb`, `index`, `uniqueIndex`. Add `integer` and `date` if missing:

```ts
import { pgTable, uuid, text, numeric, timestamp, boolean, jsonb, integer, date, index, uniqueIndex } from 'drizzle-orm/pg-core';
```

- [ ] **Step 2: Generate the migration**

```bash
pnpm run db:generate
```

Expected: a new file under `db/migrations/0010_<two-word-name>.sql`. Open it and verify it `CREATE TABLE`s all 7 tables with the correct columns and constraints.

- [ ] **Step 3: Apply the migration locally**

```bash
pnpm run db:migrate
```

Expected: `migrations applied successfully!`

- [ ] **Step 4: Verify with a sanity query**

```bash
DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-) psql "$DATABASE_URL" -c "\dt shopify_*"
```

Expected: lists `shopify_orders`, `shopify_order_lines`, `shopify_order_refunds`, `shopify_sync_state`, `shopify_webhook_log`. Plus `sku_costs` and `shipping_invoices`.

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations/0010_*.sql db/migrations/meta/
git commit -m "feat(orders): schema for shopify orders + cost + invoice tables"
```

---

### Task 2: Shared Shopify-payload types

**Files:**
- Create: `features/shopify-orders/shopify-types.ts`

This file holds **only** the input/output types for the mapper — no logic. Centralized so the mapper, webhook handler, backfill stream parser, and tests all reference the same shape.

- [ ] **Step 1: Create `features/shopify-orders/shopify-types.ts`**

```ts
/**
 * Shape of a single order in the Shopify GraphQL Admin API "orders" query
 * result, narrowed to the fields we persist. Used by:
 *   - webhook handlers (orders/create, orders/updated, orders/cancelled)
 *   - bulkOperation JSONL stream parser
 *   - hourly safety-net cron paginator
 *
 * We deliberately keep this in a single file so all three call sites agree
 * on shape. A change here ripples to every test fixture and mapper test.
 */

export interface ShopifyMoney {
  amount: string;          // Shopify returns money as decimal strings
  currencyCode: string;
}

export interface ShopifyMoneyBag {
  shopMoney: ShopifyMoney;
}

export interface ShopifyLineItem {
  id: string;                                   // gid://shopify/LineItem/...
  sku: string | null;
  vendor: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  originalUnitPriceSet: ShopifyMoneyBag;        // per-unit price BEFORE any discount
  discountAllocations: Array<{
    allocatedAmountSet: ShopifyMoneyBag;
  }>;
}

export interface ShopifyRefund {
  id: string;
  createdAt: string;                            // ISO-8601
  totalRefundedSet: ShopifyMoneyBag;
  note: string | null;
}

export interface ShopifyFulfillment {
  trackingInfo: Array<{
    number: string | null;
    company: string | null;
  }>;
}

export interface ShopifyOrderPayload {
  id: string;                                   // gid://shopify/Order/...
  name: string;                                 // e.g. "#1234"
  createdAt: string;
  processedAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string;               // 'PAID' | 'PARTIALLY_REFUNDED' | ...
  displayFulfillmentStatus: string | null;
  currencyCode: string;
  subtotalLineItemsQuantity: number;
  // Pre-discount line total — what we map to grossLineTotal.
  // Shopify exposes this as `currentTotalPriceSet` minus discounts in some
  // versions; we compute it from line items in the mapper to be sure.
  totalDiscountsSet: ShopifyMoneyBag;
  totalShippingPriceSet: ShopifyMoneyBag;
  totalTaxSet: ShopifyMoneyBag;
  totalPriceSet: ShopifyMoneyBag;
  shippingAddress: {
    countryCodeV2: string;
  } | null;
  totalWeight: number | null;                   // in grams
  lineItems: { nodes: ShopifyLineItem[] };
  refunds: ShopifyRefund[];
  fulfillments: ShopifyFulfillment[];
}
```

- [ ] **Step 2: Commit**

```bash
git add features/shopify-orders/shopify-types.ts
git commit -m "feat(orders): shared types for Shopify order payloads"
```

---

### Task 3: Shopify-payload → internal shape mapper

**Files:**
- Create: `features/shopify-orders/sync/shopify-mapper.ts`
- Create: `features/shopify-orders/sync/shopify-mapper.test.ts`
- Create: `features/shopify-orders/__fixtures__/order-simple.json`
- Create: `features/shopify-orders/__fixtures__/order-refunded.json`
- Create: `features/shopify-orders/__fixtures__/order-multi-line.json`

- [ ] **Step 1: Create three Shopify fixture files**

`features/shopify-orders/__fixtures__/order-simple.json` (single line, paid, no refunds):

```json
{
  "id": "gid://shopify/Order/5000000001",
  "name": "#1001",
  "createdAt": "2026-05-01T08:00:00Z",
  "processedAt": "2026-05-01T08:00:30Z",
  "cancelledAt": null,
  "displayFinancialStatus": "PAID",
  "displayFulfillmentStatus": "FULFILLED",
  "currencyCode": "USD",
  "subtotalLineItemsQuantity": 1,
  "totalDiscountsSet": { "shopMoney": { "amount": "0.00", "currencyCode": "USD" } },
  "totalShippingPriceSet": { "shopMoney": { "amount": "12.00", "currencyCode": "USD" } },
  "totalTaxSet": { "shopMoney": { "amount": "0.00", "currencyCode": "USD" } },
  "totalPriceSet": { "shopMoney": { "amount": "62.00", "currencyCode": "USD" } },
  "shippingAddress": { "countryCodeV2": "US" },
  "totalWeight": 800,
  "lineItems": {
    "nodes": [
      {
        "id": "gid://shopify/LineItem/9000000001",
        "sku": "MEAN-SHIRT-001",
        "vendor": "MEAN Studio",
        "title": "Logo Tee",
        "variantTitle": "M",
        "quantity": 1,
        "originalUnitPriceSet": { "shopMoney": { "amount": "50.00", "currencyCode": "USD" } },
        "discountAllocations": []
      }
    ]
  },
  "refunds": [],
  "fulfillments": [{ "trackingInfo": [{ "number": "TRK-001", "company": "FedEx" }] }]
}
```

`features/shopify-orders/__fixtures__/order-refunded.json` (single line, refunded):

```json
{
  "id": "gid://shopify/Order/5000000002",
  "name": "#1002",
  "createdAt": "2026-05-02T09:00:00Z",
  "processedAt": "2026-05-02T09:00:30Z",
  "cancelledAt": null,
  "displayFinancialStatus": "REFUNDED",
  "displayFulfillmentStatus": "FULFILLED",
  "currencyCode": "USD",
  "subtotalLineItemsQuantity": 1,
  "totalDiscountsSet": { "shopMoney": { "amount": "0.00", "currencyCode": "USD" } },
  "totalShippingPriceSet": { "shopMoney": { "amount": "8.00", "currencyCode": "USD" } },
  "totalTaxSet": { "shopMoney": { "amount": "0.00", "currencyCode": "USD" } },
  "totalPriceSet": { "shopMoney": { "amount": "38.00", "currencyCode": "USD" } },
  "shippingAddress": { "countryCodeV2": "US" },
  "totalWeight": 500,
  "lineItems": {
    "nodes": [
      {
        "id": "gid://shopify/LineItem/9000000002",
        "sku": "MEAN-MUG-A",
        "vendor": "MEAN Studio",
        "title": "Logo Mug",
        "variantTitle": null,
        "quantity": 1,
        "originalUnitPriceSet": { "shopMoney": { "amount": "30.00", "currencyCode": "USD" } },
        "discountAllocations": []
      }
    ]
  },
  "refunds": [
    {
      "id": "gid://shopify/Refund/4000000001",
      "createdAt": "2026-05-03T10:00:00Z",
      "totalRefundedSet": { "shopMoney": { "amount": "38.00", "currencyCode": "USD" } },
      "note": "customer returned"
    }
  ],
  "fulfillments": [{ "trackingInfo": [{ "number": "TRK-002", "company": "FedEx" }] }]
}
```

`features/shopify-orders/__fixtures__/order-multi-line.json` (two lines, one with allocated discount):

```json
{
  "id": "gid://shopify/Order/5000000003",
  "name": "#1003",
  "createdAt": "2026-05-04T11:00:00Z",
  "processedAt": "2026-05-04T11:00:30Z",
  "cancelledAt": null,
  "displayFinancialStatus": "PAID",
  "displayFulfillmentStatus": "FULFILLED",
  "currencyCode": "USD",
  "subtotalLineItemsQuantity": 3,
  "totalDiscountsSet": { "shopMoney": { "amount": "10.00", "currencyCode": "USD" } },
  "totalShippingPriceSet": { "shopMoney": { "amount": "15.00", "currencyCode": "USD" } },
  "totalTaxSet": { "shopMoney": { "amount": "0.00", "currencyCode": "USD" } },
  "totalPriceSet": { "shopMoney": { "amount": "105.00", "currencyCode": "USD" } },
  "shippingAddress": { "countryCodeV2": "VN" },
  "totalWeight": 1200,
  "lineItems": {
    "nodes": [
      {
        "id": "gid://shopify/LineItem/9000000003",
        "sku": "MEAN-SHIRT-001",
        "vendor": "MEAN Studio",
        "title": "Logo Tee",
        "variantTitle": "M",
        "quantity": 2,
        "originalUnitPriceSet": { "shopMoney": { "amount": "50.00", "currencyCode": "USD" } },
        "discountAllocations": [
          { "allocatedAmountSet": { "shopMoney": { "amount": "10.00", "currencyCode": "USD" } } }
        ]
      },
      {
        "id": "gid://shopify/LineItem/9000000004",
        "sku": "OTHER-VENDOR-B",
        "vendor": "Other Brand",
        "title": "Sticker Pack",
        "variantTitle": null,
        "quantity": 1,
        "originalUnitPriceSet": { "shopMoney": { "amount": "10.00", "currencyCode": "USD" } },
        "discountAllocations": []
      }
    ]
  },
  "refunds": [],
  "fulfillments": [{ "trackingInfo": [{ "number": "TRK-003", "company": "DHL" }] }]
}
```

- [ ] **Step 2: Create the mapper test file**

`features/shopify-orders/sync/shopify-mapper.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapShopifyOrder } from './shopify-mapper';
import type { ShopifyOrderPayload } from '../shopify-types';

function fixture(name: string): ShopifyOrderPayload {
  const raw = readFileSync(join(__dirname, '..', '__fixtures__', `${name}.json`), 'utf8');
  return JSON.parse(raw) as ShopifyOrderPayload;
}

describe('mapShopifyOrder', () => {
  it('extracts the simple-order fields', () => {
    const m = mapShopifyOrder(fixture('order-simple'), 'store-1');
    expect(m.order.storeId).toBe('store-1');
    expect(m.order.shopifyOrderId).toBe('gid://shopify/Order/5000000001');
    expect(m.order.shopifyOrderNumber).toBe('#1001');
    expect(m.order.currency).toBe('USD');
    expect(m.order.grossLineTotal).toBe('50.00');
    expect(m.order.totalDiscount).toBe('0.00');
    expect(m.order.totalShipping).toBe('12.00');
    expect(m.order.totalPrice).toBe('62.00');
    expect(m.order.shipCountry).toBe('US');
    expect(m.order.shipWeightKg).toBe('0.800');
    expect(m.order.cancelledAtShopify).toBeNull();
    expect(m.lines).toHaveLength(1);
    expect(m.lines[0].sku).toBe('MEAN-SHIRT-001');
    expect(m.lines[0].vendor).toBe('MEAN Studio');
    expect(m.lines[0].unitPrice).toBe('50.00');
    expect(m.lines[0].total).toBe('50.00');
    expect(m.refunds).toHaveLength(0);
    expect(m.trackingNumbers).toEqual(['TRK-001']);
  });

  it('captures refunds with amount + reason', () => {
    const m = mapShopifyOrder(fixture('order-refunded'), 'store-1');
    expect(m.refunds).toHaveLength(1);
    expect(m.refunds[0].shopifyRefundId).toBe('gid://shopify/Refund/4000000001');
    expect(m.refunds[0].amount).toBe('38.00');
    expect(m.refunds[0].reason).toBe('customer returned');
  });

  it('computes per-line totals as (unit_price × qty) − discount_alloc', () => {
    const m = mapShopifyOrder(fixture('order-multi-line'), 'store-1');
    expect(m.lines).toHaveLength(2);
    // Line 1: 50 × 2 − 10 = 90.00
    expect(m.lines[0].quantity).toBe(2);
    expect(m.lines[0].unitPrice).toBe('50.00');
    expect(m.lines[0].discountAlloc).toBe('10.00');
    expect(m.lines[0].total).toBe('90.00');
    // Line 2: 10 × 1 − 0 = 10.00
    expect(m.lines[1].total).toBe('10.00');
    // grossLineTotal = Σ(unit_price × qty) = 100, total_discount comes from order header
    expect(m.order.grossLineTotal).toBe('100.00');
    expect(m.order.totalDiscount).toBe('10.00');
  });

  it('converts totalWeight grams to kg with 3 decimals', () => {
    const m = mapShopifyOrder(fixture('order-multi-line'), 'store-1');
    expect(m.order.shipWeightKg).toBe('1.200');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm test --run features/shopify-orders/sync/shopify-mapper.test.ts
```

Expected: FAIL with `Cannot find module './shopify-mapper'`.

- [ ] **Step 4: Implement the mapper**

`features/shopify-orders/sync/shopify-mapper.ts`:

```ts
import type {
  ShopifyOrderPayload,
  ShopifyLineItem,
  ShopifyRefund,
  ShopifyFulfillment,
} from '../shopify-types';

/** Internal shape ready for the upsert function. Numbers are strings to match
 *  Drizzle's numeric column representation; no float precision loss. */
export interface MappedOrder {
  order: {
    storeId: string;
    shopifyOrderId: string;
    shopifyOrderNumber: string;
    createdAtShopify: Date;
    processedAtShopify: Date;
    cancelledAtShopify: Date | null;
    financialStatus: string;
    fulfillmentStatus: string | null;
    currency: string;
    grossLineTotal: string;
    totalDiscount: string;
    totalShipping: string;
    totalTax: string;
    totalPrice: string;
    shipCountry: string | null;
    shipWeightKg: string | null;
  };
  lines: Array<{
    shopifyLineId: string;
    sku: string | null;
    vendor: string | null;
    productTitle: string;
    variantTitle: string | null;
    quantity: number;
    unitPrice: string;
    discountAlloc: string;
    total: string;
  }>;
  refunds: Array<{
    shopifyRefundId: string;
    refundedAt: Date;
    amount: string;
    reason: string | null;
  }>;
  trackingNumbers: string[];
}

export function mapShopifyOrder(payload: ShopifyOrderPayload, storeId: string): MappedOrder {
  const lines = payload.lineItems.nodes.map((node) => mapLine(node));
  const grossLineTotal = lines
    .reduce((sum, l) => sum + Number(l.unitPrice) * l.quantity, 0)
    .toFixed(2);

  return {
    order: {
      storeId,
      shopifyOrderId: payload.id,
      shopifyOrderNumber: payload.name,
      createdAtShopify: new Date(payload.createdAt),
      processedAtShopify: new Date(payload.processedAt),
      cancelledAtShopify: payload.cancelledAt ? new Date(payload.cancelledAt) : null,
      financialStatus: payload.displayFinancialStatus,
      fulfillmentStatus: payload.displayFulfillmentStatus,
      currency: payload.currencyCode,
      grossLineTotal,
      totalDiscount: payload.totalDiscountsSet.shopMoney.amount,
      totalShipping: payload.totalShippingPriceSet.shopMoney.amount,
      totalTax: payload.totalTaxSet.shopMoney.amount,
      totalPrice: payload.totalPriceSet.shopMoney.amount,
      shipCountry: payload.shippingAddress?.countryCodeV2 ?? null,
      shipWeightKg: payload.totalWeight !== null ? (payload.totalWeight / 1000).toFixed(3) : null,
    },
    lines,
    refunds: payload.refunds.map((r) => mapRefund(r)),
    trackingNumbers: extractTrackingNumbers(payload.fulfillments),
  };
}

function mapLine(node: ShopifyLineItem): MappedOrder['lines'][number] {
  const discountAlloc = node.discountAllocations
    .reduce((sum, d) => sum + Number(d.allocatedAmountSet.shopMoney.amount), 0)
    .toFixed(2);
  const unitPrice = node.originalUnitPriceSet.shopMoney.amount;
  const total = (Number(unitPrice) * node.quantity - Number(discountAlloc)).toFixed(2);
  return {
    shopifyLineId: node.id,
    sku: node.sku,
    vendor: node.vendor,
    productTitle: node.title,
    variantTitle: node.variantTitle,
    quantity: node.quantity,
    unitPrice,
    discountAlloc,
    total,
  };
}

function mapRefund(r: ShopifyRefund): MappedOrder['refunds'][number] {
  return {
    shopifyRefundId: r.id,
    refundedAt: new Date(r.createdAt),
    amount: r.totalRefundedSet.shopMoney.amount,
    reason: r.note,
  };
}

function extractTrackingNumbers(fulfillments: ShopifyFulfillment[]): string[] {
  return fulfillments
    .flatMap((f) => f.trackingInfo)
    .map((t) => t.number)
    .filter((n): n is string => Boolean(n));
}
```

- [ ] **Step 5: Run the test, expect PASS**

```bash
pnpm test --run features/shopify-orders/sync/shopify-mapper.test.ts
```

Expected: 4 tests passing.

- [ ] **Step 6: Commit**

```bash
git add features/shopify-orders/sync/shopify-mapper.ts \
        features/shopify-orders/sync/shopify-mapper.test.ts \
        features/shopify-orders/__fixtures__/
git commit -m "feat(orders): Shopify payload → internal shape mapper (4 unit tests)"
```

---

### Task 4: Idempotent `upsertOrder()`

**Files:**
- Create: `features/shopify-orders/sync/upsert-order.ts`
- Create: `features/shopify-orders/sync/upsert-order.test.ts`

- [ ] **Step 1: Write the test (integration — exercises real DB)**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, schema } from '@/db/client';
import { mapShopifyOrder } from './shopify-mapper';
import { upsertOrder } from './upsert-order';
import type { ShopifyOrderPayload } from '../shopify-types';

function fixture(name: string): ShopifyOrderPayload {
  return JSON.parse(
    readFileSync(join(__dirname, '..', '__fixtures__', `${name}.json`), 'utf8'),
  );
}

async function seedStore(): Promise<string> {
  const [s] = await db
    .insert(schema.stores)
    .values({
      name: 'Test Store',
      shopDomain: `test-${Math.random().toString(36).slice(2)}.myshopify.com`,
      encryptedToken: 'test',
      scopes: ['read_orders'],
      apiVersion: '2025-01',
    })
    .returning({ id: schema.stores.id });
  return s!.id;
}

describe('upsertOrder', () => {
  beforeEach(async () => {
    await db.delete(schema.shopifyOrderRefunds);
    await db.delete(schema.shopifyOrderLines);
    await db.delete(schema.shopifyOrders);
  });

  it('inserts a new order with lines, refunds, and raw_payload', async () => {
    const storeId = await seedStore();
    const payload = fixture('order-multi-line');
    await upsertOrder(storeId, payload, 'webhook');

    const [row] = await db
      .select()
      .from(schema.shopifyOrders)
      .where(eq(schema.shopifyOrders.shopifyOrderId, payload.id));
    expect(row).toBeDefined();
    expect(row.grossLineTotal).toBe('100.00');
    expect(row.source).toBe('webhook');
    expect((row.rawPayload as { id: string }).id).toBe(payload.id);

    const lines = await db
      .select()
      .from(schema.shopifyOrderLines)
      .where(eq(schema.shopifyOrderLines.orderId, row.id));
    expect(lines).toHaveLength(2);
  });

  it('re-running with the same payload is idempotent (no duplicates)', async () => {
    const storeId = await seedStore();
    const payload = fixture('order-refunded');
    await upsertOrder(storeId, payload, 'webhook');
    await upsertOrder(storeId, payload, 'cron');

    const orders = await db
      .select()
      .from(schema.shopifyOrders)
      .where(eq(schema.shopifyOrders.shopifyOrderId, payload.id));
    expect(orders).toHaveLength(1);
    expect(orders[0].source).toBe('cron'); // last write wins

    const refunds = await db
      .select()
      .from(schema.shopifyOrderRefunds)
      .where(eq(schema.shopifyOrderRefunds.orderId, orders[0].id));
    expect(refunds).toHaveLength(1);
  });

  it('replaces lines on re-upsert (Shopify can renumber lines on edit)', async () => {
    const storeId = await seedStore();
    const payload = fixture('order-multi-line');
    await upsertOrder(storeId, payload, 'webhook');

    // Simulate Shopify dropping one line on edit.
    const trimmed = {
      ...payload,
      lineItems: { nodes: [payload.lineItems.nodes[0]] },
    };
    await upsertOrder(storeId, trimmed, 'cron');

    const [order] = await db
      .select()
      .from(schema.shopifyOrders)
      .where(eq(schema.shopifyOrders.shopifyOrderId, payload.id));
    const lines = await db
      .select()
      .from(schema.shopifyOrderLines)
      .where(eq(schema.shopifyOrderLines.orderId, order.id));
    expect(lines).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test --run features/shopify-orders/sync/upsert-order.test.ts
```

Expected: FAIL with `Cannot find module './upsert-order'`.

- [ ] **Step 3: Implement `upsertOrder()`**

`features/shopify-orders/sync/upsert-order.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { mapShopifyOrder } from './shopify-mapper';
import type { ShopifyOrderPayload } from '../shopify-types';

export type UpsertSource = 'webhook' | 'cron' | 'backfill';

/**
 * Idempotently upsert a Shopify order, its lines, and its refunds in a single
 * transaction. Safe to call from any of the three sync channels — last write
 * wins on the order row, lines are DELETE+INSERT-replaced (Shopify renumbers
 * line ids on edits), and refunds dedup by shopify_refund_id.
 */
export async function upsertOrder(
  storeId: string,
  payload: ShopifyOrderPayload,
  source: UpsertSource,
): Promise<void> {
  const mapped = mapShopifyOrder(payload, storeId);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.shopifyOrders)
      .values({
        ...mapped.order,
        rawPayload: payload,
        source,
      })
      .onConflictDoUpdate({
        target: schema.shopifyOrders.shopifyOrderId,
        set: {
          ...mapped.order,
          rawPayload: payload,
          source,
          syncedAt: new Date(),
        },
      })
      .returning({ id: schema.shopifyOrders.id });

    await tx.delete(schema.shopifyOrderLines).where(eq(schema.shopifyOrderLines.orderId, row!.id));
    if (mapped.lines.length > 0) {
      await tx.insert(schema.shopifyOrderLines).values(
        mapped.lines.map((l) => ({ ...l, orderId: row!.id })),
      );
    }

    for (const refund of mapped.refunds) {
      await tx
        .insert(schema.shopifyOrderRefunds)
        .values({ ...refund, orderId: row!.id })
        .onConflictDoNothing({ target: schema.shopifyOrderRefunds.shopifyRefundId });
    }
  });
}
```

- [ ] **Step 4: Run the test, expect PASS**

```bash
pnpm test --run features/shopify-orders/sync/upsert-order.test.ts
```

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add features/shopify-orders/sync/upsert-order.ts \
        features/shopify-orders/sync/upsert-order.test.ts
git commit -m "feat(orders): idempotent upsertOrder() (3 integration tests)"
```

---

### Task 5: Pure revenue formulas — `compute.ts`

**Files:**
- Create: `features/shopify-orders/metrics/compute.ts`
- Create: `features/shopify-orders/metrics/compute.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { computeOrderMetrics } from './compute';
import type { ComputeInput } from './compute';

function input(overrides: Partial<ComputeInput> = {}): ComputeInput {
  return {
    orderId: 'o-1',
    currency: 'USD',
    grossLineTotal: 100,
    totalDiscount: 0,
    totalShipping: 10,
    totalTax: 0,
    totalRefunded: 0,
    shippingCost: { amount: 8, source: 'engine_estimate' },
    skuCosts: [
      { lineId: 'l-1', quantity: 1, costPerUnit: 30, costCurrency: 'USD' },
    ],
    ...overrides,
  };
}

describe('computeOrderMetrics', () => {
  it('computes baseline revenue with no discount, no refund, invoice ship cost', () => {
    const m = computeOrderMetrics(input({
      shippingCost: { amount: 8, source: 'invoice' },
    }));
    expect(m.gmv).toBe(100);
    expect(m.refundedAmount).toBe(0);
    expect(m.netGmv).toBe(100);
    expect(m.discount).toBe(0);
    expect(m.shippingRevenue).toBe(10);
    expect(m.shippingCost).toBe(8);
    expect(m.shippingCostSource).toBe('invoice');
    expect(m.skuCost).toBe(30);
    expect(m.skuCostCoverage).toBe(1);
    // revenue = netGmv − discount + shipRev − shipCost − skuCost
    // = 100 − 0 + 10 − 8 − 30 = 72
    expect(m.revenue).toBe(72);
    expect(m.margin).toBeCloseTo(0.72, 4);
  });

  it('subtracts discount + refunds from netGmv before revenue', () => {
    const m = computeOrderMetrics(input({
      totalDiscount: 20,
      totalRefunded: 30,
    }));
    // netGmv = 100 − 30 = 70
    // revenue = 70 − 20 + 10 − 8 − 30 = 22
    expect(m.netGmv).toBe(70);
    expect(m.revenue).toBe(22);
  });

  it('flags partial SKU cost coverage when a line has no cost row', () => {
    const m = computeOrderMetrics(input({
      skuCosts: [
        { lineId: 'l-1', quantity: 1, costPerUnit: 30, costCurrency: 'USD' },
        { lineId: 'l-2', quantity: 2, costPerUnit: null, costCurrency: null },
      ],
    }));
    expect(m.skuCost).toBe(30); // l-2 contributes 0
    expect(m.skuCostCoverage).toBe(0.5);
  });

  it('reports engine_estimate when no shipping invoice exists', () => {
    const m = computeOrderMetrics(input());
    expect(m.shippingCostSource).toBe('engine_estimate');
  });

  it('reports unknown ship source when both amount and source are absent', () => {
    const m = computeOrderMetrics(input({
      shippingCost: { amount: 0, source: 'unknown' },
    }));
    expect(m.shippingCost).toBe(0);
    expect(m.shippingCostSource).toBe('unknown');
  });

  it('returns 0 margin when netGmv is 0 (avoids div-by-zero)', () => {
    const m = computeOrderMetrics(input({
      grossLineTotal: 0,
      totalRefunded: 0,
      shippingCost: { amount: 0, source: 'invoice' },
      skuCosts: [],
    }));
    expect(m.netGmv).toBe(0);
    expect(m.margin).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm test --run features/shopify-orders/metrics/compute.test.ts
```

Expected: FAIL with `Cannot find module './compute'`.

- [ ] **Step 3: Implement `compute.ts`**

```ts
export type ShippingCostSource = 'invoice' | 'engine_estimate' | 'unknown';

export interface ComputeInput {
  orderId: string;
  currency: string;
  grossLineTotal: number;        // GMV — Σ(unit_price × qty), pre any discount
  totalDiscount: number;
  totalShipping: number;         // shipping revenue from customer
  totalTax: number;              // shown but not subtracted
  totalRefunded: number;         // sum of refund amounts in the window
  shippingCost: { amount: number; source: ShippingCostSource };
  skuCosts: Array<{
    lineId: string;
    quantity: number;
    costPerUnit: number | null;  // null when no cost row resolved
    costCurrency: string | null;
  }>;
}

export interface OrderMetrics {
  orderId: string;
  currency: string;
  gmv: number;
  refundedAmount: number;
  netGmv: number;
  discount: number;
  shippingRevenue: number;
  shippingCost: number;
  shippingCostSource: ShippingCostSource;
  skuCost: number;
  skuCostCoverage: number;       // 0–1, fraction of lines that resolved a cost
  tax: number;
  revenue: number;
  margin: number;                // revenue / netGmv when netGmv > 0, else 0
}

export function computeOrderMetrics(input: ComputeInput): OrderMetrics {
  const gmv = input.grossLineTotal;
  const refundedAmount = input.totalRefunded;
  const netGmv = gmv - refundedAmount;
  const skuCost = input.skuCosts.reduce(
    (sum, c) => sum + (c.costPerUnit ?? 0) * c.quantity,
    0,
  );
  const knownCostLines = input.skuCosts.filter((c) => c.costPerUnit !== null).length;
  const coverage = input.skuCosts.length === 0 ? 1 : knownCostLines / input.skuCosts.length;
  const revenue =
    netGmv - input.totalDiscount + input.totalShipping - input.shippingCost.amount - skuCost;
  const margin = netGmv > 0 ? revenue / netGmv : 0;

  return {
    orderId: input.orderId,
    currency: input.currency,
    gmv,
    refundedAmount,
    netGmv,
    discount: input.totalDiscount,
    shippingRevenue: input.totalShipping,
    shippingCost: input.shippingCost.amount,
    shippingCostSource: input.shippingCost.source,
    skuCost,
    skuCostCoverage: coverage,
    tax: input.totalTax,
    revenue,
    margin,
  };
}
```

- [ ] **Step 4: Run the test, expect PASS**

```bash
pnpm test --run features/shopify-orders/metrics/compute.test.ts
```

Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add features/shopify-orders/metrics/compute.ts \
        features/shopify-orders/metrics/compute.test.ts
git commit -m "feat(orders): pure per-order revenue formula (6 unit tests)"
```

---

### Task 6: Pure aggregation — `aggregate.ts`

**Files:**
- Create: `features/shopify-orders/metrics/aggregate.ts`
- Create: `features/shopify-orders/metrics/aggregate.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { aggregateMetrics } from './aggregate';
import type { OrderMetrics } from './compute';

const baseMetric = (overrides: Partial<OrderMetrics>): OrderMetrics => ({
  orderId: 'o',
  currency: 'USD',
  gmv: 100,
  refundedAmount: 0,
  netGmv: 100,
  discount: 0,
  shippingRevenue: 10,
  shippingCost: 8,
  shippingCostSource: 'invoice',
  skuCost: 30,
  skuCostCoverage: 1,
  tax: 0,
  revenue: 72,
  margin: 0.72,
  ...overrides,
});

describe('aggregateMetrics', () => {
  it('sums fields across orders', () => {
    const agg = aggregateMetrics([
      baseMetric({ orderId: 'o1' }),
      baseMetric({ orderId: 'o2', gmv: 200, netGmv: 200, revenue: 144 }),
    ]);
    expect(agg.orderCount).toBe(2);
    expect(agg.gmv).toBe(300);
    expect(agg.netGmv).toBe(300);
    expect(agg.revenue).toBe(216);
  });

  it('weighted-average margin = revenue / netGmv across the set', () => {
    const agg = aggregateMetrics([
      baseMetric({ revenue: 50, netGmv: 100 }),
      baseMetric({ revenue: 25, netGmv: 100 }),
    ]);
    // sum revenue / sum netGmv = 75 / 200 = 0.375
    expect(agg.margin).toBeCloseTo(0.375, 4);
  });

  it('treats an empty list as zero everything', () => {
    const agg = aggregateMetrics([]);
    expect(agg.orderCount).toBe(0);
    expect(agg.gmv).toBe(0);
    expect(agg.margin).toBe(0);
  });

  it('exposes the most-common currency (assumes single-currency window)', () => {
    const agg = aggregateMetrics([
      baseMetric({ currency: 'USD' }),
      baseMetric({ currency: 'USD' }),
      baseMetric({ currency: 'VND' }),
    ]);
    expect(agg.currency).toBe('USD');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm test --run features/shopify-orders/metrics/aggregate.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `aggregate.ts`**

```ts
import type { OrderMetrics } from './compute';

export interface AggregateMetrics {
  orderCount: number;
  currency: string;             // most common currency in the window; empty when set is empty
  gmv: number;
  refundedAmount: number;
  netGmv: number;
  discount: number;
  shippingRevenue: number;
  shippingCost: number;
  skuCost: number;
  tax: number;
  revenue: number;
  margin: number;               // weighted: sum(revenue) / sum(netGmv)
  skuCostCoverage: number;      // weighted by line count is overkill — average is fine
}

export function aggregateMetrics(orders: readonly OrderMetrics[]): AggregateMetrics {
  if (orders.length === 0) {
    return {
      orderCount: 0, currency: '',
      gmv: 0, refundedAmount: 0, netGmv: 0, discount: 0,
      shippingRevenue: 0, shippingCost: 0, skuCost: 0, tax: 0,
      revenue: 0, margin: 0, skuCostCoverage: 0,
    };
  }
  const sum = (k: keyof OrderMetrics) => orders.reduce((s, o) => s + (o[k] as number), 0);
  const gmv = sum('gmv');
  const netGmv = sum('netGmv');
  const revenue = sum('revenue');
  return {
    orderCount: orders.length,
    currency: pickMostCommon(orders.map((o) => o.currency)),
    gmv,
    refundedAmount: sum('refundedAmount'),
    netGmv,
    discount: sum('discount'),
    shippingRevenue: sum('shippingRevenue'),
    shippingCost: sum('shippingCost'),
    skuCost: sum('skuCost'),
    tax: sum('tax'),
    revenue,
    margin: netGmv > 0 ? revenue / netGmv : 0,
    skuCostCoverage: orders.reduce((s, o) => s + o.skuCostCoverage, 0) / orders.length,
  };
}

function pickMostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = ''; let max = 0;
  for (const [v, c] of counts) if (c > max) { best = v; max = c; }
  return best;
}
```

- [ ] **Step 4: Run the test, expect PASS**

```bash
pnpm test --run features/shopify-orders/metrics/aggregate.test.ts
```

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add features/shopify-orders/metrics/aggregate.ts \
        features/shopify-orders/metrics/aggregate.test.ts
git commit -m "feat(orders): pure metric aggregation (4 unit tests)"
```

---

### Task 7: RBAC permissions

**Files:**
- Modify: `lib/auth/rbac.ts`
- Modify: `lib/auth/rbac.test.ts`

- [ ] **Step 1: Extend the test**

Append to `lib/auth/rbac.test.ts`:

```ts
describe('orders permissions', () => {
  it('admin can do everything', () => {
    expect(hasPermission('admin', 'view_orders')).toBe(true);
    expect(hasPermission('admin', 'manage_sku_costs')).toBe(true);
    expect(hasPermission('admin', 'manage_shipping_invoices')).toBe(true);
  });
  it('operator can view + manage', () => {
    expect(hasPermission('operator', 'view_orders')).toBe(true);
    expect(hasPermission('operator', 'manage_sku_costs')).toBe(true);
    expect(hasPermission('operator', 'manage_shipping_invoices')).toBe(true);
  });
  it('viewer can only view orders', () => {
    expect(hasPermission('viewer', 'view_orders')).toBe(true);
    expect(hasPermission('viewer', 'manage_sku_costs')).toBe(false);
    expect(hasPermission('viewer', 'manage_shipping_invoices')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
pnpm test --run lib/auth/rbac.test.ts
```

Expected: FAIL on the 9 new assertions.

- [ ] **Step 3: Extend `lib/auth/rbac.ts`**

Add to the `Permission` union:

```ts
  | 'view_orders'
  | 'manage_sku_costs'
  | 'manage_shipping_invoices';
```

Add to each role's array:
- `admin`: all three permissions.
- `operator`: all three permissions.
- `viewer`: `'view_orders'` only.

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm test --run lib/auth/rbac.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/auth/rbac.ts lib/auth/rbac.test.ts
git commit -m "feat(orders): RBAC entries view_orders, manage_sku_costs, manage_shipping_invoices"
```

---

## Phase 2 — Data pipelines

### Task 8: Webhook HMAC verification

**Files:**
- Create: `features/shopify-orders/webhook/verify-hmac.ts`
- Create: `features/shopify-orders/webhook/verify-hmac.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyShopifyHmac } from './verify-hmac';

const secret = 'shhh';
function sign(body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

describe('verifyShopifyHmac', () => {
  it('returns true on valid signature', () => {
    const body = '{"id":1}';
    expect(verifyShopifyHmac(body, sign(body), secret)).toBe(true);
  });
  it('returns false on tampered body', () => {
    const body = '{"id":1}';
    const sig = sign(body);
    expect(verifyShopifyHmac('{"id":2}', sig, secret)).toBe(false);
  });
  it('returns false on wrong secret', () => {
    const body = '{"id":1}';
    expect(verifyShopifyHmac(body, sign(body), 'other')).toBe(false);
  });
  it('returns false when header is empty', () => {
    expect(verifyShopifyHmac('{}', '', secret)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test --run features/shopify-orders/webhook/verify-hmac.test.ts
```

- [ ] **Step 3: Implement**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyShopifyHmac(rawBody: string, headerSig: string, secret: string): boolean {
  if (!headerSig) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(headerSig, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**

```bash
git add features/shopify-orders/webhook/verify-hmac.ts features/shopify-orders/webhook/verify-hmac.test.ts
git commit -m "feat(orders): HMAC SHA256 verify for Shopify webhooks (4 unit tests)"
```

---

### Task 9: Webhook topic dispatcher

**Files:**
- Create: `features/shopify-orders/webhook/dispatch.ts`

- [ ] **Step 1: Implement**

```ts
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { upsertOrder } from '../sync/upsert-order';
import type { ShopifyOrderPayload, ShopifyRefund } from '../shopify-types';

export type ShopifyWebhookTopic =
  | 'orders/create'
  | 'orders/updated'
  | 'orders/cancelled'
  | 'refunds/create';

export const SUPPORTED_TOPICS: ShopifyWebhookTopic[] = [
  'orders/create', 'orders/updated', 'orders/cancelled', 'refunds/create',
];

/** URL path segment to topic mapping. We use kebab-case URLs so the path stays
 *  Shopify-friendly: /api/webhooks/shopify/orders-create. */
export function topicFromSlug(slug: string): ShopifyWebhookTopic | null {
  const map: Record<string, ShopifyWebhookTopic> = {
    'orders-create': 'orders/create',
    'orders-updated': 'orders/updated',
    'orders-cancelled': 'orders/cancelled',
    'refunds-create': 'refunds/create',
  };
  return map[slug] ?? null;
}

/** Inverse for subscription registration. */
export function slugFromTopic(topic: ShopifyWebhookTopic): string {
  return topic.replace('/', '-');
}

export async function dispatchWebhook(
  storeId: string,
  topic: ShopifyWebhookTopic,
  payload: unknown,
): Promise<void> {
  if (topic === 'orders/create' || topic === 'orders/updated') {
    await upsertOrder(storeId, payload as ShopifyOrderPayload, 'webhook');
    return;
  }
  if (topic === 'orders/cancelled') {
    const p = payload as ShopifyOrderPayload;
    await db
      .update(schema.shopifyOrders)
      .set({ cancelledAtShopify: new Date(p.cancelledAt ?? new Date().toISOString()) })
      .where(eq(schema.shopifyOrders.shopifyOrderId, p.id));
    return;
  }
  if (topic === 'refunds/create') {
    const r = payload as ShopifyRefund & { order_id: string };
    // Look up the parent order; ignore if not yet synced (hourly cron will fix it later)
    const [parent] = await db
      .select({ id: schema.shopifyOrders.id })
      .from(schema.shopifyOrders)
      .where(eq(schema.shopifyOrders.shopifyOrderId, r.order_id));
    if (!parent) return;
    await db
      .insert(schema.shopifyOrderRefunds)
      .values({
        orderId: parent.id,
        shopifyRefundId: r.id,
        refundedAt: new Date(r.createdAt),
        amount: r.totalRefundedSet.shopMoney.amount,
        reason: r.note,
      })
      .onConflictDoNothing({ target: schema.shopifyOrderRefunds.shopifyRefundId });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add features/shopify-orders/webhook/dispatch.ts
git commit -m "feat(orders): webhook topic dispatcher (orders create/updated/cancelled + refunds)"
```

---

### Task 10: Webhook route handler

**Files:**
- Create: `app/api/webhooks/shopify/[topic]/route.ts`

- [ ] **Step 1: Implement**

```ts
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, schema } from '@/db/client';
import { verifyShopifyHmac } from '@/features/shopify-orders/webhook/verify-hmac';
import { dispatchWebhook, topicFromSlug } from '@/features/shopify-orders/webhook/dispatch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Shopify webhook receiver.
 *   POST /api/webhooks/shopify/<topic-slug>
 * with headers X-Shopify-Hmac-Sha256, X-Shopify-Webhook-Id, X-Shopify-Shop-Domain.
 *
 * Must respond within 5s. Steps:
 *   1. HMAC verify (raw body, never JSON-parsed first).
 *   2. Dedup on webhook_id.
 *   3. Resolve store by shop_domain.
 *   4. Log received → dispatch by topic → log processed.
 *
 * Any failure logs `status='failed'` and returns 500 so Shopify retries.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ topic: string }> },
): Promise<Response> {
  const slug = (await params).topic;
  const topic = topicFromSlug(slug);
  if (!topic) return NextResponse.json({ ok: false, error: 'unknown topic' }, { status: 404 });

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'misconfigured' }, { status: 500 });

  const rawBody = await request.text();
  const sig = request.headers.get('x-shopify-hmac-sha256') ?? '';
  if (!verifyShopifyHmac(rawBody, sig, secret)) {
    return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 401 });
  }

  const webhookId = request.headers.get('x-shopify-webhook-id') ?? '';
  const shopDomain = request.headers.get('x-shopify-shop-domain') ?? '';
  if (!webhookId || !shopDomain) {
    return NextResponse.json({ ok: false, error: 'missing headers' }, { status: 400 });
  }

  const [store] = await db
    .select({ id: schema.stores.id })
    .from(schema.stores)
    .where(eq(schema.stores.shopDomain, shopDomain));
  if (!store) {
    return NextResponse.json({ ok: false, error: 'unknown shop' }, { status: 404 });
  }

  const existing = await db
    .select({ status: schema.shopifyWebhookLog.status })
    .from(schema.shopifyWebhookLog)
    .where(eq(schema.shopifyWebhookLog.shopifyWebhookId, webhookId));
  if (existing.length > 0 && existing[0].status === 'processed') {
    return NextResponse.json({ ok: true, skipped: 'duplicate' });
  }

  const payloadHash = createHash('sha256').update(rawBody).digest('hex');
  await db
    .insert(schema.shopifyWebhookLog)
    .values({
      storeId: store.id,
      topic,
      shopifyWebhookId: webhookId,
      status: 'received',
      payloadHash,
    })
    .onConflictDoNothing({ target: schema.shopifyWebhookLog.shopifyWebhookId });

  try {
    const payload = JSON.parse(rawBody);
    await dispatchWebhook(store.id, topic, payload);
    await db
      .update(schema.shopifyWebhookLog)
      .set({ status: 'processed', processedAt: new Date() })
      .where(eq(schema.shopifyWebhookLog.shopifyWebhookId, webhookId));
    await db
      .insert(schema.shopifySyncState)
      .values({ storeId: store.id, lastWebhookAt: new Date() })
      .onConflictDoUpdate({
        target: schema.shopifySyncState.storeId,
        set: { lastWebhookAt: new Date() },
      });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await db
      .update(schema.shopifyWebhookLog)
      .set({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
      .where(eq(schema.shopifyWebhookLog.shopifyWebhookId, webhookId));
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
```

- [ ] **Step 2: Smoke build**

```bash
pnpm build 2>&1 | tail -5
```

Expected: build succeeds and the route appears in the route listing.

- [ ] **Step 3: Commit**

```bash
git add app/api/webhooks/shopify/
git commit -m "feat(orders): webhook receiver with HMAC verify + idempotency + dispatch"
```

---

### Task 11: Webhook subscription registration helper + hook into store-connect

**Files:**
- Create: `features/shopify-orders/webhook/register-subscriptions.ts`
- Modify: `app/api/auth/shopify/callback/route.ts`

- [ ] **Step 1: Implement `register-subscriptions.ts`**

```ts
import { runMutation } from '@/lib/shopify/writer';
import { SUPPORTED_TOPICS, slugFromTopic, type ShopifyWebhookTopic } from './dispatch';
import type { stores } from '@/db/schema';
import type { InferSelectModel } from 'drizzle-orm';

type StoreRow = InferSelectModel<typeof stores>;

const REGISTER_MUTATION = `
  mutation register($topic: WebhookSubscriptionTopic!, $url: URL!) {
    webhookSubscriptionCreate(
      topic: $topic,
      webhookSubscription: { callbackUrl: $url, format: JSON }
    ) {
      userErrors { field message }
      webhookSubscription { id }
    }
  }
`;

const TOPIC_TO_GRAPHQL: Record<ShopifyWebhookTopic, string> = {
  'orders/create': 'ORDERS_CREATE',
  'orders/updated': 'ORDERS_UPDATED',
  'orders/cancelled': 'ORDERS_CANCELLED',
  'refunds/create': 'REFUNDS_CREATE',
};

/**
 * Subscribe a freshly-connected store to all four order-related webhook
 * topics. Existing subscriptions return userErrors but we treat duplicates as
 * success (re-running this function should be idempotent).
 */
export async function registerOrderWebhooks(store: StoreRow): Promise<void> {
  const baseUrl = process.env.SHOPIFY_APP_URL;
  if (!baseUrl) throw new Error('SHOPIFY_APP_URL not configured');
  for (const topic of SUPPORTED_TOPICS) {
    const url = `${baseUrl}/api/webhooks/shopify/${slugFromTopic(topic)}`;
    try {
      await runMutation({
        store,
        featureKey: 'shopify_orders',
        requiredScopes: ['read_orders'],
        query: REGISTER_MUTATION,
        variables: { topic: TOPIC_TO_GRAPHQL[topic], url },
        deps: { isEnabled: async () => true },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists')) continue;
      throw err;
    }
  }
}
```

- [ ] **Step 2: Wire into `app/api/auth/shopify/callback/route.ts`**

Locate where the new store row is inserted, and after `await db.insert(...)` (or after the upsert returns the store row), call `registerOrderWebhooks(store)`. Wrap in try/catch — log on failure but do NOT abort the callback flow, so a webhook registration glitch doesn't lock the operator out:

```ts
import { registerOrderWebhooks } from '@/features/shopify-orders/webhook/register-subscriptions';

// after the store row exists:
try {
  await registerOrderWebhooks(storeRow);
} catch (err) {
  // Non-fatal — log and continue. Admin can re-register via /admin/shopify-sync-health.
  console.error('webhook registration failed for', storeRow.shopDomain, err);
}
```

- [ ] **Step 3: Add `read_orders` scope to `.env.example`**

```diff
- SHOPIFY_SCOPES=read_shipping,read_checkout_branding,read_products,write_shipping,write_shop_settings
+ SHOPIFY_SCOPES=read_shipping,read_checkout_branding,read_products,write_shipping,write_shop_settings,read_orders
```

Also note in README (next task batch) that existing stores must re-approve scopes.

- [ ] **Step 4: Smoke build**

```bash
pnpm build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add features/shopify-orders/webhook/register-subscriptions.ts \
        app/api/auth/shopify/callback/route.ts \
        .env.example
git commit -m "feat(orders): auto-register order webhooks on store connect"
```

---

### Task 12: Backfill — bulkOperation submit + poll + stream

**Files:**
- Create: `features/shopify-orders/backfill/submit-bulk-query.ts`
- Create: `features/shopify-orders/backfill/poll-bulk-operation.ts`
- Create: `features/shopify-orders/backfill/stream-jsonl.ts`
- Create: `features/shopify-orders/backfill/run-backfill.ts`

- [ ] **Step 1: Implement `submit-bulk-query.ts`**

```ts
import { runMutation } from '@/lib/shopify/writer';
import type { InferSelectModel } from 'drizzle-orm';
import type { stores } from '@/db/schema';

type StoreRow = InferSelectModel<typeof stores>;

const BULK_MUTATION = `
  mutation backfill($q: String!) {
    bulkOperationRunQuery(query: $q) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const ORDERS_QUERY = `
{
  orders(query: "created_at:>=<SINCE>") {
    edges { node {
      id name createdAt processedAt cancelledAt
      displayFinancialStatus displayFulfillmentStatus currencyCode
      subtotalLineItemsQuantity
      totalDiscountsSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } }
      totalPriceSet { shopMoney { amount currencyCode } }
      shippingAddress { countryCodeV2 }
      totalWeight
      lineItems { edges { node {
        id sku vendor title variantTitle quantity
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
      } } }
      refunds {
        id createdAt note
        totalRefundedSet { shopMoney { amount currencyCode } }
      }
      fulfillments { trackingInfo { number company } }
    } }
  }
}`;

/** Submits the bulk query and returns the bulk operation id. */
export async function submitBackfillBulkQuery(store: StoreRow, sinceIso: string): Promise<string> {
  const query = ORDERS_QUERY.replace('<SINCE>', sinceIso);
  const res = await runMutation({
    store,
    featureKey: 'shopify_orders',
    requiredScopes: ['read_orders'],
    query: BULK_MUTATION,
    variables: { q: query },
    deps: { isEnabled: async () => true },
  });
  const r = (res as {
    data?: { bulkOperationRunQuery: {
      bulkOperation?: { id: string };
      userErrors: Array<{ message: string }>;
    } };
  }).data?.bulkOperationRunQuery;
  if (!r) throw new Error('No response from bulkOperationRunQuery');
  if (r.userErrors.length > 0) throw new Error(r.userErrors[0].message);
  if (!r.bulkOperation) throw new Error('No bulkOperation returned');
  return r.bulkOperation.id;
}
```

- [ ] **Step 2: Implement `poll-bulk-operation.ts`**

```ts
import { runQuery } from '@/lib/shopify/connector';
import type { InferSelectModel } from 'drizzle-orm';
import type { stores } from '@/db/schema';

type StoreRow = InferSelectModel<typeof stores>;

const POLL_QUERY = `
  query poll {
    currentBulkOperation {
      id status errorCode objectCount url partialDataUrl
    }
  }
`;

export interface BulkStatus {
  id: string;
  status: 'CREATED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  errorCode: string | null;
  objectCount: string | null;       // Shopify returns as string
  url: string | null;
  partialDataUrl: string | null;
}

export async function pollBulkOperation(store: StoreRow): Promise<BulkStatus | null> {
  const res = await runQuery<{ data?: { currentBulkOperation: BulkStatus | null } }>({
    store,
    featureKey: 'shopify_orders',
    requiredScopes: ['read_orders'],
    query: POLL_QUERY,
    deps: { isEnabled: async () => true },
  });
  return res.data?.currentBulkOperation ?? null;
}
```

- [ ] **Step 3: Implement `stream-jsonl.ts`**

```ts
/**
 * Stream Shopify's bulkOperation JSONL output file from `url`, batch parsed
 * orders by 100, and invoke a callback per batch. We parse each line as JSON;
 * line items and refunds arrive as separate JSONL records with `__parentId`
 * fields linking back to the parent order. We group them in-memory and emit
 * complete `ShopifyOrderPayload` shapes.
 */
import type { ShopifyOrderPayload, ShopifyLineItem, ShopifyRefund, ShopifyFulfillment } from '../shopify-types';

interface ParentedRow extends Record<string, unknown> { id: string; __parentId?: string }

export async function streamBulkResult(
  url: string,
  onBatch: (orders: ShopifyOrderPayload[]) => Promise<void>,
  batchSize = 100,
): Promise<number> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`bulk result fetch failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let totalOrders = 0;

  const orders = new Map<string, ShopifyOrderPayload & { lineItemsRaw: ShopifyLineItem[] }>();
  const batch: ShopifyOrderPayload[] = [];

  const flush = async (final: boolean): Promise<void> => {
    if (batch.length >= batchSize || (final && batch.length > 0)) {
      await onBatch(batch.splice(0));
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        const row = JSON.parse(line) as ParentedRow;
        if (!row.__parentId) {
          // Top-level order
          const orderRow = row as unknown as ShopifyOrderPayload;
          orders.set(orderRow.id, { ...orderRow, refunds: [], fulfillments: [], lineItems: { nodes: [] }, lineItemsRaw: [] });
        } else {
          const parent = orders.get(row.__parentId);
          if (!parent) continue; // out-of-order; rare
          // Distinguish by presence of fields
          if ('quantity' in row) parent.lineItemsRaw.push(row as unknown as ShopifyLineItem);
          else if ('totalRefundedSet' in row) parent.refunds.push(row as unknown as ShopifyRefund);
          else if ('trackingInfo' in row) parent.fulfillments.push(row as unknown as ShopifyFulfillment);
        }
      }
      nl = buffer.indexOf('\n');
    }
    // Emit completed orders when buffer between orders ticks over
    // (Shopify's JSONL doesn't guarantee order completion markers, so we
    // hold orders until end-of-stream and flush then; simpler and correct.)
  }
  for (const o of orders.values()) {
    o.lineItems.nodes = o.lineItemsRaw;
    delete (o as Partial<typeof o>).lineItemsRaw;
    batch.push(o);
    totalOrders++;
    await flush(false);
  }
  await flush(true);
  return totalOrders;
}
```

- [ ] **Step 4: Implement `run-backfill.ts`**

```ts
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { upsertOrder } from '../sync/upsert-order';
import { submitBackfillBulkQuery } from './submit-bulk-query';
import { pollBulkOperation } from './poll-bulk-operation';
import { streamBulkResult } from './stream-jsonl';

const POLL_INTERVAL_MS = 30_000;
const WATCHDOG_MS = 2 * 60 * 60 * 1000; // 2h

export interface BackfillResult {
  storeId: string;
  ordersIngested: number;
  bulkOperationId: string;
  durationMs: number;
}

/** Run a 12-month backfill for one store. Throws on any failure. */
export async function runBackfillForStore(storeId: string): Promise<BackfillResult> {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) throw new Error(`store ${storeId} not found`);

  await db
    .insert(schema.shopifySyncState)
    .values({ storeId, backfillStatus: 'running', backfillStartedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.shopifySyncState.storeId,
      set: { backfillStatus: 'running', backfillStartedAt: new Date(), backfillError: null },
    });

  const start = Date.now();
  const since = new Date(start - 365 * 24 * 60 * 60 * 1000).toISOString();
  let bulkId = '';

  try {
    bulkId = await submitBackfillBulkQuery(store, since);
    await db
      .update(schema.shopifySyncState)
      .set({ backfillCursor: bulkId })
      .where(eq(schema.shopifySyncState.storeId, storeId));

    let url: string | null = null;
    while (true) {
      if (Date.now() - start > WATCHDOG_MS) {
        throw new Error('bulk operation stuck > 2h, abort');
      }
      const s = await pollBulkOperation(store);
      if (!s) throw new Error('no bulk operation in flight');
      if (s.status === 'FAILED' || s.status === 'CANCELLED' || s.status === 'EXPIRED') {
        throw new Error(`bulk operation ${s.status} (${s.errorCode ?? 'unknown'})`);
      }
      if (s.status === 'COMPLETED') { url = s.url; break; }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!url) throw new Error('bulk completed without url');

    let ingested = 0;
    await streamBulkResult(url, async (orders) => {
      for (const o of orders) {
        await upsertOrder(storeId, o, 'backfill');
        ingested++;
      }
    });

    await db
      .update(schema.shopifySyncState)
      .set({ backfillStatus: 'done', backfillFinishedAt: new Date() })
      .where(eq(schema.shopifySyncState.storeId, storeId));

    return { storeId, ordersIngested: ingested, bulkOperationId: bulkId, durationMs: Date.now() - start };
  } catch (err) {
    await db
      .update(schema.shopifySyncState)
      .set({
        backfillStatus: 'failed',
        backfillFinishedAt: new Date(),
        backfillError: err instanceof Error ? err.message : String(err),
      })
      .where(eq(schema.shopifySyncState.storeId, storeId));
    throw err;
  }
}
```

- [ ] **Step 5: Create the script entry point**

`scripts/cron/backfill-shopify-orders.ts`:

```ts
import { runBackfillForStore } from '@/features/shopify-orders/backfill/run-backfill';

async function main(): Promise<void> {
  const storeArg = process.argv.find((a) => a.startsWith('--store='));
  if (!storeArg) {
    process.stderr.write('usage: pnpm cron:backfill-orders --store=<storeId>\n');
    process.exit(1);
  }
  const storeId = storeArg.split('=')[1];
  const r = await runBackfillForStore(storeId);
  process.stdout.write(
    `backfill: store=${r.storeId} ingested=${r.ordersIngested} duration=${(r.durationMs / 1000).toFixed(1)}s\n`,
  );
}

main()
  .catch((err) => {
    process.stderr.write(`backfill: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
```

- [ ] **Step 6: Register the npm script**

In `package.json` add to scripts:

```json
"cron:backfill-orders": "dotenv -- tsx scripts/cron/backfill-shopify-orders.ts"
```

- [ ] **Step 7: Smoke build**

```bash
pnpm build 2>&1 | tail -5
```

- [ ] **Step 8: Commit**

```bash
git add features/shopify-orders/backfill/ scripts/cron/backfill-shopify-orders.ts package.json
git commit -m "feat(orders): 12-month backfill via Shopify bulkOperation"
```

---

### Task 13: Hourly safety-net cron

**Files:**
- Create: `features/shopify-orders/cron/hourly-sync.ts`
- Create: `scripts/cron/sync-shopify-orders.ts`
- Modify: `package.json`
- Modify: `README.md` (Railway cron entries)

- [ ] **Step 1: Implement `hourly-sync.ts`**

```ts
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { runQuery } from '@/lib/shopify/connector';
import { upsertOrder } from '../sync/upsert-order';
import type { ShopifyOrderPayload } from '../shopify-types';

const PAGE_SIZE = 50;

const PAGED_QUERY = `
  query orders($q: String!, $cursor: String) {
    orders(first: ${PAGE_SIZE}, query: $q, after: $cursor, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name createdAt processedAt cancelledAt
        displayFinancialStatus displayFulfillmentStatus currencyCode
        subtotalLineItemsQuantity
        totalDiscountsSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { countryCodeV2 }
        totalWeight
        lineItems(first: 250) {
          nodes {
            id sku vendor title variantTitle quantity
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
          }
        }
        refunds {
          id createdAt note
          totalRefundedSet { shopMoney { amount currencyCode } }
        }
        fulfillments { trackingInfo { number company } }
      }
    }
  }
`.trim();

export interface StoreSyncResult {
  storeId: string;
  storeName: string;
  ingested: number;
  error?: string;
}

export async function runHourlySync(): Promise<StoreSyncResult[]> {
  const stores = await db.select().from(schema.stores).where(eq(schema.stores.status, 'active'));
  const results: StoreSyncResult[] = [];

  for (const store of stores) {
    // Per-store advisory lock so two cron runs don't double-process the same store.
    const lockKey = hash(store.id);
    const locked = await db.execute(
      sql`SELECT pg_try_advisory_xact_lock(${lockKey}) AS locked`,
    );
    if (!(locked as unknown as { locked: boolean }[])[0]?.locked) {
      results.push({ storeId: store.id, storeName: store.name, ingested: 0, error: 'locked' });
      continue;
    }

    try {
      const [state] = await db
        .select()
        .from(schema.shopifySyncState)
        .where(eq(schema.shopifySyncState.storeId, store.id));
      const since = state?.lastCronSyncAt ?? new Date(Date.now() - 60 * 60 * 1000);
      const q = `updated_at:>=${since.toISOString()}`;

      let cursor: string | null = null;
      let ingested = 0;
      do {
        const res = await runQuery<{
          data?: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: ShopifyOrderPayload[] } };
        }>({
          store, featureKey: 'shopify_orders', requiredScopes: ['read_orders'],
          query: PAGED_QUERY, variables: { q, cursor },
          deps: { isEnabled: async () => true },
        });
        const page = res.data?.orders;
        if (!page) break;
        for (const o of page.nodes) {
          await upsertOrder(store.id, o, 'cron');
          ingested++;
        }
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (cursor);

      await db
        .insert(schema.shopifySyncState)
        .values({ storeId: store.id, lastCronSyncAt: new Date() })
        .onConflictDoUpdate({
          target: schema.shopifySyncState.storeId,
          set: { lastCronSyncAt: new Date() },
        });
      results.push({ storeId: store.id, storeName: store.name, ingested });
    } catch (err) {
      results.push({
        storeId: store.id, storeName: store.name, ingested: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}
```

- [ ] **Step 2: Create the script entry point**

`scripts/cron/sync-shopify-orders.ts`:

```ts
import { runHourlySync } from '@/features/shopify-orders/cron/hourly-sync';

async function main(): Promise<void> {
  const results = await runHourlySync();
  let failures = 0;
  for (const r of results) {
    if (r.error) {
      failures++;
      process.stderr.write(`sync-orders: ${r.storeName} — FAILED: ${r.error}\n`);
    } else {
      process.stdout.write(`sync-orders: ${r.storeName} — ${r.ingested} orders\n`);
    }
  }
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    process.stderr.write(`sync-orders: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
```

- [ ] **Step 3: Register the npm script**

`package.json`:

```json
"cron:sync-orders": "dotenv -- tsx scripts/cron/sync-shopify-orders.ts"
```

- [ ] **Step 4: README update — document the new Railway service**

Append to the "Scheduled jobs (cron)" section of `README.md`:

```markdown
**Orders safety-net** (in addition to FedEx fuel):

Add another Railway cron service from the same repo:

- **Start command:** `npm run cron:sync-orders`
- **Cron schedule:** `5 * * * *` (every hour)
- **Reference variable:** `DATABASE_URL` from the Postgres service

This service polls every active store for orders with `updated_at >=
last_cron_sync_at` and reconciles them through the same upsertOrder() path
the webhook handler uses. It's an idempotent safety net; webhooks remain
the primary real-time channel.
```

- [ ] **Step 5: Smoke build**

```bash
pnpm build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add features/shopify-orders/cron/ scripts/cron/sync-shopify-orders.ts package.json README.md
git commit -m "feat(orders): hourly safety-net cron sync"
```

---

## Phase 3 — CSV ingestion

### Task 14: SKU cost CSV parser

**Files:**
- Create: `features/shopify-orders/csv-upload/parse-sku-costs.ts`
- Create: `features/shopify-orders/csv-upload/parse-sku-costs.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { parseSkuCostsCsv } from './parse-sku-costs';

const headers = 'sku,cost,currency,effective_from';

describe('parseSkuCostsCsv', () => {
  it('parses well-formed rows', () => {
    const csv = [
      headers,
      'MEAN-A,12.50,USD,2026-05-01',
      'CICI-B,520000,VND,2026-05-01',
    ].join('\n');
    const r = parseSkuCostsCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      sku: 'MEAN-A', cost: '12.50', currency: 'USD', effectiveFrom: '2026-05-01',
    });
  });

  it('defaults effective_from to today when blank', () => {
    const csv = [headers, 'MEAN-A,12.50,USD,'].join('\n');
    const r = parseSkuCostsCsv(csv, new Date('2026-05-28T00:00:00Z'));
    expect(r.rows[0].effectiveFrom).toBe('2026-05-28');
  });

  it('flags non-numeric cost as an error', () => {
    const csv = [headers, 'MEAN-A,abc,USD,2026-05-01'].join('\n');
    const r = parseSkuCostsCsv(csv);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ line: 2, message: expect.stringContaining('cost') });
  });

  it('flags non-ISO-3 currency', () => {
    const csv = [headers, 'MEAN-A,12.50,$,2026-05-01'].join('\n');
    const r = parseSkuCostsCsv(csv);
    expect(r.errors[0].message).toMatch(/currency/i);
  });

  it('flags missing required header', () => {
    const csv = ['sku,cost,currency', 'MEAN-A,12.50,USD'].join('\n');
    const r = parseSkuCostsCsv(csv);
    expect(r.errors[0].message).toMatch(/effective_from/);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm test --run features/shopify-orders/csv-upload/parse-sku-costs.test.ts
```

- [ ] **Step 3: Implement**

```ts
export interface SkuCostRow {
  sku: string;
  cost: string;            // keep as string; downstream Drizzle numeric needs strings
  currency: string;
  effectiveFrom: string;   // YYYY-MM-DD
}

export interface CsvError {
  line: number;
  message: string;
}

export interface ParseResult {
  rows: SkuCostRow[];
  errors: CsvError[];
}

export function parseSkuCostsCsv(text: string, today: Date = new Date()): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const errors: CsvError[] = [];
  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 0, message: 'empty file' }] };
  }
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const required = ['sku', 'cost', 'currency', 'effective_from'];
  for (const r of required) {
    if (!header.includes(r)) errors.push({ line: 1, message: `missing header: ${r}` });
  }
  if (errors.length > 0) return { rows: [], errors };

  const idx = (k: string) => header.indexOf(k);
  const todayIso = today.toISOString().slice(0, 10);

  const rows: SkuCostRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((s) => s.trim());
    const sku = cells[idx('sku')];
    const cost = cells[idx('cost')];
    const currency = cells[idx('currency')];
    const effectiveFrom = cells[idx('effective_from')] || todayIso;

    if (!sku) { errors.push({ line: i + 1, message: 'missing sku' }); continue; }
    if (!/^-?\d+(\.\d+)?$/.test(cost)) {
      errors.push({ line: i + 1, message: `cost must be numeric, got "${cost}"` }); continue;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push({ line: i + 1, message: `currency must be ISO-3, got "${currency}"` }); continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      errors.push({ line: i + 1, message: `effective_from must be YYYY-MM-DD, got "${effectiveFrom}"` }); continue;
    }
    rows.push({ sku, cost, currency, effectiveFrom });
  }
  return { rows, errors };
}
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**

```bash
git add features/shopify-orders/csv-upload/parse-sku-costs.ts features/shopify-orders/csv-upload/parse-sku-costs.test.ts
git commit -m "feat(orders): SKU cost CSV parser (5 unit tests)"
```

---

### Task 15: SKU cost apply (server action)

**Files:**
- Create: `features/shopify-orders/csv-upload/apply-sku-costs.ts`

- [ ] **Step 1: Implement**

```ts
'use server';

import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';
import { parseSkuCostsCsv } from './parse-sku-costs';

export interface ApplySkuCostsInput {
  storeId: string;
  csvText: string;
  filename: string;
  userId: string;
}

export interface ApplySkuCostsResult {
  inserted: number;
  overwritten: number;
  errors: Array<{ line: number; message: string }>;
}

/**
 * Parse + persist SKU costs from a CSV upload. Idempotent on
 * (store_id, sku, effective_from) — re-uploading the same file is safe
 * and overwrites the cost (operator can correct typos).
 */
export async function applySkuCosts(input: ApplySkuCostsInput): Promise<ApplySkuCostsResult> {
  const { rows, errors } = parseSkuCostsCsv(input.csvText);
  if (errors.length > 0) {
    return { inserted: 0, overwritten: 0, errors };
  }

  // Count overwrites by counting existing rows matching incoming keys before insert.
  const existingCount = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count FROM sku_costs
     WHERE store_id = ${input.storeId}
       AND (sku, effective_from) IN
           (${sql.join(rows.map((r) => sql`(${r.sku}, ${r.effectiveFrom}::date)`), sql`, `)})
  `);
  const overwritten = Number(existingCount[0]?.count ?? 0);

  for (const r of rows) {
    await db.insert(schema.skuCosts)
      .values({
        storeId: input.storeId,
        sku: r.sku,
        costPerUnit: r.cost,
        currency: r.currency,
        effectiveFrom: r.effectiveFrom,
        source: `csv:${input.filename}`,
        uploadedBy: input.userId,
      })
      .onConflictDoUpdate({
        target: [schema.skuCosts.storeId, schema.skuCosts.sku, schema.skuCosts.effectiveFrom],
        set: {
          costPerUnit: r.cost,
          currency: r.currency,
          source: `csv:${input.filename}`,
          uploadedBy: input.userId,
          uploadedAt: new Date(),
        },
      });
  }

  return { inserted: rows.length - overwritten, overwritten, errors: [] };
}
```

- [ ] **Step 2: Commit**

```bash
git add features/shopify-orders/csv-upload/apply-sku-costs.ts
git commit -m "feat(orders): server action — apply SKU costs CSV"
```

---

### Task 16: Shipping invoice CSV parser + apply

**Files:**
- Create: `features/shopify-orders/csv-upload/parse-shipping-invoice.ts`
- Create: `features/shopify-orders/csv-upload/parse-shipping-invoice.test.ts`
- Create: `features/shopify-orders/csv-upload/apply-shipping-invoice.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest';
import { parseShippingInvoiceCsv } from './parse-shipping-invoice';

const headers = 'tracking_number,actual_cost,currency,date';

describe('parseShippingInvoiceCsv', () => {
  it('parses well-formed rows', () => {
    const csv = [headers, '1234567890,12.50,USD,2026-04-15'].join('\n');
    const r = parseShippingInvoiceCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toEqual({
      trackingNumber: '1234567890', actualCost: '12.50', currency: 'USD', date: '2026-04-15',
    });
  });
  it('flags missing tracking_number', () => {
    const csv = [headers, ',12.50,USD,2026-04-15'].join('\n');
    expect(parseShippingInvoiceCsv(csv).errors[0].message).toMatch(/tracking/);
  });
  it('flags non-numeric cost', () => {
    const csv = [headers, '12345,abc,USD,2026-04-15'].join('\n');
    expect(parseShippingInvoiceCsv(csv).errors[0].message).toMatch(/cost/);
  });
});
```

- [ ] **Step 2: Verify fail**
- [ ] **Step 3: Implement `parse-shipping-invoice.ts`** — same shape as `parse-sku-costs.ts`, fields: `tracking_number`, `actual_cost`, `currency`, `date`. Same validation rules (numeric, ISO-3, YYYY-MM-DD). Return `{rows, errors}`.

- [ ] **Step 4: Implement `apply-shipping-invoice.ts`**

```ts
'use server';

import { db, schema } from '@/db/client';
import { parseShippingInvoiceCsv } from './parse-shipping-invoice';

export interface ApplyShippingInvoiceInput {
  storeId: string;
  carrierAccountId: string;
  invoicePeriodStart: string;
  invoicePeriodEnd: string;
  csvText: string;
  filename: string;
}

export interface ApplyShippingInvoiceResult {
  inserted: number;
  overwritten: number;
  errors: Array<{ line: number; message: string }>;
}

export async function applyShippingInvoice(input: ApplyShippingInvoiceInput): Promise<ApplyShippingInvoiceResult> {
  const { rows, errors } = parseShippingInvoiceCsv(input.csvText);
  if (errors.length > 0) return { inserted: 0, overwritten: 0, errors };

  let overwritten = 0;
  for (const r of rows) {
    const res = await db.insert(schema.shippingInvoices)
      .values({
        storeId: input.storeId,
        carrierAccountId: input.carrierAccountId,
        trackingNumber: r.trackingNumber,
        invoicePeriodStart: input.invoicePeriodStart,
        invoicePeriodEnd: input.invoicePeriodEnd,
        actualCost: r.actualCost,
        currency: r.currency,
        source: `csv:${input.filename}`,
      })
      .onConflictDoUpdate({
        target: [schema.shippingInvoices.storeId, schema.shippingInvoices.trackingNumber],
        set: {
          actualCost: r.actualCost,
          currency: r.currency,
          invoicePeriodStart: input.invoicePeriodStart,
          invoicePeriodEnd: input.invoicePeriodEnd,
          source: `csv:${input.filename}`,
          uploadedAt: new Date(),
        },
      })
      .returning({ id: schema.shippingInvoices.id });
    if (res.length === 0) overwritten++;
  }

  return { inserted: rows.length - overwritten, overwritten, errors: [] };
}
```

- [ ] **Step 5: Run all CSV tests, expect PASS**
- [ ] **Step 6: Commit**

```bash
git add features/shopify-orders/csv-upload/parse-shipping-invoice* features/shopify-orders/csv-upload/apply-shipping-invoice.ts
git commit -m "feat(orders): shipping invoice CSV parser + apply (3 unit tests)"
```

---

### Task 17: Upload UI for SKU costs

**Files:**
- Create: `app/(dashboard)/f/orders/[storeId]/costs/page.tsx`
- Create: `components/shopify-orders/CsvUploader.tsx` (reused by Task 18)

- [ ] **Step 1: Create the reusable `CsvUploader` client component**

```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload } from 'lucide-react';

export interface UploadResult {
  inserted: number;
  overwritten: number;
  errors: Array<{ line: number; message: string }>;
}

interface CsvUploaderProps {
  uploadAction: (formData: FormData) => Promise<UploadResult>;
  expectedHeaders: string[];
  hint: string;
}

export function CsvUploader({ uploadAction, expectedHeaders, hint }: CsvUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (form: FormData): Promise<void> => {
    setBusy(true);
    setResult(await uploadAction(form));
    setBusy(false);
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="text-xs text-muted-foreground">
          Required headers: <span className="font-mono">{expectedHeaders.join(', ')}</span>. {hint}
        </div>
        <form action={onSubmit} className="space-y-3">
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
            required
          />
          <Button type="submit" disabled={!file || busy} size="sm" className="gap-1.5">
            <Upload className="size-3.5" />
            {busy ? 'Importing…' : 'Import CSV'}
          </Button>
        </form>
        {result && (
          <div className="text-sm space-y-1">
            <div>Inserted: <span className="font-mono">{result.inserted}</span></div>
            <div>Overwritten: <span className="font-mono">{result.overwritten}</span></div>
            {result.errors.length > 0 && (
              <details>
                <summary className="text-destructive">{result.errors.length} errors</summary>
                <ul className="text-xs font-mono mt-1 space-y-0.5">
                  {result.errors.map((e, i) => <li key={i}>line {e.line}: {e.message}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create the page**

`app/(dashboard)/f/orders/[storeId]/costs/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { eq, desc } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { applySkuCosts } from '@/features/shopify-orders/csv-upload/apply-sku-costs';
import { CsvUploader, type UploadResult } from '@/components/shopify-orders/CsvUploader';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function CostsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_sku_costs')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) notFound();

  const recent = await db
    .select()
    .from(schema.skuCosts)
    .where(eq(schema.skuCosts.storeId, storeId))
    .orderBy(desc(schema.skuCosts.uploadedAt))
    .limit(50);

  async function uploadAction(form: FormData): Promise<UploadResult> {
    'use server';
    const session2 = await auth.api.getSession({ headers: await headers() });
    if (!session2) throw new Error('unauthenticated');
    const file = form.get('file') as File;
    const csvText = await file.text();
    const r = await applySkuCosts({
      storeId, csvText, filename: file.name, userId: session2.user.id,
    });
    revalidatePath(`/f/orders/${storeId}/costs`);
    return r;
  }

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link href={`/f/orders/${storeId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        {store.name}
      </Link>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">SKU costs</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Upload CSV of cost-per-SKU. Costs are time-versioned by <span className="font-mono">effective_from</span>; orders use the latest cost effective on or before <span className="font-mono">processed_at</span>.
        </p>
      </header>

      <CsvUploader
        uploadAction={uploadAction}
        expectedHeaders={['sku', 'cost', 'currency', 'effective_from']}
        hint="effective_from is YYYY-MM-DD; blank = today."
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent uploads (latest 50 rows)
        </h2>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2">SKU</th>
                  <th className="text-right px-4 py-2">Cost</th>
                  <th className="text-left px-4 py-2">Cur.</th>
                  <th className="text-left px-4 py-2">Effective from</th>
                  <th className="text-left px-4 py-2">Source</th>
                  <th className="text-left px-4 py-2">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="px-4 py-2 font-mono">{r.sku}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.costPerUnit}</td>
                    <td className="px-4 py-2 font-mono">{r.currency}</td>
                    <td className="px-4 py-2 font-mono">{r.effectiveFrom}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.source}</td>
                    <td className="px-4 py-2 text-xs">{new Date(r.uploadedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Smoke build**

```bash
pnpm build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/f/orders/\[storeId\]/costs/ components/shopify-orders/CsvUploader.tsx
git commit -m "feat(orders): SKU cost CSV upload UI + history"
```

---

### Task 18: Upload UI for shipping invoices

**Files:**
- Create: `app/(dashboard)/f/orders/[storeId]/shipping-invoices/page.tsx`

- [ ] **Step 1: Implement the page**

```tsx
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { eq, desc } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { applyShippingInvoice } from '@/features/shopify-orders/csv-upload/apply-shipping-invoice';
import { CsvUploader, type UploadResult } from '@/components/shopify-orders/CsvUploader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, ChevronLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ShippingInvoicesPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_shipping_invoices')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) notFound();

  const carriers = await db
    .select()
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.enabled, true));

  const recent = await db
    .select()
    .from(schema.shippingInvoices)
    .where(eq(schema.shippingInvoices.storeId, storeId))
    .orderBy(desc(schema.shippingInvoices.uploadedAt))
    .limit(50);

  async function uploadAction(formData: FormData): Promise<UploadResult> {
    'use server';
    const file = formData.get('file') as File;
    const r = await applyShippingInvoice({
      storeId,
      carrierAccountId: String(formData.get('carrierAccountId')),
      invoicePeriodStart: String(formData.get('periodStart')),
      invoicePeriodEnd: String(formData.get('periodEnd')),
      csvText: await file.text(),
      filename: file.name,
    });
    revalidatePath(`/f/orders/${storeId}/shipping-invoices`);
    return r;
  }

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link href={`/f/orders/${storeId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        {store.name}
      </Link>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Shipping invoices</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Upload monthly carrier invoices. Tracking numbers reconcile against existing orders;
          unmatched rows are stored anyway for late-arriving orders.
        </p>
      </header>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="text-xs text-muted-foreground">
            Required headers: <span className="font-mono">tracking_number, actual_cost, currency, date</span>
          </div>
          <form action={uploadAction} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="text-sm space-y-1">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Carrier</div>
                <select name="carrierAccountId" required className="w-full h-9 border border-input bg-input/30 rounded-lg px-3 text-sm">
                  {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="text-sm space-y-1">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Period start</div>
                <input type="date" name="periodStart" required className="w-full h-9 border border-input bg-input/30 rounded-lg px-3 text-sm" />
              </label>
              <label className="text-sm space-y-1">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Period end</div>
                <input type="date" name="periodEnd" required className="w-full h-9 border border-input bg-input/30 rounded-lg px-3 text-sm" />
              </label>
            </div>
            <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
            <Button type="submit" size="sm" className="gap-1.5">
              <Upload className="size-3.5" />
              Import CSV
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent uploads (latest 50 rows)
        </h2>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2">Tracking #</th>
                  <th className="text-right px-4 py-2">Cost</th>
                  <th className="text-left px-4 py-2">Cur.</th>
                  <th className="text-left px-4 py-2">Period</th>
                  <th className="text-left px-4 py-2">Source</th>
                  <th className="text-left px-4 py-2">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="px-4 py-2 font-mono">{r.trackingNumber}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.actualCost}</td>
                    <td className="px-4 py-2 font-mono">{r.currency}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.invoicePeriodStart} → {r.invoicePeriodEnd}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.source}</td>
                    <td className="px-4 py-2 text-xs">{new Date(r.uploadedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Smoke build**
- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/f/orders/\[storeId\]/shipping-invoices/
git commit -m "feat(orders): shipping invoice CSV upload UI + history"
```

---

## Phase 4 — Dashboard

### Task 19: `dashboard-actions.ts` — getStoreMetrics

**Files:**
- Create: `features/shopify-orders/dashboard-actions.ts`

- [ ] **Step 1: Implement**

```ts
'use server';

import { and, eq, gte, lte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { computeOrderMetrics, type OrderMetrics } from './metrics/compute';
import { aggregateMetrics, type AggregateMetrics } from './metrics/aggregate';

export type Grouping = 'day' | 'week' | 'month' | 'vendor';

export interface GetStoreMetricsArgs {
  storeId: string;
  dateFrom: Date;
  dateTo: Date;
  vendorFilter?: string[];
  grouping: Grouping;
}

export interface MetricsBucket {
  bucketKey: string;        // ISO date for time grouping; vendor name for vendor grouping
  bucketLabel: string;
  metrics: AggregateMetrics;
}

export interface GetStoreMetricsResult {
  total: AggregateMetrics;
  buckets: MetricsBucket[];
}

/**
 * Pull orders + lines + cost rows + shipping invoices, compute per-order
 * metrics in JS (so the formula stays in one place), and bucket by the
 * requested grouping.
 *
 * For v1 this materializes all rows in the date window into memory. If a
 * store ships > 100k orders / period and this gets slow, replace with a
 * SQL-side aggregation that uses date_trunc + SUM and a separate cost
 * coverage join — but defer until measured.
 */
export async function getStoreMetrics(args: GetStoreMetricsArgs): Promise<GetStoreMetricsResult> {
  const where = and(
    eq(schema.shopifyOrders.storeId, args.storeId),
    gte(schema.shopifyOrders.processedAtShopify, args.dateFrom),
    lte(schema.shopifyOrders.processedAtShopify, args.dateTo),
  );

  const orders = await db.select().from(schema.shopifyOrders).where(where);
  if (orders.length === 0) {
    return { total: emptyAgg(), buckets: [] };
  }
  const orderIds = orders.map((o) => o.id);

  const lines = await db
    .select()
    .from(schema.shopifyOrderLines)
    .where(inArray(schema.shopifyOrderLines.orderId, orderIds));
  const refunds = await db
    .select()
    .from(schema.shopifyOrderRefunds)
    .where(inArray(schema.shopifyOrderRefunds.orderId, orderIds));

  // Cost lookup per (sku, processedAt) — fetch latest effective cost.
  const skus = Array.from(new Set(lines.map((l) => l.sku).filter((s): s is string => !!s)));
  const allCosts = skus.length === 0
    ? []
    : await db
        .select()
        .from(schema.skuCosts)
        .where(and(
          eq(schema.skuCosts.storeId, args.storeId),
          inArray(schema.skuCosts.sku, skus),
        ));
  const costIndex = indexCostsBySkuByDate(allCosts);

  // Shipping invoice lookup — by tracking number from raw payload.
  const trackingByOrder = new Map<string, string[]>();
  for (const o of orders) {
    const tracking = extractTrackingNumbers(o.rawPayload);
    if (tracking.length > 0) trackingByOrder.set(o.id, tracking);
  }
  const allTracking = Array.from(new Set([...trackingByOrder.values()].flat()));
  const invoices = allTracking.length === 0
    ? []
    : await db
        .select()
        .from(schema.shippingInvoices)
        .where(and(
          eq(schema.shippingInvoices.storeId, args.storeId),
          inArray(schema.shippingInvoices.trackingNumber, allTracking),
        ));
  const invoiceIndex = new Map(invoices.map((i) => [i.trackingNumber, i]));

  // Compute per-order metrics.
  const allMetrics: Array<OrderMetrics & { vendor: string[]; bucketKey: string; bucketLabel: string }> = [];
  for (const o of orders) {
    const oLines = lines.filter((l) => l.orderId === o.id);
    const filteredLines = args.vendorFilter && args.vendorFilter.length > 0
      ? oLines.filter((l) => l.vendor && args.vendorFilter!.includes(l.vendor))
      : oLines;
    if (args.vendorFilter && filteredLines.length === 0) continue;

    const grossLineTotal = sumNumeric(filteredLines.map((l) => Number(l.unitPrice) * l.quantity));
    const totalRefunded = refunds
      .filter((r) => r.orderId === o.id)
      .reduce((s, r) => s + Number(r.amount), 0);

    // Pro-rata split for order-level fields when vendor filter is active.
    const wholeOrderGross = sumNumeric(oLines.map((l) => Number(l.unitPrice) * l.quantity));
    const share = wholeOrderGross > 0 ? grossLineTotal / wholeOrderGross : 1;

    // Shipping cost — invoice if matching tracking, else engine estimate.
    let shippingCost = { amount: 0, source: 'unknown' as 'invoice' | 'engine_estimate' | 'unknown' };
    const tracking = trackingByOrder.get(o.id) ?? [];
    const matchingInvoice = tracking.map((t) => invoiceIndex.get(t)).find((i) => !!i);
    if (matchingInvoice) {
      shippingCost = { amount: Number(matchingInvoice.actualCost) * share, source: 'invoice' };
    } else {
      // Live engine estimate is left as a follow-up — for v1 we surface 0
      // with source='unknown' when there's no invoice. The carrier-rates
      // engine integration ships in a follow-up task.
      shippingCost = { amount: 0, source: 'unknown' };
    }

    const skuCosts = filteredLines.map((l) => {
      const cost = l.sku ? costIndex.get(l.sku)?.find((c) => new Date(c.effectiveFrom) <= o.processedAtShopify) : null;
      return {
        lineId: l.id,
        quantity: l.quantity,
        costPerUnit: cost ? Number(cost.costPerUnit) : null,
        costCurrency: cost?.currency ?? null,
      };
    });

    const m = computeOrderMetrics({
      orderId: o.id,
      currency: o.currency,
      grossLineTotal,
      totalDiscount: Number(o.totalDiscount) * share,
      totalShipping: Number(o.totalShipping) * share,
      totalTax: Number(o.totalTax) * share,
      totalRefunded: totalRefunded * share,
      shippingCost,
      skuCosts,
    });

    const vendor = filteredLines.map((l) => l.vendor).filter((v): v is string => !!v);
    const { key, label } = bucketize(o.processedAtShopify, vendor, args.grouping);
    allMetrics.push({ ...m, vendor, bucketKey: key, bucketLabel: label });
  }

  const buckets = groupBucketMetrics(allMetrics);
  const total = aggregateMetrics(allMetrics);
  return { total, buckets };
}

function indexCostsBySkuByDate(rows: typeof schema.skuCosts.$inferSelect[]): Map<string, typeof rows> {
  const idx = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = idx.get(r.sku) ?? [];
    arr.push(r);
    idx.set(r.sku, arr);
  }
  for (const arr of idx.values()) arr.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return idx;
}

function extractTrackingNumbers(payload: unknown): string[] {
  const p = payload as { fulfillments?: Array<{ trackingInfo: Array<{ number: string | null }> }> };
  if (!p?.fulfillments) return [];
  return p.fulfillments.flatMap((f) => f.trackingInfo.map((t) => t.number)).filter((n): n is string => !!n);
}

function sumNumeric(nums: number[]): number { return nums.reduce((a, b) => a + b, 0); }

function bucketize(date: Date, vendors: string[], grouping: Grouping): { key: string; label: string } {
  if (grouping === 'vendor') {
    const v = vendors[0] ?? '(no vendor)';
    return { key: v, label: v };
  }
  const iso = date.toISOString().slice(0, 10);
  if (grouping === 'day') return { key: iso, label: iso };
  if (grouping === 'week') {
    const monday = new Date(date);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const k = monday.toISOString().slice(0, 10);
    return { key: k, label: `Week of ${k}` };
  }
  // month
  const k = iso.slice(0, 7);
  return { key: k, label: k };
}

function groupBucketMetrics(items: Array<OrderMetrics & { bucketKey: string; bucketLabel: string }>): MetricsBucket[] {
  const grouped = new Map<string, { label: string; items: OrderMetrics[] }>();
  for (const m of items) {
    const g = grouped.get(m.bucketKey) ?? { label: m.bucketLabel, items: [] };
    g.items.push(m);
    grouped.set(m.bucketKey, g);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, g]) => ({ bucketKey: k, bucketLabel: g.label, metrics: aggregateMetrics(g.items) }));
}

function emptyAgg(): AggregateMetrics {
  return {
    orderCount: 0, currency: '',
    gmv: 0, refundedAmount: 0, netGmv: 0, discount: 0,
    shippingRevenue: 0, shippingCost: 0, skuCost: 0, tax: 0,
    revenue: 0, margin: 0, skuCostCoverage: 0,
  };
}

export interface MissingCostOrder {
  orderId: string;
  shopifyOrderNumber: string;
  processedAt: Date;
  missingSkus: string[];
}

export async function getMissingCostOrders(storeId: string, dateFrom: Date, dateTo: Date): Promise<MissingCostOrder[]> {
  const rows = await db.execute<{
    order_id: string; shopify_order_number: string; processed_at_shopify: Date; missing_skus: string[];
  }>(sql`
    SELECT o.id AS order_id,
           o.shopify_order_number,
           o.processed_at_shopify,
           array_agg(DISTINCT l.sku) FILTER (WHERE l.sku IS NOT NULL) AS missing_skus
      FROM shopify_orders o
      JOIN shopify_order_lines l ON l.order_id = o.id
 LEFT JOIN LATERAL (
        SELECT 1 FROM sku_costs c
         WHERE c.store_id = o.store_id
           AND c.sku = l.sku
           AND c.effective_from <= o.processed_at_shopify::date
         ORDER BY c.effective_from DESC LIMIT 1
      ) c ON TRUE
     WHERE o.store_id = ${storeId}
       AND o.processed_at_shopify BETWEEN ${dateFrom} AND ${dateTo}
       AND l.sku IS NOT NULL
       AND c IS NULL
     GROUP BY o.id, o.shopify_order_number, o.processed_at_shopify
     ORDER BY o.processed_at_shopify DESC
     LIMIT 100;
  `);
  return rows.map((r) => ({
    orderId: r.order_id,
    shopifyOrderNumber: r.shopify_order_number,
    processedAt: r.processed_at_shopify,
    missingSkus: r.missing_skus ?? [],
  }));
}
```

- [ ] **Step 2: Smoke build**
- [ ] **Step 3: Commit**

```bash
git add features/shopify-orders/dashboard-actions.ts
git commit -m "feat(orders): server actions for store metrics + missing-cost drill-down"
```

---

### Task 19a: Live shipping-cost estimate via carrier-rates engine

The spec promises a hybrid shipping cost: invoice when known, **live engine estimate** when not. Task 19 left the no-invoice branch at `0 / 'unknown'`. This task wires the existing `features/carrier-rates/engine/quote()` into that branch.

**Files:**
- Create: `features/shopify-orders/sync/resolve-shipping-estimate.ts`
- Modify: `features/shopify-orders/dashboard-actions.ts`

- [ ] **Step 1: Implement `resolve-shipping-estimate.ts`**

```ts
/**
 * For an order without a shipping invoice, compute a live shipping-cost
 * estimate using the existing carrier-rates engine.
 *
 * Strategy:
 *   1. Look up the market that covers the order's ship_country.
 *   2. Find every carrier_account linked to that market.
 *   3. For each linked carrier, load the snapshot and call quote().
 *   4. Return the minimum quote (we assume the operator picks the cheapest
 *      carrier per shipment; refine post-v1 once we have selection data).
 *
 * Returns { amount, source: 'engine_estimate' } when a quote succeeds,
 * { amount: 0, source: 'unknown' } when no linked carrier covers the
 * country or no quote can be produced.
 */
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote } from '@/features/carrier-rates/engine/quote';
import { loadCarrierAccountSnapshot } from '@/features/carrier-rates/engine/load';

export interface EngineEstimateInput {
  shipCountry: string | null;
  shipWeightKg: number | null;
}

export interface EngineEstimateResult {
  amount: number;
  source: 'engine_estimate' | 'unknown';
}

export async function resolveShippingEstimate(
  input: EngineEstimateInput,
): Promise<EngineEstimateResult> {
  if (!input.shipCountry || !input.shipWeightKg) {
    return { amount: 0, source: 'unknown' };
  }

  // 1. Markets that contain this country.
  const marketRows = await db.execute<{ market_id: string }>(
    /* sql */ `SELECT DISTINCT mt.id AS market_id
                 FROM market_templates mt
                 JOIN market_template_countries c ON c.market_template_id = mt.id
                WHERE c.country_code = ${input.shipCountry}`,
  );
  if (marketRows.length === 0) return { amount: 0, source: 'unknown' };

  // 2. Carrier accounts linked to any of those markets.
  const marketIds = marketRows.map((r) => r.market_id);
  const links = await db
    .select({ carrierAccountId: schema.marketCarrierLinks.carrierAccountId })
    .from(schema.marketCarrierLinks)
    .where(inArray(schema.marketCarrierLinks.marketTemplateId, marketIds));
  if (links.length === 0) return { amount: 0, source: 'unknown' };

  // 3. Quote each carrier; pick the cheapest displayed amount.
  const carrierIds = Array.from(new Set(links.map((l) => l.carrierAccountId)));
  let best: number | null = null;
  for (const id of carrierIds) {
    const snap = await loadCarrierAccountSnapshot(id);
    const q = quote(snap, { weightKg: input.shipWeightKg, destinationCountry: input.shipCountry });
    if (q.ok) {
      const amt = q.breakdown.finalCost;
      if (best === null || amt < best) best = amt;
    }
  }
  if (best === null) return { amount: 0, source: 'unknown' };
  return { amount: best, source: 'engine_estimate' };
}
```

> **Note:** The exact column names in `market_template_countries` may differ in the existing schema; before writing this, run `grep -n market_template db/schema.ts` and adjust the SQL to the actual table/column names. The intent is the same: resolve country → markets → linked carrier accounts.

- [ ] **Step 2: Wire into `dashboard-actions.ts`**

In the per-order loop, replace the block:

```ts
} else {
  // Live engine estimate is left as a follow-up — for v1 we surface 0
  // with source='unknown' when there's no invoice. The carrier-rates
  // engine integration ships in a follow-up task.
  shippingCost = { amount: 0, source: 'unknown' };
}
```

with:

```ts
} else {
  const est = await resolveShippingEstimate({
    shipCountry: o.shipCountry,
    shipWeightKg: o.shipWeightKg !== null ? Number(o.shipWeightKg) : null,
  });
  shippingCost = { amount: est.amount * share, source: est.source };
}
```

Add the import at the top:

```ts
import { resolveShippingEstimate } from './sync/resolve-shipping-estimate';
```

- [ ] **Step 3: Smoke build**

```bash
pnpm tsc --noEmit --pretty false 2>&1 | head -10
pnpm build 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add features/shopify-orders/sync/resolve-shipping-estimate.ts \
        features/shopify-orders/dashboard-actions.ts
git commit -m "feat(orders): live shipping-cost estimate via carrier-rates engine"
```

---

### Task 20: Per-store dashboard page

**Files:**
- Create: `app/(dashboard)/f/orders/page.tsx` (landing — list of store tabs)
- Create: `app/(dashboard)/f/orders/[storeId]/page.tsx`
- Create: `components/shopify-orders/MetricsKpis.tsx`
- Create: `components/shopify-orders/MetricsTable.tsx`
- Create: `components/shopify-orders/MetricsFilters.tsx`

- [ ] **Step 1: Implement `app/(dashboard)/f/orders/page.tsx`**

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { Card, CardContent } from '@/components/ui/card';
import { ShoppingBag } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function OrdersLanding() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_orders')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }

  const stores = await db.select().from(schema.stores).where(eq(schema.stores.status, 'active'));

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ShoppingBag className="size-3.5" />
          Orders
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">Revenue dashboard</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Per-store GMV, net revenue, margin. Time-versioned cost-of-goods and reconciled shipping cost.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stores.map((s) => (
          <Link key={s.id} href={`/f/orders/${s.id}`}>
            <Card className="hover:bg-muted/30 transition-colors">
              <CardContent className="p-6">
                <div className="text-sm font-semibold">{s.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{s.shopDomain}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `MetricsKpis.tsx`** — 6 stat tiles (GMV / Refunded / Net GMV / Revenue / Margin % / Orders) reading from `AggregateMetrics`. Mirror the visual pattern of the existing surcharges page StatTile component.

- [ ] **Step 3: Implement `MetricsTable.tsx`** — paginated table rendering `MetricsBucket[]` with columns as defined in the spec; one column set for time grouping, another for vendor grouping (pick via `grouping` prop).

- [ ] **Step 4: Implement `MetricsFilters.tsx`** (client component) — preset time chips + custom date pickers + vendor multi-select (only renders when `showVendor` prop true) + grouping radio. Emits URL search params via `next/navigation`'s `useRouter`/`useSearchParams`.

- [ ] **Step 5: Implement `app/(dashboard)/f/orders/[storeId]/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { getStoreMetrics, type Grouping } from '@/features/shopify-orders/dashboard-actions';
import { MetricsKpis } from '@/components/shopify-orders/MetricsKpis';
import { MetricsTable } from '@/components/shopify-orders/MetricsTable';
import { MetricsFilters } from '@/components/shopify-orders/MetricsFilters';

export const dynamic = 'force-dynamic';

// Stores that should expose vendor filter. Hard-coded list per spec decision #4.
const VENDOR_FILTER_STORES = ['mean-store.myshopify.com'];

export default async function StoreOrders({
  params, searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ from?: string; to?: string; vendor?: string; group?: Grouping }>;
}) {
  const { storeId } = await params;
  const sp = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_orders')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) notFound();

  const dateTo = sp.to ? new Date(sp.to) : new Date();
  const dateFrom = sp.from ? new Date(sp.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const grouping = (sp.group as Grouping) ?? 'day';
  const vendorFilter = sp.vendor?.split(',').filter(Boolean);

  const showVendor = VENDOR_FILTER_STORES.includes(store.shopDomain);

  const { total, buckets } = await getStoreMetrics({
    storeId, dateFrom, dateTo,
    vendorFilter: showVendor ? vendorFilter : undefined,
    grouping,
  });

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{store.name}</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono">{store.shopDomain} · {total.currency || store.shopDomain.split('.')[0].toUpperCase()}</p>
      </header>

      <MetricsFilters
        defaultFrom={dateFrom.toISOString().slice(0, 10)}
        defaultTo={dateTo.toISOString().slice(0, 10)}
        defaultGrouping={grouping}
        defaultVendor={vendorFilter ?? []}
        showVendor={showVendor}
        availableVendors={Array.from(new Set(buckets.flatMap(() => []))).sort()}
      />

      <MetricsKpis metrics={total} />

      <MetricsTable buckets={buckets} grouping={grouping} currency={total.currency} />
    </div>
  );
}
```

- [ ] **Step 6: Smoke build + Visual check**

```bash
pnpm build 2>&1 | tail -5
pnpm dev
# Open http://localhost:3000/f/orders and click into a store
```

- [ ] **Step 7: Commit**

```bash
git add app/\(dashboard\)/f/orders/ components/shopify-orders/Metrics*.tsx
git commit -m "feat(orders): per-store dashboard with KPI tiles, filters, breakdown table"
```

---

### Task 21: Admin sync-health page

**Files:**
- Create: `app/(dashboard)/admin/shopify-sync-health/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, desc, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { registerOrderWebhooks } from '@/features/shopify-orders/webhook/register-subscriptions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function SyncHealth() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_stores')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }

  const stores = await db
    .select({
      id: schema.stores.id,
      name: schema.stores.name,
      shopDomain: schema.stores.shopDomain,
      state: schema.shopifySyncState,
    })
    .from(schema.stores)
    .leftJoin(schema.shopifySyncState, eq(schema.shopifySyncState.storeId, schema.stores.id))
    .where(eq(schema.stores.status, 'active'));

  const webhookCounts = await db.execute<{ store_id: string; ok: string; failed: string }>(sql`
    SELECT store_id,
           SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END)::text AS ok,
           SUM(CASE WHEN status IN ('failed','rejected') THEN 1 ELSE 0 END)::text AS failed
      FROM shopify_webhook_log
     WHERE received_at > NOW() - INTERVAL '24 hours'
     GROUP BY store_id;
  `);
  const wcMap = new Map(webhookCounts.map((w) => [w.store_id, w]));

  async function reregisterAction(formData: FormData): Promise<void> {
    'use server';
    const storeId = String(formData.get('storeId'));
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
    if (store) await registerOrderWebhooks(store);
    revalidatePath('/admin/shopify-sync-health');
  }

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <h1 className="text-3xl font-semibold tracking-tight">Shopify sync health</h1>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left px-4 py-2">Store</th>
                <th className="text-left px-4 py-2">Backfill</th>
                <th className="text-left px-4 py-2">Last webhook</th>
                <th className="text-left px-4 py-2">Last cron</th>
                <th className="text-right px-4 py-2">Webhooks 24h (ok / failed)</th>
                <th className="text-right px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => {
                const wc = wcMap.get(s.id);
                const ago = (d: Date | null) => d ? `${Math.round((Date.now() - new Date(d).getTime()) / 60000)} min ago` : '—';
                return (
                  <tr key={s.id} className="border-b border-border/40">
                    <td className="px-4 py-2">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs font-mono text-muted-foreground">{s.shopDomain}</div>
                    </td>
                    <td className="px-4 py-2">{s.state?.backfillStatus ?? 'idle'}</td>
                    <td className="px-4 py-2">{ago(s.state?.lastWebhookAt)}</td>
                    <td className="px-4 py-2">{ago(s.state?.lastCronSyncAt)}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {wc?.ok ?? '0'} / <span className="text-destructive">{wc?.failed ?? '0'}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <form action={reregisterAction}>
                        <input type="hidden" name="storeId" value={s.id} />
                        <Button type="submit" size="sm" variant="outline">Re-register</Button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Smoke build**
- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/admin/shopify-sync-health/
git commit -m "feat(orders): admin sync-health page + per-store re-register webhook action"
```

---

### Task 22: Health card on the store dashboard

**Files:**
- Create: `components/shopify-orders/HealthCard.tsx`
- Modify: `app/(dashboard)/f/orders/[storeId]/page.tsx` — render `<HealthCard />`.

- [ ] **Step 1: Implement `HealthCard.tsx`**

```tsx
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { Card, CardContent } from '@/components/ui/card';

interface HealthCardProps { storeId: string }

export async function HealthCard({ storeId }: HealthCardProps) {
  const [state] = await db
    .select().from(schema.shopifySyncState)
    .where(eq(schema.shopifySyncState.storeId, storeId));
  const counts = await db.execute<{ ok: string; failed: string }>(sql`
    SELECT SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END)::text AS ok,
           SUM(CASE WHEN status IN ('failed','rejected') THEN 1 ELSE 0 END)::text AS failed
      FROM shopify_webhook_log
     WHERE store_id = ${storeId} AND received_at > NOW() - INTERVAL '24 hours';
  `);
  const ago = (d: Date | null | undefined) =>
    d ? `${Math.round((Date.now() - new Date(d).getTime()) / 60000)} min ago` : '—';
  return (
    <Card>
      <CardContent className="p-4 text-xs space-y-1">
        <div className="uppercase tracking-wider text-muted-foreground mb-2">Sync health</div>
        <div>Last webhook: <span className="font-mono">{ago(state?.lastWebhookAt)}</span></div>
        <div>Last cron: <span className="font-mono">{ago(state?.lastCronSyncAt)}</span></div>
        <div>Backfill: <span className="font-mono">{state?.backfillStatus ?? 'idle'}</span></div>
        <div>
          Webhooks 24h: <span className="font-mono">{counts[0]?.ok ?? '0'} ok</span>
          {' · '}
          <span className="font-mono text-destructive">{counts[0]?.failed ?? '0'} failed</span>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Drop into the store page**

In `app/(dashboard)/f/orders/[storeId]/page.tsx`, after the header, render:

```tsx
<HealthCard storeId={storeId} />
```

- [ ] **Step 3: Smoke build**
- [ ] **Step 4: Commit**

```bash
git add components/shopify-orders/HealthCard.tsx app/\(dashboard\)/f/orders/\[storeId\]/page.tsx
git commit -m "feat(orders): per-store sync health card"
```

---

### Task 23: Navigation entry

**Files:**
- Modify: `lib/nav.ts`

- [ ] **Step 1: Add an "Orders" entry**

Look at existing entries and append a parallel one routed to `/f/orders`, gated on `view_orders` permission.

- [ ] **Step 2: Commit**

```bash
git add lib/nav.ts
git commit -m "feat(orders): nav entry"
```

---

### Task 24: Playwright E2E — happy path

**Files:**
- Create: `e2e/orders.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';

test('orders dashboard renders with KPI tiles after sign-in', async ({ page }) => {
  await page.goto('/sign-in');
  // Reuse the existing sign-in helper from other e2e specs if present.
  // (Pattern: features/markets/apply.e2e.ts or similar.)
  await page.fill('input[name="email"]', 'admin@example.com');
  await page.fill('input[name="password"]', process.env.E2E_PASSWORD ?? 'test1234');
  await page.click('button[type="submit"]');

  await page.goto('/f/orders');
  await expect(page.locator('h1')).toContainText('Revenue dashboard');

  // Click into the first store card
  await page.locator('a[href^="/f/orders/"]').first().click();
  await expect(page.locator('h1')).toBeVisible();

  // KPI tiles visible
  await expect(page.locator('text=GMV')).toBeVisible();
  await expect(page.locator('text=Revenue')).toBeVisible();
});
```

- [ ] **Step 2: Run**

```bash
pnpm test:e2e e2e/orders.spec.ts
```

Expected: PASS (or document any environment-setup steps).

- [ ] **Step 3: Commit**

```bash
git add e2e/orders.spec.ts
git commit -m "test(orders): e2e happy path"
```

---

## Phase 5 — Wrap-up

### Task 25: Final integration smoke + PR

**Files:** none new

- [ ] **Step 1: Full check**

```bash
pnpm tsc --noEmit --pretty false 2>&1 | head -20
pnpm lint 2>&1 | tail -20
pnpm test -- --run 2>&1 | tail -10
pnpm build 2>&1 | tail -10
```

All must come back clean / green.

- [ ] **Step 2: Open PR**

```bash
git push -u origin spec/shopify-orders
gh pr create --title "feat(orders): Shopify ingestion + revenue dashboard (spec 2026-05-28)" --body "$(cat <<'EOF'
## Summary

Pulls every Shopify order for the trailing 12 months across all connected
stores, ingests SKU costs + shipping invoices via CSV, and surfaces a
per-store revenue dashboard.

## Phases shipped

- Phase 1: schema + upsertOrder() + revenue formulas + RBAC.
- Phase 2: webhook receiver + bulkOperation backfill + hourly safety-net cron.
- Phase 3: SKU cost CSV + shipping invoice CSV with upload UI.
- Phase 4: per-store dashboard, admin sync-health, nav entry.

## Test plan

- [x] tsc clean
- [x] lint clean
- [x] all unit + integration tests pass
- [x] e2e smoke passes
- [ ] Railway cron service `orders-cron` added (manual step — see README)
- [ ] read_orders scope added to SHOPIFY_SCOPES env
- [ ] Re-register webhooks for each existing store via /admin/shopify-sync-health
- [ ] Run pnpm cron:backfill-orders --store=<id> for each active store
EOF
)"
```

- [ ] **Step 3: Wait for CI then squash-merge per finish-branch default.**

---

## Open improvement (post-v1, not blocking)

- The PAGED_QUERY in `hourly-sync.ts` re-states the same field selection as the bulkOperation in `submit-bulk-query.ts`. After v1 ships, extract the shared selection set to one constant in `features/shopify-orders/backfill/orders-fields.gql.ts` and import it from both call sites.
- Currency conversion across stores for a "global" view (deferred to v2 per spec).
- Carrier-selection logic in `resolveShippingEstimate` currently picks the cheapest linked carrier per shipment. Once Markets apply runs and store-overrides record the actual chosen carrier per (market, store), feed that picker so the engine estimate matches the carrier that would actually have shipped.
