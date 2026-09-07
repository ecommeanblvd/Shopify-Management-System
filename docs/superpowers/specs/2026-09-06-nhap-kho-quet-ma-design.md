# Nhập kho quét mã — định danh theo Shopify ID thay cho SKU

**Ngày:** 2026-09-06 · **Trạng thái:** thiết kế, chờ CEO soát · **Quyết định liên quan:** D-045 (đường ghi Lark), D-051 (mỗi việc nền một tên)

## 1. Vấn đề

Mọi bước sau khi đơn về đều nối bằng **SKU**: báo đơn sang brand (MMP nhận `{sku, title, qty}`), brand gửi hàng về (Lark khớp `Order Number + Lineitem SKU`), QC/đóng gói (Lark `SKU(s)`), trạng thái dòng (`order_fulfillment_lines.sku`), tồn kho, giá vốn. Brand đổi SKU là gãy chuỗi. Nhận hàng hiện phải **gõ tay** mã đơn + SKU vào Lark; gõ sai một ký tự là khớp hụt (39 dòng bill khớp hụt phát hiện 05/09 cùng gốc).

Trong khi **ID Shopify đã có sẵn** nhưng không ai dùng: `shopify_order_lines.shopifyLineId`, `order_fulfillment_lines.shopifyLineId`; khâu đóng gói đã nối bằng Line ID.

## 2. Quyết định nền

### 2.1 Mã trên tem định danh MÓN, không định danh sản phẩm
Hàng may theo đơn: một chiếc về là cho **một đơn cụ thể**. Tem chỉ nói "áo X size M" thì vẫn phải hỏi "của đơn nào" — đúng chỗ đang gãy.

### 2.2 Hai tầng mã, hai vai trò (CEO chốt 06/09)
| Tầng | Mã | Ai in | Vai trò |
|---|---|---|---|
| Dòng đơn | Shopify Line ID (14 chữ số) | Brand, nếu in được | Nhận diện gói về là của đơn nào, dòng nào |
| Món | `WH-00009890` (mô hình `goods_receipt_items` có sẵn) | Kho, lúc nhận | Theo dõi từng chiếc qua QC → kệ → đóng gói |

Vì sao không dùng Line ID làm mã món: một dòng mua 2 chiếc = 2 món vật lý chung một mã → không tách QC, không tách vị trí, không biết chiếc nào đã về. Vì sao không dùng `WH` làm mã brand: mã sinh lúc nhận, brand không biết trước.

Tem brand là **đường tắt**, không phải điều kiện: brand không in thì kho chọn từ danh sách chờ, luồng vẫn chạy.

### 2.3 Mã không nối chuỗi, không dài
Tem chỉ mang **một** khoá. Product/Variant/Order tra từ database. Line ID 14 chữ số — ngắn hơn SKU hiện tại (28 ký tự), tương đương EAN-13.

### 2.4 Kho làm bước NHẬN trong SMS, các bước sau vẫn Lark (phương án C)
Lý do kho bỏ SMS tháng 5: SMS chưa tiện hơn Lark cho toàn luồng, Lark đã quen. → Bước nhận hàng trong SMS phải **tiện hơn Lark rõ rệt** (quét, không gõ), và phải **bàn giao mượt** sang Lark.

### 2.5 Quét bằng camera điện thoại; in qua trình duyệt
Không phụ thuộc máy quét cầm tay. Máy in nào cũng được.

### 2.6 QR, không mã sọc
Camera điện thoại đọc QR ổn định hơn mã sọc ở cỡ tem nhỏ; QR chứa được chữ đọc bằng mắt. Phân biệt loại tem bằng tiền tố: `WH-…` (món) · `L:…` (dòng đơn).

### 2.7 SMS là nguồn sự thật cho "MEAN đã nhận hàng"
Sau tính năng này, ngày nhận sinh từ SMS. Lark nhận bản sao. Đồng bộ Lark → SMS hiện có chỉ **điền dòng chưa có**, không đè dòng do SMS ghi.

## 3. Màn hình "Nhập kho nhanh" (mobile web)

Bốn bước, mỗi bước một thao tác chính, **không bước nào gõ SKU**.

1. **Mở phiếu nhận** — chạm chọn brand → mở/tạo `goods_receipts` hôm nay cho brand. Một kiện về = một phiếu.
2. **Xác định dòng đơn** — hai đường vào cùng một chỗ:
   - Quét tem brand (`L:<lineId>`) → nhảy thẳng tới dòng đơn.
   - Chọn từ **danh sách chờ** (`listAwaitingGoods` lọc theo brand): *mã đơn · tên hàng · size · mong đợi N · hạn về*, có ô tìm theo mã đơn.
