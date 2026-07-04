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

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';
export function delayTone(delayStatus: string): Tone {
  return delayStatus === 'overdue' ? 'bad' : delayStatus === 'due_soon' ? 'warn' : 'ok';
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

export interface TimelineStep { key: string; label: string; at: Date | string | null; durationHrs: number | null }

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

/** Các mốc đã đạt (at != null) + duration từ mốc đã-đạt liền trước. */
export function buildTimeline(m: Milestones): TimelineStep[] {
  const reached = TIMELINE_ORDER.filter((s) => m[s.key] != null);
  return reached.map((s, i) => ({
    key: s.key as string,
    label: s.label,
    at: m[s.key],
    durationHrs: i === 0 ? null : hoursBetween(m[reached[i - 1].key], m[s.key]),
  }));
}
