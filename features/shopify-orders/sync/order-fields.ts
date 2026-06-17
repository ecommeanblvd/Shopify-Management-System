/**
 * Tập field GraphQL cho 1 ĐƠN — nguồn-sự-thật duy nhất, dùng chung cho:
 *  - cron paged query (orders → nodes)
 *  - webhook single fetch (order(id:))
 * Khớp đúng shape mà `mapShopifyOrder` đọc (lineItems.nodes, refunds[], …).
 * Cố tình KHÔNG lấy shippingLines (giống paged query) — detectCarrierKey
 * chấp nhận undefined → carrier=null, đặt sau hoặc do bulk backfill set.
 */
export const ORDER_NODE_FIELDS = `
  id name createdAt processedAt cancelledAt
  displayFinancialStatus displayFulfillmentStatus currencyCode
  subtotalLineItemsQuantity
  totalDiscountsSet { shopMoney { amount currencyCode } }
  totalShippingPriceSet { shopMoney { amount currencyCode } }
  totalTaxSet { shopMoney { amount currencyCode } }
  totalPriceSet { shopMoney { amount currencyCode } }
  shippingAddress { countryCodeV2 city zip address1 address2 provinceCode name company }
  totalWeight
  lineItems(first: 250) {
    nodes {
      id sku vendor title variantTitle quantity
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
    }
  }
  refunds {
    id createdAt note
    totalRefundedSet { shopMoney { amount currencyCode } }
  }
  fulfillments { trackingInfo { number company } }
`.trim();
