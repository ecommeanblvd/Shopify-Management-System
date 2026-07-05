import { describe, it, expect } from 'vitest';
import { toPublicTimeline, defaultTimeline } from './public-timeline';

const base = {
  currentStage: 'shipped', syncedAt: '2026-03-20T00:00:00Z',
  placedAt: '2026-03-01T00:00:00Z', productionStartAt: null, goodsReceivedAt: null,
  qcPassAt: null, packedAt: '2026-03-10T00:00:00Z', shippedAt: '2026-03-12T00:00:00Z',
  inTransitAt: null, outForDeliveryAt: null, deliveredAt: null, completedAt: null,
};
describe('toPublicTimeline', () => {
  it('chỉ mốc đã đạt (label+ngày), stage hiện tại + kế; KHÔNG field nội bộ', () => {
    const r = toPublicTimeline(base);
    expect(r.currentStage).toBe('shipped');
    expect(r.currentStageLabel.length).toBeGreaterThan(0);
    expect(r.nextStageLabel).not.toBeNull();
    expect(r.steps.map((s) => s.label).length).toBe(3); // placed, packed, shipped
    expect(JSON.stringify(r)).not.toMatch(/delay|deadline|exception/i);
  });
  it('đơn mới chỉ có placed', () => {
    const r = toPublicTimeline({ ...base, currentStage: 'placed', packedAt: null, shippedAt: null });
    expect(r.steps).toHaveLength(1);
  });
});

describe('defaultTimeline', () => {
  it('đủ 6 step, chỉ Placed có at (từ placedAt truyền vào)', () => {
    const placedAt = new Date('2026-03-01T00:00:00Z');
    const r = defaultTimeline(placedAt);
    expect(r.currentStage).toBe('placed');
    expect(r.currentStageLabel).toBe('Placed');
    expect(r.steps).toHaveLength(6);
    expect(r.steps.map((s) => s.label)).toEqual([
      'Placed', 'In production', 'Quality check', 'Packed', 'Shipped', 'Delivered',
    ]);
    expect(r.steps[0].at).toBe(placedAt.toISOString());
    r.steps.slice(1).forEach((s) => expect(s.at).toBeNull());
  });

  it('placedAt null → step Placed cũng at null', () => {
    const r = defaultTimeline(null);
    expect(r.steps[0].at).toBeNull();
    expect(r.steps.every((s) => s.at === null)).toBe(true);
  });
});
