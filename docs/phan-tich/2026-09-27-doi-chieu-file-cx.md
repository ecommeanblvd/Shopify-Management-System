# Đối chiếu file vận hành của team CX với hệ thống

**Ngày:** 27/09/2026
**Bảng phân tích:** `CX - Product line Management` (`tblF6nPbhHalo7KI`) — file vận
hành chính của CX trong base *INECSO - CX | WORKING FILE 2026*.
**Quy mô:** 104 cột · 5.909 dòng (2.106 dòng từ 01/06/2026).

## Cách đo

Chỉ tính cột **thật sự được dùng** trên dòng từ 01/06/2026. Trong 104 cột:

- **30 cột rỗng hoàn toàn** — cột chết, phần lớn là bản sao thừa
  (`ECOM - WH - Inventory … Copy 2 (1)`, `Tháng`, `Month | Only`…).
- **15 cột dùng dưới 5%** — bỏ qua.
- **59 cột còn lại** là thứ cần so.

Trong 59 cột đó, **12 cột là công thức/metadata của Lark** (`ID`, `Month`,
`Year`, `Dashboard - Date`, `EDD Min - Today`…). Chúng tự sinh từ cột khác nên
không phải "trường dữ liệu cần bê sang".

**Còn 47 trường thực chất.**

## Kết quả

| | Số trường | Tỉ lệ |
|---|---|---|
| Hệ thống ĐÃ CÓ | **22** | 47% |
| Có một phần / khác cách | **9** | 19% |
| CHƯA CÓ | **16** | 34% |

## 22 trường đã có

| Trường của CX | Bên mình |
|---|---|
| Order Number | `shopify_orders.shopify_order_number` |
| Date Order Created | `processed_at_shopify` |
| Store | `stores.name` |
| Vendor | `shopify_order_lines.vendor` |
| Lineitem Name | `product_title` + `variant_title` |
| Lineitem SKU · Quantity · Price | `shopify_order_lines` |
| Country | `ship_country` |
| Min / Max Production (days) | `processing_min_days` / `_max_days` |
| Address Check | `addr_class`, `addr_deliverable`, `addr_confidence`, `addr_issue` |
| WH - Tiếp nhận | `goods_receipt_items` |
| WH - Action | bản sao `lark_wh_inventory` |
| WH - QC Faild lý do | `wh_loi_qc` |
| Order Processing Status | rollup `order_fulfillment` |
| LOG - Tracking number · Courier in real | `shipments` |
| LOG - Tracking stt · EP Status · EP-Dispatch Status | `shipments.delivery_status` |
| Visible - WH-Ngày MEAN nhận hàng gần nhất | `goods_receipt_items.created_at` |

Hai chỗ **hệ thống mình mạnh hơn hẳn**:

- **Address Check**: CX có một ô chọn. Mình có bốn trường từ FedEx —
  phân loại nhà riêng/công ty, giao được hay không, địa chỉ chuẩn hoá gợi ý,
  và mức tin cậy.
- **QC Faild lý do**: CX có một ô text. Mình có bảng lỗi riêng, mỗi lỗi một
  dòng kèm lý do chọn từ danh sách và **ảnh chỗ lỗi**, in được biên bản.

## 9 trường có một phần

| Trường của CX | Tình trạng |
|---|---|
| CX - EDD (Min) / (Max) | Mình có `estimated_delivery` nhưng là MỘT chuỗi gộp `"6 October - 20 October"`, chưa tách hai đầu |
| Allocate Source | Mình có allocation nhưng chưa có phân loại *Đơn mới chưa xử lý / Báo Mer / Lấy tồn kho / Báo Procurement* |
| PROCU - Final Order Stt | Gần với `brand_order_requests.confirm_status`, khác bộ giá trị |
| WH-Điều phối đơn | Gần với `order_fulfillment_lines.status`, khác cách chia |
| Base Vendor (HN/SG) | Mình có mã kho GVM/AP/DM, chưa gom thành vùng |
| Ngày WH dự kiến đi hàng | Suy được từ EDD nhưng chưa có trường riêng |
| OC - On-Time Delivery | Tính được từ `delivered_at` so với EDD, chưa có sẵn |
| Inventory available | Gần với ngày QC đạt |

## 16 trường chưa có — gom thành 5 nhóm

**1. Hệ thống ticket / công việc CX (6 trường, dùng 100%)**
`CX - To Do` · `Incident Management` · `Incident Management Test-Select Order No.`
· `Truspilot Review` · `Query Types` · `CX - Order Tag` · `CX Effort`

Đây là **phần lớn nhất và cũng là lõi công việc của CX**. Bốn cột đầu là liên
kết sang bảng riêng trong file CX — tức đằng sau chúng là cả một hệ thống quản
lý việc, sự cố và đánh giá. Hệ thống mình **chưa có gì tương đương**.

**2. Đổi trả (2 trường)**
`Return Order` · `ID Return` — liên kết sang bảng `Return Management`. Mình
**chưa có module đổi trả** nào.

**3. Thông tin khách (3 trường)**
`Customer Email` (100%) · `Customer Measurements` (83%) · `Customer Order Notes` (7%)

`Customer Email` đáng chú ý: đồng bộ đơn của mình **chỉ lấy `customer { id }`**,
không lấy email. Đây là thứ **sửa được nhanh nhất** trong cả danh sách — thêm
một trường vào câu truy vấn Shopify.

`Customer Measurements` là số đo khách đặt hàng may đo, CX dùng 83% — mình chưa
có chỗ lưu.

**4. EDD và sản xuất (3 trường)**
`Lỗi-EDD (Min)` · `Lỗi-EDD (Max)` — CX ghi lý do lệch ngày giao dự kiến.
`OC - Production Completion ETA` (62%) — ngày brand hẹn xong hàng.

**5. Cân nặng theo dòng (1 trường)**
`Lineitem Weight` (99%). Mình có cân ở mức ĐƠN (`ship_weight_kg`) và mức KIỆN
(`shipments.actual_weight_kg`), chưa có mức DÒNG.

## Nhận định

Phần **vận hành đơn** — đơn, hàng, kho, QC, vận chuyển — hệ thống đã phủ tốt và
có chỗ còn chi tiết hơn Lark.

Phần **chưa có lại không phải các trường lẻ, mà là hai module trọn vẹn**: quản
lý việc/sự cố của CX, và đổi trả. Thêm cột vào bảng đơn không giải quyết được;
chúng cần bảng riêng và luồng riêng, giống cách đã làm với Nhận & Kiểm.

Thứ tự đề nghị, dễ trước khó sau:

1. **Customer Email** — sửa một dòng trong câu truy vấn đồng bộ
2. **Tách CX - EDD thành hai đầu Min/Max** — đã có dữ liệu, chỉ cần tách chuỗi
3. **Customer Measurements + Order Notes** — thêm trường, có sẵn nguồn từ Shopify
4. **Module đổi trả** — cần brainstorm riêng
5. **Module ticket/sự cố CX** — lớn nhất, cần brainstorm riêng
