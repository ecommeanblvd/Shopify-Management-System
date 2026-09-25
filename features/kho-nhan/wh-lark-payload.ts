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
export const COT_WAREHOUSE = 'Warehouse';

/**
 * Hai cột TEXT nhập tay nuôi công thức `Định danh`.
 *
 * `Định danh` là cột công thức (type 20), nối bốn cột bằng `-` và bỏ cột rỗng:
 *   ARRAYJOIN(LIST(Order Number final, Lineitem SKU final,
 *                  Import - Inventory type, WH - Unique code).FILTER(≠""), "-")
 *
 * Trông thì tưởng nó tự sinh từ `Import (select order)` — KHÔNG. Hai cột
 * `… (look up)` mới tự sinh từ liên kết; hai cột `… final` là TEXT, Lark không
 * tự chép sang. Bỏ trống thì `Định danh` ra cụt ngủn kiểu `Retail-WH-34061`
 * thay vì `#MBLVD30542-TomFried-TS2644-S-KPTT-PLA-Retail-WH-34061` — đã mắc
 * đúng thế ở record thử 24/09.
 *
 * (Bảng vận hành cần hai cột này vì dòng nhập theo PO không có liên kết đơn:
 * cột look up rỗng, chỉ `final` giữ được mã. Nên chúng là cột tay, không phải
 * lookup.)
 */
/** AutoNumber Lark sinh khi tạo dòng — chỉ ĐỌC, không bao giờ ghi. */
export const COT_UNIQUE_CODE = 'WH - Unique code (k xóa)';
export const COT_ORDER_FINAL = 'Order Number final';
export const COT_SKU_FINAL = 'Lineitem SKU final';

/**
 * Kho bên mình → tên lựa chọn NGUYÊN VĂN trên Lark.
 *
 * Thiếu cột này thì record vẫn tạo được nhưng KHÔNG view nào hiện nó: mọi view
 * của bảng đều lọc theo `Warehouse` (view "HN | Nhập - QC & Stock" lọc đúng
 * "HN | GVM"). Record vô hình là record không ai dùng được — đã mắc 24/09.
 */
export const KHO_SANG_LARK: Record<string, string> = {
  GVM: 'HN | GVM',
  AP: 'SG | AP',
  DM: 'SG | DM',
};

/**
 * Nội dung tạo MỘT dòng lúc kho bấm "Gửi".
 *
 * `Import (select order)` là cột LIÊN KẾT tới bảng "CX - MER - Product line
 * Management", nhận MẢNG record_id. Giá trị đúng chính là
 * `lark_mon_don.record_id` — đã đối chiếu thật 24/09: record_id ở hai nơi trùng
 * khít. Brand, giá, ngày đặt… Lark TỰ LOOKUP từ liên kết này nên không điền tay;
 * riêng `Order Number final` / `Lineitem SKU final` thì phải điền (xem trên).
 *
 * `maDon` và `sku` lấy NGUYÊN VĂN từ `lark_mon_don` — cùng nguồn mà cột look up
 * đọc — để hai cột `final` và hai cột `look up` luôn khớp nhau từng ký tự.
 */
export function dungPayloadNhan(
  d: { larkMonRecordId: string; maDon: string; sku: string; nhanLuc: Date; kho: string },
): Record<string, unknown> {
  const kho = KHO_SANG_LARK[d.kho];
  if (!kho) throw new Error(`Kho "${d.kho}" chưa có tên tương ứng trên Lark.`);
  return {
    [COT_NGAY_IMPORT]: d.nhanLuc.getTime(),
    [COT_INVENTORY_TYPE]: INVENTORY_TYPE_RETAIL,
    [COT_SELECT_ORDER]: [d.larkMonRecordId],
    [COT_ORDER_FINAL]: d.maDon,
    [COT_SKU_FINAL]: d.sku,
    [COT_WH_ACTION]: WH_ACTION_CHO_QC,
    [COT_WAREHOUSE]: kho,
  };
}

/** Nội dung sửa sau khi QC ĐẠT — chỉ đổi đúng một cột, không đụng gì khác. */
export function dungPayloadSauQcDat(): Record<string, unknown> {
  return { [COT_WH_ACTION]: WH_ACTION_TAM_NHAP };
}
