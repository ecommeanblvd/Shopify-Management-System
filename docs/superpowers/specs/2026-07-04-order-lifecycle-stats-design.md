# Order Lifecycle — Phase 3 (Thống kê) — Design

> Thống kê thời gian xử lý từng công đoạn vòng đời đơn (avg + median + tỉ lệ overdue),
> breakdown/filter theo brand và carrier, scope theo store, xu hướng theo tháng.
> Trả lời: công đoạn nào chậm, do brand nào / carrier nào.

**Ngày:** 2026-07-04
**Trạng thái:** đã duyệt thiết kế, chờ plan.
**Nhánh:** `feat/order-lifecycle-p3`

## 1. Bối cảnh

P1 đã snapshot mốc vòng đời mọi đơn vào `order_lifecycle`; P2 đã có dashboard theo dõi realtime.
P3 = lớp **phân tích tổng hợp**: đo thời gian trung bình/trung vị từng công đoạn + tỉ lệ trễ, cắt
theo brand/carrier/store/tháng — để quản trị full chuỗi cung ứng (brand sản xuất ↔ carrier vận chuyển).

## 2. Quyết định đã chốt (brainstorm)

| Chủ đề | Quyết định |
|---|---|
| Chỉ số/công đoạn | **avg + median** (giờ) + **tỉ lệ overdue** (duration đoạn > SLA đoạn) |
| Breakdown/filter | **Brand VÀ Carrier** (+ Tháng); đơn nhiều brand/carrier → tính cho mỗi cái (explode) |
| Scope | **Store = workspace** (chọn store / tất cả ở đầu trang) |
| Nguồn | Aggregate `order_lifecycle` (mốc) + join brand (vendor)/carrier (shipments) |
| Ghi DB | KHÔNG (thuần đọc) |

## 3. Công đoạn đo (6 đoạn = SLA keys)

| SLA key | Duration = hiệu 2 mốc (order_lifecycle) |
|---|---|
| `placed_to_production` | `productionStartAt − placedAt` (chỉ đơn có sản xuất) |
| `production` | `goodsReceivedAt − productionStartAt` |
| `qc` | `qcPassAt − goodsReceivedAt` |
| `pack` | `packedAt − (qcPassAt ?? goodsReceivedAt ?? placedAt)` |
| `ship` | `shippedAt − packedAt` |
| `deliver` | `deliveredAt − shippedAt` |

Duration chỉ tính khi **cả 2 mốc có** (đoạn đã hoàn thành); thiếu → bỏ đơn đó khỏi đoạn đó (n giảm).
`overdue` cho 1 đơn ở 1 đoạn = `durationHrs > slaHrs(đoạn)`.

## 4. Data model / kiến trúc (không bảng mới)

### 4.1 `features/lifecycle/stats-queries.ts`
`lifecycleDurations(filter?): Promise<DurationRow[]>` — SQL đọc `order_lifecycle` (mốc) + join:
- brand: distinct `shopifyOrderLines.vendor` của đơn → `brands: string[]`.
- carrier: distinct `shipments.carrierKey` của đơn → `carriers: string[]`.
- `storeId`, `placedMonth` (`to_char(placedAt,'YYYY-MM')`).
- 6 duration (giờ, null nếu thiếu mốc) tính bằng SQL `extract(epoch …)/3600`.
Filter: `storeId?`, `brand?`, `carrier?`, `fromMonth?`, `toMonth?`. Trả `DurationRow`:
`{ orderId, storeId, placedMonth, brands, carriers, dur: Record<SlaKey, number|null> }`.

### 4.2 `features/lifecycle/stats-logic.ts` (thuần, test đầy đủ)
- `median(nums: number[]): number | null` (sort, giữa; rỗng→null).
- `aggregateLifecycle(rows: DurationRow[], sla: Record<SlaKey, number>, groupBy: 'none'|'brand'|'carrier'|'month'): StatGroup[]`
  - Explode theo groupBy (brand/carrier → mỗi phần tử mảng 1 dòng; month → placedMonth; none → 1 nhóm "Tất cả").
  - Mỗi (group × SlaKey): `avgHrs`, `medianHrs`, `overdueRate` (tỉ lệ dur>sla), `n` (số đơn có duration đoạn đó).
  - `StatGroup = { key: string; perStage: Record<SlaKey, { avgHrs: number|null; medianHrs: number|null; overdueRate: number; n: number }> }`.

## 5. UI (P3)

`/f/lifecycle/stats` (RBAC `view_fulfillment`):
- Bộ chọn: **Store** (dropdown, mặc định tất cả) + **khoảng tháng** (from/to) + nút breakdown **Tổng / Brand / Carrier / Tháng**.
- Bảng: hàng = group (hoặc "Tất cả" khi Tổng); cột = 6 công đoạn; mỗi ô hiển thị `avg · median (n)` + màu theo overdueRate (🔴 ≥30% · 🟡 ≥10% · 🟢). Hover/ghi chú overdue%.
- Link về dashboard P2.

## 6. Test & lỗi

- Thuần `stats-logic`: median (lẻ/chẵn/rỗng), aggregate (avg, overdueRate, n theo đoạn thiếu mốc), explode multi-brand (1 đơn 2 brand → tính cả 2), groupBy none/month.
- Query: mỏng (SQL + map) — không unit-test DB; logic thuần đã test.
- Đơn không có mốc nào của 1 đoạn → không tính vào đoạn đó (không kéo avg về 0).

## 7. YAGNI / không làm

- Không p90/percentile khác (chỉ avg+median); không export; không biểu đồ (bảng số là đủ P3);
  không cache/bảng tổng hợp (aggregate on-read, order_lifecycle đã gọn + index).
- Không đổi P1/P2; không ghi DB.
