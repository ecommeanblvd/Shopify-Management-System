import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { allocateLine, reallocateSku } from './allocate';
import { applyMovement } from './ledger';

// SAFETY: same guard as features/shopify-orders/sync/upsert-order.test.ts —
// this suite writes real rows, so it only runs when the operator has
// explicitly designated the connected DB as disposable: TEST_DATABASE_URL is
// set AND equals DATABASE_URL. A normal `npm test` (no TEST_DATABASE_URL),
// CI, or a production DATABASE_URL all skip the suite. Unlike the upsert
// suite it never bulk-deletes — it only creates and removes its own rows
// (unique TEST-ALLOC-* SKU).
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

const SKU = `TEST-ALLOC-${Date.now()}`;

describe.skipIf(!hasLiveDb)('warehouse allocator (integration)', () => {
  let storeId: string;
  let orderId: string;
  let fulfillmentId: string;
  let line1Id: string; // qty 2, pending_check -> in_stock
  let line2Id: string; // qty 1, out_of_stock -> in_stock via reallocateSku
  let invId: string;

  beforeAll(async () => {
    const [store] = await db.insert(schema.stores).values({
      name: 'Alloc Test Store',
      shopDomain: `test-alloc-${Math.random().toString(36).slice(2)}.myshopify.com`,
      encryptedToken: 'test',
      scopes: ['read_orders'],
      apiVersion: '2025-01',
    }).returning({ id: schema.stores.id });
    storeId = store!.id;

    const [order] = await db.insert(schema.shopifyOrders).values({
      storeId,
      shopifyOrderId: `gid://shopify/Order/test-alloc-${Date.now()}`,
      shopifyOrderNumber: '#TEST-ALLOC',
      createdAtShopify: new Date(),
      processedAtShopify: new Date(),
      financialStatus: 'PAID',
      currency: 'USD',
      grossLineTotal: '0.00', totalDiscount: '0.00', totalShipping: '0.00',
      totalTax: '0.00', totalPrice: '0.00',
      rawPayload: {}, source: 'test',
    }).returning({ id: schema.shopifyOrders.id });
    orderId = order!.id;

    const [ful] = await db.insert(schema.orderFulfillment)
      .values({ orderId })
      .returning({ id: schema.orderFulfillment.id });
    fulfillmentId = ful!.id;

    const [l1] = await db.insert(schema.orderFulfillmentLines)
      .values({ fulfillmentId, shopifyLineId: 'test-alloc-line-1', sku: SKU, qty: 2, status: 'pending_check' })
      .returning({ id: schema.orderFulfillmentLines.id });
    line1Id = l1!.id;

    const [inv] = await db.insert(schema.warehouseInventory)
      .values({ sku: SKU, warehouseCode: 'HN', qtyOnHand: 2, qtyReserved: 0 })
      .returning({ id: schema.warehouseInventory.id });
    invId = inv!.id;
  });

  afterAll(async () => {
    // Only this suite's rows. inventory_movements restricts the inventory FK,
    // so delete the ledger first; deleting the store cascades order ->
    // fulfillment -> lines -> events/brand requests.
    await db.delete(schema.inventoryMovements)
      .where(eq(schema.inventoryMovements.warehouseInventoryId, invId));
    await db.delete(schema.warehouseInventory).where(eq(schema.warehouseInventory.id, invId));
    await db.delete(schema.stores).where(eq(schema.stores.id, storeId));
  });

  it('allocates a pending_check line: in_stock, reserved, one auto_allocate movement', async () => {
    await expect(allocateLine(line1Id)).resolves.toBe(true);

    const [line] = await db.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.id, line1Id));
    expect(line.status).toBe('in_stock');
    expect(line.allocatedQty).toBe(2);
    expect(line.warehouseInventoryId).toBe(invId);

    const [inv] = await db.select().from(schema.warehouseInventory)
      .where(eq(schema.warehouseInventory.id, invId));
    expect(inv.qtyOnHand).toBe(2);
    expect(inv.qtyReserved).toBe(2);

    const movements = await db.select().from(schema.inventoryMovements)
      .where(and(eq(schema.inventoryMovements.warehouseInventoryId, invId),
                 eq(schema.inventoryMovements.reason, 'auto_allocate')));
    expect(movements).toHaveLength(1);
    expect(movements[0].refId).toBe(line1Id);
  });

  it('re-running allocateLine on an in_stock line is a no-op (idempotent)', async () => {
    await expect(allocateLine(line1Id)).resolves.toBe(false);

    const movements = await db.select().from(schema.inventoryMovements)
      .where(and(eq(schema.inventoryMovements.warehouseInventoryId, invId),
                 eq(schema.inventoryMovements.reason, 'auto_allocate')));
    expect(movements).toHaveLength(1); // no second reservation

    const [inv] = await db.select().from(schema.warehouseInventory)
      .where(eq(schema.warehouseInventory.id, invId));
    expect(inv.qtyReserved).toBe(2);
  });

  it('reallocateSku after a receipt grants the out_of_stock line and clears its awaiting brand request', async () => {
    const [l2] = await db.insert(schema.orderFulfillmentLines)
      .values({ fulfillmentId, shopifyLineId: 'test-alloc-line-2', sku: SKU, qty: 1, status: 'out_of_stock' })
      .returning({ id: schema.orderFulfillmentLines.id });
    line2Id = l2!.id;
    await db.insert(schema.brandOrderRequests)
      .values({ fulfillmentLineId: line2Id, orderId, brandSlug: null, sku: SKU, qty: 1 }); // awaiting/pending defaults

    // Goods arrive: +1 on_hand through the ledger, exactly like receiving does.
    await db.transaction(async (tx) => {
      await applyMovement(tx, {
        sku: SKU, warehouseCode: 'HN',
        deltaOnHand: 1, deltaReserved: 0,
        reason: 'receipt_po', actor: 'test:allocate-integration',
      });
    });

    await expect(reallocateSku(SKU)).resolves.toBe(1);

    const [line] = await db.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.id, line2Id));
    expect(line.status).toBe('in_stock');
    expect(line.allocatedQty).toBe(1);

    const requests = await db.select().from(schema.brandOrderRequests)
      .where(eq(schema.brandOrderRequests.fulfillmentLineId, line2Id));
    expect(requests).toHaveLength(0); // awaiting request cleaned up on success

    const [inv] = await db.select().from(schema.warehouseInventory)
      .where(eq(schema.warehouseInventory.id, invId));
    expect(inv.qtyOnHand).toBe(3);
    expect(inv.qtyReserved).toBe(3);
  });
});
