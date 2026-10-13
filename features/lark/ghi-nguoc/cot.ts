/**
 * Tên cột bảng Lark LOG-Export mà SMS ghi ngược (spec 2026-09-19 §5). Đổi tên cột bên Lark là
 * hỏng — nên để MỘT chỗ. Hai ô chọn kèm danh sách giá trị hợp lệ kiểm 19/09/2026 qua API fields:
 * ghi chuỗi lạ vào ô chọn là Lark đẻ lựa chọn mới (bài học cột Couriers, D-045).
 */
export const COT = {
  logUniqueCode: 'Log Unique code',
  category: 'LOG-EP-Dispatch Category (Final)',
  status: 'LOG-EP-Dispatch Status',
  ngayGiaoThucTe: 'Ngày giao thực tế',
  ngayGiaoDuKien: 'Ngày giao dự kiến',
  /** Khớp đúng tên field Lark mà `parse-pack-row.ts` đang đọc (`fields['Tracking Number']`) —
   *  dùng khoá có sẵn thay vì bịa tên mới, tránh hai chỗ trỏ vào hai cột khác nhau. */
  trackingNumber: 'Tracking Number',
} as const;

export const LUA_CHON_CATEGORY: readonly string[] = [
  'Shipment Created', 'In Transit', 'Shipping Exceptions', 'Delivered', 'Lost by Carrier', 'Shipping Failed',
];
export const LUA_CHON_STATUS: readonly string[] = [
  'Ready for Carrier', 'On Delivery', 'Delayed', 'Customs Clearance', 'Forward to Third-party',
  'Hold by Unavoidable Reason', 'Delivery Attempt Failed', 'Additional Information Required', 'Held for Pickup',
  'Delivery Completed', 'Return-Processing', 'Package Lost', 'On Hold', 'Cancel at Cnee Country',
];

/** Khoá `shipment_charges` → cột tiền trên Lark (VND). `non_conveyable` vẫn không có cột;
 *  `address_correction` thì ĐÃ CÓ từ 13/10/2026 (ô `Phí sửa địa chỉ`, xem dưới) nhưng đường
 *  HOÁ ĐƠN chưa nối — `chargeTu` ở `ghi-nguoc.ts` chưa SELECT cột đó.
 *
 *  Ô `Giá chiết khấu` KHÔNG BAO GIỜ được ghi — đó là **Formula của Lark** (đọc API fields
 *  13/10/2026: `fldlEbi91K` type=20), nó tự tính `Tổng − base − fuel − ký nhận − …`. Số chiết
 *  khấu đi vào ô RIÊNG `Chiết khấu || API` (xem dưới); hai ô khác nhau, đừng lẫn.
 *
 *  `as const` chứ KHÔNG `Record<string, string>`: kiểu rộng cho phép tra một khoá không tồn tại
 *  mà vẫn qua được type-check, nên đổi tên một khoá ở đây sẽ gửi `patch["undefined"]` lên Lark
 *  (tên cột rỗng ⇒ PUT là all-or-nothing nên chặn cả bản vá). Khoá hẹp bắt lỗi đó lúc biên dịch. */
