import { describe, it, expect } from 'vitest';
import { stageChip, cancelCopy, requestStatusLabel, fmtMoney, type PolicyJson } from './journey-vm';

describe('stageChip', () => {
  it('placed → In production / info', () => {
    expect(stageChip('placed')).toEqual({ label: 'In production', tone: 'info' });
  });
  it('production → In production / info', () => {
    expect(stageChip('production')).toEqual({ label: 'In production', tone: 'info' });
  });
  it('qc → Quality check / info', () => {
    expect(stageChip('qc')).toEqual({ label: 'Quality check', tone: 'info' });
  });
  it('pack → Packed / info', () => {
    expect(stageChip('pack')).toEqual({ label: 'Packed', tone: 'info' });
  });
  it('ship → Shipped / info', () => {
    expect(stageChip('ship')).toEqual({ label: 'Shipped', tone: 'info' });
  });
  it('deliver → Delivered / success', () => {
    expect(stageChip('deliver')).toEqual({ label: 'Delivered', tone: 'success' });
  });
  it('completed → Delivered / success', () => {
    expect(stageChip('completed')).toEqual({ label: 'Delivered', tone: 'success' });
  });
  it('cancelled → Cancelled / critical', () => {
    expect(stageChip('cancelled')).toEqual({ label: 'Cancelled', tone: 'critical' });
  });
  it('refunded → Refunded / critical', () => {
    expect(stageChip('refunded')).toEqual({ label: 'Refunded', tone: 'critical' });
  });
  it('null → Processing / neutral', () => {
    expect(stageChip(null)).toEqual({ label: 'Processing', tone: 'neutral' });
  });
  it('unknown stage → Processing / neutral', () => {
    expect(stageChip('mystery')).toEqual({ label: 'Processing', tone: 'neutral' });
  });
});

describe('cancelCopy', () => {
  const policy = (over: Partial<PolicyJson> = {}): PolicyJson => ({
    canCancel: null,
    canClaim: false,
    claimDeadline: null,
    refundPercent: 100,
    refundAmount: '263.98',
    feeAmount: '0',
    ...over,
  });

  it('free → full refund message with refundAmount', () => {
    expect(cancelCopy(policy({ canCancel: 'free', refundAmount: '263.98' }))).toBe(
      'Free cancellation — full refund ($263.98)',
    );
  });

  it('fee40 → fee + refund message using feeAmount/refundAmount sample', () => {
    expect(
      cancelCopy(policy({ canCancel: 'fee40', refundAmount: '158.39', feeAmount: '105.59' })),
    ).toBe('Production has started. Cancellation fee 40% ($105.59). You will be refunded $158.39 (60%).');
  });

  it('null → null', () => {
    expect(cancelCopy(policy({ canCancel: null }))).toBeNull();
  });
});

describe('requestStatusLabel', () => {
  const cases: Array<[string, string, string]> = [
    ['claim', 'submitted', 'Claim submitted — awaiting review'],
    ['claim', 'under_review', 'Claim under review'],
    ['claim', 'approved', 'Claim approved — please ship the item back'],
    ['claim', 'rejected', 'Claim rejected'],
    ['claim', 'return_in_transit', 'Return shipment in transit'],
    ['claim', 'received', 'Return received — quality check in progress'],
    ['claim', 'refund_pending', 'Refund processing'],
    ['claim', 'refunded', 'Refunded'],
    ['cancel', 'refund_pending', 'Cancellation approved — refund processing'],
    ['cancel', 'refunded', 'Cancelled & refunded'],
  ];

  it.each(cases)('kind=%s status=%s → %s', (kind, status, expected) => {
    expect(requestStatusLabel(kind, status)).toBe(expected);
  });

  it('unknown kind/status → generic fallback', () => {
    expect(requestStatusLabel('cancel', 'mystery')).toBe('cancel mystery');
    expect(requestStatusLabel('mystery', 'submitted')).toBe('mystery submitted');
  });
});

describe('fmtMoney', () => {
  it('USD → $ prefix, 2 decimals', () => {
    expect(fmtMoney('263.98', 'USD')).toBe('$263.98');
  });
  it('non-USD currency → fallback "amount currency"', () => {
    expect(fmtMoney('100', 'VND')).toBe('100 VND');
  });
});
