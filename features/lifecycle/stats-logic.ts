/** THUẦN: tổng hợp thống kê vòng đời. Không I/O. */
import { hoursBetween } from './display';

export type SlaKey =
  | 'placed_to_production' | 'production' | 'qc' | 'pack' | 'ship' | 'deliver';

export const SLA_SEGMENTS: SlaKey[] = [
  'placed_to_production', 'production', 'qc', 'pack', 'ship', 'deliver',
];

export interface DurationMilestones {
  placedAt: Date | string | null;
  productionStartAt: Date | string | null;
  goodsReceivedAt: Date | string | null;
  qcPassAt: Date | string | null;
  packedAt: Date | string | null;
  shippedAt: Date | string | null;
  deliveredAt: Date | string | null;
}

/** Duration (giờ) mỗi đoạn; null nếu thiếu mốc. */
export function computeDurations(m: DurationMilestones): Record<SlaKey, number | null> {
  const packAnchor = m.qcPassAt ?? m.goodsReceivedAt ?? m.placedAt;
  return {
    placed_to_production: hoursBetween(m.placedAt, m.productionStartAt),
    production: hoursBetween(m.productionStartAt, m.goodsReceivedAt),
    qc: hoursBetween(m.goodsReceivedAt, m.qcPassAt),
    pack: hoursBetween(packAnchor, m.packedAt),
    ship: hoursBetween(m.packedAt, m.shippedAt),
    deliver: hoursBetween(m.shippedAt, m.deliveredAt),
  };
}

export interface DurationRow {
  orderId: string;
  storeId: string;
  storeName: string | null;
  placedMonth: string | null;
  brands: string[];
  carriers: string[];
  stale: boolean;
  dur: Record<SlaKey, number | null>;
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type GroupBy = 'none' | 'brand' | 'carrier' | 'month';

export interface StageStat {
  avgHrs: number | null;
  medianHrs: number | null;
  overdueRate: number;
  n: number;
}

export interface StatGroup {
  key: string;
  orders: number;
  perStage: Record<SlaKey, StageStat>;
}

function groupKeys(row: DurationRow, by: GroupBy): string[] {
  switch (by) {
    case 'none': return ['Tất cả'];
    case 'month': return [row.placedMonth ?? '(không rõ)'];
    case 'brand': return row.brands.length ? row.brands : ['(không brand)'];
    case 'carrier': return row.carriers.length ? row.carriers : ['(không carrier)'];
  }
}

export function aggregateLifecycle(
  rows: DurationRow[], sla: Record<SlaKey, number>, groupBy: GroupBy,
): StatGroup[] {
  // key -> { orders, seg -> number[] }
  const acc = new Map<string, { orders: number; segs: Record<SlaKey, number[]> }>();
  for (const r of rows) {
    for (const k of groupKeys(r, groupBy)) {
      let g = acc.get(k);
      if (!g) {
        g = { orders: 0, segs: emptySegs() };
        acc.set(k, g);
      }
      g.orders += 1;
      for (const seg of SLA_SEGMENTS) {
        if (seg === 'deliver' && r.stale) continue;
        const v = r.dur[seg];
        if (v != null) g.segs[seg].push(v);
      }
    }
  }

  const groups: StatGroup[] = [];
  for (const [key, g] of acc) {
    const perStage = {} as Record<SlaKey, StageStat>;
    for (const seg of SLA_SEGMENTS) {
      const xs = g.segs[seg];
      const n = xs.length;
      const avgHrs = n ? xs.reduce((a, b) => a + b, 0) / n : null;
      const overdue = xs.filter((v) => v > sla[seg]).length;
      perStage[seg] = {
        avgHrs, medianHrs: median(xs), overdueRate: n ? overdue / n : 0, n,
      };
    }
    groups.push({ key, orders: g.orders, perStage });
  }

  groups.sort((a, b) =>
    groupBy === 'month' || groupBy === 'none'
      ? a.key.localeCompare(b.key)
      : b.orders - a.orders || a.key.localeCompare(b.key),
  );
  return groups;
}

function emptySegs(): Record<SlaKey, number[]> {
  return {
    placed_to_production: [], production: [], qc: [], pack: [], ship: [], deliver: [],
  };
}
