import type {
  ShopifyOrderPayload,
  ShopifyLineItem,
  ShopifyRefund,
  ShopifyFulfillment,
} from '../shopify-types';

/** Internal shape ready for the upsert function. Numbers are strings to match
 *  Drizzle's numeric column representation; no float precision loss. */
export interface MappedOrder {
  order: {
    storeId: string;
    shopifyOrderId: string;
    shopifyOrderNumber: string;
    createdAtShopify: Date;
    processedAtShopify: Date;
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
    shipWeightKg: string | null;
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

export function mapShopifyOrder(payload: ShopifyOrderPayload, storeId: string): MappedOrder {
  const lines = payload.lineItems.nodes.map((node) => mapLine(node));
  // grossLineTotal = Σ(original_unit_price × qty) — true GMV before any discount
  const grossLineTotal = lines
    .reduce((sum, l) => sum + Number(l.unitPrice) * l.quantity, 0)
    .toFixed(2);

  return {
    order: {
      storeId,
      shopifyOrderId: payload.id,
      shopifyOrderNumber: payload.name,
      createdAtShopify: new Date(payload.createdAt),
      processedAtShopify: new Date(payload.processedAt),
      cancelledAtShopify: payload.cancelledAt ? new Date(payload.cancelledAt) : null,
      financialStatus: payload.displayFinancialStatus,
      fulfillmentStatus: payload.displayFulfillmentStatus,
      currency: payload.currencyCode,
      grossLineTotal,
      totalDiscount: payload.totalDiscountsSet.shopMoney.amount,
      totalShipping: payload.totalShippingPriceSet.shopMoney.amount,
      totalTax: payload.totalTaxSet.shopMoney.amount,
      totalPrice: payload.totalPriceSet.shopMoney.amount,
      shipCountry: payload.shippingAddress?.countryCodeV2 ?? null,
      shipWeightKg: payload.totalWeight !== null ? (payload.totalWeight / 1000).toFixed(3) : null,
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
    refundedAt: new Date(r.createdAt),
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
