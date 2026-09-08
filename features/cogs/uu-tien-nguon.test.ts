import { describe, it, expect } from 'vitest';
import { duocGhiDe } from './uu-tien-nguon';

describe('duocGhiDe', () => {
  it('mmp kế nhiệm brand_statement → mmp được đè brand_statement', () => {
    expect(duocGhiDe('brand_statement', 'mmp')).toBe(true);
  });

  it('brand_statement KHÔNG được đè mmp (chiều ngược lại)', () => {
    expect(duocGhiDe('mmp', 'brand_statement')).toBe(false);
  });

  it('shopify_unit_cost bị đè bởi cả hai nguồn bảng kê', () => {
    expect(duocGhiDe('shopify_unit_cost', 'brand_statement')).toBe(true);
    expect(duocGhiDe('shopify_unit_cost', 'mmp')).toBe(true);
  });

  it('không nguồn nào bị đè bởi shopify_unit_cost', () => {
    expect(duocGhiDe('brand_statement', 'shopify_unit_cost')).toBe(false);
    expect(duocGhiDe('mmp', 'shopify_unit_cost')).toBe(false);
  });

  it('cùng nguồn → luôn được ghi đè (ví dụ nhập lại chính kỳ đó)', () => {
    expect(duocGhiDe('brand_statement', 'brand_statement')).toBe(true);
    expect(duocGhiDe('mmp', 'mmp')).toBe(true);
    expect(duocGhiDe('shopify_unit_cost', 'shopify_unit_cost')).toBe(true);
  });
});
