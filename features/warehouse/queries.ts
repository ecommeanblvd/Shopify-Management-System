/** Read-side queries cho trang Kho (board + drawer lịch sử movement). */
import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface InventoryRow {
  id: string;
  sku: string;
  warehouseCode: string;
  productTitle: string | null;
  variantTitle: string | null;
  qtyOnHand: number;
  qtyReserved: number;
  /** on-hand − reserved (tính sẵn cho UI). */
  available: number;
  shelf: string | null;
  floor: string | null;
  bin: string | null;
  note: string | null;
}

export async function listInventory(filter?: { warehouse?: string }): Promise<InventoryRow[]> {
  const rows = await db.select().from(schema.warehouseInventory)
    .where(filter?.warehouse
      ? eq(schema.warehouseInventory.warehouseCode, filter.warehouse)
      : undefined)
    .orderBy(schema.warehouseInventory.sku, schema.warehouseInventory.warehouseCode);
  return rows.map((r) => ({
    id: r.id, sku: r.sku, warehouseCode: r.warehouseCode,
    productTitle: r.productTitle, variantTitle: r.variantTitle,
    qtyOnHand: r.qtyOnHand, qtyReserved: r.qtyReserved,
    available: r.qtyOnHand - r.qtyReserved,
    shelf: r.shelf, floor: r.floor, bin: r.bin, note: r.note,
  }));
}

/** Tham chiếu đã enrich để drawer hiển thị: đơn (clickable) hoặc phiếu nhập. */
export type MovementRef =
  | { kind: 'order'; orderId: string; orderNumber: string }
  | { kind: 'receipt'; code: string }
  | null;

export interface MovementRow {
  id: string;
  deltaOnHand: number;
  deltaReserved: number;
  reason: string;
  refType: string | null;
  note: string | null;
  actor: string;
  createdAt: Date;
  ref: MovementRef;
}

/**
 * Lịch sử movement của MỘT dòng tồn, mới nhất trước. Enrich tham chiếu theo
 * refType bằng truy vấn bulk (gom id từng loại → fetch 1 lần → map), không
 * query từng dòng.
 */
export async function listMovements(warehouseInventoryId: string, limit = 50): Promise<MovementRow[]> {
  const moves = await db.select().from(schema.inventoryMovements)
    .where(eq(schema.inventoryMovements.warehouseInventoryId, warehouseInventoryId))
    .orderBy(desc(schema.inventoryMovements.createdAt))
    .limit(limit);

  const orderIds: string[] = [];
  const lineIds: string[] = [];
  const receiptItemIds: string[] = [];
  for (const m of moves) {
    if (!m.refId) continue;
    if (m.refType === 'order') orderIds.push(m.refId);
    else if (m.refType === 'fulfillment_line') lineIds.push(m.refId);
    else if (m.refType === 'receipt_item') receiptItemIds.push(m.refId);
  }

  // refType 'order' → số đơn Shopify
  const orderById = new Map<string, string>();
  if (orderIds.length > 0) {
    const rows = await db.select({
      id: schema.shopifyOrders.id,
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    }).from(schema.shopifyOrders)
      .where(inArray(schema.shopifyOrders.id, orderIds));
    for (const r of rows) orderById.set(r.id, r.orderNumber);
  }

  // refType 'fulfillment_line' → đơn qua line → fulfillment → shopify_orders
  const orderByLine = new Map<string, { orderId: string; orderNumber: string }>();
  if (lineIds.length > 0) {
    const rows = await db.select({
      lineId: schema.orderFulfillmentLines.id,
      orderId: schema.shopifyOrders.id,
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    }).from(schema.orderFulfillmentLines)
      .innerJoin(schema.orderFulfillment,
        eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
      .innerJoin(schema.shopifyOrders,
        eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
      .where(inArray(schema.orderFulfillmentLines.id, lineIds));
    for (const r of rows) orderByLine.set(r.lineId, { orderId: r.orderId, orderNumber: r.orderNumber });
  }

  // refType 'receipt_item' → mã phiếu nhập
  const receiptCodeByItem = new Map<string, string>();
  if (receiptItemIds.length > 0) {
    const rows = await db.select({
      itemId: schema.goodsReceiptItems.id,
      code: schema.goodsReceipts.code,
    }).from(schema.goodsReceiptItems)
      .innerJoin(schema.goodsReceipts,
        eq(schema.goodsReceipts.id, schema.goodsReceiptItems.receiptId))
      .where(inArray(schema.goodsReceiptItems.id, receiptItemIds));
    for (const r of rows) receiptCodeByItem.set(r.itemId, r.code);
  }

  return moves.map((m) => {
    let ref: MovementRef = null;
    if (m.refId) {
      if (m.refType === 'order') {
        const orderNumber = orderById.get(m.refId);
        if (orderNumber) ref = { kind: 'order', orderId: m.refId, orderNumber };
      } else if (m.refType === 'fulfillment_line') {
        const o = orderByLine.get(m.refId);
        if (o) ref = { kind: 'order', orderId: o.orderId, orderNumber: o.orderNumber };
      } else if (m.refType === 'receipt_item') {
        const code = receiptCodeByItem.get(m.refId);
        if (code) ref = { kind: 'receipt', code };
      }
    }
    return {
      id: m.id,
      deltaOnHand: m.deltaOnHand, deltaReserved: m.deltaReserved,
      reason: m.reason, refType: m.refType,
      note: m.note, actor: m.actor, createdAt: m.createdAt,
      ref,
    };
  });
}
