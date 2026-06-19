import { describe, it, expect } from 'vitest';
import { buildMmpOrderPayload } from './order-push-logic';

describe('buildMmpOrderPayload', () => {
  it('chỉ gồm field đã chốt (không PII chi tiết); line gồm vendor', () => {
    const p = buildMmpOrderPayload({
      orderNumber: '#MBLVD28899', store: 'meanblvd', recipientName: 'Nguyen A', shipCountry: 'SA',
      brandLines: [{ sku: 'ABC', title: 'Áo', qty: 2, vendor: 'denio' }],
    });
    expect(p).toEqual({
      orderNumber: '#MBLVD28899', store: 'meanblvd', recipientName: 'Nguyen A', shipCountry: 'SA',
      lines: [{ sku: 'ABC', title: 'Áo', qty: 2, vendor: 'denio' }],
    });
    // không lọt key lạ ở top-level (email/address/price)
    expect(Object.keys(p).sort()).toEqual(['lines','orderNumber','recipientName','shipCountry','store']);
    // line chỉ gồm sku/title/qty/vendor (không giá)
    expect(Object.keys(p.lines[0]).sort()).toEqual(['qty','sku','title','vendor']);
  });
  it('giữ nguyên thứ tự + nhiều dòng brand; vendor null cho line không rõ brand', () => {
    const p = buildMmpOrderPayload({ orderNumber: 'TA1', store: 'tinhatelier', recipientName: null, shipCountry: 'DE',
      brandLines: [{ sku: 'A', title: 'X', qty: 1, vendor: 'montsand' }, { sku: null, title: 'Y', qty: 3, vendor: null }] });
    expect(p.lines).toEqual([{ sku: 'A', title: 'X', qty: 1, vendor: 'montsand' }, { sku: null, title: 'Y', qty: 3, vendor: null }]);
  });
});
