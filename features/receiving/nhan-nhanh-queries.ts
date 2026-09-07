import { and, eq, isNull, sql, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';

// brandSlug và expectedDeliveryDate rộng hơn "string"/"Date" so với chữ ký ở task
// brief: brand_order_requests.brand_slug nullable thật sự (khởi tạo null, gán sau
// khi biết brand — xem features/fulfillment/actions.ts) và cột date() của Drizzle
// suy ra string (không phải Date) trừ khi khai báo mode:'date'. Khớp quy ước toàn
// repo (features/fulfillment/brand-logic.ts, features/lifecycle/sync.ts, …).
export interface BrandDangCho { brandSlug: string | null; displayName: string | null; soDong: number }

export interface DongCho {
  lineId: string; shopifyLineId: string; orderId: string; orderNumber: string | null; brandRequestId: string;
  brandSlug: string | null; sku: string | null; productTitle: string | null; variantTitle: string | null;
  mongDoi: number; daIn: number; daXacNhan: number; expectedDeliveryDate: string | null;
}

/** Điều kiện "đang chờ hàng brand" — GIỐNG listAwaitingGoods (queries.ts) để hai danh sách không lệch nhau. */
const DANG_CHO = and(
  eq(schema.orderFulfillmentLines.status, 'brand_confirmed'),
  eq(schema.brandOrderRequests.confirmStatus, 'confirmed'),
  isNull(schema.brandOrderRequests.deliveredAt),
);

const DA_IN = sql<number>`(select count(*)::int from goods_receipt_items gi where gi.fulfillment_line_id = ${schema.orderFulfillmentLines.id})`;
const DA_XAC_NHAN = sql<number>`(select count(*)::int from goods_receipt_items gi where gi.fulfillment_line_id = ${schema.orderFulfillmentLines.id} and gi.confirmed_at is not null)`;

function chonDong() {
  return db.select({
    lineId: schema.orderFulfillmentLines.id,
    shopifyLineId: schema.orderFulfillmentLines.shopifyLineId,
    orderId: schema.brandOrderRequests.orderId,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    brandRequestId: schema.brandOrderRequests.id,
    brandSlug: schema.brandOrderRequests.brandSlug,
    sku: schema.orderFulfillmentLines.sku,
    productTitle: schema.shopifyOrderLines.productTitle,
    variantTitle: schema.shopifyOrderLines.variantTitle,
    mongDoi: schema.orderFulfillmentLines.qty,
    daIn: DA_IN,
    daXacNhan: DA_XAC_NHAN,
    expectedDeliveryDate: schema.brandOrderRequests.expectedDeliveryDate,
  })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.brandOrderRequests, eq(schema.brandOrderRequests.fulfillmentLineId, schema.orderFulfillmentLines.id))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.brandOrderRequests.orderId))
    .leftJoin(schema.shopifyOrderLines, and(
      eq(schema.shopifyOrderLines.orderId, schema.brandOrderRequests.orderId),
      eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId),
    ));
}

/** Brand có dòng đang chờ, kèm tên hiển thị từ mmp_brands (null nếu brand chưa khai). */
export async function listBrandDangCho(): Promise<BrandDangCho[]> {
  return db.select({
    brandSlug: schema.brandOrderRequests.brandSlug,
    displayName: sql<string | null>`max(${schema.mmpBrands.displayName})`,
    soDong: sql<number>`count(*)::int`,
  })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.brandOrderRequests, eq(schema.brandOrderRequests.fulfillmentLineId, schema.orderFulfillmentLines.id))
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.brandOrderRequests.brandSlug))
    .where(DANG_CHO)
    .groupBy(schema.brandOrderRequests.brandSlug)
    .orderBy(schema.brandOrderRequests.brandSlug);
}

export async function listDongCho(brandSlug: string): Promise<DongCho[]> {
  return chonDong()
    .where(and(DANG_CHO, eq(schema.brandOrderRequests.brandSlug, brandSlug)))
    .orderBy(schema.brandOrderRequests.expectedDeliveryDate, schema.shopifyOrders.shopifyOrderNumber);
}

/** Quét tem brand `L:<id>` → dòng đơn (KHÔNG lọc đang chờ: dòng đã nhận xong vẫn trả về để UI báo "đã nhận rồi"). */
export async function getDongTheoShopifyLineId(shopifyLineId: string): Promise<DongCho | null> {
  const [r] = await chonDong().where(eq(schema.orderFulfillmentLines.shopifyLineId, shopifyLineId)).limit(1);
  return r ?? null;
}

export async function getDongTheoId(lineId: string): Promise<DongCho | null> {
  const [r] = await chonDong().where(eq(schema.orderFulfillmentLines.id, lineId)).limit(1);
  return r ?? null;
}

/**
 * Phiếu retail_for_order của brand tạo HÔM NAY theo giờ Bangkok. received_at là
 * timestamp UTC-naive → đổi múi hai bước trong SQL, không so bằng JS Date.
 */
export async function getPhieuHomNay(brandSlug: string): Promise<{ id: string; code: string } | null> {
  const [r] = await db.select({ id: schema.goodsReceipts.id, code: schema.goodsReceipts.code })
    .from(schema.goodsReceipts)
    .where(and(
      eq(schema.goodsReceipts.sourceType, 'retail_for_order'),
      eq(schema.goodsReceipts.vendor, brandSlug),
      sql`(${schema.goodsReceipts.receivedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::date = (now() AT TIME ZONE 'Asia/Bangkok')::date`,
    ))
    .orderBy(desc(schema.goodsReceipts.createdAt)).limit(1);
  return r ?? null;
}

export async function getMonTheoUnitCode(unitCode: string) {
  const [r] = await db.select({
    id: schema.goodsReceiptItems.id, receiptId: schema.goodsReceiptItems.receiptId,
    fulfillmentLineId: schema.goodsReceiptItems.fulfillmentLineId, confirmedAt: schema.goodsReceiptItems.confirmedAt,
  }).from(schema.goodsReceiptItems).where(eq(schema.goodsReceiptItems.unitCode, unitCode)).limit(1);
  return r ?? null;
}

export async function listMonTrongPhieu(receiptId: string) {
  return db.select({
    id: schema.goodsReceiptItems.id, unitCode: schema.goodsReceiptItems.unitCode,
    sku: schema.goodsReceiptItems.sku, productTitle: schema.goodsReceiptItems.productTitle, variantTitle: schema.goodsReceiptItems.variantTitle,
    fulfillmentLineId: schema.goodsReceiptItems.fulfillmentLineId,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    printedAt: schema.goodsReceiptItems.printedAt, confirmedAt: schema.goodsReceiptItems.confirmedAt,
    unplanned: schema.goodsReceiptItems.unplanned,
  })
    .from(schema.goodsReceiptItems)
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .where(eq(schema.goodsReceiptItems.receiptId, receiptId))
    .orderBy(schema.goodsReceiptItems.unitCode);
}
