import { describe, it, expect } from 'vitest';
import { parseBrandReceivedRow, larkDateField } from './parse-brand-received';

describe('larkDateField', () => {
  it('đọc field date Lark {type:5,value:[ms]} → ms', () => {
    expect(larkDateField({ type: 5, value: [1748192400000] })).toBe(1748192400000);
  });
  it('số trực tiếp → số; rỗng/khác → null', () => {
    expect(larkDateField(1748192400000)).toBe(1748192400000);
    expect(larkDateField({ type: 5, value: [] })).toBeNull();
    expect(larkDateField(null)).toBeNull();
    expect(larkDateField('abc')).toBeNull();
  });
});

describe('parseBrandReceivedRow', () => {
  it('đọc order (bỏ #), sku, vendor, receivedAt', () => {
    const r = parseBrandReceivedRow({
      'order_number': [{ text: '#MBLVD21623', type: 'text' }],
      'Lineitem SKU': [{ text: 'Lespoir-SS_008-M-WHI-Sale', type: 'text' }],
      'vendor': 'MEAN BLVD',
      'Visible - WH-Ngày MEAN nhận hàng gần nhất': { type: 5, value: [1748192400000] },
    });
    expect(r.orderNumber).toBe('MBLVD21623');
    expect(r.sku).toBe('Lespoir-SS_008-M-WHI-Sale');
    expect(r.vendor).toBe('MEAN BLVD');
    expect(r.receivedAt?.getTime()).toBe(1748192400000);
  });
  it('thiếu ngày nhận → receivedAt null; thiếu order/sku → null', () => {
    const r = parseBrandReceivedRow({ 'order_number': [{ text: 'MBLVD1' }], 'Lineitem SKU': [{ text: 'X' }] });
    expect(r.receivedAt).toBeNull();
    expect(parseBrandReceivedRow({}).orderNumber).toBeNull();
    expect(parseBrandReceivedRow({}).sku).toBeNull();
  });
});
