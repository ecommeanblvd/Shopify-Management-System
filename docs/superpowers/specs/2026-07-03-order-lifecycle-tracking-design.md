# Order Lifecycle Tracking — vòng đời đơn hàng + SLA + dashboard — Design

> Theo dõi trọn vòng đời mọi đơn hàng store: đặt hàng → sản xuất (brand) → QC → packed →
> shipped → vận chuyển theo carrier → delivered → cửa sổ return/refund 30 ngày → completed.
> Đo thời gian từng công đoạn, so với SLA dự kiến, alert delay trên dashboard.

**Ngày:** 2026-07-03
**Trạng thái:** đã duyệt thiết kế (A–E), chờ plan P1.
**Nhánh:** `feat/order-lifecycle`

## 1. Bối cảnh & vấn đề

Hệ thống đã bắt được **hầu hết mốc thời gian** vòng đời đơn nhưng nằm rải rác ~8 bảng
(`shopifyOrders`, `mmpOrderPushes`, `brandOrderRequests`, `orderFulfillmentLines`, `shipments`,
`shopifyOrderRefunds`, `larkOrderStatus`) và đã có derivation 11 stage cho worklist
(`features/fulfillment/order-stage.ts`). Nhưng CHƯA có:
- Đo **thời gian xử lý từng công đoạn** của từng đơn (duration giữa các mốc).
- Khái niệm **SLA dự kiến** cho từng công đoạn + phát hiện **delay**.
- Mốc bắt đầu các trạng thái carrier (`in_transit`, `out_for_delivery`) — nguồn chỉ có trạng thái hiện tại.
- **Cửa sổ 30 ngày sau delivered** (return/refund) → đơn mới thực sự **completed**.
- **Dashboard** nhìn full chuỗi xử lý + alert công đoạn trễ để báo khách / làm việc với brand.

## 2. Quyết định đã chốt (brainstorm)

| Chủ đề | Quyết định |
|---|---|
| Phạm vi đơn | **Mọi store đang kết nối** (đơn Shopify đã sync; ship hộ KHÔNG thuộc scope này) |
| Nguồn SLA | **Mặc định toàn hệ thống, admin sửa trong UI**; sản xuất ưu tiên `expectedDeliveryDate` của brand nếu có |
| Kênh alert | **Chỉ dashboard** (badge/lọc/sort theo mức trễ) — chưa gửi Lark/email |
| Return/refund | **Đọc tín hiệu có sẵn** (refund Shopify + Lark 'Return-Processing') — không xây workflow return riêng |
| Kiến trúc | **A — snapshot table + cron** (không derive-on-read, không event-sourcing) |
| Phasing | **P1 nền tảng dữ liệu → P2 dashboard → P3 thống kê** — mỗi phase 1 plan riêng |

## 3. Mô hình công đoạn (stage machine)

Chuỗi chính + mốc vào stage (nguồn có sẵn; ✚ = cron stamp lần-đầu-thấy vì nguồn không lưu):

| # | Stage key | Vào stage khi | Mốc (nguồn) |
|---|---|---|---|
| 1 | `placed` | Đơn sync vào | `shopifyOrders.createdAtShopify` |
| 2 | `production` | Push brand (đơn có line out-of-stock) | start `mmpOrderPushes.sentAt`; confirm `brandOrderRequests.confirmedAt`; ETA `brandOrderRequests.expectedDeliveryDate` (fallback `larkOrderStatus.expectedDeliveryDate`); xong `brandOrderRequests.deliveredAt` (max các request của đơn) |
| 3 | `qc` | Lark KCS | `larkOrderStatus.qcStatus='pass'` ✚ (`qcPassAt`) |
| 4 | `packed` | Đóng gói xong | min(`orderFulfillmentLines.packedAt`) fallback min(`shipments.createdAt`) |
| 5 | `shipped` | Bàn giao carrier | min(`shipments.labelCreatedAt`) fallback lần đầu có trackingNumber ✚ |
| 6 | `in_transit` | Carrier bắt đầu vận chuyển | first-seen `deliveryStatus='in_transit'` ✚ (`inTransitAt`) |
| 7 | `out_for_delivery` | Carrier đi giao | first-seen `deliveryStatus='out_for_delivery'` ✚ (`outForDeliveryAt`) |
| 8 | `delivered` | TẤT CẢ pack delivered (hoặc Lark 'Delivery Completed') | max(`shipments.deliveredAt`) fallback first-seen Lark ✚ |
| 9 | `post_delivery` | Cửa sổ 30 ngày sau delivered | bắt đầu = deliveredAt; con-trạng-thái: `return_processing` (Lark 'Return-Processing' ✚) / `refunded` (`shopifyOrderRefunds.refundedAt` đầu tiên) |
| 10 | `completed` | deliveredAt + 30 ngày & không có return đang xử lý | derive (cron set `completedAt`) |

