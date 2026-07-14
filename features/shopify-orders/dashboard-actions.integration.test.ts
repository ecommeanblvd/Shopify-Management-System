import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreOrdersPage } from './dashboard-actions';

// SAFETY: same guard as the other integration suites — this writes real rows,
// so it only runs when the operator has designated the connected DB disposable
// (TEST_DATABASE_URL set AND === DATABASE_URL). A normal `npm test` skips it.
const hasLiveDb = await (async () => {
  const url = process.env.DATABASE_URL;
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!url || !testUrl || url !== testUrl) return false;
  try {
    await db.execute('SELECT 1');
    return true;
  } catch {
    return false;
  }
})();

const STAMP = Date.now();
const SEARCH_NAME = `PageSearchTarget-${STAMP}`;

describe.skipIf(!hasLiveDb)('getStoreOrdersPage (all-time server pagination)', () => {
  let storeId: string;
  const orderIds: string[] = [];

  // 5 orders, processedAt ascending so #5 is newest. Order #3 gets the
  // distinctive recipient name for the search test.
  beforeAll(async () => {
    const [store] = await db.insert(schema.stores).values({
      name: 'Pagination Test Store',
      shopDomain: `test-page-${Math.random().toString(36).slice(2)}.myshopify.com`,
      encryptedToken: 'test',
      scopes: ['read_orders'],
      apiVersion: '2025-01',
      status: 'active',
    }).returning({ id: schema.stores.id });
    storeId = store!.id;

    const base = new Date('2024-01-01T00:00:00Z').getTime();
    for (let i = 1; i <= 5; i++) {
      const at = new Date(base + i * 24 * 60 * 60 * 1000);
      const [row] = await db.insert(schema.shopifyOrders).values({
        storeId,
        shopifyOrderId: `gid://shopify/Order/PAGE-${STAMP}-${i}`,
        shopifyOrderNumber: `PT${STAMP}-${i}`,
        createdAtShopify: at,
        processedAtShopify: at,
        updatedAtShopify: at,
        financialStatus: 'paid',
        fulfillmentStatus: null,
        currency: 'USD',
        grossLineTotal: '0',
        totalDiscount: '0',
        totalShipping: '0',
        totalTax: '0',
        totalPrice: '0',
        shipName: i === 3 ? SEARCH_NAME : `Buyer ${i}`,
        rawPayload: {},
        source: 'backfill',
      }).returning({ id: schema.shopifyOrders.id });
      orderIds.push(row!.id);
    }
  });

  afterAll(async () => {
    if (orderIds.length) {
      await db.delete(schema.shopifyOrders).where(inArray(schema.shopifyOrders.id, orderIds));
    }
    if (storeId) await db.delete(schema.stores).where(eq(schema.stores.id, storeId));
  });

  it('reports the full total and returns only the requested page', async () => {
    const p0 = await getStoreOrdersPage({ storeId, page: 0, pageSize: 2, sort: 'newest' });
    expect(p0.totalCount).toBe(5);
    expect(p0.rows).toHaveLength(2);
    // Newest first → PT..-5 then PT..-4.
    expect(p0.rows.map((r) => r.shopifyOrderNumber)).toEqual([`PT${STAMP}-5`, `PT${STAMP}-4`]);
  });

  it('paginates without overlap and fills the final partial page', async () => {
    const p0 = await getStoreOrdersPage({ storeId, page: 0, pageSize: 2, sort: 'newest' });
    const p1 = await getStoreOrdersPage({ storeId, page: 1, pageSize: 2, sort: 'newest' });
    const p2 = await getStoreOrdersPage({ storeId, page: 2, pageSize: 2, sort: 'newest' });
    expect(p1.rows).toHaveLength(2);
    expect(p2.rows).toHaveLength(1); // 5 = 2 + 2 + 1
    const ids = [...p0.rows, ...p1.rows, ...p2.rows].map((r) => r.orderId);
    expect(new Set(ids).size).toBe(5); // no duplicates across pages
  });

  it('sorts oldest-first when asked', async () => {
    const oldest = await getStoreOrdersPage({ storeId, page: 0, pageSize: 1, sort: 'oldest' });
    expect(oldest.rows[0]?.shopifyOrderNumber).toBe(`PT${STAMP}-1`);
  });

  it('searches across all orders by order number', async () => {
    const res = await getStoreOrdersPage({ storeId, page: 0, pageSize: 25, search: `PT${STAMP}-2` });
    expect(res.totalCount).toBe(1);
    expect(res.rows[0]?.shopifyOrderNumber).toBe(`PT${STAMP}-2`);
  });

  it('searches by recipient name too', async () => {
    const res = await getStoreOrdersPage({ storeId, page: 0, pageSize: 25, search: SEARCH_NAME });
    expect(res.totalCount).toBe(1);
    expect(res.rows[0]?.shopifyOrderNumber).toBe(`PT${STAMP}-3`);
  });

  it('clamps an out-of-range page to the last page instead of returning empty', async () => {
    const oob = await getStoreOrdersPage({ storeId, page: 9999, pageSize: 2, sort: 'newest' });
    expect(oob.rows).toHaveLength(1); // last page holds the 1 leftover
    expect(oob.totalCount).toBe(5);
  });
});
