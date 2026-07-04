import { describe, it, expect } from 'vitest';
import { deriveLifecycle, DEFAULT_SLA, type LifecycleSignals } from './derive';

const NOW = new Date('2026-07-03T10:00:00Z');
const H = 3600_000;
const d = (h: number) => new Date(NOW.getTime() - h * H);

/** Signals mặc định: đơn mới đặt, chưa có gì. */
function sig(over: Partial<LifecycleSignals> = {}): LifecycleSignals {
  return {
    placedAt: d(1), cancelledAt: null, financialStatus: 'paid',
    mmpSentAt: null, brandConfirmedAt: null, brandEta: null,
    brandRequestCount: 0, brandDeliveredCount: 0, brandDeliveredMaxAt: null,
    larkQc: null, larkDispatch: null,
    packedMinAt: null, labelMinAt: null, hasTracking: false,
    packs: 0, packsDelivered: 0, packsException: 0,
    anyInTransit: false, anyOutForDelivery: false, shipDeliveredMaxAt: null,
    refundFirstAt: null,
    ...over,
  };
}
const run = (s: LifecycleSignals, prev: Parameters<typeof deriveLifecycle>[1] = null) =>
  deriveLifecycle(s, prev, DEFAULT_SLA, NOW);

describe('stage machine — thứ tự ưu tiên', () => {
  it('đơn mới → placed, deadline = placedAt + placed_to_production', () => {
    const r = run(sig());
    expect(r.currentStage).toBe('placed');
    expect(r.deadline).toEqual(new Date(d(1).getTime() + 24 * H));
    expect(r.delayStatus).toBe('on_track');
  });
  it('đã push brand → production', () => {
    const r = run(sig({ mmpSentAt: d(5), brandRequestCount: 1 }));
    expect(r.currentStage).toBe('production');
    expect(r.productionStartAt).toEqual(d(5));
  });
  it('mọi brand request delivered → goodsReceivedAt = max, stage qc', () => {
    const r = run(sig({ mmpSentAt: d(50), brandRequestCount: 2, brandDeliveredCount: 2, brandDeliveredMaxAt: d(10) }));
    expect(r.currentStage).toBe('qc');
    expect(r.goodsReceivedAt).toEqual(d(10));
  });
  it('mới delivered 1/2 request → vẫn production (kiện chậm nhất)', () => {
    const r = run(sig({ mmpSentAt: d(50), brandRequestCount: 2, brandDeliveredCount: 1, brandDeliveredMaxAt: d(10) }));
    expect(r.currentStage).toBe('production');
    expect(r.goodsReceivedAt).toBeNull();
  });
  it('packed → stage packed (đơn đủ kho: bỏ qua production/qc)', () => {
    const r = run(sig({ packedMinAt: d(3) }));
    expect(r.currentStage).toBe('packed');
    expect(r.packedAt).toEqual(d(3));
  });
  it('có label → shipped', () => {
    const r = run(sig({ packedMinAt: d(5), labelMinAt: d(2), hasTracking: true, packs: 1 }));
    expect(r.currentStage).toBe('shipped');
    expect(r.shippedAt).toEqual(d(2));
  });
  it('anyInTransit → in_transit (stamp inTransitAt = now lần đầu)', () => {
    const r = run(sig({ packedMinAt: d(5), labelMinAt: d(2), hasTracking: true, packs: 1, anyInTransit: true }));
    expect(r.currentStage).toBe('in_transit');
    expect(r.inTransitAt).toEqual(NOW);
  });
  it('anyOutForDelivery → out_for_delivery', () => {
    const r = run(sig({ labelMinAt: d(2), hasTracking: true, packs: 1, anyInTransit: true, anyOutForDelivery: true }));
    expect(r.currentStage).toBe('out_for_delivery');
    expect(r.outForDeliveryAt).toEqual(NOW);
  });
  it('tất cả pack delivered → post_delivery, deliveredAt = max ship', () => {
    const r = run(sig({ labelMinAt: d(48), hasTracking: true, packs: 2, packsDelivered: 2, shipDeliveredMaxAt: d(5) }));
    expect(r.currentStage).toBe('post_delivery');
    expect(r.deliveredAt).toEqual(d(5));
  });
  it('delivered 1/2 pack → CHƯA post_delivery', () => {
    const r = run(sig({ labelMinAt: d(48), hasTracking: true, packs: 2, packsDelivered: 1, anyInTransit: true, shipDeliveredMaxAt: d(5) }));
    expect(r.currentStage).toBe('in_transit');
    expect(r.deliveredAt).toBeNull();
  });
  it('Lark Delivery Completed (không có ship data) → post_delivery, stamp deliveredAt = now', () => {
    const r = run(sig({ larkDispatch: 'Delivery Completed' }));
    expect(r.currentStage).toBe('post_delivery');
    expect(r.deliveredAt).toEqual(NOW);
  });
});

