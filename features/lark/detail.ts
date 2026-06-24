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
