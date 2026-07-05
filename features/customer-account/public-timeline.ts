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
