'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { ngayKinhDoanh } from '@/lib/timezone';
import { requirePerm, withUniqueRetry } from '@/features/receiving/perm';
import { maChiec, maPhieuNhan } from './nhan-logic';
import { layIdBienThe } from './shopify-qc';

/**
 * Ghi nhận MỘT chiếc vừa về, ở trạng thái ĐANG KIỂM.
 *
 * `qc_result='pending'` và `disposition='pending'` → chiếc này KHÔNG vào tồn và
 * phân bổ KHÔNG nhìn thấy. Chỉ QC đạt mới nhập kho (CEO 24/09: "khi về chỉ ghi
 * là đang kiểm hàng, còn QC thành công thì mới nhập vào kho, vì nếu QC không
 * thành công sẽ cần phải trả lại cho brand").
 *
 * `current_warehouse_code` để NULL tới khi QC đạt — chưa kiểm thì chưa thuộc kho nào.
 * Đây chính là thứ giữ chiếc `pending` ngoài tầm mắt của `allocate.ts`, vốn lọc
 * theo `current_warehouse_code` và `qc_checked_at`.
 */
export async function ghiNhanChiec(lineId: string): Promise<{ ok: boolean; loi?: string; itemId?: string }> {
  const actor = await requirePerm('manage_qc');
  try {
    const [line] = await db.select({
      id: schema.shopifyOrderLines.id,
      orderId: schema.shopifyOrderLines.orderId,
      sku: schema.shopifyOrderLines.sku,
      productTitle: schema.shopifyOrderLines.productTitle,
      variantTitle: schema.shopifyOrderLines.variantTitle,
      vendor: schema.shopifyOrderLines.vendor,
      variantIdDaCo: schema.shopifyOrderLines.shopifyVariantId,
      storeId: schema.shopifyOrders.storeId,
      shopifyOrderId: schema.shopifyOrders.shopifyOrderId,
    }).from(schema.shopifyOrderLines)
      .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shopifyOrderLines.orderId))
      .where(eq(schema.shopifyOrderLines.id, lineId)).limit(1);
    if (!line) return { ok: false, loi: 'Không tìm thấy dòng đơn.' };

    /**
     * ID biến thể — hai tầng, tầng trên chính xác hơn:
     *  1. cột trên dòng đơn nếu bộ đồng bộ có điền (hiện chỉ 199/15.836 dòng);
     *  2. hỏi thẳng Shopify theo ĐÚNG đơn này.
     * KHÔNG tra theo SKU: `shopify_variants` chỉ có MỘT store nên trượt hàng
     * store khác, và SKU trùng giữa hai store thì còn chọn NHẦM biến thể.
     * Không ra thì để null — vẫn nhận hàng được, không chặn kho.
     */
    const variantId = line.variantIdDaCo
      ?? (line.sku ? await layIdBienThe(line.storeId, line.shopifyOrderId, line.sku) : null);

    const maPhieu = maPhieuNhan(ngayKinhDoanh(new Date())!, line.vendor);
    let [phieu] = await db.select().from(schema.goodsReceipts)
      .where(eq(schema.goodsReceipts.code, maPhieu)).limit(1);
    if (!phieu) {
      // Hai người cùng nhận chiếc đầu tiên của một brand trong ngày → cùng dựng
      // một mã phiếu. `code` là unique nên người sau đụng 23505; đọc lại thay vì hỏng.
      try {
        [phieu] = await db.insert(schema.goodsReceipts).values({
          code: maPhieu, warehouseCode: 'GVM', sourceType: 'consignment',
          vendor: line.vendor, receivedAt: new Date(), receivedBy: actor,
        }).returning();
      } catch {
        [phieu] = await db.select().from(schema.goodsReceipts)
          .where(eq(schema.goodsReceipts.code, maPhieu)).limit(1);
      }
    }
    if (!phieu) return { ok: false, loi: 'Không dựng được phiếu nhận.' };

    const item = await withUniqueRetry(async () => {
      const seq = await db.execute<{ v: string }>("SELECT nextval('wh_chiec_seq') AS v");
      const unitCode = maChiec(Number(seq.rows[0]?.v), new Date());
      const [row] = await db.insert(schema.goodsReceiptItems).values({
        receiptId: phieu!.id,
        unitCode,
        sku: line.sku,
        shopifyVariantId: variantId,
        productTitle: line.productTitle,
        variantTitle: line.variantTitle,
        orderId: line.orderId,
        qcResult: 'pending',
        disposition: 'pending',
      }).returning({ id: schema.goodsReceiptItems.id });
      return row;
    });

    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true, itemId: item.id };
  } catch (e) {
    console.error('[kho-nhan] ghiNhanChiec lỗi:', e);
    return { ok: false, loi: 'Ghi nhận thất bại, thử lại.' };
  }
}
