import { describe, it, expect } from 'vitest';
import { buildMmpOrderPayload } from './order-push-logic';

describe('buildMmpOrderPayload', () => {
  it('chỉ gồm field đã chốt (không PII chi tiết)', () => {
    const p = buildMmpOrderPayload({
      orderNumber: '#MBLVD28899', store: 'meanblvd', recipientName: 'Nguyen A', shipCountry: 'SA',
      brandLines: [{ sku: 'ABC', title: 'Áo', qty: 2 }],
    });
    expect(p).toEqual({
      orderNumber: '#MBLVD28899', store: 'meanblvd', recipientName: 'Nguyen A', shipCountry: 'SA',
      lines: [{ sku: 'ABC', title: 'Áo', qty: 2 }],
    });
    // không lọt key lạ (email/address/price)
    expect(Object.keys(p).sort()).toEqual(['lines','orderNumber','recipientName','shipCountry','store']);
  });
  it('giữ nguyên thứ tự + nhiều dòng brand', () => {
    const p = buildMmpOrderPayload({ orderNumber: 'TA1', store: 'tinhatelier', recipientName: null, shipCountry: 'DE',
      brandLines: [{ sku: 'A', title: 'X', qty: 1 }, { sku: null, title: 'Y', qty: 3 }] });
    expect(p.lines).toEqual([{ sku: 'A', title: 'X', qty: 1 }, { sku: null, title: 'Y', qty: 3 }]);
  });
});
