# Giá vốn theo line đơn và báo cáo lãi gộp theo tháng

Ngày: 2026-09-08 · Trạng thái: CEO duyệt từng phần trong phiên brainstorm 08/09.

## 1. Vấn đề

CEO cần "Rev thực tế" (lãi gộp) theo tháng: doanh thu trừ phí ship trừ giá vốn. Hệ thống đã có khung giá vốn (`sku_costs` theo SKU và ngày hiệu lực, `cost_override` từng line, công thức Margin trong `features/shopify-orders/metrics/compute.ts`, dashboard theo tháng, trang tải CSV) nhưng **độ phủ giá vốn 6 tháng gần đây là 0%** ở cả ba store. Ba nguồn có thể lấy đều trống: Shopify `inventoryItem.unitCost` gần 0%, `mmp_products.cost_price` 0/23.188, CSV chưa tải lần nào.

Với hàng brand ký gửi (phần lớn dòng đơn MEAN BLVD), giá vốn là **tiền MEAN trả brand**, được chốt trên bảng kê công nợ hằng tháng — biến thiên theo dòng (phí customize, % chiết khấu đổi theo tháng) và gắn với **kỳ thanh toán**, không gắn với ngày đặt. Mô hình "một giá/SKU" không diễn tả được.

## 2. Quyết định nền (CEO chốt)

- **Nguồn giá vốn (phương án D):** hàng brand lấy từ bảng kê thanh toán cho brand (nay là Google Sheet, sau là MMP); hàng tự sản xuất (TINH, Mirer, hàng MEAN) lấy từ Shopify *Cost per item*; CSV để sửa tay.
- **Denio deal theo THỰC NHẬN.** Chỉ tab "A. Đơn thực nhận trong tháng" có cột *Tổng thành tiền TT*, thuế GTGT và lịch chuyển tiền; tab "thực bán" chỉ tham khảo. Lấy cột **Tổng thành tiền TT** (trước thuế).
- **Kỳ ghi nhận giá vốn hàng brand = tháng thực nhận trên bảng kê** (phương án B). Hàng tự sản xuất: kỳ = tháng đặt.
- **Ghép theo mã đơn + line item** trong đơn. Hai dòng sheet (váy `DN0729` + phụ kiện `PKDN0729`) gộp về một line Shopify `DN0729+PK0729…`.
- **Báo cáo theo VND.**
- Tab nháp "Trang tính14" và bảng giá ở đầu file: bỏ qua (không có tiêu đề bảng kê).

Khảo sát sheet Denio 01→08/2026: 16 tab (8 thực nhận, 8 thực bán), 865 dòng thực nhận / 533 mã đơn; công thức TT = giá nội địa × SL × (1 − %CK) + phí customize khớp 865/865; CK 40% (01–05), 35% (06–07), 08 chủ yếu 40%. Khớp SMS: 497 đúng SKU, 185 khớp qua mã sản phẩm gốc, 158 mã `#MBLVDPO…` và 25 mã `#MTB…` không thuộc Shopify, 127 dòng nhận khác tháng đặt.

## 3. Dữ liệu

Hai bảng mới, một bảng tỉ giá; không sửa bảng cũ.

### 3.1 `order_line_cogs`
| Cột | Ý nghĩa |
|---|---|
| `order_id`, `shopify_line_id`, `store_id` | khoá ghép với `shopify_orders` / `shopify_order_lines` |
| `kind` | `cogs` \| `return` (return số âm) |
| `period` | `YYYY-MM` — kỳ ghi nhận (brand: tháng thực nhận; tự sản xuất: tháng đặt) |
| `amount`, `currency` | tiền giá vốn **giữ tiền tệ gốc** (Denio: VND) |
| `source` | `brand_statement` \| `mmp` \| `csv` \| `shopify_unit_cost` |
| `brand_slug`, `statement_ref` | ví dụ `denio 2026-08` |
| `detail` (jsonb) | các dòng sheet đã cộng vào line, %CK, phí customize, SL sheet, cờ "sheet tính dư", tổng có thuế |
| `imported_at`, `imported_by` | |

