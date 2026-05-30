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
});
