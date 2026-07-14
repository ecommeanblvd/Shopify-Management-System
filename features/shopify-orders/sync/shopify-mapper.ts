import type {
  ShopifyOrderPayload,
  ShopifyLineItem,
  ShopifyRefund,
  ShopifyFulfillment,
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

export function mapShopifyOrder(payload: ShopifyOrderPayload, storeId: string): MappedOrder {
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
      totalShipping: payload.totalShippingPriceSet.shopMoney.amount,
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
      shippingCarrierKey: detectCarrierKey(payload.shippingLines),
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

function mapRefund(r: ShopifyRefund): MappedOrder['refunds'][number] {
  return {
    shopifyRefundId: r.id,
    refundedAt: toDate(r.createdAt, new Date(0)),
    amount: r.totalRefundedSet.shopMoney.amount,
    reason: r.note,
  };
}

function extractTrackingNumbers(fulfillments: ShopifyFulfillment[]): string[] {
  return fulfillments
    .flatMap((f) => f.trackingInfo)
    .map((t) => t.number)
    .filter((n): n is string => Boolean(n));
}
