# Mã vạch theo ID Shopify cho khâu nhận & kiểm hàng: quét trên máy tính và điện thoại, in tem tại kho

**Ngày:** 2026-09-23 · **Trạng thái:** thiết kế, chờ CEO soát · **Liên quan:** spec 2026-09-22 màn Nhận hàng & KCS (nền để gắn vào), `features/receiving/ma-tem.ts` (hệ mã tem đã có)

## 1. Vấn đề

Màn "Nhận & kiểm hàng" (`/f/warehouse/nhan-kcs`) đã bám đúng luồng Lark nhưng mọi thao tác vẫn là gõ tay: gõ mã đơn, đọc mắt để tìm đúng món trong đơn nhiều món, gõ cân. Kho làm hàng trăm món mỗi ngày, và đơn có hai dòng cùng mã hàng thì nhìn mắt không phân biệt được (ví dụ thật: #MBLVD29928 mua hai cái `SemiSense-TM26-D20-L-WADM-PLA`).

CEO 23/09/2026: **quản trị theo ID Shopify** (đơn / sản phẩm / biến thể) và làm thành mã vạch để quét, trên điện thoại lẫn máy tính. Làm đúng luồng Lark trước, rồi tối ưu thêm.

SMS đã có sẵn nền, spec này MỞ RỘNG chứ không làm lại:
- `features/receiving/ma-tem.ts`: mã có tiền tố, `docMaTem` từ chối chuỗi trần ("quét nhầm mã vạch SKU của brand phải ra null chứ không đoán").
- Trang in tem `/f/warehouse/receiving/tem`, màn quét `/f/warehouse/receiving/quet`.

## 2. Quyết định (CEO chốt 23/09/2026)

1. **Kho in tem dán từng món khi nhận.** Hàng vendor gửi về không mang mã của mình.
2. **Tem mang mã dòng đơn** với hàng về theo đơn (5.703 dòng `Tạm nhập (đi đơn)`), **mã biến thể** với hàng lưu kho (2.380 dòng `Lưu kho`).
3. Quét được trên máy tính (máy quét cầm tay) và điện thoại (camera).
4. Bật ghi lên Lark **từng bản ghi một** qua danh sách cho phép, không bật hàng loạt.

## 3. Hệ mã

| Tiền tố | Nghĩa | Dùng khi |
|---|---|---|
| `L:<shopifyLineId>` | một món của MỘT đơn | tem hàng về theo đơn (đã có trong `ma-tem.ts`) |
| `V:<shopifyVariantId>` | một loại hàng, không gắn đơn | tem hàng lưu kho (mới) |
| `O:<shopifyOrderId>` | cả đơn | quét để mở đơn (mới) |
| `WH-<8 số>` | mã kho tự cấp | phiếu nhập cũ, giữ nguyên |

**Luật chọn mã cho một món** (thuần, có test): có mã dòng đơn → `L:`; không có nhưng có mã biến thể → `V:`; không có cả hai → `WH-` do kho cấp. **Không món nào bị bỏ lại không tem.**

**Không nhận chuỗi trần** — giữ nguyên nguyên tắc của `docMaTem`.

## 4. Dữ liệu

Đo 23/09/2026: nối món Lark sang dòng đơn Shopify theo (mã đơn, mã hàng) được **6.253/7.713 = 81 %**. Phần còn lại là đơn cũ đã xoá dòng hoặc mã hàng đổi sau khi đặt. Gốc rễ: `shopify_order_lines` **không lưu mã biến thể**, đang phải suy từ mã hàng — mà 120.817 biến thể có 119.987 mã hàng riêng, nên suy được nhưng không chắc chắn.

Cần thêm:
- `shopify_order_lines.shopify_variant_id` — điền khi đồng bộ đơn (Shopify trả sẵn trong line item). Sau bước này tỉ lệ nối gần như tuyệt đối.
- `lark_mon_don.shopify_line_id` — nối một lần, cập nhật theo nhịp đồng bộ mỗi giờ.
- `wh_nhan_kcs.tem_in_luc` — biết món nào chưa dán tem.

**Đơn có hai dòng cùng mã hàng:** tem sinh theo TỪNG DÒNG ĐƠN, không theo mã hàng, nên hai món giống hệt vẫn có hai mã khác nhau.

## 5. Màn hình

**Ô quét đứng đầu màn, luôn giữ con trỏ.** Máy quét cầm tay gõ chuỗi rồi Enter như bàn phím nên không cần bấm nút.

| Quét | Màn làm gì |
|---|---|
| `O:` | mở đơn đó |
| `L:` | mở đơn chứa dòng đó, cuộn tới đúng món, tô sáng |
| `V:` khi đang mở đơn | chọn món khớp trong đơn |
| `V:` khi chưa mở đơn | liệt kê các đơn đang chờ có món ấy |
| `WH-` | tra món kho cũ |
| mã lạ | "không nhận ra mã này" — KHÔNG đoán |
| mã thuộc đơn khác | hỏi "chuyển sang đơn #X?" — không tự nhảy |

**Điện thoại:** đọc mã bằng camera qua `BarcodeDetector` của trình duyệt (Chrome Android có sẵn, không cài gì); máy không hỗ trợ thì gõ tay như thường. Bố cục màn nhỏ: mỗi món một thẻ dọc, ô nhập hàng lớn, nút Lưu chạy hết chiều ngang. Bảng nhiều cột giữ cho máy tính.

**In tem:** lưu xong mỗi món hiện nút In tem. Tem gồm mã vạch + phần chữ người đọc được (mã đơn, mã hàng, tên hàng, kho) — mã mờ hay mất mạng thì mắt người vẫn đọc được. In một món hoặc cả đơn.

**Bàn phím cho máy tính:** quét xong con trỏ nhảy vào ô cân; gõ số rồi Enter là lưu và sang món kế. Không rời tay khỏi bàn phím.

## 6. Bật ghi Lark từng bước

Thêm chế độ **danh sách cho phép** giữa chạy thử và chạy thật: `WH_GHI_LARK=chon:<định danh món>,<định danh món>` — chỉ những món khai tên mới ghi thật, còn lại vẫn chỉ lưu trong SMS. Nhờ vậy kiểm từng bản ghi mà không sợ lỡ tay ghi hàng loạt.

Trình tự kiểm:

1. Test màn, không gì chạm Lark (đang ở chế độ này).
2. Một món **chưa có dòng Lark** → ghi thật, soi từng cột.
3. Một món **đã có dòng cũ** → kiểm nhánh cập nhật. Nhánh nguy hiểm nhất vì nó sửa dữ liệu đang có và **chưa từng chạy thật lần nào**.
4. Một món **không đạt** → kiểm phần lý do, và việc xoá lý do khi kiểm lại thành đạt.
5. Ổn cả bốn → bỏ giới hạn, nối lại việc đẩy tự động (`day-nhan-kcs-lark` hiện nằm ngoài mọi nhóm cron, xem `features/jobs/groups.ts`).

## 7. Kiểm thử

**Thuần:** `docMaTem` đọc đủ bốn loại và từ chối chuỗi rác (mở rộng test đã có); luật chọn mã tem cho một món (dòng đơn → biến thể → mã kho); luật xử lý khi mã quét thuộc đơn khác; đọc danh sách cho phép từ env.

**Thật:** in thử một tem, quét lại bằng máy quét cầm tay và bằng điện thoại, xác nhận ra đúng món.

## 8. Ngoài phạm vi

In tem hàng loạt cho cả kho · quét để xuất kho · gắn mã vạch vào khâu đóng gói · sửa `shopify_variants` (chỉ đọc) · ba cột Lark chưa ai dùng (`WH - CURRENT (final location)`, `FINANCE đã nhận BB`, `WH - Check Packed`).
