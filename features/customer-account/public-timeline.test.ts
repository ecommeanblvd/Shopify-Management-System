import { describe, it, expect } from 'vitest';
import { toPublicTimeline } from './public-timeline';

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