3. **In tem món** — hiện *Đơn · hàng · size · mong đợi N*. Nút **In N tem** (sửa được N). Bấm → tạo N dòng `goods_receipt_items` (mã `WH`, nối `fulfillmentLineId`/`orderId`/`brandRequestId`) → mở trang in.
4. **Quét xác nhận** — dán tem, quét lại từng tem. Khớp → đánh dấu đã xác nhận, đếm *1/2 → 2/2*. Đủ chiếc → dòng đơn chuyển "đã nhận", ghi ngày nhận (mục 5).

Quét xong về bước 2. Hết kiện → **Đóng phiếu**.

### 3.1 Tình huống lệch
| Tình huống | Xử lý |
|---|---|
| Brand gửi thiếu (1/2) | In 1 tem; dòng còn nợ 1, vẫn trong danh sách chờ |
| Hàng không có trong danh sách chờ | Nút **Nhận ngoài kế hoạch**: in tem, ghi SKU/tên, `fulfillmentLineId = NULL`, cờ vàng để ghép sau |
| Quét nhầm (tem phiếu khác / món đã xác nhận / mã không tồn tại) | Báo đỏ + rung, **không ghi gì** |
| Tem in rồi mà không quét xác nhận | Món tồn tại ở trạng thái "đã in, chưa xác nhận" — hiện cảnh báo trên phiếu, không tự coi là đã nhận |

### 3.2 Thay đổi dữ liệu
- `goods_receipt_items`: thêm `confirmed_at timestamp` (lúc quét xác nhận), `printed_at timestamp`. Cột `unit_code` giữ nguyên làm khoá tem.
- Không đổi khoá `WH-` (đã có 9.890 mã, không đụng dữ liệu cũ).

## 4. Tem

| Tem | QR | Chữ kèm | Cỡ |
|---|---|---|---|
| Món | `WH-00009890` | `#TA2331 · Áo X · XL · 1/2 · TINH` | 50×30mm; bản A4 24 tem/trang |
| Dòng đơn | `L:18158666023207` | `#TA2331 · dòng 2 · Áo X · XL × 2` | như trên |

In qua trình duyệt (`@page`), sinh QR phía client bằng thư viện npm. Trang in nhận danh sách mã, không gọi API lúc in.

## 5. Bàn giao sang Lark và MMP

Khi một dòng đơn đủ chiếc xác nhận:
1. Ghi `mmp_line_received.received_at` (nguồn cho `receivedAt` trong payload MMP — công nợ theo kỳ nhận).
2. Đẩy một dòng sang bảng Lark **"WH ngày MEAN nhận hàng"** (base `HxfAw0iRViHiNgkSlbBltpVkg3f`, table `tblFtdIn8H7ftfBL`): *Order Number, Lineitem SKU, ngày nhận, **Mã món** (cột mới, chuỗi `WH-… | WH-…`)*. Dùng đường ghi đã có (`updateLogRecordFields` mở rộng cho bảng này; thêm tạo dòng mới).
3. `syncBrandReceived` (Lark → SMS) đổi luật: chỉ chèn khi `mmp_line_received` chưa có dòng đó; **không ghi đè**.

Lark hỏng không chặn bước nhận: phiếu vẫn đóng, dòng Lark đánh dấu "chưa đẩy" và cron điền bù (cùng cách bộ điền bù Couriers, D-045).

## 6. Báo brand qua MMP

Payload đơn (`MmpOrderLine`) thêm **hai trường cộng thêm**: `lineId: string` (Shopify Line ID) và `labelUrl: string | null` (PDF tem QR cả đơn). Không đổi trường cũ. Endpoint SMS sinh PDF theo đơn, ký URL có hạn. **Phải báo MMP** trước khi bật, để họ hiện link cho brand.

## 7. Ngoài phạm vi (cố ý)
- QC, kệ, đóng gói trong SMS — vẫn Lark (phương án C).
- Đổi khoá tồn kho / giá vốn từ SKU sang Variant ID — việc riêng, sau khi luồng nhận ổn.
- Tem kiện (mã lô hàng brand gửi) — chưa cần; tem dòng đơn đủ dùng.

## 8. Kiểm chứng thành công
- Nhận một kiện 5 món không gõ ký tự nào.
- Đổi SKU một sản phẩm trên Shopify → nhận hàng, QC, đóng gói không bị ảnh hưởng.
- Kho dùng màn hình này liên tục 2 tuần không quay về nhập tay trong Lark.
