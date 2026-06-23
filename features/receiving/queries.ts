import { eq, desc, and, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getSignedDownloadUrl, isStorageConfigured } from '@/lib/storage/s3';

/** Receipts list, newest first. */
export async function listReceipts() {
  return db.select({
    id: schema.goodsReceipts.id,
    code: schema.goodsReceipts.code,
    warehouseCode: schema.goodsReceipts.warehouseCode,
    sourceType: schema.goodsReceipts.sourceType,
    vendor: schema.goodsReceipts.vendor,
    receivedAt: schema.goodsReceipts.receivedAt,
  })
    .from(schema.goodsReceipts)
    .orderBy(desc(schema.goodsReceipts.receivedAt));
}

/** Lines confirmed by a brand and still awaiting physical goods (worklist for
 *  receiving "retail_for_order" items). */
export async function listAwaitingGoods() {
  return db.select({
    lineId: schema.orderFulfillmentLines.id,
    orderId: schema.brandOrderRequests.orderId,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    brandRequestId: schema.brandOrderRequests.id,
    brandSlug: schema.brandOrderRequests.brandSlug,
    sku: schema.orderFulfillmentLines.sku,
    qty: schema.orderFulfillmentLines.qty,
    expectedDeliveryDate: schema.brandOrderRequests.expectedDeliveryDate,
  })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.brandOrderRequests, eq(schema.brandOrderRequests.fulfillmentLineId, schema.orderFulfillmentLines.id))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.brandOrderRequests.orderId))
    .where(and(
      eq(schema.orderFulfillmentLines.status, 'brand_confirmed'),
      eq(schema.brandOrderRequests.confirmStatus, 'confirmed'),
      isNull(schema.brandOrderRequests.deliveredAt),
    ))
    .orderBy(schema.brandOrderRequests.expectedDeliveryDate);
}

async function signed(key: string | null): Promise<string | null> {
  if (!key || !isStorageConfigured()) return null;
  return getSignedDownloadUrl(key);
}

/** A receipt header + its items, with signed URLs resolved for any image keys. */
export async function getReceiptDetail(receiptId: string) {
  const [receipt] = await db.select().from(schema.goodsReceipts)
    .where(eq(schema.goodsReceipts.id, receiptId)).limit(1);
  if (!receipt) return null;
  const items = await db.select().from(schema.goodsReceiptItems)
    .where(eq(schema.goodsReceiptItems.receiptId, receiptId))
    .orderBy(schema.goodsReceiptItems.unitCode);
  const itemsWithUrls = await Promise.all(items.map(async (it) => ({
    ...it,
    photoUrl: await signed(it.photoKey),
    qcFailPhotoUrl: await signed(it.qcFailPhotoKey),
  })));
  const handoverUrl = await signed(receipt.handoverDocKey);
  return { receipt: { ...receipt, handoverUrl }, items: itemsWithUrls };
}

/** Mọi đơn vị hàng đang CHỜ KCS (qcResult='pending') across mọi phiếu — FIFO. */
export async function listPendingQcItems() {
  const rows = await db
    .select({
      id: schema.goodsReceiptItems.id,
      unitCode: schema.goodsReceiptItems.unitCode,
      sku: schema.goodsReceiptItems.sku,
      productTitle: schema.goodsReceiptItems.productTitle,
      variantTitle: schema.goodsReceiptItems.variantTitle,
      photoKey: schema.goodsReceiptItems.photoKey,
      receiptCode: schema.goodsReceipts.code,
      sourceType: schema.goodsReceipts.sourceType,
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      brandSlug: schema.brandOrderRequests.brandSlug,
      createdAt: schema.goodsReceiptItems.createdAt,
    })
    .from(schema.goodsReceiptItems)
    .innerJoin(schema.goodsReceipts, eq(schema.goodsReceipts.id, schema.goodsReceiptItems.receiptId))
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .leftJoin(schema.brandOrderRequests, eq(schema.brandOrderRequests.id, schema.goodsReceiptItems.brandRequestId))
    .where(eq(schema.goodsReceiptItems.qcResult, 'pending'))
    .orderBy(schema.goodsReceiptItems.createdAt);

  return Promise.all(rows.map(async ({ photoKey, ...r }) => ({
    ...r,
    photoUrl: await signed(photoKey),
  })));
}
