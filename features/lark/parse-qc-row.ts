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

/** 1 giá trị "QC Check" (single-select) → status. Không khớp/null → null. THUẦN. */
export function mapQcCheck(value: string | null): QcStatus | null {
  switch (value) {
    case 'QC Failed': return 'fail';
    case 'Tiếp nhận - chưa QC': return 'pending';
    case 'QC Pass': return 'pass';
    case 'Gửi dư': return 'extra';
    default: return null;
  }
}

/** Giá trị QC Check của record createdTime LỚN NHẤT có qcCheck non-null. THUẦN. */
export function latestQcCheck(items: Array<{ qcCheck: string | null; createdTime: number }>): string | null {
  let best: { qcCheck: string; createdTime: number } | null = null;
  for (const it of items) {
    if (!it.qcCheck) continue;
    if (!best || it.createdTime >= best.createdTime) best = { qcCheck: it.qcCheck, createdTime: it.createdTime };
  }
  return best?.qcCheck ?? null;
}
