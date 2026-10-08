/**
 * THUẦN: dòng món trên bảng Lark nào còn nhận được (CEO 08/10/2026). Không I/O.
 *
 * Dùng cho kênh KHÔNG-Shopify — đơn Trung Quốc `#MTB`/`#MXHS`. Xem `pham-vi.ts` vì sao chỉ hai
 * kênh đó.
 *
 * MỘT DÒNG MÓN = MỘT CHIẾC. Đo 08/10/2026: 211 cặp (đơn × SKU) trên 211 dòng MTB/MXHS, không
 * cặp nào hơn một dòng; và 36/40 đơn MBLVD mới nhất có số dòng món khớp đúng tổng số lượng
 * (`#MBLVD30729`: 2 dòng món, số lượng 2). Nên không có khái niệm "còn mấy chiếc" ở đây: một
 * dòng đã có chiếc gắn vào là xong, chưa có thì còn nhận được.
 *
 * Khác hẳn luật PO (`po-con-nhan.ts`), nơi một dòng mang `Lineitem quantity` và phải gom theo
 * đơn. Viết chung một hàm cho hai luật khác nhau là chỗ sớm muộn cũng lẫn.
 */

export interface DongMonLark {
  /** Khoá chính `lark_mon_don.dinh_danh`. */
  dinhDanh: string;
  orderNumber: string;
  sku: string | null;
  /** Cột `store` trên bảng món — `#MTB`, `#MXHS`, `#MBLVD`… */
  store: string | null;
  /** Đơn/món đã đánh huỷ trên Lark. */
  huy: boolean;
  /** Có `record_id` để nối `Import (select order)` hay không. */
  coRecordId: boolean;
}

/**
 * THUẦN: dòng này còn nhận được không. Trả LÝ DO khi không, để chỗ gọi nói được vì sao thay vì
 * im lặng bỏ qua.
 *
 * @param daNhan số chiếc đã nhận gắn vào đúng `dinh_danh` này.
 * @param duocPhepStore kênh này có trong danh sách cho phép không (xem `nhanQuaMonLark`).
 */
export function monConNhanDuoc(
  d: DongMonLark, daNhan: number, duocPhepStore: boolean,
): { ok: true } | { ok: false; lyDo: string } {
  if (!duocPhepStore) return { ok: false, lyDo: 'kênh này chưa được mở để nhận hàng' };
  /* 77 dòng MTB/MXHS đang mang cờ huỷ (đo 08/10). Nhận hàng của đơn đã huỷ là đưa vào kho một
   * chiếc không có đơn nào đòi, và không có đường nào rút ra. */
  if (d.huy) return { ok: false, lyDo: 'đơn/món này đã huỷ trên Lark' };
  if (!d.sku || d.sku.trim() === '') return { ok: false, lyDo: 'dòng món thiếu SKU' };
  if (!d.coRecordId) return { ok: false, lyDo: 'dòng món chưa có record_id trên Lark' };
  if (daNhan >= 1) return { ok: false, lyDo: 'món này đã nhận rồi' };
  return { ok: true };
}
