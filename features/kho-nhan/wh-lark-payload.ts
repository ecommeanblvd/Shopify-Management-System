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
/** Chiếc trượt QC nằm lại kho chờ xử lý (CEO chốt 03/10/2026, theo đề nghị của Bảo). */
export const WH_ACTION_LUU_KHO = 'Lưu kho';

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
/** Ô TEXT trên Lark — nhiều dòng lỗi bên mình gộp thành một câu, xem `moTaLoiQc`. */
export const COT_LY_DO_FAIL = 'Lý do QC failed';
/** Cột ĐÍNH KÈM trên Lark cho ảnh chụp lỗi. */
export const COT_ANH_LOI_QC = 'Ảnh chụp lỗi QC fail';

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
export const COT_LINEITEM_NAME = 'Lineitem Name';
export const COT_VENDOR_FINAL = 'Vendor final';
export const COT_QTY_TRUOC_QC = 'Quantity tiếp nhận trước QC';

/**
 * `Store final` KHÔNG ghi: bên Lark đã tự có giá trị đúng trên mọi dòng hệ
 * thống tạo mà mình chưa hề đụng vào.
 */

/**
 * Bỏ dấu, bỏ mọi ký tự không phải chữ/số, hạ chữ thường.
 *
 * `đ`/`Đ` phải đổi sang `d` THỦ CÔNG trước: đó là CHỮ CÁI RIÊNG trong Unicode
 * (U+0111/U+0110), không phải `d` mang dấu, nên `NFD` không tách ra được và bước
 * lọc ký tự sẽ XOÁ MẤT nó — "Đăng Phong Designer" thành "angphongdesigner",
 * không bao giờ khớp "Dang Phong Designer". Đã đo: thêm bước này KHÔNG đẻ thêm
 * nhóm lựa chọn trùng nào (vẫn 153 dạng chuẩn hoá trên 164 lựa chọn).
 */
