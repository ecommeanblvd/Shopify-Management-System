import { describe, it, expect } from 'vitest';
import { segmentTimings, stageEstimateHrs, STAGE_SEGMENT } from './stage-timing';
import type { SlaKey } from './stats-logic';

const SLA: Record<SlaKey, number> = {
  placed_to_production: 24, production: 240, qc: 48, pack: 48, ship: 24, deliver: 168,
};
const H = 3600_000;
const base = new Date('2026-01-01T00:00:00Z').getTime();
const at = (h: number) => new Date(base + h * H);

describe('segmentTimings', () => {
  it('đủ mốc → actual + verdict đúng/trễ theo SLA', () => {
    const rows = segmentTimings({
      placedAt: at(0), productionStartAt: at(10), goodsReceivedAt: at(300),
      qcPassAt: at(310), packedAt: at(320), shippedAt: at(330), deliveredAt: at(400),
    }, SLA);
    const by = Object.fromEntries(rows.map((r) => [r.segment, r]));
    expect(by.placed_to_production.actualHrs).toBe(10);
    expect(by.placed_to_production.verdict).toBe('đúng'); // 10 <= 24
    expect(by.production.actualHrs).toBe(290);
    expect(by.production.verdict).toBe('trễ');            // 290 > 240
  });
  it('thiếu mốc → actual null + verdict null', () => {
    const rows = segmentTimings({
      placedAt: at(0), productionStartAt: null, goodsReceivedAt: null,
      qcPassAt: null, packedAt: null, shippedAt: null, deliveredAt: null,
    }, SLA);
    const by = Object.fromEntries(rows.map((r) => [r.segment, r]));
    expect(by.production.actualHrs).toBeNull();
    expect(by.production.verdict).toBeNull();
    expect(by.production.estimateHrs).toBe(240);
  });
});

describe('stageEstimateHrs', () => {
  it('map stage → SLA đoạn tương ứng', () => {
    expect(stageEstimateHrs('qc', SLA)).toBe(48);
    expect(stageEstimateHrs('shipped', SLA)).toBe(24);
    expect(stageEstimateHrs('completed', SLA)).toBeNull();
  });
  it('STAGE_SEGMENT có mọi stage', () => {
    expect(STAGE_SEGMENT.placed).toBe('placed_to_production');
    expect(STAGE_SEGMENT.completed).toBeNull();
  });
});
