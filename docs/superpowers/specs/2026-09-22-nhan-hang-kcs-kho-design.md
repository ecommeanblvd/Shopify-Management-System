# Màn "Nhận hàng & KCS": kho nhập số lượng, cân, kết quả kiểm và hướng xử lý trên SMS, ghi sang bảng kho Lark

**Ngày:** 2026-09-22 · **Trạng thái:** thiết kế, chờ CEO soát · **Liên quan:** spec 2026-09-22 màn Đóng hàng (cùng cách ghi ngược Lark), D-045 (đường ghi Lark hẹp có chủ đích)

## 1. Vấn đề

Bảng Lark **"WH - Inventory (Nhập, QC, Pack)"** (`tblfnOiEwzcXmemM`, 9.007 dòng, mỗi dòng = một món của một đơn) là nơi kho làm việc hằng ngày. Khảo sát 22/09/2026:

| Thao tác trên Lark | Số dòng đã điền |
|---|---|
| `QC Check` — QC Pass 8.427 · QC Failed 430 · Gửi dư 1 | 8.858 / 9.007 |
| `WH - Action` — Tạm nhập (đi đơn) 5.703 · Lưu kho 2.380 · Gửi trả Vendor (QC fail) 391 · Hoàn trả brand (return) 220 · Trả lại Vendor (đồ mượn) 65 | 8.864 |
| `Quantity tiếp nhận trước QC` | 8.848 |
| `Weight (kg)` | 5.047 (56 %) |
| `Lý do QC failed` · `Ảnh chụp lỗi QC fail` | 777 · 126 |

SMS đã có trang "Chờ KCS" nhưng chạy trên **phiếu nhận hàng tạo trong SMS**, mà kho không dùng: `warehouse_inventory` chỉ 757 dòng so với 9.007 dòng Lark. 149 dòng chưa QC trên Lark đều là dòng RỖNG (không mã hàng, không đơn) do bấm nhầm — tức **không tồn tại hàng chờ QC**: kho tạo dòng và điền kết quả trong cùng một thao tác khi hàng về.

Hệ quả: màn nào chỉ "sửa dòng chờ sẵn" sẽ luôn rỗng và vô dụng. Màn phải làm được **cả nhận lẫn kiểm**.

## 2. Quyết định (CEO chốt 22/09/2026)

1. **Nguồn dữ liệu là Lark**, SMS đọc bảng kho và ghi ngược — giống hệt màn Đóng hàng. Lark vẫn là sổ cái, không ai mất dữ liệu.
2. **Một màn làm cả nhận và kiểm**: chọn đơn → nhập số lượng, cân, kết quả kiểm, hướng xử lý → SMS **tạo dòng mới** trên bảng kho, hoặc điền vào dòng đã có.
3. **Ảnh lỗi lưu tại SMS**, sang Lark chỉ ghi `Lý do QC failed` bằng chữ. Không dùng API tải tệp của Lark ở đợt này.
4. Đợt này KHÔNG làm: vị trí kệ, kích thước món, biên bản đổi trả vendor, xuất lẻ một đầu kho.

## 3. Luồng dữ liệu

```
Kho mở /f/warehouse/nhan-kcs → gõ/quét mã đơn
        │
        ▼
SMS hiện các MÓN của đơn (bảng lark_mon_don, đã đồng bộ sẵn mỗi giờ)
        │  kho nhập: số lượng · cân · kết quả kiểm · hướng xử lý (+ lý do & ảnh nếu không đạt)
        ▼
SMS lưu vào DB của mình (nguồn để hiện lại + hàng đợi gửi)
        │
        ▼
Đẩy sang Lark bảng WH - Inventory:
   món CHƯA có dòng kho → TẠO dòng mới (13 cột §5)
   món ĐÃ có dòng kho  → CẬP NHẬT đúng dòng đó
        │
        ▼
Cron sync-lark mỗi giờ đọc lại → ai sửa tay trên Lark thì SMS biết
```

**Vì sao nối được:** cột `Import (select order)` của bảng kho là link (type 21) trỏ sang `tblFtdIn8H7ftfBL` — **chính bảng món** mà SMS đang đọc hằng giờ vào `lark_mon_don`. SMS biết chính xác phải nối dòng kho mới vào món nào.

## 4. Màn hình `/f/warehouse/nhan-kcs`

**Quyền:** xem `view_receiving`; nhập và lưu `manage_qc`.

**Khối trên — tìm đơn.** Ô nhập mã đơn (gõ hoặc quét). Hiện các món của đơn:

| Cột | Nội dung |
|---|---|
| Món | mã hàng, tên hàng, nhà cung cấp |
| Đặt | số lượng theo đơn |
| Trạng thái kho | *Chưa nhận* · *Đã nhận dd/mm · QC Pass · Tạm nhập (đi đơn)* (đọc từ dòng kho đã có) |
| Nhập | số lượng · cân (kg) · kết quả kiểm · hướng xử lý |

- Món **đã huỷ** (`lark_mon_don.huy`) gắn nhãn đỏ "Đã huỷ — không nhận vào kho" và khoá ô nhập; đó chính là thứ không nên nhận.
- Món **đã có dòng kho** hiện kết quả cũ, nhập tiếp là **sửa** dòng đó chứ không tạo dòng hai.

