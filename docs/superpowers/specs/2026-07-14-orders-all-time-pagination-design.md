# Orders page — all-time server-side pagination

**Date:** 2026-07-14
**Status:** Approved (design)

## Problem

After the full-history backfill, historical orders (e.g. tinhatelier now has 1276
orders back to 2024-07) are in the DB but invisible in the store's orders page.
The page defaults to the last 30 days and caps its cache at 120 days
(`CACHE_DAYS`), with date presets only up to YTD. Operators expect the orders
section to show **all orders from the beginning**, browsable page by page — not
capped by a date window.

## Decisions (from brainstorming)

1. **KPI cards stay date-ranged.** The metrics panel (revenue, margin, cost…)
   remains a windowed analytics tool (7d/30d/90d/YTD), unchanged.
2. **Order list becomes independent + all-time, server-side paginated.** Each
   page load fetches only that page's rows (~25–250) from the server — payload
   stays small and constant regardless of store size.
3. **Search is server-side over all orders** (by order number / recipient name),
   not a client-side filter over the loaded page.

## Architecture

The orders page splits into two independent blocks:

| Block | Data source | Scope |
|---|---|---|
| KPI cards + date presets | `getStoreMetrics(window)` — unchanged | Date range |
| Orders table (new: server-paginated) | `getStoreOrdersPage(...)` — new | All history |

### New server action: `getStoreOrdersPage`

```
getStoreOrdersPage({
  storeId: string,
  page: number,        // 0-based
  pageSize: number,    // 25 | 50 | 100 | 250
  search?: string,     // matches order number OR recipient name, ILIKE
  sort?: 'newest' | 'oldest',  // default 'newest'
}): Promise<{ rows: OrderRow[]; totalCount: number }>
```

- Query: `SELECT ... FROM shopify_orders WHERE store_id = ?
  [AND (shopify_order_number ILIKE %q% OR ship_name ILIKE %q%)]
  ORDER BY created_at_shopify {DESC|ASC} LIMIT pageSize OFFSET page*pageSize`.
- `totalCount = COUNT(*)` with the same WHERE (cheap; `store_id` is indexed).
- Per-order metrics (cost/margin/ship) are computed only for the ≤250 rows of the
  current page.

### Shared metrics function

`getStoreMetrics` currently mixes "fetch orders in window" with "compute per-order
metrics". Extract `computeOrderMetrics(orders, deps)` (lines, refunds, sku costs,
shipping invoices, shipment charges → `OrderRow[]`) so both the KPI window path
and the table-page path reuse identical logic — no duplication, and it draws a
clean boundary in a file that had grown tangled.

### Data flow (table)

`page / pageSize / search / sort` live in URL params. The server component reads
them, calls `getStoreOrdersPage`, and renders the current page. Changing page /
search / sort issues `router.replace` to update the URL → server refetches just
that page. `OrdersTable` drops its client-side `slice`; it receives `rows`,
`totalCount`, and the current page/pageSize from the server and renders directly.

## Unchanged

KPI cards, date presets, order detail popover (`getOrderDetail`), `view_orders`
permission gating, page-size options (25/50/100/250).

## Testing

- `getStoreOrdersPage`: correct LIMIT/OFFSET slice, `totalCount`, search matches
  order number + recipient name, sort direction.
- `computeOrderMetrics`: regression — same numbers as the pre-refactor
  `getStoreMetrics` for a given order set.

## Out of scope (YAGNI)

- No separate date filter on the table (KPIs own dates; table is pure all-time).
- No infinite scroll; classic numbered pagination only.
