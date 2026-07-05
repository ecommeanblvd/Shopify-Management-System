import { describe, it, expect } from 'vitest';
import { stageChip, cancelCopy, requestStatusLabel, fmtMoney, buildStepper, fmtDate, type PolicyJson } from './journey-vm';

describe('stageChip', () => {
  it('placed → Order placed / neutral', () => {
    expect(stageChip('placed')).toEqual({ label: 'Order placed', tone: 'neutral' });
  });
  it('production → In production / info', () => {
    expect(stageChip('production')).toEqual({ label: 'In production', tone: 'info' });
  });
  it('qc → Quality check / info', () => {
    expect(stageChip('qc')).toEqual({ label: 'Quality check', tone: 'info' });
  });
  it('packed → Packed / info', () => {
    expect(stageChip('packed')).toEqual({ label: 'Packed', tone: 'info' });
  });
  it('shipped → Shipped / info', () => {
    expect(stageChip('shipped')).toEqual({ label: 'Shipped', tone: 'info' });
  });
  it('in_transit → Shipped / info', () => {
    expect(stageChip('in_transit')).toEqual({ label: 'Shipped', tone: 'info' });
  });
  it('out_for_delivery → Out for delivery / info', () => {
    expect(stageChip('out_for_delivery')).toEqual({ label: 'Out for delivery', tone: 'info' });
  });
  it('post_delivery → Delivered / success', () => {
    expect(stageChip('post_delivery')).toEqual({ label: 'Delivered', tone: 'success' });
  });
  it('completed → Delivered / success', () => {
    expect(stageChip('completed')).toEqual({ label: 'Delivered', tone: 'success' });
  });
  it('refunded_full → Refunded / neutral', () => {
    expect(stageChip('refunded_full')).toEqual({ label: 'Refunded', tone: 'neutral' });
  });
  it('cancelled → Cancelled / critical', () => {
    expect(stageChip('cancelled')).toEqual({ label: 'Cancelled', tone: 'critical' });
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

describe('buildStepper', () => {
  const steps = [
    { label: 'Placed', at: '2026-06-01T00:00:00Z' },
    { label: 'In production', at: '2026-06-02T00:00:00Z' },
    { label: 'Quality check', at: null },
    { label: 'Packed', at: null },
    { label: 'Shipped', at: null },
    { label: 'Delivered', at: null },
  ];

  it('giữa chừng: mốc đã đạt → done, currentStageLabel → current, còn lại upcoming', () => {
    const r = buildStepper({ currentStageLabel: 'In production', steps });
    expect(r).toEqual([
      { label: 'Placed', at: '2026-06-01T00:00:00Z', state: 'done' },
      { label: 'In production', at: '2026-06-02T00:00:00Z', state: 'current' },
      { label: 'Quality check', at: null, state: 'upcoming' },
      { label: 'Packed', at: null, state: 'upcoming' },
      { label: 'Shipped', at: null, state: 'upcoming' },
      { label: 'Delivered', at: null, state: 'upcoming' },
    ]);
  });

  it('chưa bắt đầu: chỉ Placed có at + là current, còn lại upcoming', () => {
    const r = buildStepper({
      currentStageLabel: 'Placed',
      steps: [
        { label: 'Placed', at: '2026-06-01T00:00:00Z' },
        { label: 'In production', at: null },
        { label: 'Quality check', at: null },
        { label: 'Packed', at: null },
        { label: 'Shipped', at: null },
        { label: 'Delivered', at: null },
      ],
    });
    expect(r[0].state).toBe('current');
    expect(r.slice(1).every((s) => s.state === 'upcoming')).toBe(true);
  });

  it('hoàn tất: mọi mốc trước Delivered đã đạt → done, Delivered = current', () => {
    const r = buildStepper({
      currentStageLabel: 'Delivered',
      steps: [
        { label: 'Placed', at: '2026-06-01T00:00:00Z' },
        { label: 'In production', at: '2026-06-02T00:00:00Z' },
        { label: 'Quality check', at: '2026-06-03T00:00:00Z' },
        { label: 'Packed', at: '2026-06-04T00:00:00Z' },
        { label: 'Shipped', at: '2026-06-05T00:00:00Z' },
        { label: 'Delivered', at: '2026-06-06T00:00:00Z' },
      ],
    });
    expect(r.slice(0, 5).every((s) => s.state === 'done')).toBe(true);
    expect(r[5].state).toBe('current');
  });

  it('timeline null → 6 label mặc định, tất cả upcoming (degrade an toàn)', () => {
    const r = buildStepper(null);
    expect(r).toHaveLength(6);
    expect(r.map((s) => s.label)).toEqual([
      'Placed', 'In production', 'Quality check', 'Packed', 'Shipped', 'Delivered',
    ]);
    expect(r.every((s) => s.state === 'upcoming')).toBe(true);
    expect(r.every((s) => s.at === null)).toBe(true);
  });
});

describe('fmtDate', () => {
  it('valid ISO string → "Mon D, YYYY"', () => {
    expect(fmtDate('2025-03-10T12:00:00Z')).toBe('Mar 10, 2025');
  });
  it('null → empty string', () => {
    expect(fmtDate(null)).toBe('');
  });
  it('garbage string → empty string', () => {
    expect(fmtDate('not-a-date')).toBe('');
  });
});
