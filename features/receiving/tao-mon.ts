import { desc, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { nextSeqCode, parseSeq } from './logic';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface MonMoi {
  receiptId: string;
  sku?: string | null; productTitle?: string | null; variantTitle?: string | null; photoKey?: string | null;
  brandRequestId?: string | null; fulfillmentLineId?: string | null; orderId?: string | null;
  domPrice?: string | null; domPriceCurrency?: string | null;
  globalPrice?: string | null; globalPriceCurrency?: string | null; weightKg?: string | null;
  /** 'now' = tạo bởi nút "In N tem" (đã in, chờ quét xác nhận). */
  printedAt?: 'now' | null;
  unplanned?: boolean;
}

/**
 * Sinh mã WH- kế tiếp và chèn MỘT món trong transaction đang mở. Gọi trong
 * withUniqueRetry vì "max + 1" có thể đụng khi hai người in cùng lúc.
 * Không đụng brand_order_requests — ai gọi tự quyết (addReceiptItem chốt
 * delivered_at ngay; in tem thì đợi quét đủ chiếc).
 */
export async function taoMonTrongTx(tx: Tx, mon: MonMoi): Promise<{ id: string; unitCode: string }> {
  const [last] = await tx.select({ unitCode: schema.goodsReceiptItems.unitCode })
    .from(schema.goodsReceiptItems).orderBy(desc(schema.goodsReceiptItems.unitCode)).limit(1);
  const unitCode = nextSeqCode('WH', parseSeq('WH', last?.unitCode ?? null));
  const [row] = await tx.insert(schema.goodsReceiptItems).values({
    receiptId: mon.receiptId, unitCode,
    sku: mon.sku?.trim() || null, productTitle: mon.productTitle ?? null, variantTitle: mon.variantTitle ?? null,
    photoKey: mon.photoKey ?? null,
    brandRequestId: mon.brandRequestId ?? null, fulfillmentLineId: mon.fulfillmentLineId ?? null, orderId: mon.orderId ?? null,
    domPrice: mon.domPrice ?? null, domPriceCurrency: mon.domPriceCurrency ?? null,
    globalPrice: mon.globalPrice ?? null, globalPriceCurrency: mon.globalPriceCurrency ?? null, weightKg: mon.weightKg ?? null,
    printedAt: mon.printedAt === 'now' ? sql`now()` : null,
    unplanned: mon.unplanned ?? false,
  }).returning({ id: schema.goodsReceiptItems.id });
  return { id: row.id, unitCode };
}
