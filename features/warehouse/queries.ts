/** Read-side queries cho trang Kho (board + drawer lịch sử movement). */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface WarehouseSummary {
  /** Số dòng tồn (sku × kho). */
  totalLines: number;
  /** Số SKU khác nhau. */
  totalSkus: number;
  /** Σ qty_on_hand toàn kho. */
  totalQtyOnHand: number;
  /** Σ giá vốn (dom_price, VND) của các MÓN đang in_stock. */
  totalValueVnd: number;
  /** Số món in_stock CÓ giá vốn (dom_price) — coverage. */
  valuedUnits: number;
  /** Tổng món in_stock (để hiện coverage X/Y). */
  inStockUnits: number;
  /** Nhập (Σ delta_on_hand>0) trong [from,to). */
  movementIn: number;
  /** Xuất (Σ |delta_on_hand<0|) trong [from,to). */
  movementOut: number;
}

/** Tổng quan kho: giá trị (Σ giá vốn dom_price của món in_stock, VND) + nhập/xuất
 *  theo khoảng ngày (sổ inventory_movements). Toàn kho (mọi mã kho). */
export async function getWarehouseSummary(from: Date, to: Date): Promise<WarehouseSummary> {
  // Đếm dòng/sku/tồn từ warehouse_inventory.
  const invRes = await db.execute(sql`
    select count(*)::int as lines, count(distinct sku)::int as skus,
           coalesce(sum(qty_on_hand),0)::int as qty
    from warehouse_inventory`);
  const v = (invRes.rows ?? (invRes as unknown as Array<Record<string, unknown>>))[0];

  // Giá trị = Σ dom_price (VND) của món in_stock; coverage = số món có giá.
  const valRes = await db.execute(sql`
    select coalesce(sum(dom_price::float8),0)::float8 as val,
           count(dom_price)::int as valued, count(*)::int as units
    from goods_receipt_items where stock_status = 'in_stock'`);
  const p = (valRes.rows ?? (valRes as unknown as Array<Record<string, unknown>>))[0];

  const mvRes = await db.execute(sql`
    select
      coalesce(sum(case when delta_on_hand > 0 then delta_on_hand else 0 end),0)::int as inq,
      coalesce(sum(case when delta_on_hand < 0 then -delta_on_hand else 0 end),0)::int as outq
    from inventory_movements
    where created_at >= ${from} and created_at < ${to}`);
  const m = (mvRes.rows ?? (mvRes as unknown as Array<Record<string, unknown>>))[0];

  return {
    totalLines: Number(v.lines), totalSkus: Number(v.skus), totalQtyOnHand: Number(v.qty),
    totalValueVnd: Math.round(Number(p.val)), valuedUnits: Number(p.valued), inStockUnits: Number(p.units),
    movementIn: Number(m.inq), movementOut: Number(m.outq),
  };
}

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

/** Một MÓN tồn (goods_receipt_items) hiển thị trong drawer per-unit. */
export interface WarehouseItemRow {
  id: string;
  unitCode: string;
  currentWarehouseCode: string | null;
  location: string | null;
  stockStatus: string;
  receivedAt: Date | null;
  domPrice: string | null;
  domPriceCurrency: string | null;
  globalPrice: string | null;
  globalPriceCurrency: string | null;
  /** Nguồn nhập — note của phiếu nhập (goods_receipts.note). */
  source: string | null;
  /** Đơn đã gắn (qua fulfillmentLineId → fulfillment → shopify_orders); null nếu chưa cấp. */
  order: { orderId: string; orderNumber: string } | null;
}

/**
 * Danh sách MÓN của một SKU (tùy chọn lọc theo kho hiện tại). Một truy vấn
 * joined (receipt cho source; fulfillment_line → fulfillment → shopify_orders
 * cho đơn) — không N+1. Sắp theo stockStatus rồi receivedAt.
 */
export async function listItems(sku: string, warehouseCode?: string): Promise<WarehouseItemRow[]> {
  const gri = schema.goodsReceiptItems;
  const rows = await db.select({
    id: gri.id,
    unitCode: gri.unitCode,
    currentWarehouseCode: gri.currentWarehouseCode,
    location: gri.location,
    stockStatus: gri.stockStatus,
    receivedAt: gri.qcCheckedAt,
    domPrice: gri.domPrice,
    domPriceCurrency: gri.domPriceCurrency,
    globalPrice: gri.globalPrice,
    globalPriceCurrency: gri.globalPriceCurrency,
    source: schema.goodsReceipts.note,
    orderId: schema.shopifyOrders.id,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
  }).from(gri)
    .innerJoin(schema.goodsReceipts, eq(schema.goodsReceipts.id, gri.receiptId))
    .leftJoin(schema.orderFulfillmentLines, eq(schema.orderFulfillmentLines.id, gri.fulfillmentLineId))
    .leftJoin(schema.orderFulfillment, eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .where(warehouseCode
      ? and(eq(gri.sku, sku), eq(gri.currentWarehouseCode, warehouseCode))
      : eq(gri.sku, sku))
    .orderBy(asc(gri.stockStatus), asc(gri.qcCheckedAt));

  return rows.map((r) => ({
    id: r.id,
    unitCode: r.unitCode,
    currentWarehouseCode: r.currentWarehouseCode,
    location: r.location,
    stockStatus: r.stockStatus,
    receivedAt: r.receivedAt,
    domPrice: r.domPrice,
    domPriceCurrency: r.domPriceCurrency,
    globalPrice: r.globalPrice,
    globalPriceCurrency: r.globalPriceCurrency,
    source: r.source,
    order: r.orderId && r.orderNumber
      ? { orderId: r.orderId, orderNumber: r.orderNumber }
      : null,
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
    // id làm tiebreaker: cặp transfer_in/out cùng transaction trùng createdAt.
    .orderBy(desc(schema.inventoryMovements.createdAt), desc(schema.inventoryMovements.id))
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
