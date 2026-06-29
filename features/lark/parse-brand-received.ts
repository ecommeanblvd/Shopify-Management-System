/**
 * THUẦN: 1 record bảng Lark "WH ngày MEAN nhận hàng" → (orderNumber bare, sku,
 * vendor, receivedAt). Nguồn ngày nhận hàng từ brand để đẩy MMP (đối soát công nợ).
 */
import { larkText } from './parse-pack-row';

/** Field date Lark có thể là số (epoch ms) hoặc {type:5,value:[ms]}. → ms|null. */
export function larkDateField(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && 'value' in (v as object)) {
    const arr = (v as { value: unknown }).value;
    if (Array.isArray(arr) && typeof arr[0] === 'number' && Number.isFinite(arr[0])) return arr[0];
  }
  return null;
}

export interface BrandReceivedRow {
  orderNumber: string | null; // bare (bỏ '#')
  sku: string | null;
  vendor: string | null;
  receivedAt: Date | null;
}

const RECV_FIELD = 'Visible - WH-Ngày MEAN nhận hàng gần nhất';

export function parseBrandReceivedRow(fields: Record<string, unknown>): BrandReceivedRow {
  const on = larkText(fields['order_number']);
  const ms = larkDateField(fields[RECV_FIELD]);
  return {
    orderNumber: on ? on.replace(/^#/, '') : null,
    sku: larkText(fields['Lineitem SKU']),
    vendor: larkText(fields['vendor']),
    receivedAt: ms != null ? new Date(ms) : null,
  };
}
