/**
 * Stream Shopify's bulkOperation JSONL output. Top-level rows are orders;
 * nested rows (lineItems, refunds, fulfillments) carry a `__parentId` that
 * links them back to the parent order. We accumulate all rows into a map,
 * then emit complete orders at end-of-stream.
 */
import type {
  ShopifyOrderPayload,
  ShopifyLineItem,
  ShopifyRefund,
  ShopifyFulfillment,
} from '../shopify-types';

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

  type Accumulator = ShopifyOrderPayload & { lineItemsRaw: ShopifyLineItem[] };
  const orders = new Map<string, Accumulator>();

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
          const orderRow = row as unknown as ShopifyOrderPayload;
          // shippingLines is a plain list (NOT a paginated connection) so
          // it arrives inline on the parent row. Defensively default to []
          // in case Shopify returns null/undefined for an order that's
          // missing a shipping line (free fulfilment, pickup, etc.).
          orders.set(orderRow.id, {
            ...orderRow,
            refunds: [],
            fulfillments: [],
            lineItems: { nodes: [] },
            lineItemsRaw: [],
            // shippingLines now a connection (edges/nodes) — children
            // arrive as separate JSONL rows linked via __parentId.
            // Initialise empty and accumulate below.
            shippingLines: [],
          });
        } else {
          const parent = orders.get(row.__parentId);
          if (!parent) continue;
          if ('quantity' in row) parent.lineItemsRaw.push(row as unknown as ShopifyLineItem);
          else if ('totalRefundedSet' in row) parent.refunds.push(row as unknown as ShopifyRefund);
          else if ('trackingInfo' in row) parent.fulfillments.push(row as unknown as ShopifyFulfillment);
          // Shipping line child rows have `title` + `code` (no quantity,
          // no totalRefundedSet, no trackingInfo). Detect by id prefix
          // which is stable: gid://shopify/ShippingLine/...
          else if (typeof row.id === 'string' && row.id.includes('/ShippingLine/')) {
            parent.shippingLines.push({
              title: (row.title as string | null) ?? null,
              code: (row.code as string | null) ?? null,
            });
          }
        }
      }
      nl = buffer.indexOf('\n');
    }
  }

  const batch: ShopifyOrderPayload[] = [];
  for (const o of orders.values()) {
    o.lineItems.nodes = o.lineItemsRaw;
    const cleaned = { ...o } as Partial<Accumulator>;
    delete cleaned.lineItemsRaw;
    batch.push(cleaned as ShopifyOrderPayload);
    totalOrders++;
    if (batch.length >= batchSize) await onBatch(batch.splice(0));
  }
  if (batch.length > 0) await onBatch(batch.splice(0));
  return totalOrders;
}
