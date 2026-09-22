# Màn "Đóng hàng": kiện đóng xong về SMS tức thì từ Lark, Đức so cước và chọn line ship tại SMS

**Ngày:** 2026-09-22 · **Trạng thái:** thiết kế, chờ CEO soát · **Quyết định liên quan:** D-045 (đường ghi Lark chỉ điền ô trống, một cột `Couriers`), D-051 (mỗi việc nền một tên), D-086 (kiện tách theo mã vận đơn), spec 2026-09-19 (ghi ngược Lark — bước 1 của lộ trình rời Lark)

## 1. Vấn đề

Chức năng so cước và chọn hãng đã có trên SMS (`CarrierComparePanel` + `assignOrderCarrier`, đẩy tên hãng lên cột `Couriers` của Lark) nhưng **Đức chưa dùng lần nào trong 30 ngày**: Đức làm việc theo **kiện đã đóng** (dòng bảng Lark LOG-Export, view "Tạo pack/ tracking tổng hợp"), không theo đơn; và chọn hãng **ngay lúc đóng**, trước khi tạo nhãn (CEO 22/09: đóng xong tạo nhãn luôn, từng kiện).

SMS hiện chỉ biết kiện đã đóng qua cron `sync-lark` mỗi giờ (một lượt ~68 phút): dòng Lark về SMS sau **2,3 giờ (trung vị), 4,3 giờ (90 %)** — đo 14 ngày. 100 % dòng khi về SMS đã có `Couriers` do Đức chọn trên Lark. Màn SMS đọc từ cron vì thế vô dụng cho việc chọn line.

## 2. Quyết định (CEO chốt 22/09/2026)

1. **Lark tự đẩy dòng đóng xong sang SMS** bằng Automation của base (trigger theo điều kiện → HTTP request). Ops đóng hàng **không đổi thao tác**, vẫn nhập cân/kích thước/hộp/ảnh trên Lark.
2. **"Đóng xong" = đủ 5 điều kiện trên dòng Lark:** `Weights` có số · `Dimension ( điền tay)` có giá trị · `Select VTĐG1` đã chọn · `Attachment` có ảnh · `Tracking Number` trống. (Tỉ lệ điền 60 ngày: 99 / 99 / 100 / 98 %.)
3. **Đức chọn line trên màn SMS "Đóng hàng"**, quote theo cân thực + kích thước của kiện; chọn xong SMS ghi `Couriers` lên Lark như hiện nay; Ops thấy hãng trên Lark, tạo nhãn như cũ.
4. Cron `sync-lark` hàng giờ giữ nguyên làm **lưới bù**: rule Lark tắt/lỗi thì dòng vẫn về, chỉ chậm.

## 3. Luồng dữ liệu

```
Ops điền đủ 5 ô ──Lark Automation──▶ POST /api/lark/pack { record_id }
                                          │ xác thực secret
                                          ▼
                              SMS đọc lại record qua Lark API
                                          │ parsePackRow → classifyPackRows (1 dòng)
                                          ▼
                     shipments (tạo/cập nhật)  hoặc  lark_pack_cho_khop (không khớp đơn)
                                          ▼
                    Màn "Đóng hàng": kiện chưa tracking, so cước, nút chọn
                                          │ assignOrderCarrier (sẵn có)
                                          ▼
                 shopify_orders.selected_carrier_key  +  Lark cột Couriers (D-045)
                                          ▼
                       Ops thấy Couriers trên Lark → tạo nhãn → Tracking về theo cron
```

SMS **không tin dữ liệu Lark gửi kèm** — chỉ dùng `record_id` để đọc lại; mọi giá trị vào DB đến từ Lark API.

## 4. Endpoint `POST /api/lark/pack`

