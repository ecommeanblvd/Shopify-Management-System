/**
 * THUẦN: quyết định một chiếc hàng được gửi lên Lark theo đường ĐƠN hay đường PO, và dòng Lark
 * nào thì được phép xoá. Không I/O.
 *
 * Vì sao tách khỏi `day-wh-lark.ts`: hai quyết định này là chỗ dễ sai âm thầm nhất của cả đường
 * ghi — chọn sai đường thì dòng PO lên bảng vận hành mang loại nhập `Retail`, mà `Retail` là
 * hàng đi đơn, đọc xong không ai biết chiếc đó từ đâu về. Tách ra để test được từng luật một mà
 * không cần CSDL lẫn Lark.
 */
import { COT_SELECT_ORDER, COT_ORDER_FINAL, COT_SKU_FINAL } from './wh-lark-payload';

export interface ChiecDeGui {
  /** `shopify_orders.shopify_order_number` — null với hàng PO và hàng kênh Lark. */
  maDon: string | null;
  /** `goods_receipt_items.po_order_number` — null với hàng đi đơn. */
  poOrderNumber: string | null;
  /** `lark_mon_don.order_number` tra qua `mon_dinh_danh` — kênh không-Shopify (đơn TQ). */
  monOrderNumber: string | null;
  /** `lark_mon_don.record_id` — để nối `Import (select order)`. */
  monRecordId: string | null;
  sku: string | null;
}

export type QuyetDinhGui =
  | { ok: false; lyDo: string }
  | { ok: true; kieu: 'don'; maDon: string; sku: string }
  | { ok: true; kieu: 'po'; maDon: string; sku: string }
  /** Kênh không-Shopify. Payload giống y đường `don` — chỉ khác nguồn của mã đơn và của liên kết. */
  | { ok: true; kieu: 'mon'; maDon: string; sku: string; monRecordId: string };

/**
 * THUẦN: chiếc này đi đường nào.
 *
 * Bảo báo 09/10/2026 món PO nhận ở SMS không lên Lark. Nguyên nhân: bản cũ đòi `maDon` lấy từ
 * `shopify_orders`, mà hàng PO cố ý để `order_id` NULL (xem `ghiNhanChiecPo`) — nên mọi món PO
 * rơi vào nhánh "thiếu mã đơn hoặc SKU" và không bao giờ đi tiếp.
 *
 * VỪA CÓ mã đơn VỪA CÓ mã PO thì TỪ CHỐI, không tự chọn một bên: hai mã trên một chiếc là dữ
 * liệu tự mâu thuẫn, và đoán hộ ở đây là ghi một dòng sai nguồn lên bảng vận hành rồi không ai
 * truy lại được vì sao.
 */
export function quyetDinhGui(c: ChiecDeGui): QuyetDinhGui {
  const sku = (c.sku ?? '').trim();
  const don = (c.maDon ?? '').trim();
  const po = (c.poOrderNumber ?? '').trim();
  const mon = (c.monOrderNumber ?? '').trim();
  const monRec = (c.monRecordId ?? '').trim();
  if (sku === '') return { ok: false, lyDo: 'thiếu SKU' };
  const coMay = [don, po, mon].filter((x) => x !== '').length;
  if (coMay > 1) return { ok: false, lyDo: 'chiếc này mang nhiều nguồn cùng lúc — cần người kiểm tay' };
  if (don !== '') return { ok: true, kieu: 'don', maDon: don, sku };
  if (po !== '') return { ok: true, kieu: 'po', maDon: po, sku };
  if (mon !== '') {
    /* Thiếu `record_id` thì KHÔNG rơi về payload không liên kết: dòng kênh Lark trên bảng vận
     * hành vẫn phải nối `Import (select order)` như đơn MBLVD (183 dòng MTB/MXHS đang có đều là
     * `Retail` có liên kết). Bỏ liên kết là dòng trông y hệt dòng PO và mất đường truy về món. */
    if (monRec === '') return { ok: false, lyDo: 'món Lark chưa có record_id — không nối được liên kết đơn' };
    return { ok: true, kieu: 'mon', maDon: mon, sku, monRecordId: monRec };
  }
  return { ok: false, lyDo: 'thiếu mã đơn, mã PO và món Lark' };
}

/** Giá trị ô TEXT trên Lark: chuỗi thường, hoặc mảng đoạn chữ của ô nhiều định dạng. */
function docChu(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map((x) => (x as { text?: string })?.text ?? '').join('').trim();
  return '';
}

/** Bỏ `#` đầu mã đơn để so sánh — hai bảng không nhất quán dấu này. */
const boThang = (s: string) => s.replace(/^#/, '');

/**
 * THUẦN: HÀNG RÀO 3 của `goKhoiLark` — dòng Lark này có đúng là dòng của chiếc hàng kia không.
 *
 * Với hàng ĐI ĐƠN, hàng rào là cột liên kết `Import (select order)`: còn liên kết món thì dòng
 * đó là dòng hệ thống tạo, mất liên kết là có người đã đụng vào và KHÔNG được xoá.
 *
 * Với hàng PO thì hàng rào ấy vô nghĩa — dòng PO không bao giờ có liên kết đơn (bảng món chỉ
 * còn dòng PO tới PO21, PO đang chạy là PO52). Dùng nguyên hàng rào cũ thì mọi dòng PO đều bị
 * từ chối xoá, kho nhận nhầm một chiếc là mắc kẹt. Nên đổi sang hàng rào ĐỊNH DANH, chặt tương
 * đương: mã đơn VÀ SKU trên dòng Lark phải khớp đúng chiếc đang xoá.
 */
export function duocXoaRecord(
  fields: Record<string, unknown> | null | undefined,
  mong: { kieu: 'don' } | { kieu: 'po'; maDon: string; sku: string },
): { ok: true } | { ok: false; loi: string } {
  const f = fields ?? {};
  if (mong.kieu === 'don') {
    const lien = f[COT_SELECT_ORDER] as { record_ids?: string[] }[] | undefined;
    const coLien = Array.isArray(lien) && lien.some((x) => (x.record_ids ?? []).length > 0);
    if (!coLien) {
      return { ok: false, loi: 'Record trên Lark không còn liên kết món — KHÔNG xoá, cần người kiểm tay.' };
    }
    return { ok: true };
  }
  const donLark = boThang(docChu(f[COT_ORDER_FINAL]));
  const skuLark = docChu(f[COT_SKU_FINAL]);
  if (donLark === '' || skuLark === '') {
    return { ok: false, loi: 'Record PO trên Lark trống mã đơn hoặc SKU — KHÔNG xoá, cần người kiểm tay.' };
  }
  if (donLark !== boThang(mong.maDon.trim()) || skuLark !== mong.sku.trim()) {
    return { ok: false, loi: `Record trên Lark là "${donLark} / ${skuLark}", không phải chiếc đang xoá — KHÔNG xoá.` };
  }
  return { ok: true };
}
