/**
 * Shape of a single order in the Shopify GraphQL Admin API "orders" query
 * result, narrowed to the fields we persist. Used by:
 *   - webhook handlers (orders/create, orders/updated, orders/cancelled)
 *   - bulkOperation JSONL stream parser
 *   - hourly safety-net cron paginator
 *
 * We deliberately keep this in a single file so all three call sites agree
 * on shape. A change here ripples to every test fixture and mapper test.
 */

export interface ShopifyMoney {
  amount: string;          // Shopify returns money as decimal strings
  currencyCode: string;
}

export interface ShopifyMoneyBag {
  shopMoney: ShopifyMoney;
}

export interface ShopifyLineItem {
  id: string;                                   // gid://shopify/LineItem/...
  sku: string | null;
  vendor: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  originalUnitPriceSet: ShopifyMoneyBag;        // per-unit price BEFORE any discount
  discountAllocations: Array<{
    allocatedAmountSet: ShopifyMoneyBag;
  }>;
}

export interface ShopifyRefund {
  id: string;
  createdAt: string;                            // ISO-8601
  totalRefundedSet: ShopifyMoneyBag;
  note: string | null;
}

export interface ShopifyFulfillment {
  trackingInfo: Array<{
    number: string | null;
    company: string | null;
  }>;
}

/** One shipping line from a Shopify order — operator-visible `title` plus
 *  the machine-readable `code`. Either field is used to derive the carrier
 *  key (fedex / dhl). NULL on both means we couldn't tag the order. */
export interface ShopifyShippingLine {
  title: string | null;
  code: string | null;
  /** Phí ship SAU giảm giá (khách THỰC trả) — dùng làm ship rev thay vì
   *  totalShippingPriceSet (phí GỐC, chưa trừ promo giảm ship). null = chưa sync. */
  discountedPriceSet?: { shopMoney: { amount: string } } | null;
}

export interface ShopifyTxnFee {
  amount: ShopifyMoney;
  rate: string | null;
  type: string;
  flatFee?: { amount: string } | null;
}

export interface ShopifyTxn {
  kind: string;
  status: string;
  amountSet: { shopMoney: ShopifyMoney };
  fees: ShopifyTxnFee[];
}

export interface ShopifyOrderPayload {
  id: string;                                   // gid://shopify/Order/...
  name: string;                                 // e.g. "#1234"
  createdAt: string;
  processedAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string;               // 'PAID' | 'PARTIALLY_REFUNDED' | ...
  displayFulfillmentStatus: string | null;
  currencyCode: string;
  subtotalLineItemsQuantity: number;
  // Pre-discount line total — what we map to grossLineTotal.
  // Shopify exposes this as `currentTotalPriceSet` minus discounts in some
  // versions; we compute it from line items in the mapper to be sure.
  totalDiscountsSet: ShopifyMoneyBag;
  totalShippingPriceSet: ShopifyMoneyBag;
  totalTaxSet: ShopifyMoneyBag;
  totalPriceSet: ShopifyMoneyBag;
  shippingAddress: {
    countryCodeV2: string;
    // Used by the carrier engine for remote-area surcharge lookup.
    // FedEx/DHL publish remote areas by either postcode (zip) or city
    // depending on country, and Shopify always populates both when
    // available — we store both and let the engine fall back from
    // postcode → city.
    city: string | null;
    zip: string | null;
    // Địa chỉ đầy đủ — để verify qua FedEx Address Validation. Optional vì
    // Shopify/fixtures cũ có thể không trả các field này.
    address1?: string | null;
    address2?: string | null;
    provinceCode?: string | null;
    name?: string | null;
    company?: string | null;
  } | null;
  totalWeight: number | null;                   // in grams
  // Only present when the query included `customer { id }` — gated per-store
  // on the read_customers scope (see order-fields.ts orderNodeFields). GID
  // form (gid://shopify/Customer/N) as returned by GraphQL; normalized to the
  // bare numeric id before persisting (see upsert-order.ts normalizeCustomerGid).
  customer?: { id: string } | null;
  lineItems: { nodes: ShopifyLineItem[] };
  refunds: ShopifyRefund[];
  fulfillments: ShopifyFulfillment[];
  transactions?: ShopifyTxn[];
  // Always present on a paid order; empty on pickup-only or free
  // fulfilment. Used to derive the carrier the quote engine should
  // price against (per operator spec: never auto-pick cheapest).
  shippingLines: ShopifyShippingLine[];
}
