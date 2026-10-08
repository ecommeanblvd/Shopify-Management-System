'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { nhanHangDuoc, nhanQuaMonLark } from './pham-vi';
import { revalidatePath } from 'next/cache';
import { goKhoiLark } from './day-wh-lark';
import { db, schema } from '@/db/client';
import { ngayKinhDoanh, sqlGioKinhDoanh } from '@/lib/timezone';
import { requirePerm, withUniqueRetry } from '@/features/receiving/perm';
import { maChiec, maPhieuNhan } from './nhan-logic';
import { khoa, monPoConNhan } from './po-con-nhan';
import { monConNhanDuoc } from './mon-lark-con-nhan';
import { returnConNhanDuoc } from './return-con-nhan';
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
      shopDomain: schema.stores.shopDomain,
    }).from(schema.shopifyOrderLines)
      .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shopifyOrderLines.orderId))
      .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
      .where(eq(schema.shopifyOrderLines.id, lineId)).limit(1);
    if (!line) return { ok: false, loi: 'Không tìm thấy dòng đơn.' };
    /* Chặn LẦN HAI ở chỗ GHI, không chỉ ở ô tìm: ô tìm là cửa duy nhất hôm nay,
     * nhưng action nhận thẳng `lineId` nên một kết quả tìm cũ (hoặc một lời gọi
     * dựng tay) vẫn ghi được hàng của store bị chặn. Kiểm ở nơi THAY ĐỔI dữ liệu
     * mới là kiểm thật (CEO 29/09/2026). */
    if (!nhanHangDuoc(line.shopDomain)) {
      return { ok: false, loi: `Store ${line.shopDomain} không thuộc phạm vi nhận hàng.` };
    }

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
 * Nhận MỘT chiếc hàng đặt PO (CEO 29/09/2026).
 *
 * PO không thuộc đơn Shopify nào nên `order_id` để NULL và giữ mã PO ở
 * `po_order_number`. Kiểm lại điều kiện NGAY TRƯỚC KHI GHI thay vì tin kết quả
 * tìm: ô tìm có thể mở từ mười phút trước, trong lúc đó đội kho đã nhập nốt số
 * còn thiếu trên Lark và PO đã đủ — ghi tiếp là nhận thừa.
 */
export async function ghiNhanChiecPo(poRecordId: string): Promise<{ ok: boolean; loi?: string; itemId?: string }> {
  const actor = await requirePerm('manage_qc');
  try {
    const [dong] = await db.select().from(schema.larkPoDong)
      .where(eq(schema.larkPoDong.recordId, poRecordId)).limit(1);
    if (!dong) return { ok: false, loi: 'Không tìm thấy dòng PO.' };
    if (!dong.baoDon) return { ok: false, loi: 'Dòng PO này chưa tick "Báo đơn".' };
    if (!dong.orderNumber || !dong.sku) return { ok: false, loi: 'Dòng PO thiếu mã đơn hoặc SKU.' };

    const con = await conNhanDuocPo(dong.orderNumber, dong.sku);
    if (con <= 0) {
      return { ok: false, loi: `PO ${dong.orderNumber} đã nhập đủ — không nhận thêm được.` };
    }

    const kho = await khoCuaNguoiDung(actor);
    const maPhieu = maPhieuNhan(ngayKinhDoanh(new Date())!, dong.vendor, kho);
    let [phieu] = await db.select().from(schema.goodsReceipts)
      .where(eq(schema.goodsReceipts.code, maPhieu)).limit(1);
    if (!phieu) {
      try {
        [phieu] = await db.insert(schema.goodsReceipts).values({
          code: maPhieu, warehouseCode: kho, sourceType: 'consignment',
          vendor: dong.vendor, receivedAt: new Date(), receivedBy: actor,
        }).returning();
      } catch {
        [phieu] = await db.select().from(schema.goodsReceipts)
          .where(eq(schema.goodsReceipts.code, maPhieu)).limit(1);
      }
    }
    if (!phieu) return { ok: false, loi: 'Không dựng được phiếu nhận.' };

    const item = await withUniqueRetry(async () => {
      const seq = await db.execute<{ v: string }>("SELECT nextval('wh_chiec_seq') AS v");
      const [row] = await db.insert(schema.goodsReceiptItems).values({
        receiptId: phieu!.id,
        unitCode: maChiec(Number(seq.rows[0]?.v), new Date()),
        sku: dong.sku,
        productTitle: dong.lineitemName,
        orderId: null,
        poOrderNumber: dong.orderNumber,
        poRecordId: dong.recordId,
        qcResult: 'pending',
        disposition: 'pending',
      }).returning({ id: schema.goodsReceiptItems.id });
      return row;
    });

    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true, itemId: item.id };
  } catch (e) {
    console.error('[kho-nhan] ghiNhanChiecPo lỗi:', e);
    return { ok: false, loi: 'Ghi nhận thất bại, thử lại.' };
  }
}

