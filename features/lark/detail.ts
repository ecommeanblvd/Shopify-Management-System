/**
 * Phần B — fetch LIVE record Lark cho trang chi tiết đơn (mọi field, key→value).
 * Lỗi/thiếu env → trả [] (card hiện trạng thái trống), KHÔNG ném làm vỡ trang.
 */
import 'server-only';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { larkText } from './parse-pack-row';
import { searchRecordsByOrderNumber } from './client';

/** 1 record Lark → list {label,value}; bỏ field rỗng/không stringify được. THUẦN. */
export function flattenLarkRecord(fields: Record<string, unknown>): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const [label, raw] of Object.entries(fields)) {
    const value = larkText(raw);
    if (value) out.push({ label, value });
  }
  return out;
}

/** Field Lark "cần thiết" hiển thị trong modal chi tiết (thứ tự = thứ tự hiện). */
export const LARK_DETAIL_FIELDS: string[] = [
  'LOG-EP-Dispatch Status',
  'Sub-Status',
  'CX-FF Status (look up)',
  'Final | Delivery Status',
  'Ngày giao dự kiến',
  'Ngày giao thực tế',
  'Couriers',
  'Tracking Number',
  'Weights',
  'Dimension ( điền tay)',
  'LOG-Order Remark (Full)',
  'CX/Khách note on order (look up)',
];

/** Lấy các field theo `names` (giữ thứ tự), bỏ field rỗng/thiếu. THUẦN. */
export function pickLarkFields(
  fields: Record<string, unknown>,
  names: string[],
): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const name of names) {
    const value = larkText(fields[name]);
    if (value) out.push({ label: name, value });
  }
  return out;
}

/** Raw fields của record Lark ĐẦU TIÊN khớp đơn. Best-effort → {}. */
export async function getLarkRawFieldsForOrder(orderId: string): Promise<Record<string, unknown>> {
  try {
    const [ord] = await db
      .select({ orderNumber: schema.shopifyOrders.shopifyOrderNumber })
      .from(schema.shopifyOrders)
      .where(eq(schema.shopifyOrders.id, orderId))
      .limit(1);
    if (!ord?.orderNumber) return {};
    const records = await searchRecordsByOrderNumber(ord.orderNumber);
    return records[0]?.fields ?? {};
  } catch (e) {
    console.error(`[lark] getLarkRawFieldsForOrder ${orderId} lỗi:`, e);
    return {};
  }
}

export interface LarkDetailRecord {
  recordId: string;
  fields: Array<{ label: string; value: string }>;
}

/** Lấy (các) record Lark của đơn theo Order Number. Best-effort: lỗi → []. */
export async function getLarkRecordsForOrder(orderId: string): Promise<LarkDetailRecord[]> {
  try {
    const [ord] = await db
      .select({ orderNumber: schema.shopifyOrders.shopifyOrderNumber })
      .from(schema.shopifyOrders)
      .where(eq(schema.shopifyOrders.id, orderId))
      .limit(1);
    if (!ord?.orderNumber) return [];
    const records = await searchRecordsByOrderNumber(ord.orderNumber);
    return records.map((r) => ({ recordId: r.record_id, fields: flattenLarkRecord(r.fields) }));
  } catch (e) {
    console.error(`[lark] getLarkRecordsForOrder ${orderId} lỗi:`, e);
    return [];
  }
}
