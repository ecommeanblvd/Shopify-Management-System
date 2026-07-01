import { describe, expect, it } from 'vitest';
import { deriveOrderStage, type StageSignals } from './order-stage';

const base: StageSignals = {
  pushedMmp: false, larkQc: null, larkDispatch: null, allInStock: false,
  ship: { packs: 0, withTracking: 0, delivered: 0, exception: 0, inTransit: 0, outForDelivery: 0 },
};
type PartialSignals = Partial<Omit<StageSignals, 'ship'>> & { ship?: Partial<StageSignals['ship']> };
const S = (p: PartialSignals): StageSignals => ({ ...base, ...p, ship: { ...base.ship, ...(p.ship ?? {}) } });

describe('deriveOrderStage — thứ tự vòng đời', () => {
  it('mặc định (chưa gì) → chờ đặt brand', () => {
    expect(deriveOrderStage(base).key).toBe('awaiting_brand_order');
  });
  it('allInStock, chưa push → lấy từ kho', () => {
    expect(deriveOrderStage(S({ allInStock: true })).key).toBe('pick_warehouse');
  });
  it('đã push MMP → đã báo brand', () => {
    expect(deriveOrderStage(S({ pushedMmp: true })).key).toBe('brand_notified');
  });
  it('KCS pending → brand gửi · chờ KCS (thắng brand_notified)', () => {
    expect(deriveOrderStage(S({ pushedMmp: true, larkQc: 'pending' })).key).toBe('kcs_pending');
    expect(deriveOrderStage(S({ larkQc: 'extra' })).key).toBe('kcs_pending');
  });
  it('KCS fail → kcs_failed', () => {
    expect(deriveOrderStage(S({ larkQc: 'fail' })).key).toBe('kcs_failed');
  });
  it('KCS pass → chờ đóng gói', () => {
    expect(deriveOrderStage(S({ larkQc: 'pass' })).key).toBe('ready_to_pack');
  });
  it('có kiện, chưa tracking → đã đóng gói (thắng KCS pass)', () => {
    expect(deriveOrderStage(S({ larkQc: 'pass', ship: { packs: 1 } })).key).toBe('packed');
  });
  it('có tracking / in-transit → đã ship', () => {
    expect(deriveOrderStage(S({ ship: { packs: 1, withTracking: 1 } })).key).toBe('shipped');
    expect(deriveOrderStage(S({ ship: { packs: 1, withTracking: 1, inTransit: 1 } })).key).toBe('shipped');
  });
  it('out for delivery → đang giao (thắng shipped)', () => {
    expect(deriveOrderStage(S({ ship: { packs: 1, withTracking: 1, inTransit: 1, outForDelivery: 1 } })).key).toBe('out_for_delivery');
    expect(deriveOrderStage(S({ larkDispatch: 'On Delivery' })).key).toBe('out_for_delivery');
  });
  it('mọi kiện delivered → hoàn tất (thắng tất cả)', () => {
    expect(deriveOrderStage(S({ ship: { packs: 2, withTracking: 2, delivered: 2 } })).key).toBe('delivered');
  });
  it('delivered 1/2 kiện → chưa hoàn tất (vẫn đang ship)', () => {
    expect(deriveOrderStage(S({ ship: { packs: 2, withTracking: 2, delivered: 1, inTransit: 1 } })).key).not.toBe('delivered');
  });
  it('exception → sự cố', () => {
    expect(deriveOrderStage(S({ ship: { packs: 1, withTracking: 1, exception: 1 } })).key).toBe('exception');
    expect(deriveOrderStage(S({ larkDispatch: 'Package Lost' })).key).toBe('exception');
  });
  it('fallback Lark: dispatch Delivery Completed → hoàn tất dù ship trống', () => {
    expect(deriveOrderStage(S({ larkDispatch: 'Delivery Completed' })).key).toBe('delivered');
  });
  it('mỗi stage có label + tone', () => {
    const st = deriveOrderStage(S({ larkQc: 'pass' }));
    expect(st.label.length).toBeGreaterThan(0);
    expect(['ok', 'info', 'warn', 'bad', 'muted']).toContain(st.tone);
  });
});