**Ràng buộc nhập:**
- Kết quả kiểm: `QC Pass` | `QC Failed` | `Gửi dư` — tên lấy NGUYÊN của Lark, không đặt tên mới, để báo cáo cũ không gãy.
- Hướng xử lý: `Tạm nhập (đi đơn)` | `Lưu kho` | `Gửi trả Vendor (QC fail)` | `Hoàn trả brand (return)` | `Trả lại Vendor (đồ mượn)`.
- Chọn `QC Failed` → **bắt buộc** lý do (chữ) và ảnh, như ràng buộc đang có ở trang KCS hiện tại.
- Chọn `QC Pass` → hướng xử lý mặc định `Tạm nhập (đi đơn)` (5.703/8.864 dòng, gần hai phần ba).
- Cân nhập ở đây chảy thẳng sang màn Đóng hàng: hiện chỉ 56 % dòng Lark có cân, thiếu cân thì Đóng hàng phải đoán theo Shopify.

**Khối dưới — đã xử lý hôm nay.** Danh sách dòng kho SMS vừa ghi trong ngày (mã dòng WH-xxxxx, món, kết quả, người làm, giờ), để kho nhìn lại và sửa khi gõ nhầm.

## 5. Ghi sang Lark

**Bộ cột khi TẠO dòng mới** (đúng như dòng WH-33982/33983 kho đang tạo tay):

| Cột Lark | Nguồn |
|---|---|
| `Import (select order)` | link tới record món (`lark_mon_don.record_id`) |
| `Lineitem SKU final`, `Lineitem Name` | món |
| `Order Number final` | mã đơn |
| `Store final`, `Vendor final` | món |
| `Warehouse` | kho kho chọn (`HN \| GVM`, `SG \| AP`…) |
| `Import - Inventory type` | `Retail` |
| `Ngày Import - tiếp nhận đồ tại kho` | hôm nay (nửa đêm giờ VN) |
| `Quantity tiếp nhận trước QC`, `Weight (kg)` | kho nhập |
| `QC Check`, `WH - Action` | kho chọn |
| `Lý do QC failed` | khi không đạt |

**Khi CẬP NHẬT dòng có sẵn:** chỉ ghi `Quantity tiếp nhận trước QC`, `Weight (kg)`, `QC Check`, `WH - Action`, `Lý do QC failed`. Không đụng cột khác.

**Đường ghi vẫn hẹp:** thêm quyền tạo/sửa trên bảng kho nhưng giới hạn đúng 13 cột trên. **Không có lệnh xoá** — một lỗi lập trình không được phép quét sạch bảng vận hành.

**Giá trị phải khớp danh sách chọn.** `QC Check`, `WH - Action`, `Warehouse`, `Store final`, `Vendor final` đều là cột chọn: ghi giá trị lạ thì Lark đẻ lựa chọn mới, hỏng bộ lọc và báo cáo của cả đội. SMS chỉ gửi giá trị đang tồn tại — cùng nguyên tắc với tên hãng ở cột `Couriers` (features/lark/courier-name.ts).

**Chống tạo trùng.** Trước khi tạo, SMS tìm dòng kho theo **liên kết món** (không theo mã đơn — một đơn nhiều món). Có rồi → cập nhật. Hai người cùng nhận một món trong vài giây: người sau nhận thông báo "món này đã có dòng WH-xxxxx", không tạo thêm.

**Lark hỏng không làm mất việc.** SMS lưu vào DB của mình TRƯỚC, rồi mới đẩy Lark. Đẩy trượt → dòng nằm trong hàng đợi, tự thử lại theo nhịp cron, màn hiện cảnh báo để kho điền tay nếu gấp. Cùng kiểu hàng đợi sự kiện MMP (`ship_ho_order_events`).

## 6. Dữ liệu SMS

- `lark_mon_don` thêm cột `record_id` (mã record Lark của món) — hiện chỉ lưu `dinh_danh`, không đủ để tạo link. Cron `syncBrandReceived` điền sẵn.
- Bảng mới `wh_nhan_kcs`: `id`, `mon_dinh_danh`, `order_number`, `sku`, `so_luong`, `can_kg`, `qc_check`, `wh_action`, `ly_do_fail`, `anh_key`, `warehouse`, `nguoi_lam`, `luc`, `lark_record_id`, `trang_thai_day` (`cho` | `da_day` | `loi`), `loi`.
- Ảnh lưu như ảnh QC hiện tại (`uploadReceiptImage`).

## 7. Kiểm thử

**Thuần:** dựng bộ cột gửi Lark từ dữ liệu kho nhập (tạo mới và cập nhật là hai bộ khác nhau); kiểm giá trị nằm trong danh sách chọn; luật bắt buộc lý do + ảnh khi `QC Failed`; luật quyết định tạo mới hay cập nhật; mặc định `Tạm nhập (đi đơn)` khi `QC Pass`.

**Thật:** chạy chế độ thử (`WH_GHI_LARK=dry`) ghi ra log thay vì gọi Lark; rồi ghi một dòng nháp trên Lark bằng một món thật, mở bảng xem đúng cột; xong mới bật thật.

## 8. Ngoài phạm vi

Vị trí kệ (`Vị trí tại kho`, mới 6,5 % dòng có) · kích thước món (`Kích thước`, 85 dòng) · biên bản đổi trả vendor · xuất lẻ một đầu kho · ba cột chưa ai dùng (`WH - CURRENT (final location)`, `FINANCE đã nhận BB`, `WH - Check Packed`, đều 0 dòng — nên hỏi CEO có bỏ khỏi bảng Lark không).
