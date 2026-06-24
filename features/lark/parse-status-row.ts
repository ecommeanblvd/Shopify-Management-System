/**
 * THUẦN: 1 record Lark (object `fields`) → 4 field status snapshot cho list.
 * Dùng lại helper đọc field + epoch→VN-date của parse-pack-row (DRY).
 */
import { larkText, larkEpochToVnMidnight } from './parse-pack-row';

export interface LarkStatusRow {
  dispatchStatus: string | null;
  cxFfStatus: string | null;
  deliveryStatus: string | null;
  expectedDeliveryDate: Date | null;
}

/** Field date Lark = epoch ms (số). Non-số/null → null. */
function larkDate(v: unknown): Date | null {
  if (typeof v === 'number' && Number.isFinite(v)) return larkEpochToVnMidnight(v);
  return null;
}

export function parseLarkStatus(fields: Record<string, unknown>): LarkStatusRow {
  return {
    dispatchStatus: larkText(fields['LOG-EP-Dispatch Status']),
    cxFfStatus: larkText(fields['CX-FF Status (look up)']),
    deliveryStatus: larkText(fields['Final | Delivery Status']),
    expectedDeliveryDate: larkDate(fields['Ngày giao dự kiến']),
  };
}
