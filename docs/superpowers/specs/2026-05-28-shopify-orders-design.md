# Shopify orders ingestion + revenue dashboard — design

**Date:** 2026-05-28
**Author:** lmtiep
**Status:** Draft → awaiting implementation plan

## Problem

The current Shopify Management System reports nothing about commerce performance. Operators see GMV implicitly through the Shopify admin, but cannot:

- Compare GMV vs **real revenue** (GMV minus cost-of-goods, shipping cost, and discount cost).
- Slice across multiple stores in one view.
- See vendor-level profitability for the MEAN store.
- Reconcile estimated shipping cost (from our carrier-rates engine) against actual carrier invoices.
- Detect missing SKU costs that silently break margin calculations.

This spec covers v1: pull every order across every connected store for the trailing 12 months, ingest cost-of-goods and shipping-invoice CSVs, and surface a per-store dashboard with KPI tiles and a time-series breakdown.

## Goals (v1)

- Persist every Shopify order and line item for the last 12 months in our Postgres so reports can re-slice without re-fetching.
- Keep data fresh through Shopify webhooks (real-time) with an hourly cron safety-net.
- Ingest cost-of-goods per SKU through CSV upload (time-versioned).
- Ingest carrier invoices through CSV upload and reconcile against live engine estimates.
- Compute consistent metrics per order: GMV, refunded, discount, shipping revenue, shipping cost, SKU cost, and **revenue**.
- Render per-store dashboard tabs with time filter and (for MEAN only) vendor filter.

## Non-goals (v1)

- Multi-currency display conversion (each store renders in its native currency; v2 will add FX).
- Single-order drill-down page (v1.1).
- Email / Slack alerts on sync health (v2 — health card on dashboard is enough for v1).
- API integration with the brand cost system (CSV-only; the integration is a future spec).
- Customer cohort, discount-code ROI, channel attribution (separate spec).
- Cash-basis refund accounting (we use Gross + a separate Refunded column).
- Tax accounting beyond pass-through (tax is reported but not deducted from revenue).

## Decisions (sticky for downstream specs)

1. **Cost source v1 = CSV upload.** API integration with the brand ERP is deferred.
2. **All connected stores + hybrid sync** = webhook (real-time) + hourly cron (safety-net). No per-store opt-in.
3. **Backfill = trailing 12 months** from the moment we run the script, hard-coded, manually triggered per store.
4. **Per-store tab + time filter + vendor filter (MEAN only).** Vendor filter is conditional on `storeId === MEAN`.
5. **Hybrid shipping cost** = live engine estimate by default; replaced by actual when matching `shipping_invoices` row exists. A "variance" column surfaces the delta when both are known.
6. **Gross GMV + separate Refunded column** — refunds are NOT netted by default.
7. **Per-store native currency only in v1.** Dashboard labels currency clearly.
8. **Order scope: paid + cancelled + refunded.** Drafts and abandoned carts are not stored.
9. **Webhook topics**: `orders/create`, `orders/updated`, `orders/cancelled`, `refunds/create`.
10. **Hourly cron**: `5 * * * *` UTC, safety net.

## Architecture

### High-level picture

```
                          ┌─────────────────────────────┐
                          │  Shopify (per store)        │
                          │  GraphQL Admin + Webhooks   │
                          └──────────┬──────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
        ▼                            ▼                            ▼
┌───────────────┐          ┌──────────────────┐         ┌──────────────────┐
│ Backfill cron │          │ Webhook endpoint │         │ Hourly cron      │
│ (on demand,   │          │ /api/webhooks/   │         │ safety-net,      │
│ bulkOperation)│          │  shopify/[topic] │         │ poll updated_at  │
└──────┬────────┘          └──────────┬───────┘         └──────────┬───────┘
       │                              │                            │
       └──────────────┬───────────────┴────────────────────────────┘
                      ▼
              ┌────────────────────┐
              │  upsertOrder()     │ ← single source of truth
              │  (idempotent)      │
              └─────────┬──────────┘
                        ▼
          ┌─────────────────────────────────┐
          │ Postgres                        │
          │  shopify_orders                 │
          │  shopify_order_lines            │
          │  shopify_order_refunds          │
          │  sku_costs (CSV)                │
          │  shipping_invoices (CSV)        │
          │  shopify_sync_state             │
          │  shopify_webhook_log            │
          └────────────┬────────────────────┘
                       │
                       ▼
          ┌─────────────────────────────┐
          │ Dashboard                   │
          │ /f/orders/[storeId]         │
          │ + carrier-rates engine for  │
          │   live shipping estimates   │
          └─────────────────────────────┘
```

