/**
 * THUẦN: 1 record QC table Lark → (orderNumber, qcCheck) + gom nhiều dòng/đơn
 * thành 1 trạng thái KCS. Field: 'Order Number final', 'QC Check' (single-select).
 */
import { larkText } from './parse-pack-row';

export function parseQcRow(fields: Record<string, unknown>): { orderNumber: string | null; qcCheck: string | null } {
  return {
    orderNumber: larkText(fields['Order Number final']),
    qcCheck: larkText(fields['QC Check']),
  };
}

export type QcStatus = 'fail' | 'pending' | 'pass' | 'extra';

/** Gom QC Check nhiều dòng/đơn → 1 trạng thái theo ưu tiên Failed>chưa-QC>Pass>Gửi dư. */
export function reduceQcStatus(values: Array<string | null>): QcStatus | null {
  const set = new Set(values.filter(Boolean) as string[]);
  if (set.has('QC Failed')) return 'fail';
  if (set.has('Tiếp nhận - chưa QC')) return 'pending';
  if (set.has('QC Pass')) return 'pass';
  if (set.has('Gửi dư')) return 'extra';
  return null;
}