function chuanHoaBrand(s: string): string {
  return s.replace(/[đĐ]/g, 'd')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Tên brand bên mình → tên CHÍNH THỨC do CEO chốt (25/09), cho các cặp mà
 * chuẩn hoá không bắt được vì khác nhau ở chữ chứ không ở cách viết.
 *
 * Chỉ dùng làm bước tra tên; tên chốt vẫn phải CÓ THẬT trong danh sách lựa chọn
 * đang đọc từ Lark, nếu không thì bỏ trống như mọi trường hợp khác.
 */
const TEN_CHOT: Record<string, string> = {
  'Happy Clothings': 'Happy Clothing',
};

/**
 * THUẦN: chọn lựa chọn `Vendor final` ứng với tên brand bên mình.
 *
 * Cột này là cột CHỌN. Ghi tên lạ vào là Lark ĐẺ THÊM lựa chọn mới trên bảng
 * vận hành chứ không báo lỗi (D-045) — bảng đã mang sẵn dấu vết: "Happy
 * Clothing" và "Happy Clothings" cùng nằm trong 164 lựa chọn.
 *
 * Hai bước, theo đúng thứ tự:
 *  1. trùng khít từng ký tự → nhận;
 *  2. bỏ dấu và hoa/thường rồi vẫn chỉ khớp ĐÚNG MỘT lựa chọn → nhận lựa chọn
 *     đó. Bắt được các cặp chỉ khác cách viết: "MIRER"/"Mirer",
 *     "THÉSONG"/"THESÓNG" (dấu rơi vào chữ khác), "L'SCARLETT"/"L’SCARLETT"
 *     (dấu nháy thẳng và dấu nháy cong), "Dang Phong"/"Đăng Phong".
 *
 * Trước cả hai bước là bảng `TEN_CHOT` cho các cặp khác nhau ở CHỮ, chuẩn hoá
 * không bắt được — ví dụ "Happy Clothings" (thừa s).
 *
 * Khớp NHIỀU hơn một thì TỪ CHỐI, không bốc bừa: chính bảng Lark đang có 9
 * nhóm lựa chọn trùng nhau sau chuẩn hoá ("LASSY" và "Lassy", "O'Hara" và
 * "OHara"…). Chọn nhầm cái người ta không dùng là chẻ dữ liệu ra thêm một
 * nhánh nữa — thà để trống cho người chọn.
 */
export function chonVendorHopLe(
  vendor: string | null | undefined, luaChon: readonly string[],
): string | null {
  const tho = vendor?.trim();
  if (!tho) return null;
  const v = TEN_CHOT[tho] ?? tho;
  if (luaChon.includes(v)) return v;
  const k = chuanHoaBrand(v);
  if (!k) return null;
  const hop = luaChon.filter((o) => chuanHoaBrand(o) === k);
  return hop.length === 1 ? hop[0]! : null;
}

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
 * `lark_mon_don.record_id`.
 *
 * `maDon` lấy từ `shopify_orders.shopify_order_number`, KHÔNG lấy từ
 * `lark_mon_don`: bảng mirror bên mình strip sạch dấu `#` (0/7752 dòng còn `#`)
 * nên ghi theo nó là ra "MBLVD30465" trong khi cả bảng Lark là "#MBLVD30465".
 *
 * `tenMon` lấy từ `lark_mon_don.lineitem_name` — chính giá trị mà cột
 * `Lineitem Name (look up)` trả về. Đo 2.785 dòng từ 01/06: cột tay trùng khít
 * cột look up ở 2.439/2.441 dòng (99,9%).
 *
 * `vendor` caller đã lọc qua `chonVendorHopLe`.
 */
export function dungPayloadNhan(
  d: {
    larkMonRecordId: string; maDon: string; sku: string;
    tenMon: string | null; vendor: string | null; nhanLuc: Date; kho: string;
  },
): Record<string, unknown> {
  const kho = KHO_SANG_LARK[d.kho];
  if (!kho) throw new Error(`Kho "${d.kho}" chưa có tên tương ứng trên Lark.`);
  return {
    [COT_NGAY_IMPORT]: d.nhanLuc.getTime(),
    [COT_INVENTORY_TYPE]: INVENTORY_TYPE_RETAIL,
    [COT_SELECT_ORDER]: [d.larkMonRecordId],
    [COT_ORDER_FINAL]: d.maDon,
    [COT_SKU_FINAL]: d.sku,
    ...(d.tenMon?.trim() ? { [COT_LINEITEM_NAME]: d.tenMon.trim() } : {}),
    // Caller đã lọc qua `chonVendorHopLe` — tới đây chỉ còn tên hợp lệ hoặc null.
    ...(d.vendor ? { [COT_VENDOR_FINAL]: d.vendor } : {}),
    // Luôn 1: mô hình bên mình mỗi dòng là MỘT CHIẾC, và bảng Lark cũng vậy —
    // 2.758/2.770 dòng từ 01/06 mang giá trị 1, kể cả các nhóm nhiều chiếc
    // cùng một dòng đơn (mỗi chiếc một dòng, mỗi dòng ghi 1).
    [COT_QTY_TRUOC_QC]: 1,
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
 * Trước 03/10/2026 hàm này CHỈ gửi `QC Check`, nên ba thứ không bao giờ tới bảng vận hành: lý
 * do lỗi, ảnh chụp lỗi, và `WH - Action` vẫn đứng ở " Chờ QC ". Đội kho điền đủ bên mình (đo
 * 02/10: 7/7 dòng lỗi có ảnh) mà các bộ phận khác không thấy gì — Bảo báo đúng ba triệu chứng
 * của cùng một chỗ thiếu này.
 *
 * KHÔNG BAO GIỜ XOÁ THỨ NGƯỜI ĐÃ ĐIỀN. Vì hệ thống chưa đẩy được, đội đóng hàng đang dán tay
 * vào đúng ba cột này: 456/463 dòng QC Failed đã có lý do, 429 dòng đã có ảnh. Ghi đè là mất
 * bằng chứng của việc đã làm — đúng lỗi đã mắc với WH-2610-00042 ngày 02/10/2026. Nên hàm nhận
 * `hienTai` là nội dung ĐANG CÓ trên Lark và chỉ:
 *   - `QC Check` → ghi `QC Failed`. Đây là phán quyết của hệ thống, cột này hệ thống làm chủ.
 *   - `WH - Action` → đổi sang "Lưu kho" CHỈ KHI đang trống hoặc còn đứng ở " Chờ QC ". Kho đã
 *     chọn giá trị thật (413 dòng "Gửi trả Vendor (QC fail)") thì giữ nguyên — họ biết hàng đã
 *     đi đâu, mình không biết. CEO chốt "Lưu kho" 03/10 theo đề nghị của Bảo; KHÔNG tự đặt
 *     "Gửi trả Vendor (QC fail)" vì giá trị đó mang nghĩa ĐÃ GỬI TRẢ.
 *   - `Lý do QC failed` → NỐI THÊM phần chưa có, giữ nguyên chữ cũ. Chạy lại không sinh thêm
 *     gì (phần nào đã nằm trong ô thì bỏ qua), nên kho bổ sung lỗi sau vẫn tới được.
 *   - `Ảnh chụp lỗi QC fail` → HỢP hai tập token, không bao giờ gỡ ảnh đang có.
 *
 * `hienTai === null` là "không đọc được bản ghi": khi đó chỉ ghi `QC Check`. Ghi ba cột kia mà
 * không biết đang có gì là ghi đè mù — thiếu một lượt báo còn hơn xoá một tấm ảnh.
 */
export interface NoiDungLoiQc {
  /** Câu mô tả gộp từ các dòng lỗi — xem `moTaLoiQc`. */
  lyDo: string;
  /** `file_token` các ảnh lỗi đã tải lên Lark. */
  anh: readonly string[];
}

/**
 * Phần của `muon` chưa xuất hiện trong `cu`, nối bằng dấu phân cách của `moTaLoiQc`.
 *
 * So khớp theo TỪNG ĐOẠN (cắt bằng ` · `), không theo chuỗi con. Chuỗi con thì "Bẩn gấu áo,
 * brand đã xác nhận" của kho sẽ nuốt mất nhãn `Bẩn`, và tệ hơn: "Không xước" nuốt `Xước vải`.
 * Đoán nghĩa câu người viết là việc hàm này không làm được — thừa một nhãn thì đọc vẫn hiểu,
 * thiếu một nhãn thì mất thông tin mà không ai thấy.
 *
 * Bỏ qua HOA/THƯỜNG khi so: kho gõ "sai màu", nhãn của mình là "Sai màu" — nối vào thành
 * "sai màu · Sai màu" thì đọc như lỗi đánh máy (đo thật 03/10/2026 trên 6 dòng fail có dòng
 * Lark: 1 dòng đúng ca này).
 *
 * Nhờ so khớp theo đoạn mà hàm ỔN ĐỊNH: lượt ghi của mình để lại đúng các đoạn ấy, nên lượt sau
 * không nối thêm gì nữa.
 */
function phanChuaCo(cu: string, muon: string): string {
  const daCo = new Set(cu.split(' · ').map((x) => x.trim().toLowerCase()));
  return muon.split(' · ').map((x) => x.trim())
    .filter((x) => x && !daCo.has(x.toLowerCase())).join(' · ');
}

/** Token ảnh đang gắn trên Lark. Dạng đọc về là mảng object có `file_token`. */
function tokenDangCo(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (x as { file_token?: unknown })?.file_token)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
}

export function dungPayloadSauQcKhongDat(
  hienTai: Record<string, unknown> | null, muon: NoiDungLoiQc,
): Record<string, unknown> {
  const ra: Record<string, unknown> = { [COT_QC_CHECK]: QC_CHECK_FAILED };
  if (!hienTai) return ra;

  const action = typeof hienTai[COT_WH_ACTION] === 'string' ? (hienTai[COT_WH_ACTION] as string).trim() : '';
  if (action === '' || action === WH_ACTION_CHO_QC.trim()) ra[COT_WH_ACTION] = WH_ACTION_LUU_KHO;

  const lyDoCu = typeof hienTai[COT_LY_DO_FAIL] === 'string' ? (hienTai[COT_LY_DO_FAIL] as string).trim() : '';
  const them = phanChuaCo(lyDoCu, muon.lyDo);
  if (them) ra[COT_LY_DO_FAIL] = lyDoCu ? `${lyDoCu} · ${them}` : them;

  const anhCu = tokenDangCo(hienTai[COT_ANH_LOI_QC]);
  const anhMoi = muon.anh.filter((t) => !anhCu.includes(t));
  if (anhMoi.length > 0) ra[COT_ANH_LOI_QC] = [...anhCu, ...anhMoi].map((file_token) => ({ file_token }));

  return ra;
}