### Feature module layout

Follow the existing `features/<key>/` convention:

```
features/shopify-orders/
├── sync/
│   ├── upsert-order.ts            # Shared idempotent upsert
│   ├── upsert-order.test.ts
│   ├── shopify-mapper.ts          # Shopify payload → internal shape
│   └── shopify-mapper.test.ts
├── backfill/
│   ├── run-backfill.ts            # Per-store, bulkOperation flow
│   └── poll-bulk-operation.ts
├── webhook/
│   ├── verify-hmac.ts
│   ├── verify-hmac.test.ts
│   └── dispatch.ts                # Topic → handler
├── cron/
│   └── hourly-sync.ts             # Safety-net poller
├── csv-upload/
│   ├── parse-sku-costs.ts
│   ├── parse-sku-costs.test.ts
│   ├── parse-shipping-invoice.ts
│   ├── parse-shipping-invoice.test.ts
│   ├── apply-sku-costs.ts         # Server action
│   └── apply-shipping-invoice.ts  # Server action
├── metrics/
│   ├── compute.ts                 # Pure: OrderMetrics
│   ├── compute.test.ts
│   ├── aggregate.ts               # Pure: AggregateMetrics
│   └── aggregate.test.ts
├── dashboard-actions.ts           # Server actions for the UI
└── __fixtures__/                  # Shopify JSON samples for tests
```

Plus the route surface:

```
app/api/webhooks/shopify/[topic]/route.ts
app/(dashboard)/f/orders/page.tsx
app/(dashboard)/f/orders/[storeId]/page.tsx
app/(dashboard)/f/orders/[storeId]/costs/page.tsx
app/(dashboard)/f/orders/[storeId]/shipping-invoices/page.tsx
app/(dashboard)/admin/shopify-sync-health/page.tsx
scripts/cron/backfill-shopify-orders.ts
scripts/cron/sync-shopify-orders.ts
```

## Data model

7 new tables. All amounts use `numeric(14,2)` unless noted; SKU cost uses `numeric(14,4)` for finer precision.

### `shopify_orders`

```
id                       uuid pk
store_id                 uuid fk → stores.id
shopify_order_id         text unique
shopify_order_number     text                           — e.g. "#1234"
created_at_shopify       timestamp                      — order placed
processed_at_shopify     timestamp                      — payment captured (canonical date for reports)
cancelled_at_shopify     timestamp null
financial_status         text                           — 'paid' | 'partially_refunded' | 'refunded' | 'pending' | 'voided'
fulfillment_status       text null                      — 'fulfilled' | 'partial' | null
currency                 text
gross_line_total         numeric(14,2)                  — Σ(line.original_unit_price × line.qty), TRUE gross before any discount; this is GMV
total_discount           numeric(14,2)                  — Shopify totalDiscountsSet (covers BOTH line-level + order-level discounts)
total_shipping           numeric(14,2)                  — shipping revenue (charged to customer)
total_tax                numeric(14,2)
total_price              numeric(14,2)                  — Shopify's grand total
ship_country             text                           — ISO-2, used by carrier-rates engine
ship_weight_kg           numeric(10,3) null
raw_payload              jsonb                          — full Shopify response (audit + future re-shape)
synced_at                timestamp
source                   text                           — 'webhook' | 'cron' | 'backfill'

INDEX (store_id, processed_at_shopify)
INDEX (store_id, cancelled_at_shopify) WHERE cancelled_at_shopify IS NOT NULL
UNIQUE (shopify_order_id)
```