describe('terminal + cửa sổ 30 ngày', () => {
  it('delivered quá 30 ngày, không return → completed, completedAt = deliveredAt+30d', () => {
    const del = d(31 * 24);
    const r = run(sig({ packs: 1, packsDelivered: 1, hasTracking: true, shipDeliveredMaxAt: del }));
    expect(r.currentStage).toBe('completed');
    expect(r.completedAt).toEqual(new Date(del.getTime() + 30 * 24 * H));
  });
  it('quá 30 ngày nhưng đang Return-Processing → vẫn post_delivery', () => {
    const r = run(sig({ packs: 1, packsDelivered: 1, hasTracking: true, shipDeliveredMaxAt: d(31 * 24), larkDispatch: 'Return-Processing' }));
    expect(r.currentStage).toBe('post_delivery');
    expect(r.returnProcessingAt).toEqual(NOW);
  });
  it('financialStatus refunded → refunded_full (terminal, thắng mọi stage)', () => {
    const r = run(sig({ financialStatus: 'refunded', refundFirstAt: d(2), packs: 1, packsDelivered: 1, shipDeliveredMaxAt: d(5), hasTracking: true }));
    expect(r.currentStage).toBe('refunded_full');
    expect(r.refundedAt).toEqual(d(2));
  });
  it('cancelledAt → cancelled (thắng cả refunded)', () => {
    const r = run(sig({ cancelledAt: d(1), financialStatus: 'refunded' }));
    expect(r.currentStage).toBe('cancelled');
    expect(r.cancelledAt).toEqual(d(1));
  });
});

describe('exception flag', () => {
  it('pack exception → exception=true, stage giữ nguyên', () => {
    const r = run(sig({ labelMinAt: d(2), hasTracking: true, packs: 1, packsException: 1, anyInTransit: true }));
    expect(r.currentStage).toBe('in_transit');
    expect(r.exception).toBe(true);
  });
  it('Return-Processing TRƯỚC delivered → exception', () => {
    const r = run(sig({ labelMinAt: d(2), hasTracking: true, packs: 1, anyInTransit: true, larkDispatch: 'Return-Processing' }));
    expect(r.exception).toBe(true);
  });
  it('Return-Processing SAU delivered → KHÔNG exception (là post_delivery sub-state)', () => {
    const r = run(sig({ packs: 1, packsDelivered: 1, hasTracking: true, shipDeliveredMaxAt: d(5), larkDispatch: 'Return-Processing' }));
    expect(r.exception).toBe(false);
    expect(r.currentStage).toBe('post_delivery');
  });
  it('hết exception → cờ tự hạ', () => {
    const r = run(sig({ labelMinAt: d(2), hasTracking: true, packs: 1, anyInTransit: true }),
      { qcPassAt: null, inTransitAt: d(3), outForDeliveryAt: null, returnProcessingAt: null, shippedAt: d(2), deliveredAt: null, completedAt: null });
    expect(r.exception).toBe(false);
  });
});

describe('first-seen stamps — không ghi đè', () => {
  it('inTransitAt giữ giá trị prev (không stamp lại now)', () => {
    const prev = { qcPassAt: null, inTransitAt: d(20), outForDeliveryAt: null, returnProcessingAt: null, shippedAt: d(22), deliveredAt: null, completedAt: null };
    const r = run(sig({ labelMinAt: d(22), hasTracking: true, packs: 1, anyInTransit: true }), prev);
    expect(r.inTransitAt).toEqual(d(20));
  });
  it('qcPassAt stamp lần đầu khi larkQc=pass, giữ ở lần sau', () => {
    const first = run(sig({ mmpSentAt: d(50), brandRequestCount: 1, brandDeliveredCount: 1, brandDeliveredMaxAt: d(30), larkQc: 'pass' }));
    expect(first.qcPassAt).toEqual(NOW);
    const again = run(sig({ mmpSentAt: d(50), brandRequestCount: 1, brandDeliveredCount: 1, brandDeliveredMaxAt: d(30), larkQc: 'pass' }),
      { ...first, completedAt: null });
    expect(again.qcPassAt).toEqual(NOW);
  });
});

