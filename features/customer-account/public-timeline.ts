/** THUẦN: rút gọn lifecycle → timeline an toàn cho customer (bỏ field nội bộ). */
import { buildTimeline, STAGE_LABELS, nextStage, type Milestones } from '@/features/lifecycle/display';
import type { StageKey } from '@/features/lifecycle/derive';

export interface PublicTimeline {
  currentStage: string;
  currentStageLabel: string;
  nextStageLabel: string | null;
  steps: Array<{ label: string; at: string | null }>;
}

const iso = (v: Date | string | null): string | null => (v == null ? null : new Date(v).toISOString());

export function toPublicTimeline(
  lc: { currentStage: string; syncedAt: Date | string | null } & Milestones,
): PublicTimeline {
  const stage = lc.currentStage as StageKey;
  const steps = buildTimeline(lc, lc.syncedAt).map((s) => ({ label: s.label, at: iso(s.at) }));
  const nx = nextStage(stage);
  return {
    currentStage: lc.currentStage,
    currentStageLabel: STAGE_LABELS[stage] ?? lc.currentStage,
    nextStageLabel: nx ? STAGE_LABELS[nx] : null,
    steps,
  };
}

/**
 * 6 giai đoạn chuẩn khách hàng (spec §3.2 order-journey-design.md, CEO đã duyệt copy):
 * Placed → In production → Quality check → Packed → Shipped → Delivered.
 * Đây là nhãn tiếng Anh dành cho khách quốc tế (khác STAGE_LABELS nội bộ tiếng Việt).
 */
export const CUSTOMER_STAGE_LABELS = [
  'Placed', 'In production', 'Quality check', 'Packed', 'Shipped', 'Delivered',
] as const;

/**
 * Fallback timeline khi đơn CHƯA có row `order_lifecycle` (chưa sync xong).
 * Vẫn hiện đủ 6 giai đoạn chuẩn (upcoming) thay vì trả null — chỉ step Placed
 * có mốc thời gian (từ `createdAtShopify` nếu có).
 */
export function defaultTimeline(placedAt: Date | null): PublicTimeline {
  const placedIso = iso(placedAt);
  return {
    currentStage: 'placed',
    currentStageLabel: CUSTOMER_STAGE_LABELS[0],
    nextStageLabel: CUSTOMER_STAGE_LABELS[1],
    steps: CUSTOMER_STAGE_LABELS.map((label, i) => ({ label, at: i === 0 ? placedIso : null })),
  };
}