### `shopify_order_lines`

```
id                 uuid pk
order_id           uuid fk → shopify_orders.id ON DELETE CASCADE
shopify_line_id    text
sku                text null
vendor             text null                            — Shopify product.vendor; used by MEAN's vendor filter
product_title      text
variant_title      text null
quantity           int
unit_price         numeric(14,2)                        — per-unit price BEFORE discount
discount_alloc     numeric(14,2)                        — Shopify-allocated discount on this line
total              numeric(14,2)                        — (unit_price × qty) − discount_alloc

INDEX (order_id)
INDEX (sku) WHERE sku IS NOT NULL
INDEX (vendor) WHERE vendor IS NOT NULL
```

### `shopify_order_refunds`

```
id                 uuid pk
order_id           uuid fk → shopify_orders.id ON DELETE CASCADE
shopify_refund_id  text unique
refunded_at        timestamp                            — Shopify processed_at on the refund
amount             numeric(14,2)                        — total refunded (subtotal + tax + ship portions)
reason             text null

INDEX (order_id)
INDEX (refunded_at)
```

### `sku_costs`

```
id              uuid pk
store_id        uuid fk → stores.id                     — costs are scoped to a store (catalogs differ)
sku             text
cost_per_unit   numeric(14,4)
currency        text                                    — ISO-3, validated
effective_from  date                                    — order with processed_at >= this uses this cost
source          text                                    — 'csv:<filename>' | 'manual' | 'api'
uploaded_by     text fk → user.id null
uploaded_at     timestamp default now()

UNIQUE (store_id, sku, effective_from)
INDEX (store_id, sku, effective_from DESC)              — drives the cost-lookup query
```

### `shipping_invoices`

```
id                    uuid pk
store_id              uuid fk → stores.id
carrier_account_id    uuid fk → carrier_accounts.id
tracking_number       text
invoice_period_start  date
invoice_period_end    date
actual_cost           numeric(14,2)
currency              text
uploaded_at           timestamp default now()
source                text                              — 'csv:<filename>'

UNIQUE (store_id, tracking_number)                       — one truth per shipment
INDEX (carrier_account_id, invoice_period_start)         — audit / period reporting
```

### `shopify_sync_state`

```
id                       uuid pk
store_id                 uuid fk → stores.id UNIQUE
backfill_status          text                            — 'idle' | 'running' | 'done' | 'failed'
backfill_cursor          text null                       — Shopify bulkOperation id
backfill_started_at      timestamp null
backfill_finished_at     timestamp null
backfill_error           text null
last_webhook_at          timestamp null                  — heartbeat
last_cron_sync_at        timestamp null                  — last hourly safety-net run
last_cron_cursor         text null                       — Shopify orders updated_at watermark
```

### `shopify_webhook_log`

```
id                    uuid pk
store_id              uuid fk → stores.id
topic                 text                              — 'orders/create' etc.
shopify_webhook_id    text                              — header X-Shopify-Webhook-Id, our idempotency key
received_at           timestamp default now()
processed_at          timestamp null
status                text                              — 'received' | 'processed' | 'rejected' | 'failed'
error                 text null
payload_hash          text                              — sha256 of body, for secondary dedup

UNIQUE (shopify_webhook_id)
INDEX (store_id, received_at DESC)
```

## Sync mechanism

Three independent channels write through the same `upsertOrder()`. All channels are idempotent on `shopify_order_id`.

### Backfill (on demand, per store)

