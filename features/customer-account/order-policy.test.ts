import { describe, it, expect } from 'vitest';
import { evaluateOrderPolicy, money, CLAIM_WINDOW_DAYS } from './order-policy';

const base = {
  placedAt: new Date('2026-07-01T00:00:00Z'),
  productionConfirmedAt: null as Date | null,
  shippedAt: null as Date | null,
  deliveredAt: null as Date | null,
  cancelledAt: null as Date | null,
  orderTotal: '263.98',
  currency: 'USD',
  hasOpenRequest: false,
  now: new Date('2026-07-03T00:00:00Z'),
};

describe('money', () => {
  it('tính cents-safe', () => {
    expect(money('263.98', 0.6)).toBe('158.39'); // 26398*0.6=15838.8 → round 15839
    expect(money('263.98', 0.4)).toBe('105.59');
    expect(money('263.98', 1)).toBe('263.98');
    expect(money('0.10', 0.6)).toBe('0.06');
  });
});

describe('evaluateOrderPolicy — cancel', () => {
  it('chưa brand-confirm → free 100%', () => {
    const r = evaluateOrderPolicy(base);
    expect(r.canCancel).toBe('free');
    expect(r.refundPercent).toBe(100);
    expect(r.refundAmount).toBe('263.98');
    expect(r.feeAmount).toBe('0.00');
  });
  it('đã confirm, chưa ship → fee40, refund 60%', () => {
    const r = evaluateOrderPolicy({ ...base, productionConfirmedAt: new Date('2026-07-02T00:00:00Z') });
    expect(r.canCancel).toBe('fee40');
    expect(r.refundPercent).toBe(60);
    expect(r.refundAmount).toBe('158.39');
    expect(r.feeAmount).toBe('105.59');
  });
  it('đã ship → không cancel', () => {
    const r = evaluateOrderPolicy({ ...base, productionConfirmedAt: new Date('2026-07-02'), shippedAt: new Date('2026-07-02T12:00:00Z') });
    expect(r.canCancel).toBeNull();
  });
  it('đã cancelled hoặc có request mở → không cancel/claim', () => {
    expect(evaluateOrderPolicy({ ...base, cancelledAt: new Date() }).canCancel).toBeNull();
    const r = evaluateOrderPolicy({ ...base, hasOpenRequest: true });
    expect(r.canCancel).toBeNull();
    expect(r.canClaim).toBe(false);
  });
});

describe('evaluateOrderPolicy — claim', () => {
  const delivered = { ...base, productionConfirmedAt: new Date('2026-07-01'), shippedAt: new Date('2026-07-02'), deliveredAt: new Date('2026-07-03T00:00:00Z') };
  it('delivered trong 14 ngày → claim được, hết cancel', () => {
    const r = evaluateOrderPolicy({ ...delivered, now: new Date('2026-07-10T00:00:00Z') });
    expect(r.canClaim).toBe(true);
    expect(r.canCancel).toBeNull();
    expect(r.claimDeadline).toEqual(new Date('2026-07-17T00:00:00Z'));
  });
  it('đúng biên 14 ngày → còn claim; quá 1ms → hết', () => {
    const edge = new Date('2026-07-17T00:00:00Z');
    expect(evaluateOrderPolicy({ ...delivered, now: edge }).canClaim).toBe(true);
    expect(evaluateOrderPolicy({ ...delivered, now: new Date(edge.getTime() + 1) }).canClaim).toBe(false);
  });
  it('chưa delivered → không claim', () => {
    expect(evaluateOrderPolicy(base).canClaim).toBe(false);
  });
});
