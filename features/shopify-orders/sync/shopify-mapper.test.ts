import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapShopifyOrder } from './shopify-mapper';
import type { ShopifyOrderPayload } from '../shopify-types';

function fixture(name: string): ShopifyOrderPayload {
  const raw = readFileSync(join(__dirname, '..', '__fixtures__', `${name}.json`), 'utf8');
  return JSON.parse(raw) as ShopifyOrderPayload;
}

describe('mapShopifyOrder', () => {
  it('extracts the simple-order fields', () => {
    const m = mapShopifyOrder(fixture('order-simple'), 'store-1');
    expect(m.order.storeId).toBe('store-1');
    expect(m.order.shopifyOrderId).toBe('gid://shopify/Order/5000000001');
    expect(m.order.shopifyOrderNumber).toBe('#1001');
    expect(m.order.currency).toBe('USD');
    expect(m.order.grossLineTotal).toBe('50.00');
    expect(m.order.totalDiscount).toBe('0.00');
    expect(m.order.totalShipping).toBe('12.00');
    expect(m.order.totalPrice).toBe('62.00');
    expect(m.order.shipCountry).toBe('US');
    expect(m.order.shipCity).toBe('San Francisco');
    expect(m.order.shipPostcode).toBe('94103');
    expect(m.order.shipWeightKg).toBe('0.800');
    expect(m.order.cancelledAtShopify).toBeNull();
    expect(m.lines).toHaveLength(1);
    expect(m.lines[0].sku).toBe('MEAN-SHIRT-001');
    expect(m.lines[0].vendor).toBe('MEAN Studio');
    expect(m.lines[0].unitPrice).toBe('50.00');
    expect(m.lines[0].total).toBe('50.00');
    expect(m.refunds).toHaveLength(0);
    expect(m.trackingNumbers).toEqual(['TRK-001']);
  });

  // Regression: the backfill bulk query historically omitted `updatedAt`, so
  // `new Date(undefined)` produced an Invalid Date that threw "Invalid time
  // value" the moment Drizzle serialised it — aborting the whole backfill.
  // The mapper must tolerate a missing date field and fall back, never throw.
  it('falls back (does not throw) when updatedAt/processedAt are absent', () => {
    const base = fixture('order-simple');
    const partial = { ...base } as Partial<ShopifyOrderPayload>;
    delete partial.updatedAt;
    delete partial.processedAt;

    const run = () => mapShopifyOrder(partial as ShopifyOrderPayload, 'store-1');
    expect(run).not.toThrow();

    const m = run();
    const created = new Date(base.createdAt).getTime();
    // Both absent fields fall back to createdAt, and remain valid (serialisable) dates.
    expect(m.order.updatedAtShopify.getTime()).toBe(created);
    expect(m.order.processedAtShopify.getTime()).toBe(created);
    expect(() => m.order.updatedAtShopify.toISOString()).not.toThrow();
  });

  it('ship rev = phí ship SAU giảm (discountedPriceSet), KHÔNG phải phí gốc', () => {
    // TINH free-ship: phí gốc 58.32, khách thực trả 0 → ship rev phải = 0.
    const base = fixture('order-simple');
    const p = {
      ...base,
      totalShippingPriceSet: { shopMoney: { amount: '58.32', currencyCode: 'USD' } },
      shippingLines: [{ title: 'FedEx', code: 'fedex', discountedPriceSet: { shopMoney: { amount: '0.00' } } }],
    } as unknown as ShopifyOrderPayload;
    expect(mapShopifyOrder(p, 'store-1').order.totalShipping).toBe('0.00');
  });

  it('nhiều shipping line có giảm → net = Σ discountedPriceSet', () => {
    const base = fixture('order-simple');
    const p = {
      ...base,
      shippingLines: [
        { title: 'A', code: 'fedex', discountedPriceSet: { shopMoney: { amount: '10.50' } } },
        { title: 'B', code: 'dhl', discountedPriceSet: { shopMoney: { amount: '4.50' } } },
      ],
    } as unknown as ShopifyOrderPayload;
    expect(mapShopifyOrder(p, 'store-1').order.totalShipping).toBe('15.00');
  });

  it('không có discountedPriceSet (đơn cũ chưa re-sync) → fallback phí gốc', () => {
    const base = fixture('order-simple');
    // order-simple không có shippingLines discounted → dùng totalShippingPriceSet.
    expect(mapShopifyOrder(base, 'store-1').order.totalShipping).toBe(base.totalShippingPriceSet.shopMoney.amount);
  });

  it('shippingDiscount = phí gốc − Σ discounted (promo 50% off shipping)', () => {
    const base = fixture('order-simple');
    const p = {
      ...base,
      totalShippingPriceSet: { shopMoney: { amount: '58.32', currencyCode: 'USD' } },
      shippingLines: [{ title: 'FedEx', code: 'fedex', discountedPriceSet: { shopMoney: { amount: '29.16' } } }],
    } as unknown as ShopifyOrderPayload;
    const o = mapShopifyOrder(p, 'store-1').order;
    expect(o.totalShipping).toBe('29.16');
    expect(o.shippingDiscount).toBe('29.16');
  });

  it('không giảm ship → shippingDiscount = 0.00; thiếu shippingLines → null (không biết)', () => {
    const base = fixture('order-simple');
    const noDiscount = {
      ...base,
      totalShippingPriceSet: { shopMoney: { amount: '20.00', currencyCode: 'USD' } },
      shippingLines: [{ title: 'FedEx', code: 'fedex', discountedPriceSet: { shopMoney: { amount: '20.00' } } }],
    } as unknown as ShopifyOrderPayload;
    expect(mapShopifyOrder(noDiscount, 'store-1').order.shippingDiscount).toBe('0.00');
    expect(mapShopifyOrder(base, 'store-1').order.shippingDiscount).toBeNull();
  });

  it('captures refunds with amount + reason', () => {
    const m = mapShopifyOrder(fixture('order-refunded'), 'store-1');
    expect(m.refunds).toHaveLength(1);
    expect(m.refunds[0].shopifyRefundId).toBe('gid://shopify/Refund/4000000001');
    expect(m.refunds[0].amount).toBe('38.00');
    expect(m.refunds[0].reason).toBe('customer returned');
  });

  it('computes per-line totals as (unit_price × qty) − discount_alloc', () => {
    const m = mapShopifyOrder(fixture('order-multi-line'), 'store-1');
    expect(m.lines).toHaveLength(2);
    // Line 1: 50 × 2 − 10 = 90.00
    expect(m.lines[0].quantity).toBe(2);
    expect(m.lines[0].unitPrice).toBe('50.00');
    expect(m.lines[0].discountAlloc).toBe('10.00');
    expect(m.lines[0].total).toBe('90.00');
    // Line 2: 10 × 1 − 0 = 10.00
    expect(m.lines[1].total).toBe('10.00');
    // grossLineTotal = Σ(unit_price × qty) = 110, total_discount comes from order header
    expect(m.order.grossLineTotal).toBe('110.00');
    expect(m.order.totalDiscount).toBe('10.00');
  });

  it('converts totalWeight grams to kg with 3 decimals', () => {
    const m = mapShopifyOrder(fixture('order-multi-line'), 'store-1');
    expect(m.order.shipWeightKg).toBe('1.200');
  });

  it('leaves city/postcode null when shippingAddress is missing (pickup, digital)', () => {
    // shippingAddress is fully nullable on Shopify when the order has no
    // ship-to (in-store pickup, digital goods). The mapper must keep
    // every dependent field null instead of throwing.
    const payload = {
      ...fixture('order-simple'),
      shippingAddress: null,
    };
    const m = mapShopifyOrder(payload, 'store-1');
    expect(m.order.shipCountry).toBeNull();
    expect(m.order.shipCity).toBeNull();
    expect(m.order.shipPostcode).toBeNull();
  });

  it('leaves city/postcode null when shippingAddress has country only', () => {
    // Some older Shopify orders only had countryCodeV2; defensive in case
    // a legacy payload misses optional fields.
    const payload = {
      ...fixture('order-simple'),
      shippingAddress: { countryCodeV2: 'VN', city: null, zip: null },
    };
    const m = mapShopifyOrder(payload, 'store-1');
    expect(m.order.shipCountry).toBe('VN');
    expect(m.order.shipCity).toBeNull();
    expect(m.order.shipPostcode).toBeNull();
  });
});
