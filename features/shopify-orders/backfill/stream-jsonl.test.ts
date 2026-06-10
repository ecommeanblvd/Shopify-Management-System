import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamBulkResult } from './stream-jsonl';

/** Build a fetch stub that streams the given JSONL lines as one body. */
function stubFetch(lines: Array<Record<string, unknown>>) {
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200 })));
}

const ORDER_GID = 'gid://shopify/Order/1';

const orderRow = {
  id: ORDER_GID,
  name: '#1001',
  createdAt: '2026-01-01T00:00:00Z',
  processedAt: '2026-01-01T00:00:00Z',
  cancelledAt: null,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'FULFILLED',
  currencyCode: 'USD',
  subtotalLineItemsQuantity: 1,
  totalDiscountsSet: { shopMoney: { amount: '0', currencyCode: 'USD' } },
  totalShippingPriceSet: { shopMoney: { amount: '10', currencyCode: 'USD' } },
  totalTaxSet: { shopMoney: { amount: '0', currencyCode: 'USD' } },
  totalPriceSet: { shopMoney: { amount: '30', currencyCode: 'USD' } },
  shippingAddress: { countryCodeV2: 'US', city: 'NYC', zip: '10001' },
  totalWeight: 500,
};

afterEach(() => vi.unstubAllGlobals());

describe('streamBulkResult', () => {
  it('attaches shipping-line child rows (connection nodes with __parentId) to the parent order', async () => {
    stubFetch([
      orderRow,
      {
        id: 'gid://shopify/ShippingLine/9',
        title: 'DHL Express',
        code: 'DHL-EXP',
        __parentId: ORDER_GID,
      },
    ]);

    const batches: unknown[][] = [];
    const total = await streamBulkResult('https://bulk.example/result.jsonl', async (orders) => {
      batches.push(orders);
    });

    expect(total).toBe(1);
    const order = batches.flat()[0] as { shippingLines: Array<{ title: string | null; code: string | null }> };
    expect(order.shippingLines).toHaveLength(1);
    expect(order.shippingLines[0]).toMatchObject({
      id: 'gid://shopify/ShippingLine/9',
      title: 'DHL Express',
      code: 'DHL-EXP',
    });
  });

  it('still defaults shippingLines to [] when an order has none', async () => {
    stubFetch([orderRow]);

    const batches: unknown[][] = [];
    await streamBulkResult('https://bulk.example/result.jsonl', async (orders) => {
      batches.push(orders);
    });

    const order = batches.flat()[0] as { shippingLines: unknown[] };
    expect(order.shippingLines).toEqual([]);
  });

  it('does not misroute line items, refunds, or fulfillments into shippingLines', async () => {
    stubFetch([
      orderRow,
      {
        id: 'gid://shopify/LineItem/2',
        sku: 'SKU-1',
        vendor: 'V',
        title: 'Item',
        variantTitle: null,
        quantity: 1,
        originalUnitPriceSet: { shopMoney: { amount: '20', currencyCode: 'USD' } },
        discountAllocations: [],
        __parentId: ORDER_GID,
      },
      {
        id: 'gid://shopify/Refund/3',
        createdAt: '2026-01-02T00:00:00Z',
        note: null,
        totalRefundedSet: { shopMoney: { amount: '5', currencyCode: 'USD' } },
        __parentId: ORDER_GID,
      },
      {
        id: 'gid://shopify/Fulfillment/4',
        trackingInfo: [{ number: 'TRACK1', company: 'DHL' }],
        __parentId: ORDER_GID,
      },
    ]);

    const batches: unknown[][] = [];
    await streamBulkResult('https://bulk.example/result.jsonl', async (orders) => {
      batches.push(orders);
    });

    const order = batches.flat()[0] as {
      shippingLines: unknown[];
      lineItems: { nodes: unknown[] };
      refunds: unknown[];
      fulfillments: unknown[];
    };
    expect(order.shippingLines).toEqual([]);
    expect(order.lineItems.nodes).toHaveLength(1);
    expect(order.refunds).toHaveLength(1);
    expect(order.fulfillments).toHaveLength(1);
  });
});
