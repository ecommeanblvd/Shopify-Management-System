import type {
  ShopifyOrderPayload,
  ShopifyLineItem,
  ShopifyRefund,
  ShopifyFulfillment,
  ShopifyShippingLine,
} from '../shopify-types';
import { detectCarrierKey, type CarrierKey } from './detect-carrier';
import { deriveTxnFee } from '../derive-txn-fee';

/** Internal shape ready for the upsert function. Numbers are strings to match
 *  Drizzle's numeric column representation; no float precision loss. */
export interface MappedOrder {
  order: {
    storeId: string;
    shopifyOrderId: string;
    shopifyOrderNumber: string;
    createdAtShopify: Date;
    processedAtShopify: Date;
    updatedAtShopify: Date;
    cancelledAtShopify: Date | null;
    financialStatus: string;
    fulfillmentStatus: string | null;
    currency: string;
    grossLineTotal: string;
    totalDiscount: string;
    totalShipping: string;
    /** Số tiền GIẢM phí ship (promo 50% off shipping…) = gốc − Σ discounted.
     *  null = đơn không có shippingLines discounted (không biết). */
    shippingDiscount: string | null;
    totalTax: string;
    totalPrice: string;
    shipCountry: string | null;
    shipCity: string | null;
    shipPostcode: string | null;
    shipAddress1: string | null;
    shipAddress2: string | null;
    shipProvinceCode: string | null;
    shipName: string | null;
    shipCompany: string | null;
    shipWeightKg: string | null;
    /** Carrier the customer paid Shopify shipping for, derived from
     *  `shippingLines`. NULL when no line is matchable — the engine
     *  defaults to FedEx per operator spec. */
    shippingCarrierKey: CarrierKey | null;
    transactionFee: string | null;
    transactionFeeNative: string | null;
    transactionFeeNativeCurrency: string | null;
  };
  lines: Array<{
    shopifyLineId: string;
    sku: string | null;
    vendor: string | null;
    productTitle: string;
    variantTitle: string | null;
    quantity: number;
    unitPrice: string;
    discountAlloc: string;
    total: string;
  }>;
  refunds: Array<{
    shopifyRefundId: string;
    refundedAt: Date;
    amount: string;
    reason: string | null;
    /** Σ tiền hoàn SHIP của lần refund này (refundShippingLines). null = không sync được chi tiết. */
    shippingAmount: string | null;
    /** Hoàn ĐỒ theo line: [{sku,title,qty,amount,tax}] (amount = subtotal line hoàn). null = không có chi tiết. */
    lines: Array<{ sku: string | null; title: string | null; qty: number; amount: string; tax: string }> | null;
  }>;
  trackingNumbers: string[];
}

/**
 * Parse a Shopify ISO date, falling back when the field is missing or invalid.
 * A `new Date(undefined)` yields an Invalid Date whose `.toISOString()` throws
 * "Invalid time value" the moment Drizzle serialises it — one absent field in a
 * GraphQL selection would otherwise abort a whole ingest. Guarding here keeps a
 * query/field drift (e.g. a channel that forgets `updatedAt`) from crashing sync.
 */
