import { describe, it, expect } from 'vitest';
import {
  delayTone, fmtDuration, hoursBetween, stageAnchorAt, buildTimeline, STAGE_LABELS,
  nextStage, stageProgress, statusLabel,
} from './display';

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
    }, null);
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

describe('nextStage', () => {
  it('trả stage kế tiếp trong chuỗi chính', () => {
    expect(nextStage('shipped')).toBe('in_transit');
    expect(nextStage('placed')).toBe('production');
  });
  it('completed/terminal → null', () => {
    expect(nextStage('completed')).toBeNull();
    expect(nextStage('cancelled')).toBeNull();
  });
});

describe('stageProgress', () => {
  it('index theo chuỗi chính', () => {
    expect(stageProgress('placed').index).toBe(0);
    expect(stageProgress('shipped').index).toBe(4);
    expect(stageProgress('placed').total).toBe(9);
  });
});

describe('delayTone + statusLabel — stale', () => {
  it('stale → tone stale', () => { expect(delayTone('stale')).toBe('stale'); });
  it('statusLabel stale/overdue/due_soon/on_track', () => {
    expect(statusLabel('stale', 960).text).toBe('Nghi mất tín hiệu');
    expect(statusLabel('stale', 960).tone).toBe('stale');
    expect(statusLabel('overdue', 50).text).toBe('Trễ 2d 2h');
    expect(statusLabel('due_soon', 0).text).toBe('Sắp hạn');
    expect(statusLabel('on_track', 0).text).toBe('Đúng hạn');
  });
});

describe('buildTimeline — sắp theo thời gian thật + approx', () => {
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  const H = 3600_000;
  const at = (h: number) => new Date(base + h * H);
  it('sắp tăng dần theo thời gian, đánh dấu out-of-order + first-seen, ẩn duration bất thường', () => {
    // shipped (spine) sớm; packed/production muộn hơn shipped → out_of_order; qc ≈ syncedAt
    const synced = at(1000);
    const steps = buildTimeline({
      placedAt: at(0), productionStartAt: at(700), goodsReceivedAt: null,
      qcPassAt: at(999), packedAt: at(400), shippedAt: at(100),
      inTransitAt: null, outForDeliveryAt: null, deliveredAt: null, completedAt: null,
    }, synced);
    // thứ tự thời gian: placed(0) < shipped(100) < packed(400) < production(700) < qc(999)
    expect(steps.map((s) => s.key)).toEqual([
      'placedAt', 'shippedAt', 'packedAt', 'productionStartAt', 'qcPassAt',
    ]);
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey.shippedAt.approx).toBe(false);
    expect(byKey.packedAt.approx).toBe(true);
    expect(byKey.packedAt.approxReason).toBe('out_of_order');
    expect(byKey.qcPassAt.approx).toBe(true);
    expect(byKey.qcPassAt.approxReason).toBe('first_seen');
    // duration chỉ tính giữa 2 mốc không-approx liền kề
    expect(byKey.packedAt.durationHrs).toBeNull();
  });
});