**Terminal states:** `completed` · `refunded_full` (financialStatus='refunded') · `cancelled`
(`cancelledAtShopify`) · đơn `exception` (mọi giai đoạn: pack `deliveryStatus='exception'` hoặc Lark
Package Lost/Return-Processing trước delivered) → CỜ `exception` (không phải stage riêng — đơn vẫn
ở stage hiện tại + cờ đỏ; hết exception thì cờ tự hạ ở lần sync sau).

**Skip rules:** đơn đủ tồn kho (không push brand) → bỏ qua `production` (không tính SLA sản xuất);
`qc` chỉ áp khi có dữ liệu Lark QC; `in_transit`/`out_for_delivery` có thể bị carrier nhảy cóc —
stage sau tự bao stage trước (mốc nào không có thì duration gộp vào đoạn kế).

**Đơn nhiều kiện:** tiến độ đơn = kiện chậm nhất (delivered khi tất cả pack delivered) — nhất quán
`order-stage.ts` hiện có.

## 4. SLA & delay

### 4.1 Bảng `lifecycle_sla` (cấu hình, admin sửa trong UI)
1 dòng / đoạn SLA, `targetHours` int. Seed mặc định:

| key | Đoạn đo | Mặc định |
|---|---|---|
| `placed_to_production` | placed → push brand (chỉ đơn cần brand) | 24h |
| `production` | push brand → hàng về kho | 240h (10 ngày) — **ưu tiên ETA brand nếu có** (deadline = expectedDeliveryDate) |
| `qc` | hàng về kho → QC pass | 48h |
| `pack` | QC pass (hoặc placed nếu skip production/qc) → packed | 48h |
| `ship` | packed → shipped | 24h |
| `deliver` | shipped → delivered | 168h (7 ngày) |

`post_delivery → completed` là **window cố định 30 ngày**, không phải SLA (không alert trễ).

### 4.2 Delay
- Deadline stage hiện tại = mốc vào stage + `targetHours` (riêng `production` = ETA brand nếu có).
- `delayStatus`: `on_track` / `due_soon` (đã dùng ≥80% thời gian) / `overdue` (+`delayHours` = số giờ quá hạn).
- Terminal/`post_delivery`/`completed` → `on_track` (không deadline).

## 5. Data model (P1, migration mới)

### 5.1 `lifecycle_sla`
`id` uuid PK · `key` text unique (6 key §4.1) · `targetHours` int notNull · `note` text ·
`updatedAt` timestamp. Seed 6 dòng khi migrate (INSERT ... ON CONFLICT DO NOTHING).

### 5.2 `order_lifecycle` (1-1 với shopifyOrders)
- `orderId` uuid FK unique · `storeId` uuid FK.
- `currentStage` text (stage key §3) · `exception` boolean default false · `exceptionNote` text.
- Mốc: `placedAt` · `productionStartAt` · `productionConfirmedAt` · `productionEta` (date) ·
  `goodsReceivedAt` · `qcPassAt` ✚ · `packedAt` · `shippedAt` · `inTransitAt` ✚ ·
  `outForDeliveryAt` ✚ · `deliveredAt` · `returnProcessingAt` ✚ · `refundedAt` ·
  `completedAt` · `cancelledAt` (tất cả timestamp nullable).