/**
 * Nhận MỘT chiếc của kênh KHÔNG-Shopify qua bảng món Lark (CEO 08/10/2026).
 *
 * Bảo báo "không nhập được đơn TQ": đơn `#MTB` (MEAN Taobao) và `#MXHS` (MEAN Xiao Hong Shu)
 * không có trong `shopify_orders` — đo 08/10 là 0 đơn — nên ô tìm không thấy gì để nhận.
 *
 * `order_id` để NULL như hàng PO, và ghim `mon_dinh_danh` + `mon_record_id`: cái đầu để đếm
 * "món này đã nhận chưa", cái sau để nối `Import (select order)` lúc đẩy lên bảng vận hành.
 *
 * Kiểm lại điều kiện NGAY TRƯỚC KHI GHI thay vì tin kết quả tìm — cùng lý lẽ `ghiNhanChiecPo`:
 * ô tìm có thể mở từ mười phút trước, trong lúc đó dòng món đã bị đánh huỷ hoặc đã có người
 * nhận. Luật ở `mon-lark-con-nhan.ts`, KHÔNG viết lại ở đây.
 */
export async function ghiNhanChiecMonLark(
  dinhDanh: string,
): Promise<{ ok: boolean; loi?: string; itemId?: string }> {
  const actor = await requirePerm('manage_qc');
  try {
    const [mon] = await db.select().from(schema.larkMonDon)
      .where(eq(schema.larkMonDon.dinhDanh, dinhDanh)).limit(1);
    if (!mon) return { ok: false, loi: 'Không tìm thấy dòng món trên bản sao bảng Lark.' };

    const [dem] = await db.select({ n: sql<number>`count(*)::int` })
      .from(schema.goodsReceiptItems)
      .where(eq(schema.goodsReceiptItems.monDinhDanh, dinhDanh));

    const duoc = monConNhanDuoc(
      { dinhDanh: mon.dinhDanh, orderNumber: mon.orderNumber, sku: mon.sku, store: mon.store,
        huy: mon.huy, coRecordId: !!mon.recordId },
      dem?.n ?? 0, nhanQuaMonLark(mon.store),
    );
    if (!duoc.ok) return { ok: false, loi: `Không nhận được: ${duoc.lyDo}.` };

    const kho = await khoCuaNguoiDung(actor);
    const maPhieu = maPhieuNhan(ngayKinhDoanh(new Date())!, mon.vendor, kho);
    let [phieu] = await db.select().from(schema.goodsReceipts)
      .where(eq(schema.goodsReceipts.code, maPhieu)).limit(1);
    if (!phieu) {
      try {
        [phieu] = await db.insert(schema.goodsReceipts).values({
          code: maPhieu, warehouseCode: kho, sourceType: 'retail_for_order',
          vendor: mon.vendor, receivedAt: new Date(), receivedBy: actor,
        }).returning();
      } catch {
        [phieu] = await db.select().from(schema.goodsReceipts)
          .where(eq(schema.goodsReceipts.code, maPhieu)).limit(1);
      }
    }
    if (!phieu) return { ok: false, loi: 'Không dựng được phiếu nhận.' };

    const item = await withUniqueRetry(async () => {
      const seq = await db.execute<{ v: string }>("SELECT nextval('wh_chiec_seq') AS v");
      const [row] = await db.insert(schema.goodsReceiptItems).values({
        receiptId: phieu!.id,
        unitCode: maChiec(Number(seq.rows[0]?.v), new Date()),
        sku: mon.sku,
        productTitle: mon.lineitemName,
        orderId: null,
        monDinhDanh: mon.dinhDanh,
        monRecordId: mon.recordId,
        qcResult: 'pending',
        disposition: 'pending',
      }).returning({ id: schema.goodsReceiptItems.id });
      return row;
    });

    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true, itemId: item.id };
  } catch (e) {
    console.error('[kho-nhan] ghiNhanChiecMonLark lỗi:', e);
    return { ok: false, loi: 'Ghi nhận thất bại, thử lại.' };
  }
}