function toDate(value: string | null | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** shippingLines về ARRAY — bulk trả array, paged/webhook trả connection {nodes}. */
function shippingLinesOf(p: ShopifyOrderPayload): ShopifyShippingLine[] {
  const sl = p.shippingLines as unknown;
  if (Array.isArray(sl)) return sl as ShopifyShippingLine[];
  if (sl && typeof sl === 'object' && Array.isArray((sl as { nodes?: unknown }).nodes)) {
    return (sl as { nodes: ShopifyShippingLine[] }).nodes;
  }
  return [];
}

/** Ship rev THỰC NHẬN = Σ discountedPriceSet (phí ship sau giảm). null khi chưa có
 *  dữ liệu discounted (đơn cũ chưa re-sync / không có shippingLines) → caller fallback
 *  về totalShippingPriceSet (phí gốc). */
function netShippingAmount(lines: ShopifyShippingLine[]): string | null {
  let sum = 0;
  let has = false;
  for (const l of lines) {
    const a = l.discountedPriceSet?.shopMoney?.amount;
    if (a != null) { sum += Number(a) || 0; has = true; }
  }
  return has ? sum.toFixed(2) : null;
}

export function mapShopifyOrder(payload: ShopifyOrderPayload, storeId: string): MappedOrder {
  const shipLines = shippingLinesOf(payload);
  const lines = payload.lineItems.nodes.map((node) => mapLine(node));
  // grossLineTotal = Σ(original_unit_price × qty) — true GMV before any discount
  const grossLineTotal = lines
    .reduce((sum, l) => sum + Number(l.unitPrice) * l.quantity, 0)
    .toFixed(2);

  const txnFee = deriveTxnFee(payload.transactions ?? [], payload.currencyCode);

  return {
    order: {
      storeId,
      shopifyOrderId: payload.id,
      shopifyOrderNumber: payload.name,
      createdAtShopify: toDate(payload.createdAt, new Date(0)),
      // processedAt/updatedAt can be absent on some orders (or omitted by a
      // channel's query) — fall back to createdAt rather than crash the insert.
      processedAtShopify: toDate(payload.processedAt, toDate(payload.createdAt, new Date(0))),
      updatedAtShopify: toDate(payload.updatedAt, toDate(payload.processedAt, toDate(payload.createdAt, new Date(0)))),
      cancelledAtShopify: payload.cancelledAt ? toDate(payload.cancelledAt, new Date(0)) : null,
      financialStatus: payload.displayFinancialStatus,
      fulfillmentStatus: payload.displayFulfillmentStatus,
      currency: payload.currencyCode,
      grossLineTotal,
      totalDiscount: payload.totalDiscountsSet.shopMoney.amount,
      // Ship rev = phí ship SAU giảm (thực nhận); fallback phí gốc khi chưa có
      // discounted (đơn cũ chưa re-sync). Store chạy promo free-ship → net < gốc.
      totalShipping: netShippingAmount(shipLines) ?? payload.totalShippingPriceSet.shopMoney.amount,
      // Số tiền giảm ship (promo 50% off shipping) — MMP cần cho đối soát store riêng.
      shippingDiscount: (() => {
        const net = netShippingAmount(shipLines);
        if (net == null) return null;
        const gross = Number(payload.totalShippingPriceSet.shopMoney.amount) || 0;
        return Math.max(0, gross - Number(net)).toFixed(2);
      })(),
      totalTax: payload.totalTaxSet.shopMoney.amount,
      totalPrice: payload.totalPriceSet.shopMoney.amount,
      shipCountry: payload.shippingAddress?.countryCodeV2 ?? null,
      shipCity: payload.shippingAddress?.city ?? null,
      shipPostcode: payload.shippingAddress?.zip ?? null,
      shipAddress1: payload.shippingAddress?.address1 ?? null,
      shipAddress2: payload.shippingAddress?.address2 ?? null,
      shipProvinceCode: payload.shippingAddress?.provinceCode ?? null,
      shipName: payload.shippingAddress?.name ?? null,
      shipCompany: payload.shippingAddress?.company ?? null,
      shipWeightKg: payload.totalWeight !== null ? (payload.totalWeight / 1000).toFixed(3) : null,
      shippingCarrierKey: detectCarrierKey(shipLines),
      transactionFee: txnFee.feeOrderCcy !== null ? String(txnFee.feeOrderCcy) : null,
      transactionFeeNative: txnFee.feeNative !== null ? String(txnFee.feeNative) : null,
      transactionFeeNativeCurrency: txnFee.feeNativeCurrency,
    },
    lines,
    refunds: payload.refunds.map((r) => mapRefund(r)),
    trackingNumbers: extractTrackingNumbers(payload.fulfillments),
  };
}

function mapLine(node: ShopifyLineItem): MappedOrder['lines'][number] {
  const discountAlloc = node.discountAllocations
    .reduce((sum, d) => sum + Number(d.allocatedAmountSet.shopMoney.amount), 0)
    .toFixed(2);
  const unitPrice = node.originalUnitPriceSet.shopMoney.amount;
  const total = (Number(unitPrice) * node.quantity - Number(discountAlloc)).toFixed(2);
  return {
    shopifyLineId: node.id,
    sku: node.sku,
    vendor: node.vendor,
    productTitle: node.title,
    variantTitle: node.variantTitle,
    quantity: node.quantity,
    unitPrice,
    discountAlloc,
    total,
  };
}

/** Connection {nodes} (paged/webhook) hoặc array trần (bulk) → array. */
function nodesOf<T>(v: { nodes?: T[] } | T[] | null | undefined): T[] {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.nodes)) return v.nodes;
  return [];
}

function mapRefund(r: ShopifyRefund): MappedOrder['refunds'][number] {
  // Breakdown khoản hoàn (đối soát MMP): hoàn SHIP riêng + hoàn ĐỒ theo SKU.
  // Refund có thể là "trả hàng, tiền 0" (chỉ lines) hoặc "hoàn tiền trần" (chỉ amount).
  const shipLines = nodesOf(r.refundShippingLines);
  const hasShipDetail = r.refundShippingLines != null;
  const shippingAmount = shipLines
    .reduce((sum, l) => sum + (Number(l.subtotalAmountSet?.shopMoney?.amount) || 0), 0);
  const itemLines = nodesOf(r.refundLineItems).map((l) => ({
    sku: l.lineItem?.sku ?? null,
    title: l.lineItem?.title ?? null,
    qty: l.quantity,
    amount: (Number(l.subtotalSet?.shopMoney?.amount) || 0).toFixed(2),
    tax: (Number(l.totalTaxSet?.shopMoney?.amount) || 0).toFixed(2),
  }));
  return {
    shopifyRefundId: r.id,
    refundedAt: toDate(r.createdAt, new Date(0)),
    amount: r.totalRefundedSet.shopMoney.amount,
    reason: r.note,
    shippingAmount: hasShipDetail ? shippingAmount.toFixed(2) : null,
    lines: r.refundLineItems != null ? itemLines : null,
  };
}

function extractTrackingNumbers(fulfillments: ShopifyFulfillment[]): string[] {
  return fulfillments
    .flatMap((f) => f.trackingInfo)
    .map((t) => t.number)
    .filter((n): n is string => Boolean(n));
}