- Script: `scripts/cron/backfill-shopify-orders.ts`
- Manual trigger: `pnpm cron:backfill-orders --store=<id>`
- Flow:
  1. Read `shopify_sync_state`; abort if `backfill_status='running'`.
  2. Mark `running`, stamp `backfill_started_at`.
  3. Submit `bulkOperationRunQuery` with `orders(query: "created_at:>=<12-months-ago>")` selecting every field we persist (order + lines + refunds + fulfillments.trackingInfo).
  4. Store `bulkOperation.id` in `backfill_cursor`.
  5. Poll `currentBulkOperation` every 30s. Watchdog cancels and restarts if stuck > 2h.
  6. On `COMPLETED`, stream the result JSONL line by line, upserting in batches of 100 orders per transaction.
  7. Mark `done`, stamp `backfill_finished_at`. On any failure, mark `failed` and write `backfill_error`.

We use bulkOperation because Shopify recommends it above ~500 orders and it bypasses the per-second cost budget.

### Webhook (real-time)

- Route: `app/api/webhooks/shopify/[topic]/route.ts` (dynamic segment carries the topic name, kebab-case in URL).
- Subscribed topics: `orders/create`, `orders/updated`, `orders/cancelled`, `refunds/create`.
- Per-request flow:
  1. Read raw body. Verify HMAC SHA256 against `SHOPIFY_API_SECRET` via header `X-Shopify-Hmac-Sha256`. On mismatch → 401, log `rejected`, no further work.
  2. Read `X-Shopify-Webhook-Id`. If `shopify_webhook_log` already has this id with status `processed` → return 200 immediately (idempotent).
  3. Identify store via `X-Shopify-Shop-Domain` → `stores.shop_domain`.
  4. Insert `webhook_log` row with `status='received'`.
  5. Dispatch by topic:
     - `orders/create` / `orders/updated` → `upsertOrder()`.
     - `orders/cancelled` → set `cancelled_at_shopify` on the existing row.
     - `refunds/create` → insert into `shopify_order_refunds` (the parent order should already exist; if not, log and 200 — the next webhook or hourly cron will fill it).
  6. Update `webhook_log.status='processed'` and `processed_at`.
  7. Return 200. Must complete within Shopify's 5s ceiling; everything in this path is local DB work, well under budget.

Webhook subscription registration happens when a store is connected (and a one-time backfill registers them on already-connected stores, see Open Assumptions).

### Hourly safety-net cron

- Script: `scripts/cron/sync-shopify-orders.ts`
- Schedule: `5 * * * *` UTC (hourly, minute 5 to dodge top-of-hour traffic).
- Per-store flow (with `pg_try_advisory_xact_lock(hash(store_id))` to avoid overlap):
  1. Read `last_cron_sync_at`.
  2. Query `orders(query: "updated_at:>=<last_cron_sync_at>")` with cursor pagination.
  3. Upsert every order via the shared function.
  4. Update `last_cron_sync_at = now`, `last_cron_cursor = end_cursor`.

Idempotent — overlap between webhook and cron simply re-writes the same row from `raw_payload`.

### Shared `upsertOrder()`

```ts
export async function upsertOrder(
  storeId: string,
  payload: ShopifyOrderPayload,
  source: 'webhook' | 'cron' | 'backfill',
): Promise<void>
```

1. `INSERT INTO shopify_orders ... ON CONFLICT (shopify_order_id) DO UPDATE` writing every field plus a fresh `raw_payload`.
2. `DELETE FROM shopify_order_lines WHERE order_id = ?` then re-`INSERT` (clean re-sync — line ids can churn on Shopify edits).
3. For each refund in payload: `INSERT ... ON CONFLICT (shopify_refund_id) DO NOTHING`.
4. All steps in a single Postgres transaction.

### Rate-limiting

- Shopify GraphQL: 50 cost-points/sec. The hourly cron throttles to ~10 req/sec with `p-throttle` for safety margin.
- BulkOperation: cost-points exempt; only one per store at a time.
- Webhook: no per-store budget.

## Cost data ingestion

Two CSV uploads behind a shared pipeline (`features/shopify-orders/csv-upload/`).

### SKU costs

Format:

```csv
sku,cost,currency,effective_from
MEAN-SHIRT-001,12.50,USD,2026-05-01
CICI-BAG-A,520000,VND,2026-05-01
```