/**
 * Nhận MỘT món đồ khách trả về (CEO 08/10/2026).
 *
 * `order_id` để NULL dù dòng return mang mã đơn Shopify thật: đơn đó ĐÃ GIAO XONG. Gắn vào
 * `order_id` là chiếc return bị tính vào "đã nhận" của đơn, và món đang chờ về của đơn đó biến
 * mất khỏi ô tìm — đúng loại lỗi đã sửa ở việc #6 hôm nay.
 *
 * Kiểm lại điều kiện NGAY TRƯỚC KHI GHI thay vì tin kết quả tìm: ô tìm có thể mở từ mười phút
 * trước, trong lúc đó đội kho đã nhập tay dòng WH bên Lark (cột lookup `WH - Tiếp nhận & QC` có
 * giá trị) hoặc LOG đã đổi trạng thái. Luật ở `return-con-nhan.ts`, KHÔNG viết lại ở đây.
 */
export async function ghiNhanChiecReturn(
  recordId: string,
): Promise<{ ok: boolean; loi?: string; itemId?: string }> {
  const actor = await requirePerm('manage_qc');
  try {
    const [dong] = await db.select().from(schema.larkLogImport)
      .where(eq(schema.larkLogImport.recordId, recordId)).limit(1);
    if (!dong) return { ok: false, loi: 'Không tìm thấy dòng đồ return trên bản sao bảng Lark.' };

    const [dem] = await db.select({ n: sql<number>`count(*)::int` })
      .from(schema.goodsReceiptItems)
      .where(eq(schema.goodsReceiptItems.returnRecordId, recordId));

    const duoc = returnConNhanDuoc({
      recordId: dong.recordId, orderNumber: dong.orderNumber, sku: dong.sku,
      soLuong: dong.soLuong, whTiepNhanQc: dong.whTiepNhanQc, logStatus: dong.logStatus,
    }, dem?.n ?? 0);
    if (!duoc.ok) return { ok: false, loi: `Không nhận được: ${duoc.lyDo}.` };

    const kho = await khoCuaNguoiDung(actor);
    /* Vendor để NULL: bảng `LOG - Import` không có cột vendor (đã dò đủ 48 cột). Mã phiếu nhận
     * vì thế không mang tên vendor — đúng hơn là bịa một cái tên vào mã phiếu. */
    const maPhieu = maPhieuNhan(ngayKinhDoanh(new Date())!, null, kho);
    let [phieu] = await db.select().from(schema.goodsReceipts)
      .where(eq(schema.goodsReceipts.code, maPhieu)).limit(1);
    if (!phieu) {
      try {
        [phieu] = await db.insert(schema.goodsReceipts).values({
          code: maPhieu, warehouseCode: kho, sourceType: 'consignment',
          vendor: null, receivedAt: new Date(), receivedBy: actor,
        }).returning();
      } catch {
        [phieu] = await db.select().from(schema.goodsReceipts)
          .where(eq(schema.goodsReceipts.code, maPhieu)).limit(1);
      }
    }
    if (!phieu) return { ok: false, loi: 'Không dựng được phiếu nhận.' };

    const item = await withUniqueRetry(async () => {
      const seq = await db.execute<{ v: string }>("SELECT nextval('wh_chiec_seq') AS v");
      const [row] = await db.insert(schema.goodsReceiptItems).values({
        receiptId: phieu!.id,
        unitCode: maChiec(Number(seq.rows[0]?.v), new Date()),
        sku: dong.sku,
        orderId: null,
        returnRecordId: dong.recordId,
        qcResult: 'pending',
        disposition: 'pending',
      }).returning({ id: schema.goodsReceiptItems.id });
      return row;
    });

    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true, itemId: item.id };
  } catch (e) {
    console.error('[kho-nhan] ghiNhanChiecReturn lỗi:', e);
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
      return { ok: false, loi: 'Không xoá được — chiếc này đã kiểm hoặc đã vào hàng chờ QC.' };
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
/**
 * Xoá MỘT chiếc khỏi danh sách — một nhát, dù đã vào chờ QC hay chưa.
 *
 * Trước đây nút này chạy `goKhoiLark` cho chiếc đã gửi, mà hàm đó CHỈ xoá dòng
 * bên Lark rồi trả chiếc về trạng thái chờ gửi — dòng vẫn nằm nguyên trong
 * danh sách. Người dùng phải bấm hai lần mới xoá xong mà không có gì nói cho
 * biết (CEO 25/09).
 *
 * THỨ TỰ BẮT BUỘC: Lark trước, bên mình sau. Xoá dòng của mình trước mà Lark
 * hỏng thì bảng Lark còn dòng trong khi bên mình đã mất dấu `lark_record_id` —
 * không còn gì để tìm ra mà dọn. Lark hỏng thì DỪNG HẲN, giữ nguyên hiện
 * trạng, để người dùng thử lại.
 */
export async function xoaChiec(itemId: string): Promise<{ ok: boolean; loi?: string }> {
  await requirePerm('manage_qc');
  const [c] = await db.select({ larkRecordId: schema.goodsReceiptItems.larkRecordId })
    .from(schema.goodsReceiptItems)
    .where(eq(schema.goodsReceiptItems.id, itemId))
    .limit(1);
  if (!c) return { ok: false, loi: 'Không tìm thấy chiếc hàng.' };

  if (c.larkRecordId) {
    const r = await goKhoiLark(itemId);
    if (!r.ok) return r;
  }
  return goChiecNhanNham(itemId);
}

export async function huyNhapChuaGui(): Promise<{ ok: boolean; soXoa: number; loi?: string }> {
  await requirePerm('manage_qc');
  try {
    const xoa = await db.delete(schema.goodsReceiptItems)
      .where(and(
        eq(schema.goodsReceiptItems.qcResult, 'pending'),
        isNull(schema.goodsReceiptItems.larkRecordId),
        // CHỈ hàng nhận HÔM NAY. Từ 25/09 màn này còn hiện nhóm "tồn từ hôm
        // trước"; không có mốc ngày thì một cú "Huỷ nhập" của phiên hôm nay
        // xoá luôn việc dang dở của hôm qua mà không ai kịp thấy.
        sql`${sql.raw(sqlGioKinhDoanh('created_at'))}::date = (now() AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::date`,
      ))
      .returning({ id: schema.goodsReceiptItems.id });
    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true, soXoa: xoa.length };
  } catch (e) {
    console.error('[kho-nhan] huyNhapChuaGui lỗi:', e);
    return { ok: false, soXoa: 0, loi: 'Huỷ nhập thất bại, thử lại.' };
  }
}

