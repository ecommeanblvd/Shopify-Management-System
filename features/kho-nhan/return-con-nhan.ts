/**
 * THUẦN: dòng đồ return nào kho còn nhận được (CEO 08/10/2026). Không I/O.
 *
 * CEO chốt cửa vào sau khi đo 666 dòng bảng `LOG - Import`: chưa có dòng WH - Inventory nào
 * khớp, VÀ trạng thái đường về của LOG cho thấy hàng đã tới kho hoặc đang được xử lý trả.
 *
 * Vì sao không mở theo mỗi "chưa có dòng WH": tập đó có 422 dòng, trong đó **324 dòng trống
 * luôn `LOG-IP-Return Status`** — dòng cũ từ trước khi có cột trạng thái. Mở ra là kho gõ một
 * mã đơn rồi thấy món từ năm ngoái, và nhận nhầm thì không có đường nào biết.
 *
 * Vì sao `Return Status` KHÔNG phải cửa: đó là trạng thái duyệt hoàn tiền của CX. Trong 244
 * dòng kho đã nhận có 135 `Refunded` và cả 1 `Rejected` — hàng bị từ chối hoàn tiền vẫn về kho
 * thật. Lọc theo nó là bỏ sót hàng có thật. (Lưu ý cột đó còn có HAI lựa chọn trùng nghĩa khác
 * hoa/thường: `Approved` 384 dòng và `APPROVED` 89 dòng — bất cứ luật nào khớp một trong hai là
 * bỏ sót 89 dòng, im lặng.)
 */

/**
 * Trạng thái đường về được coi là "hàng ĐANG TRÊN ĐƯỜNG VỀ, chưa tới kho".
 *
 * Số đo trong 422 dòng chưa có hồ sơ WH: `Return-Processing` 36, `Pakago Received` 6 — tổng 42.
 *
 * `Warehouse Received` CỐ Ý ĐỨNG NGOÀI (CEO 08/10/2026: "kiểm lại xem danh sách này có đúng là
 * hàng đang đợi return về không chứ không phải hàng đã return về và cất vào kho rồi").
 *
 * Bản đầu của hàm này CÓ nó, với lý lẽ "40 dòng mang trạng thái đó mà bên WH không có dòng nào
 * khớp, nên đó là tập cần nhận nhất". Lý lẽ đó SAI, và chính số liệu đã có bác bỏ: toàn bộ 244
 * dòng ĐÃ có hồ sơ WH đều mang `Warehouse Received` (243/244). Nghĩa là đó là trạng thái LOG đặt
 * KHI KHO ĐÃ NHẬN, không phải khi hàng đang đi. Nên 40 dòng kia gần như chắc là hàng ĐÃ VỀ RỒI,
 * chỉ thiếu hồ sơ — và bày chúng ở ô tìm là để kho bấm nhận một món đang nằm trên kệ, sinh ra
 * một chiếc ẢO thứ hai trong tồn.
 *
 * Càng chắc hơn vì lookup `WH - Tiếp nhận & QC` chỉ soi 4 loại nhập; hàng quay về ghi dưới
 * `Tồn kho (Cancel/ Sai địa chỉ)` (54 dòng, ngoài 4 loại đó) thì lookup KHÔNG thấy, trong khi
 * hàng đã nằm trong kho thật.
 *
 * 40 dòng đó là việc ĐỐI SOÁT, không phải việc nhận hàng: cần người xác định hàng đang trên kệ
 * (thì ghi bù hồ sơ) hay mất thật. Lẫn hai việc vào một ô tìm là chỗ sinh tồn ảo.
 *
 * CỐ Ý ĐỨNG NGOÀI nốt: `A31 - Held by Customs` (7), `H11 Form Processing` (3),
 * `Waiting for Payment` (4) — hàng còn ở hải quan; sẽ hiện khi LOG đổi trạng thái.
 * `Package Lost` (2) — hàng mất. 324 dòng trống trạng thái — dòng cũ từ trước khi có cột đó.
 */
export const TRANG_THAI_CHO_NHAN: ReadonlySet<string> = new Set([
  'Return-Processing',
  'Pakago Received',
]);

export interface DongReturn {
  recordId: string;
  /** Store suy từ `shopify_orders` theo mã đơn — tra được 461/461 dòng (đo 09/10/2026). */
  shopDomain: string | null;
  orderNumber: string | null;
  sku: string | null;
  soLuong: number;
  /** Lookup `WH - Tiếp nhận & QC` trên Lark: có giá trị = đội kho đã có dòng WH khớp. */
  whTiepNhanQc: string | null;
  logStatus: string | null;
}

/**
 * THUẦN: dòng này còn nhận được không. Trả LÝ DO khi không, để chỗ gọi nói được vì sao thay vì
 * im lặng bỏ qua.
 *
 * @param daNhanSms số chiếc SMS đã nhận gắn vào đúng `record_id` này.
 */
export function returnConNhanDuoc(
  d: DongReturn, daNhanSms: number, duocPhepStore: boolean,
): { ok: true; con: number } | { ok: false; lyDo: string } {
  /* Store trước mọi thứ khác: đồ return của store không đi vào kho WH thì mọi điều kiện còn lại
   * đều vô nghĩa. Bảo 09/10/2026 về Tinh: "về không nhập vào kho của WH, nhận và auto gửi về
   * GA" — bày ra ô tìm là mời kho nhận thứ họ sẽ không bao giờ thấy. Xem `STORE_RETURN_VE_KHO`. */
  if (!duocPhepStore) {
    return { ok: false, lyDo: `đồ return của store này không vào kho WH (${d.shopDomain ?? 'không tra được store'})` };
  }
  if (!d.orderNumber) return { ok: false, lyDo: 'dòng return thiếu mã đơn' };
  if (!d.sku || d.sku.trim() === '') return { ok: false, lyDo: 'dòng return thiếu SKU' };
  /* Đội kho đã có dòng WH khớp rồi. Nhận thêm là hai dòng cho một món trả về, mà bốn cột lookup
   * bên `LOG - Import` thì gộp cả hai nên số hiện ra không còn nói được dòng nào là dòng nào. */
  if (d.whTiepNhanQc != null && d.whTiepNhanQc.trim() !== '') {
    return { ok: false, lyDo: 'đội kho đã có dòng WH cho món này' };
  }
  if (!d.logStatus || !TRANG_THAI_CHO_NHAN.has(d.logStatus)) {
    return { ok: false, lyDo: `trạng thái đường về chưa tới kho (${d.logStatus ?? 'trống'})` };
  }
  const con = d.soLuong - daNhanSms;
  if (con <= 0) return { ok: false, lyDo: 'SMS đã nhận đủ số lượng của dòng này' };
  return { ok: true, con };
}
