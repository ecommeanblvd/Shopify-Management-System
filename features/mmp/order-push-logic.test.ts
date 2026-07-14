import { describe, it, expect } from 'vitest';
import { buildMmpOrderPayload } from './order-push-logic';

describe('buildMmpOrderPayload', () => {
  it('chỉ gồm field đã chốt (không PII chi tiết); line gồm vendor + receivedAt', () => {
    const p = buildMmpOrderPayload({
      orderNumber: '#MBLVD28899', store: 'meanblvd', recipientName: 'Nguyen A', shipCountry: 'SA',
      placedAt: '2026-06-15T10:00:00.000Z', receivedAt: '2026-06-20T00:00:00.000Z',
      financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED', cancelledAt: null,
      brandLines: [{ sku: 'ABC', title: 'Áo', qty: 2, vendor: 'denio', receivedAt: '2026-06-20T00:00:00.000Z' }],
    });
    expect(p).toEqual({
      orderNumber: '#MBLVD28899', store: 'meanblvd', recipientName: 'Nguyen A', shipCountry: 'SA',
      placedAt: '2026-06-15T10:00:00.000Z', receivedAt: '2026-06-20T00:00:00.000Z',
      financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED', cancelledAt: null,
      lines: [{ sku: 'ABC', title: 'Áo', qty: 2, vendor: 'denio', receivedAt: '2026-06-20T00:00:00.000Z' }],
    });
    // `receivedAt` cấp order (MMP đọc field này) — tên CHÍNH XÁC 'receivedAt'.
    expect(Object.keys(p).sort()).toEqual(['cancelledAt','financialStatus','fulfillmentStatus','lines','orderNumber','placedAt','receivedAt','recipientName','shipCountry','store']);
    expect(p.receivedAt).toBe('2026-06-20T00:00:00.000Z');
    expect(Object.keys(p.lines[0]).sort()).toEqual(['qty','receivedAt','sku','title','vendor']);
  });
  it('order-level receivedAt null khi chưa nhận; giữ thứ tự + nhiều dòng brand', () => {
    const p = buildMmpOrderPayload({ orderNumber: 'TA1', store: 'tinhatelier', recipientName: null, shipCountry: 'DE', placedAt: null, receivedAt: null,
      financialStatus: 'PENDING', fulfillmentStatus: null, cancelledAt: null,
      brandLines: [{ sku: 'A', title: 'X', qty: 1, vendor: 'montsand', receivedAt: '2026-06-21T00:00:00.000Z' }, { sku: null, title: 'Y', qty: 3, vendor: null, receivedAt: null }] });
    expect(p.lines).toEqual([{ sku: 'A', title: 'X', qty: 1, vendor: 'montsand', receivedAt: '2026-06-21T00:00:00.000Z' }, { sku: null, title: 'Y', qty: 3, vendor: null, receivedAt: null }]);
    expect(p.placedAt).toBeNull();
    expect(p.receivedAt).toBeNull();
  });
  it('mang trạng thái Shopify: refunded + cancelled + chưa giao', () => {
    const p = buildMmpOrderPayload({ orderNumber: 'TA9', store: 'tinhatelier', recipientName: 'B', shipCountry: 'US',
      placedAt: '2026-01-01T00:00:00.000Z', receivedAt: null,
      financialStatus: 'REFUNDED', fulfillmentStatus: 'UNFULFILLED', cancelledAt: '2026-01-05T00:00:00.000Z',
      brandLines: [{ sku: 'Z', title: 'Z', qty: 1, vendor: 'tinh', receivedAt: null }] });
    expect(p.financialStatus).toBe('REFUNDED');
    expect(p.fulfillmentStatus).toBe('UNFULFILLED');
    expect(p.cancelledAt).toBe('2026-01-05T00:00:00.000Z');
  });
});
