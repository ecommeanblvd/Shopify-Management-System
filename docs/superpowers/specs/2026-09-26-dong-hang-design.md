# Bước đóng hàng — thiết kế

**Ngày:** 26/09/2026 · **Duyệt:** CEO Lê Minh Tiệp

## Mục đích

Kho đóng kiện trên hệ thống thay vì gõ thẳng vào Lark: chọn chiếc đã QC đạt,
cân, chọn hộp, chụp ảnh kiện, rồi hệ thống ghi sang bảng Lark `LOG - Export`.

## Những gì đã có, KHÔNG dựng lại

- `shipments` = **kiện**: `dim_*_cm`, `actual_weight_kg`, `origin_hub`,
  `lark_hop`, `pieces`, `carrier_key`, `tracking_number`, `log_unique_code`.
- `features/packing`: `createPack` (dòng đã lấy → kiện), `markCheckPacked`,
  `shipPack`, đẩy fulfillment sang Shopify.
- `applyLineTransition` trong `features/fulfillment/actions.ts`: chuyển
  `in_stock → picked` có TRỪ TỒN đúng cách (`applyMovement` reason `pick`),
  rồi `picked → packed`.
- `/f/dong-hang`: chọn hãng vận chuyển cho kiện — **việc khác**, không đụng.
- Khối tải ảnh dán-từ-Zalo ở màn Nhận & Kiểm — dùng lại nguyên.
- Đường tải file lên Lark (`uploadWhInventoryMedia`) đã chạy thật.

## Đo đạc làm nền cho thiết kế

| Việc | Số đo |
|---|---|
| Kiện gộp nhiều đơn | **8 / 3.973 (0,2%)** → vòng này KHÔNG làm gộp |
| `Select VTĐG1` (hộp) được điền | 100% (1.658 kiện từ 01/06) |
| `Attachment` (ảnh kiện) | 98% |
| `Weights` · `Dimension` | 99% |
| Dòng đơn từng ở `picked`/`packed` | **0** — chuỗi pick→pack chưa chạy thật lần nào |

**Hộp là HÀNG TỒN.** `Select VTĐG1` trỏ ngược về chính bảng WH-Inventory; vật
tư đóng gói được nhập kho và mang mã kiểu
`MEAN-BOX-42x30x10-CAR-02-VTĐG1-WH-25314`. Nên "chọn hộp" = chọn một dòng tồn
loại `VTĐG1`/`VTĐG2` của ĐÚNG kho đang đóng, không phải gõ chuỗi tự do.

## Mô hình

Một kiện gom nhiều chiếc của **một đơn**. Chiếc = `goods_receipt_items` đã QC
đạt và được allocation gán vào `order_fulfillment_lines` (`in_stock`).

Vì chưa dòng nào từng ở `picked`, màn đóng hàng đi **thẳng `in_stock → packed`**
qua hai bước máy móc sẵn có (`picked` ở giữa để trừ tồn đúng). Bắt kho bấm một
nút "lấy hàng" riêng là nghi thức không ai làm.

## Màn hình

Tab **Đóng hàng** trong Kho hàng, hai lớp.

**Lớp 1 — đơn chờ đóng.** Đơn có ít nhất một dòng `in_stock` chưa vào kiện.
Mỗi dòng: mã đơn · brand · số chiếc sẵn sàng · kho · nước đến. Lọc theo kho,
ô tìm mã đơn.

**Lớp 2 — modal đóng kiện:**
- Danh sách chiếc sẵn sàng của đơn, tick chọn (mặc định tick hết)
- Cân nặng (kg) · D×R×C (cm)
- Hộp: chọn từ vật tư `VTĐG1`/`VTĐG2` của đúng kho
- Ảnh kiện: dán / kéo thả / chọn file, nhiều ảnh
- Nút **Đóng kiện**

## Dữ liệu thêm

- `shipments.hop_lark_record_id` — dòng vật tư đã dùng, để ghi link sang Lark
- `shipments.lark_record_id` — dòng `LOG - Export` hệ thống tạo
- `wh_anh_kien` — ảnh kiện: `shipment_id`, `s3_key`, `ten_file`, `nguoi_tai`,
  `lark_file_token`. Cùng hình với `wh_anh_nhan`.

## Ghi sang Lark

Tạo một dòng `LOG - Export`: `Order Number`, `Select hàng ship` (link sang
CX-MER theo `lark_mon_don.record_id`), `Weights`, `Dimension ( điền tay)`,
`Select VTĐG1` (link dòng vật tư), `Attachment` (ảnh), `Total pieces per pack`,
`Base`, `Store`.

Giữ đúng bốn hàng rào của luồng nhận: lưu `lark_record_id` sau khi tạo, gỡ
được, ghi nhật ký mọi lượt kể cả lượt hỏng, và **không bật tự động** — kho bấm
nút thì mới ghi.

## Ngoài phạm vi vòng này

Gộp nhiều đơn một kiện (0,2%) · chọn hãng vận chuyển (đã có màn riêng) · in
nhãn · tracking · trừ tồn vật tư đóng gói.
