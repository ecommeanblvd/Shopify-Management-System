import { describe, expect, it } from 'vitest';
import { resolveQuoteWeight } from './fedex-quote-cache';
import { fboWeightToKg } from '@/features/shipments/fedex-fbo-parse';

describe('fboWeightToKg', () => {
  it('K/KG → giữ kg; P/LB → đổi sang kg', () => {
    expect(fboWeightToKg(3.7, 'K')).toBe(3.7);
    expect(fboWeightToKg(5.2, 'P')).toBe(2.359); // 5.2 lb
    expect(fboWeightToKg(10, 'LB')).toBe(4.536);
    expect(fboWeightToKg(2, '')).toBe(2); // rỗng → coi kg
    expect(fboWeightToKg(0, 'K')).toBe(0);
  });
});

describe('resolveQuoteWeight — ưu tiên cân', () => {
  const dims = { length: 30, width: 20, height: 10 };
  it('1) billing weight hoá đơn → dùng thẳng, bỏ dims', () => {
    expect(resolveQuoteWeight({ billingWeightKg: 3.7, actualWeightKg: 2, dims }))
      .toEqual({ weightKg: 3.7 });
  });
  it('2) không billing, có dims → cân thực + dims (FedEx max)', () => {
    expect(resolveQuoteWeight({ actualWeightKg: 1.2, dims }))
      .toEqual({ weightKg: 1.2, dims });
  });
  it('3) không billing, không dims → cân thực', () => {
    expect(resolveQuoteWeight({ actualWeightKg: 0.7 })).toEqual({ weightKg: 0.7, dims: undefined });
  });
  it('4) thiếu cả billing/actual/dims → cân Shopify', () => {
    expect(resolveQuoteWeight({ shopifyWeightKg: 1.1 })).toEqual({ weightKg: 1.1, dims: undefined });
  });
});
