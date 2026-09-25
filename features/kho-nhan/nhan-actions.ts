'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { ngayKinhDoanh } from '@/lib/timezone';
import { requirePerm, withUniqueRetry } from '@/features/receiving/perm';
import { maChiec, maPhieuNhan } from './nhan-logic';
import { layIdBienThe } from './shopify-qc';

/** Kho làm việc của người đang thao tác. Chưa gán thì rơi về GVM (kho chính). */
async function khoCuaNguoiDung(userId: string): Promise<string> {
  const [u] = await db.select({ kho: schema.user.khoMacDinh })
    .from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  return (u?.kho ?? '').trim() || 'GVM';
}

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

    const kho = await khoCuaNguoiDung(actor);
    const maPhieu = maPhieuNhan(ngayKinhDoanh(new Date())!, line.vendor, kho);
    let [phieu] = await db.select().from(schema.goodsReceipts)
      .where(eq(schema.goodsReceipts.code, maPhieu)).limit(1);
    if (!phieu) {
      // Hai người cùng nhận chiếc đầu tiên của một brand trong ngày → cùng dựng
      // một mã phiếu. `code` là unique nên người sau đụng 23505; đọc lại thay vì hỏng.
      try {
        [phieu] = await db.insert(schema.goodsReceipts).values({
          code: maPhieu, warehouseCode: kho, sourceType: 'consignment',
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

/**
 * Gỡ MỘT chiếc vừa nhận nhầm khỏi danh sách đang kiểm.
 *
 * CEO 24/09: "chọn 2 sản phẩm này bị sai cần chọn lại thì remove được ở đâu".
 * Chiếc nhận nhầm chưa từng là hàng thật nên xoá hẳn dòng, không để lại rác.
 *
 * BA ĐIỀU KIỆN trong chính câu WHERE, không kiểm ở tầng trên:
 *  - `qc_result = 'pending'` — đã QC rồi thì KHÔNG được xoá, vì QC đạt đã ghi
 *    tồn kho qua applyMovement, xoá dòng là tồn treo không ai đối chiếu được;
 *  - `lark_record_id IS NULL` — chiếc đã vào hàng chờ QC đi đường `goKhoiLark`
 *    (xoá dòng Lark trước), nếu không bảng Lark còn dòng mà bên mình mất dấu;
 *  - `id` đích danh — không bao giờ xoá theo điều kiện lọc.
 *
 * `goods_receipt_items` đang giữ 833 chiếc thật và `allocate.ts` đọc nó, nên
 * mọi đường xoá ở đây phải hẹp đến mức không thể chạm hàng cũ.
 */
export async function goChiecNhanNham(itemId: string): Promise<{ ok: boolean; loi?: string }> {
  await requirePerm('manage_qc');
  try {
    const xoa = await db.delete(schema.goodsReceiptItems)
      .where(and(
        eq(schema.goodsReceiptItems.id, itemId),
        eq(schema.goodsReceiptItems.qcResult, 'pending'),
        isNull(schema.goodsReceiptItems.larkRecordId),
      ))
      .returning({ id: schema.goodsReceiptItems.id });
    if (xoa.length === 0) {
      return { ok: false, loi: 'Không gỡ được — chiếc này đã kiểm hoặc đã vào hàng chờ QC.' };
    }
    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true };
  } catch (e) {
    console.error('[kho-nhan] goChiecNhanNham lỗi:', e);
    return { ok: false, loi: 'Gỡ thất bại, thử lại.' };
  }
}

/**
 * "Huỷ nhập": dọn SẠCH các chiếc đang kiểm CHƯA gửi Lark.
 *
 * Cùng ba điều kiện với `goChiecNhanNham`, chỉ khác là không giới hạn một id.
 * Chiếc đã QC hoặc đã gửi Lark KHÔNG bị đụng tới — đó là lý do hàm này an toàn
 * dù nó xoá nhiều dòng.
 */
export async function huyNhapChuaGui(): Promise<{ ok: boolean; soXoa: number; loi?: string }> {
  await requirePerm('manage_qc');
  try {
    const xoa = await db.delete(schema.goodsReceiptItems)
      .where(and(
        eq(schema.goodsReceiptItems.qcResult, 'pending'),
        isNull(schema.goodsReceiptItems.larkRecordId),
      ))
      .returning({ id: schema.goodsReceiptItems.id });
    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true, soXoa: xoa.length };
  } catch (e) {
    console.error('[kho-nhan] huyNhapChuaGui lỗi:', e);
    return { ok: false, soXoa: 0, loi: 'Huỷ nhập thất bại, thử lại.' };
  }
}