- `effective_from` blank → today (UTC).
- Currency must be a valid ISO-3 code.
- Per-store upload page: `/f/orders/[storeId]/costs`.
- Preview shows first 20 rows + summary: `X valid · Y warnings (unknown SKU, currency mismatch) · Z errors`.
- "Unknown SKU" = SKU not seen yet in any line item for this store. Warn but allow — new SKUs are valid.
- **Currency consistency:** cost row currency should match the store's `display_currency` (looked up in `stores.plan` / a future per-store currency column — for v1 we read from the first order's currency for the store). Mismatch is a warning, not an error: an operator may legitimately price a SKU in a different currency. The cost-lookup step records the cost currency unchanged; the dashboard surfaces a "currency mismatch" badge on affected orders.
- On import: bulk INSERT with `ON CONFLICT (store_id, sku, effective_from) DO UPDATE`.
- History tab lists past uploads (date, filename, row count, uploader).

Cost-lookup query per line item:

```sql
SELECT cost_per_unit, currency
  FROM sku_costs
 WHERE store_id = $1 AND sku = $2
   AND effective_from <= $3   -- order.processed_at_shopify::date
 ORDER BY effective_from DESC
 LIMIT 1
```

Orders with at least one line that does not resolve a cost are flagged `cost_unknown=true` in the dashboard health card.

### Shipping invoices

Format:

```csv
tracking_number,actual_cost,currency,date
1234567890,12.50,USD,2026-04-15
```

- Per-store upload page: `/f/orders/[storeId]/shipping-invoices`. Operator picks carrier account + invoice period.
- Validation warns on unmatched `tracking_number` (no fulfillment in our orders points to it) but stores anyway — late-arriving orders can pick it up later.
- On import: `INSERT ... ON CONFLICT (store_id, tracking_number) DO UPDATE`.

Reconciliation when computing `OrderMetrics.shippingCost`:

1. If `shipping_invoices` has a row matching the order's tracking_number → `actual` cost, `source='invoice'`.
2. Else → live engine estimate from `features/carrier-rates/engine/quote()`, `source='engine_estimate'`.
3. If both known → "variance" column on dashboard surfaces actual − estimate.

## Dashboard + revenue computation

### Route surface

```
/f/orders                                     — landing: store-tab strip + global summary
/f/orders/[storeId]                           — per-store dashboard
/f/orders/[storeId]/costs                     — SKU cost upload + history
/f/orders/[storeId]/shipping-invoices         — invoice upload + history
```

### Per-store dashboard

- **KPI strip** (6 tiles, all respect time + vendor filter): GMV · Refunded · Net GMV · Revenue · Margin % · Orders.
- **Filter bar**: time-range chips (Today / 7d / 30d / 90d / YTD / Custom), vendor multi-select (MEAN only), grouping radio (Day / Week / Month / Vendor — Vendor only on MEAN).
- **Chart**: stacked area, time-series; stacks are Revenue, Ship cost, Discount, SKU cost (summing back to GMV).
- **Breakdown table**: paginated and sortable. Columns vary by grouping:
  - Day/Week/Month: Period · Orders · GMV · Refunded · Discount · Ship rev · Ship cost (with `actual` / `estimate` badge) · SKU cost · Revenue · Margin %.
  - Vendor: Vendor · Orders · GMV · Discount · Ship cost share · SKU cost · Revenue · Margin %.
- **Health card** (sidebar): last webhook age, last cron run, backfill state, cost coverage %, ship-actual vs estimate count. Each clickable into a list view of the offending orders.

### Revenue formulas

Single source of truth in `features/shopify-orders/metrics/compute.ts`:

```ts
interface OrderMetrics {
  orderId: string;
  gmv: number;                    // = gross_line_total (Σ original_unit_price × qty, pre any discount)
  refundedAmount: number;         // Σ refunds in window
  netGmv: number;                 // = gmv − refundedAmount
  discount: number;               // = total_discount (line + order level combined, per Shopify totalDiscountsSet)
  shippingRevenue: number;        // = total_shipping
  shippingCost: number;           // actual | engine_estimate | 0 if unknown
  shippingCostSource: 'invoice' | 'engine_estimate' | 'unknown';
  skuCost: number;                // Σ(line.qty × cost_per_unit_at_processed_at)
  skuCostCoverage: number;        // 0–1, fraction of lines that resolved a cost
  tax: number;                    // shown on drill-down; NOT subtracted from revenue (already excluded from price flows)
  revenue: number;                // netGmv − discount + shippingRevenue − shippingCost − skuCost
  margin: number;                 // revenue / netGmv when netGmv > 0
  currency: string;               // order's native currency, no conversion in v1
}
```

`aggregateMetrics(orders: OrderMetrics[])` sums each field and computes a weighted-average margin. Both functions are pure → fully unit-tested without a DB.

### Server actions

`features/shopify-orders/dashboard-actions.ts`:

- `getStoreMetrics(storeId, dateFrom, dateTo, vendorFilter?, grouping)` — single SQL aggregation across `shopify_orders`, `shopify_order_lines`, `sku_costs`, `shipping_invoices` with `date_trunc` on `processed_at_shopify`.
  - **Vendor filter semantics (MEAN only):** when `vendorFilter` is set, GMV / discount / ship cost / SKU cost are computed at line-level (only lines whose `vendor` matches contribute). Order-level fields (Refunded, Shipping revenue) are split pro-rata across the matching lines' share of `gross_line_total`. "Orders" count = `COUNT(DISTINCT order_id)` of orders that contain at least one matching line — so an order with lines from two vendors counts as 1 in each vendor's view.
- `getMissingCostOrders(storeId, dateFrom, dateTo)` — list orders flagged `cost_unknown=true`.
- `getMissingInvoiceShipments(storeId, dateFrom, dateTo)` — list shipments still on engine estimate.

### Permissions (new entries in `lib/auth/rbac.ts`)

- `view_orders` — required for dashboard routes.
- `manage_sku_costs` — required for SKU cost upload + edit.
- `manage_shipping_invoices` — required for invoice upload + edit.

## Error handling

| Failure | Detection | Response |
|---|---|---|
| Webhook HMAC mismatch | `verify-hmac.ts` returns false | 401, `webhook_log.status='rejected'`, increment rejection counter. Do not process. |
| Webhook duplicate | `shopify_webhook_id` in `webhook_log` | 200 idempotent, log skipped. |
| Webhook timeout (>5s) | Shopify retries with same `webhook_id` | Idempotent upsert handles it. |
| Webhook payload malformed | JSON parse / shape validation fails | 500 (Shopify retries 19 times over 48h); `webhook_log.status='failed'` with error. |
| GraphQL rate limit | `extensions.cost.throttleStatus` below threshold | Sleep with jitter, exponential backoff up to 60s. |
| BulkOperation FAILED | Poll returns `status='FAILED'` | `backfill_status='failed'`, write error, exit non-zero (Railway alerts). |
| BulkOperation stuck > 2h | Watchdog in poll loop | Cancel via `bulkOperationCancel`; restart. |
| Hourly cron overlap | Two runs hit same store | `pg_try_advisory_xact_lock(hash(store_id))`; loser skips. |
| Webhook + cron race on same order | Both upsert simultaneously | `ON CONFLICT DO UPDATE` is atomic; last-write-wins is correct because `raw_payload` is the full snapshot. |
| Order with unknown SKU cost | Cost lookup empty | Flag `cost_unknown=true`, count toward coverage %, do not block dashboard. |
| Order with no tracking | `raw_payload.fulfillments` empty | Ship cost = engine estimate; UI shows badge. |
| CSV malformed row | Pure parser flags it | Block import, show row-level error list, allow re-upload. |
| CSV partial duplicate | Upsert key collision | ON CONFLICT UPDATE; newer wins; receipt shows "X rows overwritten". |

## Observability