- Delay: `deadline` timestamp · `delayStatus` text ('on_track'|'due_soon'|'overdue') ·
  `delayHours` int default 0.
- `syncedAt` timestamp. Index: (`currentStage`), (`delayStatus`), (`storeId`).
✚ = giá trị stamp-lần-đầu-thấy: cron chỉ SET khi đang null (không ghi đè).

### 5.3 Logic thuần (unit-test đầy đủ)
`deriveLifecycle(signals, prev, slaMap, now)` → snapshot mới:
- `signals`: gom từ các bảng nguồn (shape input thuần, orchestrator lo query).
- `prev`: snapshot hiện có (giữ các mốc ✚ đã stamp).
- Trả: currentStage + mốc + deadline + delayStatus/delayHours + exception.

### 5.4 Cron `sync-lifecycle` (~30 phút/lần, Railway pattern hiện có)
- Quét đơn **chưa terminal** (currentStage ∉ {completed, refunded_full, cancelled}) HOẶC chưa có
  snapshot, đơn tạo ≤ 120 ngày.
- Batch-load tín hiệu nguồn (GROUP BY orderId như `worklist-status-queries.ts`) → `deriveLifecycle`
  → upsert.
- Chạy lần đầu = backfill (tự nhiên, vì mọi đơn chưa có snapshot).

## 6. Dashboard (P2)

- **`/f/lifecycle`** (RBAC `view_fulfillment`): bảng đơn — Store · Order# · Brand(s) · Stage hiện
  tại · Ở stage bao lâu · Deadline · Badge delay (🟢/🟡/🔴 + giờ trễ) · cờ exception. Lọc theo
  stage / delayStatus / store; sort mặc định delayHours giảm dần. Đếm tổng theo stage (chips).
- **Chi tiết đơn** (`/f/lifecycle/[orderId]` hoặc mở rộng trang fulfillment detail hiện có):
  **timeline dọc** các mốc §3 + duration từng đoạn + so SLA (xanh/đỏ từng đoạn) + link
  tracking/shipment/refund.
- **Cấu hình SLA** (`/f/lifecycle/sla`, RBAC `manage_fulfillment`): sửa `targetHours` 6 key.

## 7. Thống kê (P3)

- Trang tổng hợp: **thời gian trung bình từng công đoạn** (median/avg) theo brand · carrier ·
  store · tháng; tỉ lệ đơn overdue theo công đoạn. Nguồn: aggregate trên `order_lifecycle`
  (đã có đủ mốc). Trả lời "khâu nào chậm, do brand nào / carrier nào".
- (Không kênh alert ngoài — theo quyết định §2; có thể thêm digest Lark sau này nếu cần.)

## 8. Test & lỗi

- **Thuần:** `deriveLifecycle` là trọng tâm test — mỗi transition, skip rules, first-seen không ghi
  đè, multi-pack chậm nhất, exception flag on/off, deadline theo ETA brand, delay 3 mức,
  completed+30d, refund/cancel terminal.
- **Cron:** lỗi 1 đơn không abort batch (gom errors, log); nguồn thiếu (Lark null) → stage vẫn
  derive từ tín hiệu còn lại.
- **UI:** đọc snapshot — không tính toán nặng client.

## 9. YAGNI / không làm

- Không event-sourcing; không alert Lark/email (dashboard-only); không workflow return riêng;
  không SLA per-brand/per-carrier (chỉ ETA brand cho production) — P3+ nếu cần.
- Không đụng `order_fulfillment.status` rollup cũ (giữ nguyên, không refactor).
- Ship hộ ngoài scope (đã có tracking riêng).

## 10. Phân rã phase

| Phase | Deliverable | Ghi chú |
|---|---|---|
| **P1** | `lifecycle_sla` + `order_lifecycle` + `deriveLifecycle` (thuần, test) + cron + backfill | Migration mới + seed; sau P1 dữ liệu đã đo được |
| **P2** | Dashboard `/f/lifecycle` + timeline chi tiết + trang SLA | Chỉ đọc snapshot |
| **P3** | Thống kê avg/median theo brand/carrier/tháng | Aggregate queries + UI |
