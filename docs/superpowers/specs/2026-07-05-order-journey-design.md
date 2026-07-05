# Order Journey — Customer Account full-page (spec)

**Ngày:** 2026-07-05 · **Trạng thái:** đã duyệt brainstorm với CEO (chính sách, kiến trúc, UX, schema)
**Phạm vi:** Sub-project A của Customer Account nâng cao. B (Wishlist page) và C (Style Quiz) sẽ có spec riêng.

## 1. Mục tiêu

Tái định vị trang full-page `customer-account-hub` (extension đã live trên cici-mean) thành **Order Journey**:
khách xem từng đơn đã đi qua giai đoạn nào, đang ở đâu, và **hành động theo giai đoạn**
(hủy đơn / claim / return / theo dõi refund) theo đúng chính sách MEAN BLVD.
Tránh trùng lặp với 2 trang gốc Shopify: Profile (hồ sơ + membership block + store credit) và Orders (danh sách đơn thuần).

## 2. Chính sách đã khóa (CEO duyệt)

| Quyết định | Giá trị |
|---|---|
| Hủy free 100% | Đến khi **brand confirm đơn trên MMP** (mốc cứng duy nhất; không dùng mốc 48h) |
| Hủy sau brand-confirm, chưa ship | Cho hủy, **charge 40%** — refund tối đa 60% |
| Sau ship | Không hủy; chỉ claim sau khi giao |
| Hạn claim | **14 ngày** kể từ delivered |
| Bằng chứng claim | **Bắt buộc ≥1 ảnh** (tối đa 5, PNG/JPG ≤5MB/ảnh, lưu S3 sẵn có) |
| Phân xử lỗi | **Admin quyết khi duyệt**: `fault = customer` → khách trả phí ship return; `fault = mean` (supplier/platform) → MEAN trả |
| Địa chỉ return | **Nhiều hub** (US / Middle East / VN…); operation **chọn hub khi duyệt claim** theo lý do + vị trí khách |
| Refund | **v1 thủ công**: SMS snapshot số tiền + queue; admin refund trong Shopify admin rồi đánh dấu xong; KHÔNG gọi Refund API (không thêm scope write_orders) |
| Báo brand khi hủy sau confirm | **v1 admin tự báo** (cờ ⚠️ trong queue); v2 mới auto-push MMP |
| Ngôn ngữ phía khách | Tiếng Anh (khách quốc tế); nhãn module override per-store như hiện tại |

## 3. UX trang khách (extension full-page)

Menu label đổi thành **"Order Tracking"** (config per-store). Bỏ module Hồ sơ + Store credit khỏi trang
(đã có ở Profile gốc; membership tier đã hiện qua ProfileBlock). Hai tầng:

### 3.1 Danh sách đơn
Card mỗi đơn: số đơn, ngày đặt, tổng tiền, ảnh sản phẩm **object-fit contain** (không crop),
chip giai đoạn: `In production / Quality check / Packed / Shipped / Delivered / Cancelled / Refunded`.
Ảnh + line items lấy **trực tiếp từ Shopify Customer Account GraphQL** trong extension (SMS không lưu ảnh).

### 3.2 Chi tiết đơn
1. **Timeline 6 mốc** từ `order_lifecycle`: Placed → In production → Quality check → Packed → Shipped → Delivered.
   Mốc đã qua có ngày giờ; kèm ngày hoàn thành dự kiến (estimate brand điền trên MMP). Đơn hủy/refund hiện trạng thái kết thúc.
2. **Vùng hành động** (policy engine quyết):
   - Chưa brand-confirm → nút **Cancel order** — "Free cancellation — full refund".
   - Đã confirm, chưa ship → nút **Cancel order** + dialog số tiền cụ thể:
     "Production has started. Cancellation fee 40% ($X). You'll be refunded $Y (60%)." — bắt tick xác nhận.
   - Đã ship, chưa giao → "Order is on the way — cancellation no longer available" + tracking.
   - Delivered ≤14 ngày → nút **Report a problem** (mở wizard claim).
   - Delivered >14 ngày → "Claim window closed (14 days after delivery)".
3. **Wizard claim 3 bước:** ① chọn vấn đề (multi-select: Damaged package / Damaged or defective product /
   Wrong item / Wrong size / Missing item / Other + mô tả) → ② upload ảnh (≥1) → ③ review & submit → "Under review".
4. **Tiến trình yêu cầu:** timeline con của request. Claim approved hiện: địa chỉ hub return, ai trả phí ship,
   ô nhập tracking number + carrier. Rejected hiện lý do admin.

## 4. Policy engine (hàm thuần — nơi duy nhất tính tiền)

```
evaluateOrderPolicy(input): {
  canCancel: 'free' | 'fee40' | null
  canClaim: boolean            // delivered + ≤14d + chưa có claim mở
  refundPercent: 100 | 60      // cho cancel
  refundAmount, feeAmount      // từ order_total snapshot
}
input: mốc lifecycle (placedAt, brandConfirmedAt, shippedAt, deliveredAt),
       requests hiện có, orderTotal, currency, now
```
- Mốc brand-confirm = milestone `production` trong `order_lifecycle` (ghi bởi webhook MMP).
- **Snapshot tiền tại thời điểm khách gửi yêu cầu** — bất biến; admin refund đúng một con số.
- Server LUÔN re-check policy khi nhận POST (không tin client).
- Unit test đủ nhánh: biên 14 ngày, thiếu mốc, đơn đã có request mở, làm tròn tiền theo currency.