describe('deadline + delay', () => {
  it('production dùng ETA brand khi có (deadline = cuối ngày ETA UTC)', () => {
    const r = run(sig({ mmpSentAt: d(5), brandRequestCount: 1, brandEta: '2026-07-10' }));
    expect(r.deadline).toEqual(new Date('2026-07-10T23:59:59.000Z'));
  });
  it('production không ETA → mmpSentAt + 240h', () => {
    const r = run(sig({ mmpSentAt: d(5), brandRequestCount: 1 }));
    expect(r.deadline).toEqual(new Date(d(5).getTime() + 240 * H));
  });
  it('overdue: quá deadline → delayHours = số giờ trễ (ceil)', () => {
    const r = run(sig({ placedAt: d(30) })); // deadline = placed+24h → trễ 6h
    expect(r.delayStatus).toBe('overdue');
    expect(r.delayHours).toBe(6);
  });
  it('due_soon: đã dùng ≥80% thời gian', () => {
    const r = run(sig({ placedAt: d(20) })); // 20/24 ≈ 83%
    expect(r.delayStatus).toBe('due_soon');
    expect(r.delayHours).toBe(0);
  });
  it('on_track khi <80%', () => {
    expect(run(sig({ placedAt: d(10) })).delayStatus).toBe('on_track');
  });
  it('qc: chưa pass → deadline goodsReceived+48h; đã pass → qcPassAt+pack 48h', () => {
    const base = sig({ mmpSentAt: d(90), brandRequestCount: 1, brandDeliveredCount: 1, brandDeliveredMaxAt: d(10) });
    expect(run(base).deadline).toEqual(new Date(d(10).getTime() + 48 * H));
    const passed = run({ ...base, larkQc: 'pass' });
    expect(passed.deadline).toEqual(new Date(NOW.getTime() + 48 * H)); // qcPassAt=NOW + pack
  });
  it('shipped/in_transit/OFD chung deadline shippedAt + 168h', () => {
    const r = run(sig({ labelMinAt: d(2), hasTracking: true, packs: 1, anyInTransit: true }));
    expect(r.deadline).toEqual(new Date(d(2).getTime() + 168 * H));
  });
  it('post_delivery/terminal → không deadline, on_track', () => {
    const r = run(sig({ packs: 1, packsDelivered: 1, hasTracking: true, shipDeliveredMaxAt: d(5) }));
    expect(r.deadline).toBeNull();
    expect(r.delayStatus).toBe('on_track');
  });
});

describe('stale — đơn cũ ship chưa có tín hiệu giao', () => {
  it('shipped > 30 ngày, chưa delivered → stale, delayHours = giờ kể từ shipped', () => {
    const r = run(sig({ labelMinAt: d(24 * 40), hasTracking: true })); // gửi 40 ngày trước
    expect(r.currentStage).toBe('shipped');
    expect(r.delayStatus).toBe('stale');
    expect(r.delayHours).toBe(24 * 40);
  });
  it('shipped 5 ngày → KHÔNG stale (overdue theo deliver SLA vẫn tính bình thường)', () => {
    const r = run(sig({ labelMinAt: d(24 * 5), hasTracking: true }));
    expect(r.currentStage).toBe('shipped');
    expect(r.delayStatus).not.toBe('stale');
  });
  it('out_for_delivery > 30 ngày chưa delivered → stale', () => {
    const r = run(sig({ labelMinAt: d(24 * 40), hasTracking: true, anyOutForDelivery: true }));
    expect(r.currentStage).toBe('out_for_delivery');
    expect(r.delayStatus).toBe('stale');
  });
  it('đã delivered → KHÔNG stale', () => {
    // shipDeliveredMaxAt = 28 ngày trước (< 30d window → post_delivery, chưa completed)
    const r = run(sig({ labelMinAt: d(24 * 40), packs: 1, packsDelivered: 1, shipDeliveredMaxAt: d(24 * 28) }));
    expect(r.currentStage).toBe('post_delivery');
    expect(r.delayStatus).not.toBe('stale');
  });
});