/**
 * Còn nhận được bao nhiêu chiếc cho (PO, SKU) — ĐỌC LẠI ngay trước khi ghi.
 *
 * Cộng hai nguồn đúng như luật CEO chốt: dòng đội kho nhập tay trên bảng Lark,
 * và chiếc đã nhận trên SMS. Đồng thời áp luật "ĐƠN đã đủ thì chặn cả đơn" —
 * không chỉ xét riêng SKU này.
 */
async function conNhanDuocPo(orderNumber: string, sku: string): Promise<number> {
  const moiDong = await db.select({
    recordId: schema.larkPoDong.recordId, orderNumber: schema.larkPoDong.orderNumber,
    sku: schema.larkPoDong.sku, soLuong: schema.larkPoDong.soLuong, baoDon: schema.larkPoDong.baoDon,
  }).from(schema.larkPoDong).where(eq(schema.larkPoDong.orderNumber, orderNumber));

  const tran = orderNumber.replace(/^#/, '');
  const lark = await db.execute<{ sku: string; n: number }>(sql`
    SELECT sku, count(*)::int AS n FROM lark_wh_inventory
    WHERE regexp_replace(coalesce(order_number,''), '^#', '') = ${tran} AND sku IS NOT NULL GROUP BY 1`);
  const sms = await db.execute<{ sku: string; n: number }>(sql`
    SELECT sku, count(*)::int AS n FROM goods_receipt_items
    WHERE regexp_replace(coalesce(po_order_number,''), '^#', '') = ${tran} AND sku IS NOT NULL GROUP BY 1`);
  const daNhan = new Map<string, number>();
  for (const r of [...lark.rows, ...sms.rows]) {
    const k = khoa(orderNumber, r.sku);
    daNhan.set(k, (daNhan.get(k) ?? 0) + Number(r.n));
  }
  return monPoConNhan(moiDong, daNhan).find((m) => m.sku === sku.trim())?.con ?? 0;
}
