export { SLA_SEGMENTS } from '@/features/lifecycle/stats-logic';
export type { SlaKey, GroupBy, StatGroup } from '@/features/lifecycle/stats-logic';
import type { SlaKey } from '@/features/lifecycle/stats-logic';

export const STAGE_LABELS_SEG: Record<SlaKey, string> = {
  placed_to_production: 'Đặt→Sản xuất',
  production: 'Sản xuất',
  qc: 'QC',
  pack: 'Đóng gói',
  ship: 'Bàn giao',
  deliver: 'Giao hàng',
};
