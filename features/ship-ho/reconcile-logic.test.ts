import { describe, it, expect } from 'vitest';
import { parseCarrierInvoiceRow, computeReconcile } from './reconcile-logic';

describe('parseCarrierInvoiceRow', () => {
  it('dòng hợp lệ → ok', () => {
    const r = parseCarrierInvoiceRow(['794000000001', '123,456', 'ghi chú']);
    expect(r).toEqual({ kind: 'ok', trackingNumber: '794000000001', actualCostVnd: 123456 });
  });
  it('dòng rỗng → skip_empty', () => {
    expect(parseCarrierInvoiceRow([null, '']).kind).toBe('skip_empty');
    expect(parseCarrierInvoiceRow([]).kind).toBe('skip_empty');
  });
  it('thiếu tracking → error missing_tracking', () => {
    expect(parseCarrierInvoiceRow(['', '100'])).toEqual({ kind: 'error', reason: 'missing_tracking' });
  });
  it('cost không hợp lệ / âm → error bad_cost', () => {
    expect(parseCarrierInvoiceRow(['T1', 'abc'])).toEqual({ kind: 'error', reason: 'bad_cost' });
    expect(parseCarrierInvoiceRow(['T1', '-5'])).toEqual({ kind: 'error', reason: 'bad_cost' });
  });
  it('cost = 0 hợp lệ', () => {
    expect(parseCarrierInvoiceRow(['T1', '0'])).toEqual({ kind: 'ok', trackingNumber: 'T1', actualCostVnd: 0 });
  });
});

describe('computeReconcile', () => {
  it('đủ estimate + charged → delta = actual−estimate, margin = charged−actual', () => {
    expect(computeReconcile({ estimateVnd: 100000, chargedVnd: 130000, actualVnd: 110000 }))
      .toEqual({ deltaVnd: 10000, marginVnd: 20000, reconcileStatus: 'reconciled' });
  });
  it('chưa quote (estimate null) → delta null; charged null → margin null', () => {
    expect(computeReconcile({ estimateVnd: null, chargedVnd: null, actualVnd: 90000 }))
      .toEqual({ deltaVnd: null, marginVnd: null, reconcileStatus: 'reconciled' });
  });
  it('margin âm khi lỗ (actual > charged)', () => {
    expect(computeReconcile({ estimateVnd: 100000, chargedVnd: 100000, actualVnd: 120000 }))
      .toEqual({ deltaVnd: 20000, marginVnd: -20000, reconcileStatus: 'reconciled' });
  });
});