- Route handler Next (`app/api/lark/pack/route.ts`), không cần đăng nhập.
- **Xác thực:** header `X-Lark-Pack-Secret` == env `LARK_PACK_WEBHOOK_SECRET` (so timing-safe). Sai → 401, không ghi gì. Thiếu env → 503 `{ error: 'chưa cấu hình LARK_PACK_WEBHOOK_SECRET' }`.
- **Body:** JSON `{ record_id: string, log_unique_code?: string }`, tối đa 4 KB, đúng một record. Thiếu `record_id` → 400.
- **Kết quả** (luôn JSON): `{ ketQua: 'tao' | 'cap_nhat' | 'khong_khop' | 'bo_qua', shipmentId?, logUniqueCode?, lyDo?, ms }`.
- **Mã HTTP theo nguyên tắc "Lark có nên retry không":** 200 cho mọi kết quả nghiệp vụ (kể cả `bo_qua`/`khong_khop`); **502** khi Lark API lỗi/timeout (để Lark retry); 500 khi DB lỗi.
- **Dry:** env `LARK_PACK_DRY=1` → đọc + phân loại, trả kết quả, **không ghi** DB, `job_runs` ghi `dry: true`.
- Mỗi request ghi một dòng `job_runs` tên **`lark-pack-webhook`** (kết quả, log code, ms, lỗi) — trang Tác vụ nền thấy rule còn sống; `registry.ts` khai `chuKyPhut = 24h` với hậu quả "Kiện đóng xong không về SMS tức thì — Đức phải chọn line trên Lark".

## 5. Lõi xử lý một dòng (`features/lark/nhan-mot-dong.ts`)

Dùng chung với cron, **không viết luật thứ hai**:

1. `getLogRecordById(recordId)` (thêm vào `features/lark/client.ts`: GET `records/{record_id}`, cùng app/table của `updateLogRecordFields`).
2. `parsePackRow(fields)` (sẵn có, mở rộng thêm `packaging`, `skuText`, `pieces`). Không có `logUniqueCode` **hoặc** không có `orderNumber` → `bo_qua` với `lyDo`.
3. Dựng `ClassifyMaps` cho đúng dòng này: `shipmentByLogCode` / `shipmentByTracking` tra DB theo code/tracking của dòng; `orderIdByNumber` qua `resolveOrderIds([orderNumber])` (sẵn có). Gọi `classifyPackRows([row], maps)`.
4. `update` → áp `patchFrom(row)` (tách `patchFrom` từ `sync.ts` ra `features/lark/patch-kien.ts` để cả cron và webhook import); `create` → insert `shipments` cùng bộ cột cron đang dùng (`onConflictDoNothing`); `unmatched` → upsert `lark_pack_cho_khop`; `skipped` → `bo_qua`.
5. Kiện vừa tạo/cập nhật: xoá dòng cùng `record_id` trong `lark_pack_cho_khop` nếu có (đơn về sau khi kiện đã chờ).

**Idempotent:** rule có thể bắn lại cùng record (Ops sửa cân). Khớp theo `log_unique_code` → lần sau là `cap_nhat`, không tạo đôi. Hai request đồng thời cùng `record_id`: khoá trong bộ nhớ tiến trình (`Map<record_id, Promise>`) + `onConflictDoNothing` sẵn có.

**Cron `sync-lark`:** không đổi luật; dòng webhook đã tạo thì cron thấy `update` và bỏ qua nếu không đổi (D-05x). Cron khớp được đơn của dòng đang ở `lark_pack_cho_khop` → xoá khỏi bảng chờ.

## 6. Bảng mới `lark_pack_cho_khop`

| Cột | |
|---|---|
| `record_id` text PK | record Lark |
| `log_unique_code` text | PK-xxxxx |
| `order_number` text | số đơn Lark ghi (không khớp được) |
| `store`, `country`, `weight_kg`, `dims` (text "DxRxC"), `packaging`, `sku_text`, `pieces` | để Đức nhìn thấy kiện dù chưa khớp |
| `nhan_luc` timestamp, `ly_do` text | |

Dòng bị xoá khi kiện khớp (webhook lần sau hoặc cron). Không lưu ảnh.

## 7. Màn "Đóng hàng" (`/f/dong-hang`, mục nav "Đóng hàng" cạnh Quản lí đơn)

**Quyền:** xem `view_fulfillment`; chọn hãng `manage_fulfillment`.

**Danh sách:** mỗi dòng một **kiện** (`shipments` có `log_unique_code`, join đơn), nhóm theo ngày đóng (`label_created_at`, giờ VN), mới nhất trên. Bộ lọc: **Chưa có tracking** (mặc định) · Hôm nay · 7 ngày · Tất cả; ô tìm mã đơn/log code. Đầu danh sách: khối đỏ "Không khớp đơn SMS" liệt kê `lark_pack_cho_khop` (mã đơn Lark ghi, cân, kích thước) — không so cước được.