## 5. Schema (migration mới; thay `customer_return_requests` — bảng cũ rỗng, drop)

### `customer_order_requests`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid pk | |
| store_id | uuid fk stores | |
| order_id | uuid fk shopify_orders | |
| shopify_customer_id | text | từ token |
| kind | text | `cancel` \| `claim` |
| status | text | xem state machine dưới |
| reason_codes | text[] | claim |
| description | text | |
| photo_keys | text[] | S3 keys, claim |
| fault | text null | `customer` \| `mean` — admin điền |
| return_hub_id | uuid null fk return_hubs | admin chọn |
| return_shipping_payer | text null | `customer` \| `mean` |
| return_tracking_number / return_carrier | text null | khách nhập |
| order_total / refund_percent / refund_amount / currency | numeric/int/numeric/text | snapshot |
| admin_note / rejected_reason | text null | |
| created_at, reviewed_at, approved_at, tracking_added_at, received_at, qc_at, refunded_at, updated_at | timestamptz | |
| refunded_marked_by | text null | user id admin |

**State machine:**
- `cancel`: `refund_pending → refunded` (policy engine tự duyệt lúc tạo — luật máy tính được; không qua review).
- `claim`: `submitted → under_review → approved | rejected → awaiting_return → return_in_transit → received → qc_done → refund_pending → refunded`; QC fail → `rejected` kèm note (v1).
- Tiền claim: `refund_percent = 100`, `refund_amount = order_total` (snapshot lúc submit). v1 không partial refund.
- Mỗi đơn tối đa 1 request **mở** tại một thời điểm (mọi kind).

### `return_hubs`
`id, label ("US Hub"), recipient_name, address_line1/2, city, state, postal_code, country, phone, active, created_at`.
Admin CRUD trong SMS.

## 6. API khách (Bearer session token — authenticateExtension như hiện tại)

| Endpoint | Việc |
|---|---|
| `GET  /api/customer-account/orders/:id/journey` | milestones + estimate + policy result + requests[] |
| `POST /api/customer-account/orders/:id/requests` | tạo cancel/claim; server re-check policy; snapshot tiền |
| `POST /api/customer-account/uploads` | ảnh claim → S3 (validate type/size) |
| `POST /api/customer-account/requests/:id/tracking` | khách nhập tracking + carrier → `return_in_transit` |

Route `GET /orders` + `GET /orders/:id/timeline` hiện có giữ nguyên (đã dùng cho block order-status).

## 7. Admin (SMS dashboard)

- **`/f/customer-account/requests`** thay trang returns cũ: bảng lọc theo kind/status/store;
  drawer chi tiết: ảnh claim (S3 signed URL), quyết `fault`, chọn `return_hub`, approve/reject (+ note);
  các nút bước: "Đã nhận hàng" → "QC pass/fail" → "Đã refund trong Shopify" (ghi `refunded_marked_by`).
- Cancel-sau-confirm hiện cờ ⚠️ "Báo brand dừng sản xuất" (admin tự xử v1).
- **`/f/customer-account/hubs`**: CRUD return hubs.
- RBAC như hiện tại: `view_functions` xem, `manage_functions` thao tác.

## 8. Extension (shopify-extension/)

- `customer-account-hub` (page.render): thay `Page.tsx` render Order Journey (§3);
  giữ pattern render-plan thuần + module; thêm `lib/journey-api.ts` (gọi API §6) và
  `lib/order-graphql.ts` (ảnh/line items từ Customer Account GraphQL).
- `customer-account-blocks` giữ nguyên (ProfileBlock tier, OrderStatusBlock).
- Config admin `/f/customer-account`: module keys đổi — bỏ `profile`, `credit`;
  `tracking` thành module chính (Order Journey); `returns` gộp vào journey (không còn module riêng);
  `wishlist` giữ chỗ tới sub-project B.

## 9. Testing

- Policy engine: unit test đủ nhánh (mốc thiếu, biên 14d, tiền làm tròn, request mở chặn request mới).
- API: test integration route handlers (mock db) — policy re-check, auth, validate upload.
- State machine: test transition hợp lệ/không hợp lệ.
- Extension: render-plan tests như pattern hiện có; runtime verify bằng deploy lên cici-mean (block Gold là baseline đã chạy).
- KHÔNG bỏ qua `next build` trước khi push (bài học 2026-07-05).

## 10. Ngoài phạm vi (v1)

- Auto refund qua Shopify API (cần write_orders + re-install) — v2.
- Auto-push hủy đơn sang MMP — v2.
- Partial refund cho QC fail — v1 chỉ pass/fail.
- Email notification cho khách (Shopify tự gửi email refund khi admin refund trong Shopify admin).
- Sub-project B (Wishlist page + recommendations) và C (Style Quiz + personalization) — spec riêng.

## 11. Định hướng B & C (chưa phải spec)

- **B — Wishlist page:** full-page extension riêng (`customer-account-wishlist`), nối function wishlist SMS
  sẵn có; khách xem danh sách đã lưu + recommend sản phẩm tương tự (cùng brand/category/tag từ catalog SMS).
- **C — Style Quiz:** full-page extension riêng; quiz phong cách/làn da → lưu preference per-customer trong SMS
  → trang hiện recommendation cá nhân hóa; admin xem insight preference trong SMS.
