/**
 * THUẦN: 1 record Lark (object `fields`) → 4 field status snapshot cho list.
 * Dùng lại helper đọc field + epoch→VN-date của parse-pack-row (DRY).
 */
import type { DeliveryStatus } from '@/lib/fedex/track';
import { larkText, larkEpochToVnMidnight } from './parse-pack-row';

export interface LarkStatusRow {
  dispatchStatus: string | null;
  cxFfStatus: string | null;
  deliveryStatus: string | null;
  expectedDeliveryDate: Date | null;
  deliveryState: DeliveryStatus | null;
  actualDeliveredAt: Date | null;
}

/** Field date Lark = epoch ms (số). Non-số/null → null. */
function larkDate(v: unknown): Date | null {
  if (typeof v === 'number' && Number.isFinite(v)) return larkEpochToVnMidnight(v);
  return null;
}

/** Map "Final | Delivery Status" (Lark) → DeliveryStatus. Null nếu rỗng/không khớp. THUẦN. */
export function mapLarkDelivery(raw: string | null): DeliveryStatus | null {
  switch (raw) {
    case 'Chậm hơn dự kiến':
    case 'Đúng dự kiến':
    case 'Nhanh hơn dự kiến': return 'delivered';
    case 'Đang giao hàng': return 'out_for_delivery';
    case 'Đang xử lý': return 'in_transit';
    case 'Giao hàng thất bại':
    case 'Gặp vấn đề':
    case 'Mất hàng khi giao': return 'exception';
    default: return null;
  }
}

export function parseLarkStatus(fields: Record<string, unknown>): LarkStatusRow {
  return {
    dispatchStatus: larkText(fields['LOG-EP-Dispatch Status']),
    cxFfStatus: larkText(fields['CX-FF Status (look up)']),
    deliveryStatus: larkText(fields['Final | Delivery Status']),
    expectedDeliveryDate: larkDate(fields['Ngày giao dự kiến']),
    deliveryState: mapLarkDelivery(larkText(fields['Final | Delivery Status'])),
    actualDeliveredAt: larkDate(fields['Ngày giao thực tế']),
  };
}
