/** THUẦN: nhãn/tone/định dạng + timeline cho UI vòng đời. Không I/O. */
import type { StageKey } from './derive';

export const STAGE_LABELS: Record<StageKey, string> = {
  placed: 'Đã đặt',
  production: 'Sản xuất',
  qc: 'QC',
  packed: 'Đóng gói',
  shipped: 'Đã gửi',
  in_transit: 'Vận chuyển',
  out_for_delivery: 'Đang giao',
  post_delivery: 'Sau giao (30 ngày)',
  completed: 'Hoàn tất',
  refunded_full: 'Hoàn tiền',
  cancelled: 'Đã huỷ',
};

export const STAGE_ORDER: StageKey[] = [
  'placed', 'production', 'qc', 'packed', 'shipped', 'in_transit',
  'out_for_delivery', 'post_delivery', 'completed', 'refunded_full', 'cancelled',
];

/** Chuỗi chính (bỏ terminal refunded/cancelled) để đo tiến độ + stage kế tiếp. */
export const MAIN_CHAIN: StageKey[] = [
  'placed', 'production', 'qc', 'packed', 'shipped',
  'in_transit', 'out_for_delivery', 'post_delivery', 'completed',
];

export function nextStage(stage: StageKey): StageKey | null {
  const i = MAIN_CHAIN.indexOf(stage);
  if (i < 0 || i >= MAIN_CHAIN.length - 1) return null;
  return MAIN_CHAIN[i + 1];
}

export function stageProgress(stage: StageKey): { index: number; total: number } {
  const total = MAIN_CHAIN.length;
  const i = MAIN_CHAIN.indexOf(stage);
  return { index: i < 0 ? total : i, total };
}

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'stale';
export function delayTone(delayStatus: string): Tone {
  return delayStatus === 'stale' ? 'stale'
    : delayStatus === 'overdue' ? 'bad'
    : delayStatus === 'due_soon' ? 'warn' : 'ok';
}

export function statusLabel(
  delayStatus: string, delayHours: number,
): { text: string; tone: Tone } {
  switch (delayStatus) {
    case 'stale': return { text: 'Nghi mất tín hiệu', tone: 'stale' };
    case 'overdue': return { text: `Trễ ${fmtDuration(delayHours)}`, tone: 'bad' };
    case 'due_soon': return { text: 'Sắp hạn', tone: 'warn' };
    default: return { text: 'Đúng hạn', tone: 'ok' };
  }
}

export function fmtDuration(hours: number | null): string {
  if (hours == null) return '—';
  if (hours < 1) return '<1h';
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

const asMs = (v: Date | string | null): number | null =>
  v == null ? null : (v instanceof Date ? v : new Date(v)).getTime();

export function hoursBetween(a: Date | string | null, b: Date | string | null): number | null {
  const ta = asMs(a); const tb = asMs(b);
  if (ta == null || tb == null) return null;
  return Math.max(0, (tb - ta) / 3600_000);
}

export interface Milestones {
  placedAt: Date | string | null;
  productionStartAt: Date | string | null;
  goodsReceivedAt: Date | string | null;
  qcPassAt: Date | string | null;
  packedAt: Date | string | null;
  shippedAt: Date | string | null;
  inTransitAt: Date | string | null;
  outForDeliveryAt: Date | string | null;
  deliveredAt: Date | string | null;
  completedAt: Date | string | null;
}

/** Mốc thời điểm vào stage hiện tại (để đo "đã ở stage bao lâu"). */
export function stageAnchorAt(stage: string, m: Partial<Milestones>): Date | string | null {
  switch (stage) {
    case 'placed': return m.placedAt ?? null;
    case 'production': return m.productionStartAt ?? null;
    case 'qc': return m.qcPassAt ?? m.goodsReceivedAt ?? null;
    case 'packed': return m.packedAt ?? null;
    case 'shipped': return m.shippedAt ?? null;
    case 'in_transit': return m.inTransitAt ?? null;
    case 'out_for_delivery': return m.outForDeliveryAt ?? null;
    case 'post_delivery': return m.deliveredAt ?? null;
    case 'completed': return m.completedAt ?? null;
    default: return null;
  }
}

export interface TimelineStep {
  key: string;
  label: string;
  at: Date | string | null;
  durationHrs: number | null;
  approx: boolean;
  approxReason: 'first_seen' | 'out_of_order' | null;
}

const TIMELINE_ORDER: Array<{ key: keyof Milestones; label: string }> = [
  { key: 'placedAt', label: 'Đặt hàng' },
  { key: 'productionStartAt', label: 'Gửi brand sản xuất' },
  { key: 'goodsReceivedAt', label: 'Hàng về kho' },
  { key: 'qcPassAt', label: 'QC pass' },
  { key: 'packedAt', label: 'Đóng gói' },
  { key: 'shippedAt', label: 'Bàn giao carrier' },
  { key: 'inTransitAt', label: 'Bắt đầu vận chuyển' },
  { key: 'outForDeliveryAt', label: 'Đang giao' },
  { key: 'deliveredAt', label: 'Đã giao' },
  { key: 'completedAt', label: 'Hoàn tất' },
];

/** Mốc nguồn đáng tin (spine) để phát hiện lệch thứ tự. */
const SPINE_KEYS = new Set<keyof Milestones>(['placedAt', 'shippedAt', 'deliveredAt', 'completedAt']);

/** Timeline: các mốc đã đạt, sắp tăng dần theo thời gian thật; đánh dấu approx; duration an toàn. */
export function buildTimeline(m: Milestones, syncedAt: Date | string | null): TimelineStep[] {
  const canonical = new Map(TIMELINE_ORDER.map((s, i) => [s.key, i] as const));
  const reached = TIMELINE_ORDER
    .filter((s) => m[s.key] != null)
    .map((s) => ({ key: s.key, label: s.label, ms: asMs(m[s.key])! }));
  const spine = reached.filter((r) => SPINE_KEYS.has(r.key as keyof Milestones));
  const syncMs = asMs(syncedAt);

  const sorted = [...reached].sort((a, b) => a.ms - b.ms);

  const built = sorted.map((r) => {
    const cIdx = canonical.get(r.key) ?? 0;
    const firstSeen = syncMs != null && Math.abs(r.ms - syncMs) <= 24 * 3600_000
      && !SPINE_KEYS.has(r.key as keyof Milestones);
    const outOfOrder = spine.some((s) => {
      const sIdx = canonical.get(s.key) ?? 0;
      return (sIdx > cIdx && s.ms < r.ms) || (sIdx < cIdx && s.ms > r.ms);
    }) && !SPINE_KEYS.has(r.key as keyof Milestones);
    const approxReason: TimelineStep['approxReason'] = firstSeen ? 'first_seen' : outOfOrder ? 'out_of_order' : null;
    return {
      key: r.key as string,
      label: TIMELINE_ORDER.find((t) => t.key === r.key)!.label,
      at: m[r.key as keyof Milestones],
      ms: r.ms,
      approx: approxReason != null,
      approxReason,
      durationHrs: null as number | null,
    };
  });

  for (let i = 1; i < built.length; i++) {
    if (!built[i].approx && !built[i - 1].approx) {
      built[i].durationHrs = Math.max(0, (built[i].ms - built[i - 1].ms) / 3600_000);
    }
  }
  return built.map(({ ms: _ms, ...step }) => step);
}