Duy nhất theo (`order_id`, `shopify_line_id`, `kind`, `period`). Ưu tiên khi một line có nhiều nguồn: `brand_statement` = `mmp` > `csv` > `shopify_unit_cost`; nguồn tự động không bao giờ đè số đã đối soát với brand. `sku_costs` và `cost_override` giữ nguyên cho luồng CSV hiện có.

### 3.2 `brand_cogs_offline`
Dòng bảng kê không thuộc đơn Shopify (`#MBLVDPO…`, `#MTB…`): `brand_slug`, `period`, `ref_code`, `sku`, `qty`, `amount`, `currency`, `kind`, `statement_ref`. Hiện trong báo cáo ở mục riêng "chi trả brand ngoài Shopify", **không** trừ vào Rev Shopify.

### 3.3 `fx_month_rates`
`from_currency`, `to_currency`, `period`, `rate`, `source` (`manual` \| `vcb`), duy nhất theo (from, to, period). Dùng đổi doanh thu USD → VND theo tháng. Tỉ giá tĩnh `stores.fx_cost_per_order_currency` giữ cho dashboard cũ.

## 4. Luật ghép bảng kê vào đơn (module thuần)

Đầu vào: dòng tab thực nhận (mã đơn, SKU, SL, giá nội địa, %CK, phí customize, TT) và mục "B. Đơn return".

1. **Tìm đơn:** chuẩn hoá mã (bỏ `#`, khoảng trắng, hoa/thường) → `shopify_order_number`. Không có: mã `#MBLVDPO…`/`#MTB…` → offline; mã khác → "không khớp", **không ghi**.
2. **Tìm line trong đơn**, theo thứ tự: SKU bằng đúng → ghép; không → so **mã sản phẩm gốc** (`DN\d{4}` và tương tự theo brand): dòng sheet ghép vào line có SKU chứa mã đó; phụ kiện `PKDN0729` ghép vào line chứa `DN0729`; nhiều ứng viên → so size và màu; đơn một line → về line đó; còn mơ hồ → "không khớp".
3. **Cộng dồn:** giá vốn line = Σ TT các dòng ghép vào. Σ SL sheet > `quantity` line → cờ "sheet tính dư", vẫn nhập.
4. **Return:** dòng `kind = 'return'`, số âm, kỳ = tháng return.
5. **Kiểm tra chéo:** tính lại TT theo công thức; lệch > 1 ₫ → cảnh báo, vẫn lấy số sheet (bản đã ký với brand).
6. **Nhập lại:** đơn vị nhập = (brand, kỳ); nhập lại xoá toàn bộ dòng `brand_statement` của kỳ đó rồi ghi mới, trong một transaction; không đụng dòng nguồn khác.

## 5. Bộ nhập bảng kê

Trang *Đơn hàng → Giá vốn → Bảng kê brand* (quyền `manage_cogs`). Chọn brand, dán link Google Sheet (hoặc tải `.xlsx`/`.csv`). SMS tải workbook qua đường xuất `xlsx`, đọc mọi tab.

**Nhận diện tab:** có tiêu đề `BẢNG KÊ CÔNG NỢ Từ ngày … đến … Brand: …` → kỳ và brand; `A. Đơn thực nhận trong tháng` → xử lý; `A. Đơn thực bán` → bỏ; tab không tiêu đề → bỏ. Brand tiêu đề ≠ brand đã chọn → dừng.

**Hai bước:** *Xem trước* (theo kỳ: dòng, khớp đúng SKU, khớp mã gốc, offline, không khớp, return, Σ TT, dòng lệch công thức; liệt kê dòng không khớp và dòng dư) → *Áp dụng* (chọn kỳ, xác nhận, ghi; audit ai/lúc nào/file/bao nhiêu dòng).

Bộ nhập cho ra cấu trúc trung gian `{ brand, period, lines[]: { orderNumber, sku, qty, amount, currency, kind, ref }, offline[] }`; luật ghép và hàm ghi chỉ làm việc với cấu trúc này.

## 6. Báo cáo "Lãi gộp theo tháng"

Trang *Đơn hàng → Lãi gộp* (quyền `view_cogs`), chọn khoảng tháng, lọc store/brand, **VND**, tháng theo giờ Bangkok.