| Cột | Nguồn |
|---|---|
| Mã đơn · Store · Nước | `shopify_orders` |
| Cân thực · D×R×C · **cân quy đổi** | `shipments.actual_weight_kg`, `dim_*`; cân quy đổi = max(cân thực, D×R×C/5000) làm tròn 0,5 kg (cùng luật engine) |
| SKU · số món · hộp | cột mới `shipments.sku_text`, `pieces`, `packaging_type` (text) — `parsePackRow` đọc thêm `SKU(s)`, `Total pieces per pack`, `Select VTĐG1`; `patchFrom` ghi khi có giá trị. Cron cũng điền dần cho kiện cũ |
| Hãng khách đã trả | `shopify_orders.shipping_carrier_key` |
| **So cước** | `quoteOrderAcrossCarriers({ country, weightKg: cân thực, dimensions, postcode, city, effectiveDate: ngày đóng, isResidential: laNhaDan(addr_class) })` — 3–5 hãng xếp theo `vndCost` tăng dần, rẻ nhất tô đậm, hãng `suspendedAt` mờ + lý do; bấm hãng mở chi tiết cước (tái dùng phần chi tiết của `CarrierComparePanel`) |
| **Chọn** | nút mỗi hãng → `assignOrderCarrier(orderId, key)` (sẵn có: chặn hãng tạm ngưng, ghi người/giờ, đẩy Lark). Phản hồi: "Đã ghi Lark ✓ (n dòng)" hoặc "Lark lỗi — điền tay: …" |
| Trạng thái | *Chờ chọn line* → *Đã chọn: UPS · Đức · 10:42* → *Đã lên nhãn* (có tracking) |

**Đơn nhiều kiện:** một lần chọn áp cho mọi kiện của đơn (Lark đã ghi mọi dòng của đơn); nút hiện "áp cho 2 kiện". Cước so theo **từng kiện** (mỗi dòng quote riêng); tổng đơn hiện ở dòng gộp.

**Hiệu năng:** danh sách chỉ đọc DB. Quote khi mở dòng hoặc nút "So cước cả trang" (tối đa 50 kiện, `Promise.all`, cache 10 phút theo `shipmentId + cân + dims` trong bộ nhớ tiến trình). Không quote nền.

**Không có trong bản này:** sửa cân/kích thước từ SMS (nguồn vẫn là Lark); tạo nhãn từ SMS; kiện ship hộ (có màn riêng).

## 8. Cấu hình phía Lark (CEO làm, hướng dẫn kèm trong plan)

Base "Operation Work files 2026 (NEW)" → bảng LOG-Export → Automation → **Trigger:** "When record matches conditions" — `Weights` is not empty AND `Dimension ( điền tay)` is not empty AND `Select VTĐG1` is not empty AND `Attachment` is not empty AND `Tracking Number` is empty. **Action:** "Send HTTP request" — POST `https://shopify-management-system-production.up.railway.app/api/lark/pack`, header `Content-Type: application/json`, header `X-Lark-Pack-Secret: <secret>`, body `{"record_id": "{{record_id}}"}`.

Secret: chuỗi ngẫu nhiên 32 ký tự, đặt cùng giá trị vào Railway `LARK_PACK_WEBHOOK_SECRET` (service web) và trong rule.

## 9. Kiểm thử

Thuần: xác thực secret (đúng/sai/thiếu env → 200-đường/401/503); phân loại kết quả từ `classifyPackRows` (tạo/cập nhật/không khớp/bỏ qua); dựng `ClassifyMaps` một dòng; cân quy đổi; sắp xếp/tô đậm bảng so cước; nhãn trạng thái kiện. Tích hợp thủ công: `LARK_PACK_DRY=1`, curl một `record_id` thật → kết quả đúng; tắt dry, gửi lại → kiện xuất hiện trên màn trong vài giây; chọn hãng → Lark cột Couriers đổi.

## 10. Ngoài phạm vi

- Ops đóng hàng trên SMS (bước 2 lộ trình rời Lark) — sau khi màn này chạy ổn.
- Tạo nhãn vận đơn từ SMS.
- Kiện ship hộ.
- Sự kiện Bitable qua Lark Open Platform (cách 2 đã bỏ).
