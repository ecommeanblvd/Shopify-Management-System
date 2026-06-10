import { describe, it, expect } from 'vitest';
import { trackingCompany, hasWriteFulfillmentsScope, buildFulfillmentLineItems } from './shopify-push';

describe('trackingCompany', () => {
  it('maps known carriers', () => {
    expect(trackingCompany('fedex')).toBe('FedEx');
    expect(trackingCompany('dhl')).toBe('DHL');
  });
  it('capitalizes unknown, handles null', () => {
    expect(trackingCompany('ups')).toBe('Ups');
    expect(trackingCompany(null)).toBe('Other');
  });
});

describe('hasWriteFulfillmentsScope', () => {
  it('true only when present', () => {
    expect(hasWriteFulfillmentsScope(['read_orders', 'write_fulfillments'])).toBe(true);
    expect(hasWriteFulfillmentsScope(['read_orders'])).toBe(false);
  });
});

describe('buildFulfillmentLineItems', () => {
  const fos = [{
    id: 'gid://shopify/FulfillmentOrder/1',
    lineItems: [
      { id: 'gid://shopify/FulfillmentOrderLineItem/11', remainingQuantity: 2, lineItem: { id: 'gid://shopify/LineItem/100' } },
      { id: 'gid://shopify/FulfillmentOrderLineItem/12', remainingQuantity: 1, lineItem: { id: 'gid://shopify/LineItem/200' } },
    ],
  }];

  it('maps pack lines to FO line items, clamping to remaining qty', () => {
    const r = buildFulfillmentLineItems(fos, [{ shopifyLineId: 'gid://shopify/LineItem/100', qty: 5 }]);
    expect(r).toEqual({
      ok: true,
      lineItemsByFulfillmentOrder: [{
        fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1',
        fulfillmentOrderLineItems: [{ id: 'gid://shopify/FulfillmentOrderLineItem/11', quantity: 2 }],
      }],
    });
  });

  it('errors when no pack line matches a fulfillable FO line', () => {
    const r = buildFulfillmentLineItems(fos, [{ shopifyLineId: 'gid://shopify/LineItem/999', qty: 1 }]);
    expect(r.ok).toBe(false);
  });

  it('skips FO line items with remainingQuantity 0', () => {
    const zero = [{ id: 'gid://shopify/FulfillmentOrder/2', lineItems: [
      { id: 'gid://shopify/FulfillmentOrderLineItem/21', remainingQuantity: 0, lineItem: { id: 'gid://shopify/LineItem/100' } },
    ] }];
    const r = buildFulfillmentLineItems(zero, [{ shopifyLineId: 'gid://shopify/LineItem/100', qty: 1 }]);
    expect(r.ok).toBe(false);
  });
});
