/**
 * THUẦN: dựng nội dung ghi sang bảng Lark "WH - Inventory (Nhập, QC, Pack)".
 *
 * MỌI giá trị cột chọn ở đây phải khớp NGUYÊN VĂN tên lựa chọn trên Lark. Sai
 * một ký tự là Lark ĐẺ RA LỰA CHỌN MỚI trên bảng vận hành, không phải báo lỗi
 * (D-045). Đọc thật ngày 24/09 và ghim vào đây, có test canh.
 */

/** ĐÚNG 8 ký tự — có dấu cách cả hai đầu. Đọc từ Lark 24/09, KHÔNG được trim. */
export const WH_ACTION_CHO_QC = ' Chờ QC ';

/** Sau khi QC đạt nhưng chưa đi đơn (CEO 24/09). 17 ký tự, không dấu cách thừa. */
export const WH_ACTION_TAM_NHAP = 'Tạm nhập (đi đơn)';

/** Hàng nhập từ brand để đi đơn (CEO 24/09). */
export const INVENTORY_TYPE_RETAIL = 'Retail';

export const COT_NGAY_IMPORT = 'Ngày Import - tiếp nhận đồ tại kho';
export const COT_INVENTORY_TYPE = 'Import - Inventory type';
export const COT_SELECT_ORDER = 'Import (select order)';
export const COT_WH_ACTION = 'WH - Action';

/**
 * Nội dung tạo MỘT dòng lúc kho bấm "Gửi".
 *
 * `Import (select order)` là cột LIÊN KẾT tới bảng "CX - MER - Product line
 * Management", nhận MẢNG record_id. Giá trị đúng chính là
 * `lark_mon_don.record_id` — đã đối chiếu thật 24/09: record_id ở hai nơi trùng
 * khít. Các cột còn lại (SKU, mã đơn, brand…) Lark TỰ LOOKUP từ liên kết này,
 * nên không được điền tay.
 */
export function dungPayloadNhan(d: { larkMonRecordId: string; nhanLuc: Date }): Record<string, unknown> {
  return {
    [COT_NGAY_IMPORT]: d.nhanLuc.getTime(),
    [COT_INVENTORY_TYPE]: INVENTORY_TYPE_RETAIL,
    [COT_SELECT_ORDER]: [d.larkMonRecordId],
    [COT_WH_ACTION]: WH_ACTION_CHO_QC,
  };
}

/** Nội dung sửa sau khi QC ĐẠT — chỉ đổi đúng một cột, không đụng gì khác. */
export function dungPayloadSauQcDat(): Record<string, unknown> {
  return { [COT_WH_ACTION]: WH_ACTION_TAM_NHAP };
}
