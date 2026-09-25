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
export const COT_QC_CHECK = 'QC Check';

/**
 * Tên lựa chọn NGUYÊN VĂN của cột `QC Check` (đọc 25/09).
 *
 * Cột này đội kho điền 100% (1.390/1.390 dòng từ 01/08), và dùng để ra con số
 * QC Pass 1.258 / QC Failed 131. Hệ thống mình trước đây KHÔNG ghi nó — mọi
 * dòng do mình tạo sẽ để trống và làm thủng chính báo cáo đó.
 */
export const QC_CHECK_CHUA = 'Tiếp nhận - chưa QC';
export const QC_CHECK_PASS = 'QC Pass';
export const QC_CHECK_FAILED = 'QC Failed';

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
 * BA CỘT KHÔNG ĐƯỢC GHI: `Store final`, `Lineitem Name`,
 * `Quantity tiếp nhận trước QC`.
 *
 * Bên Lark tự điền chúng (đội WH xác nhận 25/09, đo lại đúng: dòng từ 01/09 có
 * Store final 97,0% · Lineitem Name 99,8% · Quantity 99,2% — trong khi hệ thống
 * này chưa từng ghi cột nào trong ba).
 *
 * Và ghi vào là ghi SAI: `Lineitem Name` bên Lark là tên sản phẩm trần
 * ("Eiren Lace Maxi Dress"), còn `lark_mon_don.lineitem_name` bên mình mang cả
 * biến thể ("Eiren Lace Maxi Dress - Lapis Blue / 3XL"). Đè lên là dòng của
 * mình lệch định dạng với 9.000 dòng còn lại.
 *
 * Đã thử ghi ngày 25/09 rồi gỡ ra — giữ ghi chú này để không ai làm lại.
 */

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
 * `maDon` lấy từ `shopify_orders.shopify_order_number`, KHÔNG lấy từ
 * `lark_mon_don`: bảng mirror bên mình strip sạch dấu `#` (0/7752 dòng còn `#`)
 * nên ghi theo nó là ra "MBLVD30465" trong khi cả bảng Lark là "#MBLVD30465".
 * Số đơn Shopify giữ đúng quy ước từng store — MEAN/CICI/MIRER có `#`, TINH
 * thì không (1.320/1.340 đơn không `#`) — khớp y hệt thứ Lark đang có.
 *
 * Ba cột `Store final`, `Lineitem Name`, `Quantity tiếp nhận trước QC` KHÔNG
 * ghi ở đây — xem ghi chú phía trên.
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
    // Điền ngay từ lúc tạo: để trống là dòng của mình rơi ra ngoài mọi bộ lọc
    // theo QC Check mà đội kho đang dùng.
    [COT_QC_CHECK]: QC_CHECK_CHUA,
  };
}

/** Nội dung sửa sau khi QC ĐẠT — đổi đúng hai cột kết quả, không đụng gì khác. */
export function dungPayloadSauQcDat(): Record<string, unknown> {
  return { [COT_WH_ACTION]: WH_ACTION_TAM_NHAP, [COT_QC_CHECK]: QC_CHECK_PASS };
}

/**
 * Nội dung sửa sau khi QC KHÔNG ĐẠT.
 *
 * CHỈ đổi `QC Check`, KHÔNG đụng `WH - Action`. Cột action có lựa chọn
 * "Gửi trả Vendor (QC fail)" nhưng nó mang nghĩa ĐÃ GỬI TRẢ, mà QC hỏng chưa
 * chắc đã gửi trả ngay — đặt hộ là báo sai việc chưa làm. Để kho tự chọn.
 */
export function dungPayloadSauQcKhongDat(): Record<string, unknown> {
  return { [COT_QC_CHECK]: QC_CHECK_FAILED };
}
