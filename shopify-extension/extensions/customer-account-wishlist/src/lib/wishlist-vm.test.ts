import { describe, it, expect } from 'vitest';
import { fmtMoney, productUrl, soldOutBadge } from './wishlist-vm';

describe('fmtMoney', () => {
  it('USD → $x.xx', () => {
    expect(fmtMoney('263.98', 'USD')).toBe('$263.98');
  });
  it('null amount → chuỗi rỗng', () => {
    expect(fmtMoney(null, 'USD')).toBe('');
  });
  it('currency khác → "amount CUR"', () => {
    expect(fmtMoney('100.00', 'AED')).toBe('100.00 AED');
  });
  it('currency null → chỉ amount', () => {
    expect(fmtMoney('100.00', null)).toBe('100.00');
  });
});

describe('productUrl', () => {
  it('build storefront URL', () => {
    expect(productUrl('cici-mean.myshopify.com', 'red-dress')).toBe('https://cici-mean.myshopify.com/products/red-dress');
  });
});

describe('soldOutBadge', () => {
  it('false → Sold out', () => {
    expect(soldOutBadge(false)).toBe('Sold out');
  });
  it('true → null', () => {
    expect(soldOutBadge(true)).toBeNull();
  });
  it('null (unknown) → null', () => {
    expect(soldOutBadge(null)).toBeNull();
  });
});
