import { describe, it, expect } from 'vitest';
import { delayTone, fmtDuration, hoursBetween, stageAnchorAt, buildTimeline, STAGE_LABELS } from './display';

describe('delayTone', () => {
  it('map trạng thái → tone', () => {
    expect(delayTone('overdue')).toBe('bad');
    expect(delayTone('due_soon')).toBe('warn');
    expect(delayTone('on_track')).toBe('ok');
  });
});

describe('fmtDuration', () => {
  it('null → —; <1h; giờ; ngày+giờ', () => {
    expect(fmtDuration(null)).toBe('—');
    expect(fmtDuration(0.5)).toBe('<1h');
    expect(fmtDuration(5)).toBe('5h');
    expect(fmtDuration(50)).toBe('2d 2h');
  });
});

describe('hoursBetween', () => {
  it('giờ giữa 2 mốc; thiếu → null; âm → 0', () => {
    expect(hoursBetween('2026-07-01T00:00:00Z', '2026-07-01T05:00:00Z')).toBe(5);
    expect(hoursBetween(null, '2026-07-01T05:00:00Z')).toBeNull();
    expect(hoursBetween('2026-07-01T05:00:00Z', '2026-07-01T00:00:00Z')).toBe(0);
  });
});

describe('stageAnchorAt', () => {
  const m = { placedAt: 'p', productionStartAt: 'ps', goodsReceivedAt: 'gr', qcPassAt: 'qc', packedAt: 'pk', shippedAt: 'sh', inTransitAt: 'it', outForDeliveryAt: 'ofd', deliveredAt: 'del', completedAt: 'cp' } as never;
  it('trả mốc vào stage hiện tại', () => {
    expect(stageAnchorAt('placed', m)).toBe('p');
    expect(stageAnchorAt('in_transit', m)).toBe('it');
    expect(stageAnchorAt('post_delivery', m)).toBe('del');
  });
  it('qc: ưu tiên qcPassAt, fallback goodsReceivedAt', () => {
    expect(stageAnchorAt('qc', { qcPassAt: 'qc', goodsReceivedAt: 'gr' } as never)).toBe('qc');
    expect(stageAnchorAt('qc', { qcPassAt: null, goodsReceivedAt: 'gr' } as never)).toBe('gr');
  });
  it('terminal/unknown → null', () => {
    expect(stageAnchorAt('cancelled', m)).toBeNull();
  });
});

describe('buildTimeline', () => {
  it('chỉ mốc đã đạt + duration từ mốc trước', () => {
    const steps = buildTimeline({
      placedAt: '2026-07-01T00:00:00Z', productionStartAt: null, goodsReceivedAt: null,
      qcPassAt: null, packedAt: '2026-07-01T10:00:00Z', shippedAt: '2026-07-02T10:00:00Z',
      inTransitAt: null, outForDeliveryAt: null, deliveredAt: null, completedAt: null,
    });
    expect(steps.map((s) => s.label)).toEqual(['Đặt hàng', 'Đóng gói', 'Bàn giao carrier']);
    expect(steps[0].durationHrs).toBeNull();
    expect(steps[1].durationHrs).toBe(10);
    expect(steps[2].durationHrs).toBe(24);
  });
});

describe('STAGE_LABELS', () => {
  it('có nhãn cho mọi stage chính', () => {
    expect((STAGE_LABELS as Record<string, string>).delivered ?? STAGE_LABELS.post_delivery).toBeTruthy();
    expect(STAGE_LABELS.completed).toBeTruthy();
  });
});
