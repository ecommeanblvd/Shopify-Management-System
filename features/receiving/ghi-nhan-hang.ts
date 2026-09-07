import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Kho quét đủ chiếc một dòng → ghi ngày nhận vào mmp_line_received (nguồn cho
 * receivedAt trong payload MMP — công nợ theo kỳ nhận). source='sms' GHI ĐÈ dòng
 * 'lark'/'estimate_fulfill' cũ vì SMS là nguồn sự thật (spec §2.7); lark_pushed_at
 * về NULL để cron đẩy lại lên bảng Lark với Mã món mới.
 * Khoá theo (order_number BARE, sku) — đúng khoá bảng Lark đang dùng.
 */
export async function ghiNhanHangTrongTx(tx: Tx, d: { orderNumber: string; sku: string; vendor: string | null }): Promise<void> {
  const bare = d.orderNumber.trim().replace(/^#/, '');
  await tx.insert(schema.mmpLineReceived)
    .values({ orderNumber: bare, sku: d.sku, receivedAt: sql`now()`, vendor: d.vendor, source: 'sms', larkPushedAt: null, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: [schema.mmpLineReceived.orderNumber, schema.mmpLineReceived.sku],
      set: { receivedAt: sql`now()`, vendor: d.vendor, source: 'sms', larkPushedAt: null, updatedAt: sql`now()` },
    });
}
