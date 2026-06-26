import { describe, it, expect } from 'vitest';
import { buildMmpOrderPayload } from './order-push-logic';

describe('buildMmpOrderPayload', () => {
  it('chỉ gồm field đã chốt (không PII chi tiết); line gồm vendor + receivedAt', () => {
    const p = buildMmpOrderPayload({
      orderNumber: '#MBLVD28899', store: 'meanblvd', recipientName: 'Nguyen A', shipCountry: 'SA',
      placedAt: '2026-06-15T10:00:00.000Z',
      brandLines: [{ sku: 'ABC', title: 'Áo', qty: 2, vendor: 'denio', receivedAt: '2026-06-20T00:00:00.000Z' }],
    });
    expect(p).toEqual({
      orderNumber: '#MBLVD28899', store: 'meanblvd', recipientName: 'Nguyen A', shipCountry: 'SA',
      placedAt: '2026-06-15T10:00:00.000Z',
      lines: [{ sku: 'ABC', title: 'Áo', qty: 2, vendor: 'denio', receivedAt: '2026-06-20T00:00:00.000Z' }],
    });
    expect(Object.keys(p).sort()).toEqual(['lines','orderNumber','placedAt','recipientName','shipCountry','store']);
    expect(Object.keys(p.lines[0]).sort()).toEqual(['qty','receivedAt','sku','title','vendor']);
  });
  it('giữ nguyên thứ tự + nhiều dòng brand; vendor null + receivedAt null cho line chưa nhận', () => {
    const p = buildMmpOrderPayload({ orderNumber: 'TA1', store: 'tinhatelier', recipientName: null, shipCountry: 'DE', placedAt: null,
      brandLines: [{ sku: 'A', title: 'X', qty: 1, vendor: 'montsand', receivedAt: '2026-06-21T00:00:00.000Z' }, { sku: null, title: 'Y', qty: 3, vendor: null, receivedAt: null }] });
    expect(p.lines).toEqual([{ sku: 'A', title: 'X', qty: 1, vendor: 'montsand', receivedAt: '2026-06-21T00:00:00.000Z' }, { sku: null, title: 'Y', qty: 3, vendor: null, receivedAt: null }]);
    expect(p.placedAt).toBeNull();
  });
});
