import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { allocateLine, reallocateSku } from './allocate';
import { releaseOrderAllocations } from './release';

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

// Per-unit allocator (spec §3): allocateLine giữ ĐÚNG MỘT MÓN cụ thể
// (goods_receipt_items, FIFO theo qcCheckedAt), set stockStatus='allocated',
// và reserve +1 trên rollup. release trả món về in_stock. v1 mỗi dòng qty=1.
describe.skipIf(!hasLiveDb)('warehouse allocator (integration, per-unit)', () => {
  let storeId: string;
  let orderId: string;
  let fulfillmentId: string;
  let line1Id: string; // qty 1, pending_check -> in_stock (cấp món FIFO)
  let line2Id: string; // qty 1, out_of_stock -> in_stock via reallocateSku
  let invId: string;
  let receiptId: string;
  let itemOldId: string; // qcCheckedAt cũ hơn → được chọn trước
  let itemNewId: string;

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
      .values({ fulfillmentId, shopifyLineId: 'test-alloc-line-1', sku: SKU, qty: 1, status: 'pending_check' })
      .returning({ id: schema.orderFulfillmentLines.id });
    line1Id = l1!.id;

    // Rollup row: onHand=2 (2 món in_stock), reserved=0.
    const [inv] = await db.insert(schema.warehouseInventory)
      .values({ sku: SKU, warehouseCode: 'GVM', qtyOnHand: 2, qtyReserved: 0 })
      .returning({ id: schema.warehouseInventory.id });
    invId = inv!.id;

    // Receipt + 2 món per-unit in_stock ở GVM. itemOld nhận TRƯỚC → FIFO chọn.
    const [rcpt] = await db.insert(schema.goodsReceipts)
      .values({ code: `SEED-${SKU}`, warehouseCode: 'GVM', sourceType: 'po' })
      .returning({ id: schema.goodsReceipts.id });
    receiptId = rcpt!.id;

    const [itemOld] = await db.insert(schema.goodsReceiptItems).values({
      receiptId, unitCode: `${SKU}-OLD`, sku: SKU, qcResult: 'pass',
      disposition: 'store', currentWarehouseCode: 'GVM', stockStatus: 'in_stock',
      qcCheckedAt: new Date('2024-01-01'),
    }).returning({ id: schema.goodsReceiptItems.id });
    itemOldId = itemOld!.id;

    const [itemNew] = await db.insert(schema.goodsReceiptItems).values({
      receiptId, unitCode: `${SKU}-NEW`, sku: SKU, qcResult: 'pass',
      disposition: 'store', currentWarehouseCode: 'GVM', stockStatus: 'in_stock',
      qcCheckedAt: new Date('2024-06-01'),
    }).returning({ id: schema.goodsReceiptItems.id });
    itemNewId = itemNew!.id;
  });

  afterAll(async () => {
    // Only this suite's rows. inventory_movements restricts the inventory FK,
    // so delete the ledger first; deleting the store cascades order ->
    // fulfillment -> lines -> events/brand requests. goods_receipts cascades
    // its items.
    await db.delete(schema.inventoryMovements)
      .where(eq(schema.inventoryMovements.warehouseInventoryId, invId));
    await db.delete(schema.warehouseInventory).where(eq(schema.warehouseInventory.id, invId));
    await db.delete(schema.goodsReceipts).where(eq(schema.goodsReceipts.id, receiptId));
    await db.delete(schema.stores).where(eq(schema.stores.id, storeId));
  });

  it('allocates a pending_check line: picks the FIFO item, sets it allocated, reserves +1', async () => {
    await expect(allocateLine(line1Id)).resolves.toBe(true);

    const [line] = await db.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.id, line1Id));
    expect(line.status).toBe('in_stock');
    expect(line.allocatedQty).toBe(1);
    expect(line.warehouseInventoryId).toBe(invId);

    // Món cũ nhất (itemOld) được chọn, gắn vào dòng, stockStatus=allocated.
    const [oldItem] = await db.select().from(schema.goodsReceiptItems)
      .where(eq(schema.goodsReceiptItems.id, itemOldId));
    expect(oldItem.stockStatus).toBe('allocated');
    expect(oldItem.fulfillmentLineId).toBe(line1Id);
    const [newItem] = await db.select().from(schema.goodsReceiptItems)
      .where(eq(schema.goodsReceiptItems.id, itemNewId));
    expect(newItem.stockStatus).toBe('in_stock'); // chưa đụng tới

    const [inv] = await db.select().from(schema.warehouseInventory)
      .where(eq(schema.warehouseInventory.id, invId));
    expect(inv.qtyOnHand).toBe(2);
    expect(inv.qtyReserved).toBe(1);

    const movements = await db.select().from(schema.inventoryMovements)
      .where(and(eq(schema.inventoryMovements.warehouseInventoryId, invId),
                 eq(schema.inventoryMovements.reason, 'auto_allocate')));
    expect(movements).toHaveLength(1);
    expect(movements[0].refType).toBe('item');
    expect(movements[0].refId).toBe(itemOldId);
  });

  it('re-running allocateLine on an in_stock line is a no-op (idempotent)', async () => {
    await expect(allocateLine(line1Id)).resolves.toBe(false);

    const movements = await db.select().from(schema.inventoryMovements)
      .where(and(eq(schema.inventoryMovements.warehouseInventoryId, invId),
                 eq(schema.inventoryMovements.reason, 'auto_allocate')));
    expect(movements).toHaveLength(1); // no second reservation

    const [inv] = await db.select().from(schema.warehouseInventory)
      .where(eq(schema.warehouseInventory.id, invId));
    expect(inv.qtyReserved).toBe(1);
  });

  it('release returns the allocated item to in_stock and frees the reservation', async () => {
    // Đơn huỷ → nhả. Set cancelledAtShopify để giống luồng thật (không bắt buộc).
    await releaseOrderAllocations(orderId, 'test:release');

    const [oldItem] = await db.select().from(schema.goodsReceiptItems)
      .where(eq(schema.goodsReceiptItems.id, itemOldId));
    expect(oldItem.stockStatus).toBe('in_stock');
    expect(oldItem.fulfillmentLineId).toBeNull();

    const [line] = await db.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.id, line1Id));
    // reallocateSku (chạy trong release) có thể cấp lại dòng ngay → in_stock.
    // Bất kể vậy, reserved trên rollup không được rò rỉ: ≤1 (1 nếu cấp lại, 0 nếu không).
    const [inv] = await db.select().from(schema.warehouseInventory)
      .where(eq(schema.warehouseInventory.id, invId));
    expect(inv.qtyReserved).toBeLessThanOrEqual(1);
    expect(inv.qtyReserved).toBeGreaterThanOrEqual(0);
    // Nếu cấp lại, đúng 1 món allocated; nếu không, 0.
    const allocated = await db.select().from(schema.goodsReceiptItems)
      .where(and(eq(schema.goodsReceiptItems.sku, SKU),
                 eq(schema.goodsReceiptItems.stockStatus, 'allocated')));
    expect(allocated.length).toBe(inv.qtyReserved);
    // Dọn về trạng thái xác định cho test sau: nhả lại nếu vừa cấp.
    if (line.status === 'in_stock') {
      await releaseOrderAllocations(orderId, 'test:release-2');
    }
  });

  it('reallocateSku grants an out_of_stock line by picking an available item', async () => {
    const [l2] = await db.insert(schema.orderFulfillmentLines)
      .values({ fulfillmentId, shopifyLineId: 'test-alloc-line-2', sku: SKU, qty: 1, status: 'out_of_stock' })
      .returning({ id: schema.orderFulfillmentLines.id });
    line2Id = l2!.id;
    await db.insert(schema.brandOrderRequests)
      .values({ fulfillmentLineId: line2Id, orderId, brandSlug: null, sku: SKU, qty: 1 }); // awaiting/pending defaults

    await expect(reallocateSku(SKU)).resolves.toBe(1);

    const [line] = await db.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.id, line2Id));
    expect(line.status).toBe('in_stock');
    expect(line.allocatedQty).toBe(1);

    const requests = await db.select().from(schema.brandOrderRequests)
      .where(eq(schema.brandOrderRequests.fulfillmentLineId, line2Id));
    expect(requests).toHaveLength(0); // awaiting request cleaned up on success

    // Đúng 1 món allocated gắn dòng này.
    const allocated = await db.select().from(schema.goodsReceiptItems)
      .where(eq(schema.goodsReceiptItems.fulfillmentLineId, line2Id));
    expect(allocated).toHaveLength(1);
    expect(allocated[0].stockStatus).toBe('allocated');
  });
});