- **Health card** on `/f/orders/[storeId]` — operator-facing answer to "is sync working?".
- **Admin page** `/admin/shopify-sync-health` — table of every store with backfill state, last webhook age, webhook success rate (24h), cron last run. Color-coded green/yellow/red.
- **No external APM in v1.** Railway logs + the in-app `shopify_webhook_log` and `shopify_sync_state` tables cover observation. Sentry/Highlight can be added later by wrapping the webhook route handler.

## Testing strategy

### Unit tests (Vitest, fast, 80% coverage gate)

- `compute.ts` — table-driven across normal, refund, partial discount, unknown SKU cost, missing ship invoice.
- `aggregate.ts` — weighted-average margin, edge cases (zero netGmv).
- `parse-sku-costs.ts`, `parse-shipping-invoice.ts` — pure CSV parsers, table-driven.
- `verify-hmac.ts` — pure crypto check.
- `shopify-mapper.ts` — feed fixture JSONL → assert internal shape.

### Integration tests (Vitest with test DB)

- Full webhook flow: HMAC → idempotency → upsert → metrics query returns correct result.
- BulkOperation parse: fixture JSONL → assert N orders + M lines inserted correctly.
- Cost lookup with `effective_from`: 3 cost rows for same SKU at different dates → assert the right cost is picked per order date.
- Refund event after order: `refundedAmount` aggregates correctly.

### E2E tests (Playwright)

- Upload SKU cost CSV → preview → import → verify import receipt → dashboard coverage % updates.
- Time filter change → KPI tiles + chart re-render.
- Vendor filter on MEAN tab → metrics drop accordingly.

### Fixtures

`features/shopify-orders/__fixtures__/` holds sanitized real Shopify payloads:
- Single-line paid order.
- Multi-line refunded order.
- Partial fulfillment.
- Order with discount codes.
- Order with no tracking number.

## Rollout plan (4 phases, ~4 weeks solo)

```
Phase 1 — Foundation (1 week)
  • Schema migration (7 tables) + tests
  • upsertOrder() core + tests
  • compute.ts and aggregate.ts + tests
  • RBAC entries

Phase 2 — Data pipelines (1 week)
  • Backfill script with bulkOperation polling
  • Webhook endpoint with HMAC verify + topic dispatch
  • Webhook subscription registration on store connect
  • Hourly safety-net cron

Phase 3 — Cost & invoice ingestion (3–4 days)
  • SKU cost CSV parser + apply
  • Shipping invoice CSV parser + apply
  • Upload UI for both

Phase 4 — Dashboard surface (1 week)
  • Per-store dashboard route + KPI tiles + chart
  • Time filter + vendor filter
  • Health card + admin sync-health page
  • E2E tests
```

Phase 1 must ship before any other phase. Phase 3 and Phase 4 can proceed in parallel once Phase 2 is open.

## Open assumptions to confirm before the implementation plan

1. **Webhook URL public:** webhooks register at `${SHOPIFY_APP_URL}/api/webhooks/shopify/<topic>` (today: `https://shopify-management-system-production.up.railway.app/...`). The Railway main-app service already serves this hostname; no infra change needed.
2. **Shopify scopes:** today's scopes are `read_shipping,read_checkout_branding,read_products,write_shipping,write_shop_settings`. We must add `read_orders`. Every store will need to re-install (or accept a scope upgrade prompt) before the new module can sync.
3. **Existing stores already connected:** v1 ships with a one-shot "Re-register webhooks" admin action so legacy stores subscribe to the new topics without re-installing the app.

## References

- Carrier rates engine: `features/carrier-rates/engine/quote.ts` — used for live shipping estimates.
- Existing connector: `lib/shopify/connector.ts` (read-only) and `lib/shopify/writer.ts` (mutation path) — extend with order-specific queries.
- CSV parser pattern to mirror: `features/carrier-rates/postcodes-csv.ts`.
- Cron pattern to mirror: `scripts/cron/refresh-fedex-fuel.ts` and the Railway cron service `fuel-cron`.