| Cột | Cách tính |
|---|---|
| Doanh thu thuần | Σ(đơn giá × SL − giảm giá phân bổ) − hoàn tiền, đơn đặt trong tháng, đổi VND theo `fx_month_rates` |
| Phí ship thực | như dashboard hiện tại (hoá đơn → override → ước lượng), đổi VND |
| Giá vốn | Σ `order_line_cogs` có `period` = tháng, cộng `cogs`, trừ `return` |
| **Rev thực tế (lãi gộp)** | Doanh thu thuần − Phí ship − Giá vốn |
| Chi brand ngoài Shopify | Σ `brand_cogs_offline` kỳ đó, cột riêng, không trừ |
| Độ phủ COGS | % line và % doanh thu có giá vốn; < 100% → lãi gộp hiện màu cảnh báo |
| Thuộc đơn tháng trước | phần COGS kỳ này của đơn đặt tháng trước |

Chi tiết theo brand rồi theo line (doanh thu, giá vốn, nguồn, tham chiếu). Xuất CSV bảng tháng và **danh sách line chưa có giá vốn** (store, brand, mã đơn, SKU, SL, doanh thu). Tỉ giá thiếu → dùng tỉ giá gần nhất trước đó, cờ "tỉ giá tạm", ô nhập ngay trên trang.

Kỹ thuật: cộng dồn bằng SQL (một truy vấn doanh thu theo tháng đặt, một COGS theo kỳ); ghép và đổi tiền là module thuần có test; không đụng dashboard store hiện có.

## 7. MMP, hàng tự sản xuất, quyền

- **MMP:** webhook `POST /api/mmp/cogs` (ký HMAC như webhook MMP hiện có) nhận đúng cấu trúc trung gian §5, `source = 'mmp'`, qua cùng luật ghép và hàm ghi. `mmp_products.cost_price` không cần điền.
- **Hàng tự sản xuất** (store TINH, Mirer; vendor tự sản xuất trên MEAN BLVD khai một chỗ): cron ngày `sync-unit-cost` đọc Shopify `inventoryItem.unitCost` → `sku_costs` (nguồn `shopify`, chỉ ghi khi đổi); cron `apply-own-cogs` ghi `order_line_cogs` cho line chưa có giá vốn: giá SKU hiệu lực × SL, kỳ = tháng đặt. Cả hai vào `JOB_REGISTRY`.
- **VAT:** giá vốn = TT trước thuế; tổng có thuế lưu trong `detail`.
- **Quyền:** thêm `view_cogs`, `manage_cogs`; không tái dùng quyền xem đơn.

## 8. Lỗi và an toàn
Nhập theo kỳ trong một transaction; dòng không khớp không bao giờ được đoán; webhook sai chữ ký/cấu trúc → từ chối; cron lỗi hiện trên `/f/jobs`.

## 9. Kiểm thử
Test module thuần: đọc tab (tiêu đề, kỳ, A/B, bỏ nháp); luật ghép trên mẫu Denio (SKU đúng, `DN0729`/`PKDN0729`, đơn một line, PO, MTB, return, dư SL); đổi tiền theo tháng và cờ tạm; phép tính báo cáo. Kiểm thật: xem-trước trên link Denio phải ra 8 kỳ, 865 dòng, 497 + 185 khớp, 183 offline, Σ TT từng kỳ đúng bảng khảo sát (01: 166.648.800 · 02: 206.330.000 · 03: 180.710.000 · 04: 148.573.400 · 05: 171.324.000 · 06: 90.762.850 · 07: 47.381.000 · 08: 123.789.500 ₫).

## 10. Ngoài phạm vi
Theo dõi dòng tiền đã chuyển cho brand; chi phí vận hành/marketing (lãi ròng); backfill đơn MEAN BLVD 2022–2024 (việc riêng, làm trước nếu cần P&L ba năm đó).

## 11. Thứ tự triển khai
Bảng + luật ghép + bộ nhập → nhập Denio 8 kỳ → báo cáo lãi gộp → cron Shopify unit cost → webhook MMP (khi MMP sẵn).
