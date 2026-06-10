import { describe, it, expect } from 'vitest';
import {
  nextReturnCode,
  validateReturnDraft,
  validateReturnQc,
  restockEffect,
  refundReconcileFlag,
} from './logic';

describe('nextReturnCode', () => {
  it('formats per-order code', () => {
    expect(nextReturnCode('1042', 1)).toBe('CR-1042-1');
    expect(nextReturnCode('1042', 3)).toBe('CR-1042-3');
  });
});

describe('validateReturnDraft', () => {
  const ok = { orderId: 'o1', lines: [{ shopifyLineId: 'l1', returnedQty: 2 }] };
  it('accepts valid input', () => {
    expect(validateReturnDraft(ok).ok).toBe(true);
  });
  it('rejects missing order', () => {
    expect(validateReturnDraft({ ...ok, orderId: '' }).ok).toBe(false);
  });
  it('rejects empty lines', () => {
    expect(validateReturnDraft({ ...ok, lines: [] }).ok).toBe(false);
  });
  it('rejects non-positive qty', () => {
    expect(validateReturnDraft({ ...ok, lines: [{ shopifyLineId: 'l1', returnedQty: 0 }] }).ok).toBe(false);
  });
  it('rejects duplicate line ids', () => {
    expect(validateReturnDraft({ orderId: 'o1', lines: [
      { shopifyLineId: 'l1', returnedQty: 1 },
      { shopifyLineId: 'l1', returnedQty: 1 },
    ] }).ok).toBe(false);
  });
});

describe('validateReturnQc', () => {
  it('accepts pass+fail equal to returned', () => {
    expect(validateReturnQc([{ returnedQty: 3, passQty: 2, failQty: 1 }]).ok).toBe(true);
  });
  it('accepts pass+fail below returned (uninspected remainder)', () => {
    expect(validateReturnQc([{ returnedQty: 3, passQty: 1, failQty: 0 }]).ok).toBe(true);
  });
  it('rejects pass+fail above returned', () => {
    expect(validateReturnQc([{ returnedQty: 2, passQty: 2, failQty: 1 }]).ok).toBe(false);
  });
  it('rejects negative quantities', () => {
    expect(validateReturnQc([{ returnedQty: 2, passQty: -1, failQty: 0 }]).ok).toBe(false);
  });
  it('rejects empty input', () => {
    expect(validateReturnQc([]).ok).toBe(false);
  });
});

describe('restockEffect', () => {
  it('restocks passQty when there is a sku', () => {
    expect(restockEffect({ sku: 'ABC', passQty: 2 })).toEqual({ onHandDelta: 2 });
  });
  it('does not restock without a sku', () => {
    expect(restockEffect({ sku: null, passQty: 2 })).toEqual({ onHandDelta: 0 });
  });
});

describe('refundReconcileFlag', () => {
  it('refunded when shopify has a refund', () => {
    expect(refundReconcileFlag({ totalPassQty: 2, shopifyRefundCount: 1 })).toBe('refunded');
  });
  it('awaiting_refund when goods passed but no refund', () => {
    expect(refundReconcileFlag({ totalPassQty: 2, shopifyRefundCount: 0 })).toBe('awaiting_refund');
  });
  it('none when nothing passed and no refund', () => {
    expect(refundReconcileFlag({ totalPassQty: 0, shopifyRefundCount: 0 })).toBe('none');
  });
});
