// features/lifecycle/stats-logic.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeDurations, median, aggregateLifecycle, SLA_SEGMENTS,
  type DurationRow, type SlaKey,
} from './stats-logic';

const SLA: Record<SlaKey, number> = {
  placed_to_production: 24, production: 240, qc: 48, pack: 48, ship: 24, deliver: 168,
};
const H = 3600_000;
const base = new Date('2026-01-01T00:00:00Z').getTime();
const at = (h: number) => new Date(base + h * H);

function row(over: Partial<DurationRow>): DurationRow {
  return {
    orderId: 'o', storeId: 's', storeName: 'S', placedMonth: '2026-01',
    brands: [], carriers: [], dur: {} as Record<SlaKey, number>, ...over,
  };
}

describe('computeDurations', () => {
  it('tính đủ 6 đoạn khi có mốc', () => {
    const d = computeDurations({
      placedAt: at(0), productionStartAt: at(10), goodsReceivedAt: at(100),
      qcPassAt: at(110), packedAt: at(120), shippedAt: at(130), deliveredAt: at(300),
    });
    expect(d.placed_to_production).toBe(10);
    expect(d.production).toBe(90);
    expect(d.qc).toBe(10);
    expect(d.pack).toBe(10); // qcPassAt(110)->packedAt(120)
    expect(d.ship).toBe(10);
    expect(d.deliver).toBe(170);
  });

  it('thiếu mốc → đoạn đó null', () => {
    const d = computeDurations({
      placedAt: at(0), productionStartAt: null, goodsReceivedAt: null,
      qcPassAt: null, packedAt: at(50), shippedAt: null, deliveredAt: null,
    });
    expect(d.placed_to_production).toBeNull();
    expect(d.production).toBeNull();
    expect(d.qc).toBeNull();
    expect(d.pack).toBe(50); // fallback neo = placedAt(0) -> packedAt(50)
    expect(d.ship).toBeNull();
    expect(d.deliver).toBeNull();
  });

  it('pack neo fallback goodsReceivedAt khi không có qc', () => {
    const d = computeDurations({
      placedAt: at(0), productionStartAt: at(5), goodsReceivedAt: at(20),
      qcPassAt: null, packedAt: at(30), shippedAt: null, deliveredAt: null,
    });
    expect(d.pack).toBe(10); // goodsReceivedAt(20)->packedAt(30)
  });
});

describe('median', () => {
  it('rỗng → null', () => { expect(median([])).toBeNull(); });
  it('lẻ → phần tử giữa', () => { expect(median([3, 1, 2])).toBe(2); });
  it('chẵn → trung bình 2 giữa', () => { expect(median([1, 2, 3, 4])).toBe(2.5); });
});

describe('aggregateLifecycle', () => {
  it('groupBy none: avg/median/overdue/n theo đoạn, bỏ đoạn null', () => {
    const rows = [
      row({ dur: { ...z(), production: 100 } }),
      row({ dur: { ...z(), production: 300 } }), // overdue (>240)
      row({ dur: { ...z(), production: null } }), // không tính
    ];
    const [g] = aggregateLifecycle(rows, SLA, 'none');
    expect(g.key).toBe('Tất cả');
    expect(g.perStage.production.n).toBe(2);
    expect(g.perStage.production.avgHrs).toBe(200);
    expect(g.perStage.production.medianHrs).toBe(200);
    expect(g.perStage.production.overdueRate).toBe(0.5);
    expect(g.perStage.qc.n).toBe(0);
    expect(g.perStage.qc.avgHrs).toBeNull();
    expect(g.perStage.qc.overdueRate).toBe(0);
  });

  it('groupBy brand explode: 1 đơn 2 brand tính cả 2', () => {
    const rows = [row({ brands: ['A', 'B'], dur: { ...z(), qc: 60 } })];
    const gs = aggregateLifecycle(rows, SLA, 'brand');
    expect(gs.map((g) => g.key).sort()).toEqual(['A', 'B']);
    expect(gs.find((g) => g.key === 'A')!.perStage.qc.n).toBe(1);
    expect(gs.find((g) => g.key === 'B')!.perStage.qc.overdueRate).toBe(1); // 60>48
  });

  it('groupBy brand: đơn không brand → nhóm "(không brand)"', () => {
    const gs = aggregateLifecycle([row({ brands: [] })], SLA, 'brand');
    expect(gs[0].key).toBe('(không brand)');
  });

  it('groupBy month: gom theo placedMonth, sắp tăng dần', () => {
    const rows = [
      row({ placedMonth: '2026-02', dur: { ...z(), ship: 10 } }),
      row({ placedMonth: '2026-01', dur: { ...z(), ship: 10 } }),
    ];
    const gs = aggregateLifecycle(rows, SLA, 'month');
    expect(gs.map((g) => g.key)).toEqual(['2026-01', '2026-02']);
  });

  it('brand/carrier sắp theo số đơn giảm dần', () => {
    const rows = [
      row({ brands: ['A'] }), row({ brands: ['A'] }), row({ brands: ['B'] }),
    ];
    const gs = aggregateLifecycle(rows, SLA, 'brand');
    expect(gs.map((g) => g.key)).toEqual(['A', 'B']); // A có 2 đơn
    expect(gs[0].orders).toBe(2);
  });
});

// helper: mọi đoạn null
function z(): Record<SlaKey, number | null> {
  return { placed_to_production: null, production: null, qc: null, pack: null, ship: null, deliver: null };
}