export const COT_CHI_PHI = {
  totalAmount: 'INS | Chi phí Tổng (đ)',
  /** Giá **GỐC**, CHƯA trừ chiết khấu (CEO chốt 13/10/2026, D-245 bản 2). Vòng sửa trước đặt ô
   *  này là giá net và đã bị xoá: ô `Giá chiết khấu` là Formula của Lark tính
   *  `Tổng − base − fuel − ký nhận − …`, nên bảng vốn chờ base GỐC — đưa base net vào là làm
   *  công thức đó ra một số chiết khấu vô nghĩa. Đo 4.591 bản ghi: 2.878 dòng gõ base > tổng
   *  (gốc — ĐÚNG) vs 1.251 dòng gõ net. Số chiết khấu đi vào `discountApi` dưới đây. */
  base: 'Mức giá cơ sở',
  /**
   * ⚠️ TÊN CỘT CÓ **HAI** DẤU GẠCH ĐỨNG, mỗi bên một khoảng trắng: `Chiết khấu || API`.
   * Đọc nguyên văn từ API fields 13/10/2026 (`fldY1E45DQ`, type=2 — ô số, GHI ĐƯỢC). Dễ bị ai
   * dọn bảng sửa thành một gạch (`Chiết khấu | API`, cho giống `INS | Chi phí Tổng (đ)`) — mà
   * Lark ghi theo TÊN cột và PUT là all-or-nothing, nên lệch một ký tự là **cả bản vá bị từ
   * chối**, kể cả những ô chẳng liên quan. Lỗi lúc đó hiện ra ở `ghi-gia-uoc-tinh-len-lark.ts`
   * kèm `code=`/`msg=` của Lark và danh sách cột đã gửi — đó là chỗ bắt đầu truy.
   *
   * Khoá CỐ Ý không trùng tên cột nào của `shipment_charges`: vòng lặp
   * `Object.entries(COT_CHI_PHI)` trong `dung-patch.ts` tra `khoan[khoa]` nên khoá lạ ra
   * `undefined` ⇒ đường ghi từ HOÁ ĐƠN bỏ qua ô này. Đúng ý muốn — ô tên "|| API" dành cho số
   * API báo giá trả về; chiết khấu hoá đơn là số khác (và lưu dấu ÂM, đo 2.898/2.898 dòng).
   */
  discountApi: 'Chiết khấu || API',
  fuel: 'Phụ phí nhiên liệu',
  remote: 'Phụ phí vùng sâu xa',
  demand: 'EES / Theo nhu cầu',
  directSignature: 'Phí kí nhận trực tiếp',
  vat: 'VAT/Thuế phí khác',
  /** DHL GoGreen Plus (SAF). CẢ HAI đường ghi đều điền ô này: đường hoá đơn lấy
   *  `shipment_charges.gogreen`, đường giá ước tính lấy `QuoteBreakdown.perStep` (3/3 dòng
   *  `per_step_fixed` đều là GoGreen, xem `gia-uoc-tinh.ts`). */
  gogreen: 'GoGreen Plus-Basic',
  /** CHỈ đường HOÁ ĐƠN điền ô này (`shipment_charges.elevated_risk` — số thật, tách sẵn).
   *  Đường GIÁ ƯỚC TÍNH cố ý KHÔNG ghi: engine chỉ có số GỘP `countryFixed` (Elevated Risk +
   *  Restricted Destination + phí nhập US/EU + phí xử lý quốc tế UPS + hải quan đầu xuất
   *  Aramex; 12 dòng `country_fixed`, 0 dòng có `service_key` ⇒ không tách được), và số gộp đó
   *  ĐÃ vào ô `Phí xử lý hàng nhập` — ghi tiếp vào đây là cộng 918.000đ hai lần.
   *
   *  Ô MỚI `Phí xử lý quốc tế` (xem dưới) KHÔNG đổi điều này: nó chỉ nhận mã `573` của UPS
   *  Rating API — số đã TÁCH SẴN theo mã. Phần "phí xử lý quốc tế UPS" nằm trong `countryFixed`
   *  của engine vẫn không tách được (0/12 dòng `country_fixed` có `service_key`) nên vẫn ở lại
   *  ô `Phí xử lý hàng nhập`; lấy nó sang ô mới là lại cộng hai lần, lần này ở ô khác. */
  elevatedRisk: 'Phí rủi ro gia tăng',
  importHandling: 'Phí xử lý hàng nhập',
  /**
   * ⚠️ TÊN CỘT LÀ TIẾNG VIỆT CÓ DẤU: `Phí xử lý quốc tế` (`fldBxLDfUJ`, type=2 — ô số, ghi
   * được). Đọc nguyên văn từ API fields **14/10/2026**. Ô này **vừa bị CEO đổi tên**: ngày
   * 13/10 nó tên `Phí xử lý International`, nay là `Phí xử lý quốc tế` — cùng một `field_id`,
   * không phải cột mới. Ai còn giữ tên cũ trong tay thì bản vá bị Lark từ chối TOÀN BỘ.
   *
   * Byte của phần dễ lệch (NFC, dựng sẵn — KHÔNG phải chữ + dấu rời):
   *   `ử` = U+1EED (e1 bb ad) · `ý` = U+00FD (c3 bd) · `ố` = U+1ED1 (e1 bb 91) · `ế` = U+1EBF
   *   (e1 ba bf) · `í` = U+00ED (c3 ad). Cả tên: 17 ký tự · 25 byte UTF-8.
   * Gõ lại bằng bộ gõ khác có thể ra dạng TỔ HỢP (`y` + U+0301) — nhìn giống y hệt trên màn
   * hình nhưng Lark coi là cột KHÁC ⇒ PUT all-or-nothing từ chối cả bản vá. Test khoá tên cột
   * ở `patch-gia-uoc-tinh.test.ts` so cả dạng NFC để bắt ca này.
   *
   * KHÁC HẲN `importHandling` ('Phí xử lý hàng nhập') dù đọc na ná. Đây là khoản
   * International Processing Fee của UPS (`FIP` trên hoá đơn, mã `573` của Rating API,
   * 58.750đ/lô) — trước 14/10/2026 nó chảy vào ô `Phí xử lý hàng nhập` CHUNG với phí chuyển
   * thuế `F/D` của UPS; luật "chỉ điền ô trống" khiến một trong hai khoản **mất âm thầm**
   * (đo trên kiện `1Z2050VDD919649050`). Tách ô là để hết chuyện đó.
   *
   * Khoá đặt theo tên cột `carrier_bill_lines.international_processing` (đường hoá đơn) chứ
   * không theo `shipment_charges` — bảng đó KHÔNG có cột này, nên vòng
   * `Object.entries(COT_CHI_PHI)` của `dung-patch.ts` tra ra `undefined` ⇒ đường ghi từ HOÁ
   * ĐƠN bỏ qua ô này. Hiện chỉ đường GIÁ ƯỚC TÍNH điền (UPS mã `573`).
   */
  internationalProcessing: 'Phí xử lý quốc tế',
  /**
   * Additional Handling (UPS `190`, hoá đơn `ADH`) — CEO xác nhận 14/10/2026: cột cũ tên
   * `Phí xử lý hàng hóa` nay là **`Phụ phí xử lý hàng`** (`fldD7GpfWz`, type=2). Lại là ĐỔI
   * TÊN cùng `field_id`, không phải cột mới; tên cũ đã chết.
   *
   * Byte: `ụ` = U+1EE5 (e1 bb a5) · `í` = U+00ED · `ử` = U+1EED · `ý` = U+00FD · `à` = U+00E0
   * (c3 a0). 18 ký tự · 25 byte UTF-8, NFC.
   *
   * ⚠️ **HÔM NAY Ô NÀY SẼ LUÔN TRỐNG Ở LUỒNG ƯỚC TÍNH — ĐÓ KHÔNG PHẢI BUG.** Đo 13/10/2026:
   * không nguồn báo giá nào được quan sát thấy trả khoản này. FedEx Rate API: đếm trên 1.310
   * phản hồi THÔ còn lưu trữ → `ADDITIONAL_HANDLING` **0 lần**, `"Additional Handling"` 0 lần.
   * UPS Rating API: không có phản hồi nào được lưu để đếm, mà hoá đơn UPS **0/37 dòng** có
   * khoản này ⇒ CHƯA CÓ BẰNG CHỨNG Rating API trả về. Engine bảng giá có 1 dòng Additional
   * Handling của UPS 423.940đ nhưng là `apply_mode='when_billed'` ⇒ nằm trong số GỘP
   * `addonReference`, KHÔNG vào `carrierCost` và không tách ra được.
   * Vẫn map vì nguồn có thể trả trong tương lai (và vì mã `190` đã có tên sẵn ở
   * `lib/ups/rate.ts`) — nhưng ai thấy ô trống thì đừng đi tìm lỗi ở đây, hãy đo lại xem
   * nguồn báo giá đã trả khoản này chưa.
   *
   * Khoá theo `carrier_bill_lines.additional_handling`; `shipment_charges` KHÔNG có cột này
   * (chỉ có `non_conveyable`, khác bản chất) ⇒ đường HOÁ ĐƠN cũng bỏ qua ô này.
   */
  additionalHandling: 'Phụ phí xử lý hàng',
  /**
   * Address Correction — cột cũ tên `Phí Address Correction` nay là **`Phí sửa địa chỉ`**
   * (`fldx5cOZJu`, type=2). Đổi tên cùng `field_id` (đọc 14/10/2026); tên mới khớp đúng nhãn
   * mà cả hệ đang dùng (`price-structure.ts`, `bang-ke-khoan-phi.ts`, `giai-trinh-am-cuoc.ts`).
   *
   * Byte: `í` = U+00ED · `ử` = U+1EED · `đ` = U+0111 (c4 91) · `ị` = U+1ECB (e1 bb 8b) ·
   * `ỉ` = U+1EC9 (e1 bb 89). 15 ký tự · 23 byte UTF-8, NFC.
   *
   * ⚠️ **HÔM NAY Ô NÀY SẼ LUÔN TRỐNG Ở LUỒNG ƯỚC TÍNH — ĐÓ KHÔNG PHẢI BUG.** Bản chất khoản
   * này là phát sinh SAU khi hãng giao hụt vì địa chỉ sai, nên báo giá lúc tạo vận đơn không
   * thể biết. Số đo 13/10/2026: `ADDRESS_CORRECTION` xuất hiện **0/1.310** phản hồi FedEx Rate
   * API còn lưu trữ; phía engine, dòng sai địa chỉ của Aramex (15$) và UPS (300.800đ) đều là
   * `when_billed` ⇒ gộp trong `addonReference`, ngoài `carrierCost`. Vẫn map để ngày nào nguồn
   * trả thì ô tự đúng.
   *
   * Khoá `addressCorrection` TRÙNG tên cột `shipment_charges.address_correction` (63/6.027
   * dòng có số thật) — CỐ Ý: ngày ai thêm trường đó vào `ChargeGhiNguoc` + câu SELECT của
   * `chargeTu` (`ghi-nguoc.ts`) thì đường HOÁ ĐƠN tự điền ô này, không phải sửa thêm chỗ nào.
   * Tới hôm nay `chargeTu` CHƯA select cột đó ⇒ `khoan['addressCorrection']` là `undefined` ⇒
   * đường hoá đơn vẫn bỏ qua. Đây là việc còn để dở, không phải thiết kế.
   */
  addressCorrection: 'Phí sửa địa chỉ',
  residential: 'Phụ Phí Residential',
} as const;

/** Khoá hợp lệ của `COT_CHI_PHI` — dùng để bảng map khoản→cột của nơi khác được type-check. */
export type KhoaCotChiPhi = keyof typeof COT_CHI_PHI;
