import { describe, it, expect } from 'vitest';
import { khacGia } from './unit-cost-sync';

/** THUẦN — phần còn lại của module (docUnitCostShopify, syncUnitCost) gọi
 *  Shopify/DB thật, không test unit ở đây. */
describe('khacGia', () => {
  it('chưa có giá hiện tại (null) → khác', () => {
    expect(khacGia(null, { sku: 'A', amount: 100, currency: 'USD', vendor: 'MEAN BLVD' })).toBe(true);
  });

  it('cùng giá, cùng tiền tệ → không khác', () => {
    expect(khacGia({ costPerUnit: '100.0000', currency: 'USD' }, { sku: 'A', amount: 100, currency: 'USD', vendor: 'MEAN BLVD' })).toBe(false);
  });

  it('lệch 0.5 → khác', () => {
    expect(khacGia({ costPerUnit: '100.0000', currency: 'USD' }, { sku: 'A', amount: 100.5, currency: 'USD', vendor: 'MEAN BLVD' })).toBe(true);
  });

  it('khác tiền tệ dù cùng số → khác', () => {
    expect(khacGia({ costPerUnit: '100.0000', currency: 'USD' }, { sku: 'A', amount: 100, currency: 'VND', vendor: 'MEAN BLVD' })).toBe(true);
  });

  it("'292.0000' so với 292 → không khác (chỉ khác biểu diễn chuỗi)", () => {
    expect(khacGia({ costPerUnit: '292.0000', currency: 'USD' }, { sku: 'A', amount: 292, currency: 'USD', vendor: 'MEAN BLVD' })).toBe(false);
  });
});
