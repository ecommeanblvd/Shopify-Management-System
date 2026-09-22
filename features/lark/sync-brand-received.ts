/**
 * Sync bảng Lark "WH ngày MEAN nhận hàng" → mmp_line_received (order_number bare,
 * sku → received_at mới nhất). Nguồn ngày nhận hàng từ brand để đẩy MMP.
 * Best-effort (lỗi không chặn cron khác). Idempotent: chèn mới hoặc cập nhật
 * dòng KHÔNG phải nguồn sms; dòng sms không bao giờ bị đè (§2.7) — kho quét là
 * nguồn sự thật từ 09/2026, Lark chỉ còn bù cho đơn kho chưa quét.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listBrandReceivedRecords } from './client';
import { parseBrandReceivedRow } from './parse-brand-received';
import { docMonLark } from './huy-mon';

export interface BrandReceivedSyncResult { fetched: number; inserted: number; monHuy?: number }

const CHUNK = 500;

export async function syncBrandReceived(): Promise<BrandReceivedSyncResult> {
  const records = await listBrandReceivedRecords();
  // Gom theo (order_number, sku) → ngày nhận MỚI NHẤT + vendor.
  const byKey = new Map<string, { orderNumber: string; sku: string; receivedAt: Date; vendor: string | null }>();
  for (const rec of records) {
    const r = parseBrandReceivedRow(rec.fields);
    if (!r.orderNumber || !r.sku || !r.receivedAt) continue;
    const key = `${r.orderNumber}\u0000${r.sku}`;
    const cur = byKey.get(key);
    if (!cur || r.receivedAt.getTime() > cur.receivedAt.getTime()) {
      byKey.set(key, { orderNumber: r.orderNumber, sku: r.sku, receivedAt: r.receivedAt, vendor: r.vendor });
    }
  }
  const rows = [...byKey.values()];
  // Lark được phép cập nhật dòng Lark-owned ('lark'/'estimate_fulfill') của
  // chính nó, nhưng KHÔNG BAO GIỜ đè dòng 'sms' — kho quét là nguồn sự thật
  // từ 09/2026, Lark chỉ còn bù cho đơn kho chưa quét (spec §5.3, §2.7).
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const ins = await db.insert(schema.mmpLineReceived)
      .values(batch.map((b) => ({ orderNumber: b.orderNumber, sku: b.sku, receivedAt: b.receivedAt, vendor: b.vendor, updatedAt: new Date() })))
      .onConflictDoUpdate({
        target: [schema.mmpLineReceived.orderNumber, schema.mmpLineReceived.sku],
        set: { receivedAt: sql`excluded.received_at`, vendor: sql`excluded.vendor`, updatedAt: new Date() },
        setWhere: sql`${schema.mmpLineReceived.source} <> 'sms'`,
      })
      .returning({ id: schema.mmpLineReceived.id });
    inserted += ins.length;
  }
  const monHuy = await luuMonDon(records);
  return { fetched: records.length, inserted, monHuy };
}

/**
 * Lưu TỪNG MÓN của đơn kèm cờ huỷ, để màn Đóng hàng không cho đi kiện đã huỷ.
 * Best-effort: hỏng thì chỉ log — ngày nhận hàng (việc chính của hàm trên) đã ghi xong rồi.
 */
async function luuMonDon(records: Array<{ fields: Record<string, unknown>; record_id: string }>): Promise<number> {
  try {
    const mon = records.map((r) => docMonLark(r.fields, r.record_id)).filter((m): m is NonNullable<typeof m> => m != null);
    // Lark có thể trả 2 dòng cùng "Định danh" (sửa tay) — giữ dòng cuối để insert không đụng khoá.
    const theoDinhDanh = new Map(mon.map((m) => [m.dinhDanh, m]));
    const rows = [...theoDinhDanh.values()];
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(schema.larkMonDon)
        .values(rows.slice(i, i + CHUNK).map((m) => ({
          dinhDanh: m.dinhDanh, orderNumber: m.orderNumber, sku: m.sku, huy: m.huy, lyDo: m.lyDo, capNhatLuc: new Date(),
          recordId: m.recordId, lineitemName: m.lineitemName, store: m.store, vendor: m.vendor,
        })))
        .onConflictDoUpdate({
          target: schema.larkMonDon.dinhDanh,
          set: {
            orderNumber: sql`excluded.order_number`, sku: sql`excluded.sku`, huy: sql`excluded.huy`, lyDo: sql`excluded.ly_do`, capNhatLuc: new Date(),
            recordId: sql`excluded.record_id`, lineitemName: sql`excluded.lineitem_name`, store: sql`excluded.store`, vendor: sql`excluded.vendor`,
          },
        });
    }
    return rows.filter((m) => m.huy).length;
  } catch (e) {
    console.error('[lark] lưu món huỷ thất bại (không chặn sync ngày nhận):', e instanceof Error ? e.message : e);
    return 0;
  }
}
