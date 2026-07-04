/** THUẦN: đối chiếu thời gian thực từng đoạn với SLA + estimate cho stage. */
import { computeDurations, SLA_SEGMENTS, type SlaKey, type DurationMilestones } from './stats-logic';
import type { StageKey } from './derive';

export interface SegmentTiming {
  segment: SlaKey;
  actualHrs: number | null;
  estimateHrs: number;
  verdict: 'đúng' | 'trễ' | null;
}

/** Thực tế từng đoạn (từ mốc) so SLA → verdict. */
export function segmentTimings(m: DurationMilestones, sla: Record<SlaKey, number>): SegmentTiming[] {
  const dur = computeDurations(m);
  return SLA_SEGMENTS.map((seg) => {
    const actualHrs = dur[seg];
    const estimateHrs = sla[seg];
    const verdict: SegmentTiming['verdict'] = actualHrs == null ? null : actualHrs > estimateHrs ? 'trễ' : 'đúng';
    return { segment: seg, actualHrs, estimateHrs, verdict };
  });
}

/** Stage → đoạn SLA để hiện "dự kiến" ở point (preview stage chưa tới). */
export const STAGE_SEGMENT: Record<StageKey, SlaKey | null> = {
  placed: 'placed_to_production',
  production: 'production',
  qc: 'qc',
  packed: 'pack',
  shipped: 'ship',
  in_transit: 'deliver',
  out_for_delivery: 'deliver',
  post_delivery: null,
  completed: null,
  refunded_full: null,
  cancelled: null,
};

export function stageEstimateHrs(stage: StageKey, sla: Record<SlaKey, number>): number | null {
  const seg = STAGE_SEGMENT[stage];
  return seg ? sla[seg] : null;
}
