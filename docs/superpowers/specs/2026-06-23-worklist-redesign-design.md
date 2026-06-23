# Thiết kế lại bảng vận hành — nhìn-nhanh status (Phần A) — Design

> Phần A của việc "redesign worklist + chi tiết Lark". Phần B (fetch Lark detail + vài cột Lark
> sync thêm) là spec riêng, làm sau. Phần A dùng STATUS HỆ THỐNG đã có (#1–#4), không phụ thuộc Lark.

**Ngày:** 2026-06-23
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.

## 1. Mục tiêu

Bảng `/f/fulfillment` (`WorklistTable`) hiện chỉ có **Order# · Store · Ngày · Trạng thái** → không
nhìn-nhanh được đơn đang kẹt ở đâu. Sau #1–#4 hệ thống đã track nhiều status per đơn (verify địa
chỉ, brand, KCS, đóng gói, vận chuyển). Redesign bảng: **đưa ngày lên cột đầu** + thêm các **cột
status nhìn-nhanh** (badge), bấm hàng → trang chi tiết đơn (đã có `[orderId]`; Phần B đổ thêm Lark).

## 2. Quyết định đã chốt

- List = **kết hợp**: Phần A dùng **status hệ thống** (đã track). Vài cột Lark thêm → Phần B.
- Detail = **fetch Lark khi bấm** → Phần B. Phần A: bấm hàng → `/f/fulfillment/[orderId]` (đã có).
- **Ngày lên cột đầu tiên.**

## 3. Cột bảng mới (trái→phải)

1. **Ngày** — `createdAtShopify`, format `dd/MM/yyyy`.
2. **Đơn** — order# + store (1 cụm).
3. **Địa chỉ** — ✓ giao được / ⚠ không giao được / "chưa verify" (từ `shopifyOrders.addrDeliverable/addrVerifiedAt`).
4. **Brand** — Không cần / Chờ confirm / Confirm · `dd/MM` / ✓ Đã giao (gom `brand_order_requests`).
5. **KCS** — — / Chờ / Đạt / Lỗi (gom `goods_receipt_items.qcResult`).
6. **Đóng gói** — Chưa / `N kiện` (gom `shipments`).
7. **Vận chuyển** — tracking + Đang chuyển / Đã giao / Sự cố (gom `shipments.deliveryStatus`).
8. **Tình trạng** — pipeline tổng (`order_fulfillment.status`, badge sẵn).

Bấm 1 hàng → `/f/fulfillment/[orderId]`.

## 4. Kiến trúc & component

### Gom status (tránh N+1)
- `listFulfillmentWorklist` (giữ) trả base như cũ.
- **MỚI** `features/fulfillment/worklist-status-queries.ts`:
  `listWorklistStatus()` — base orders + **3 query GROUP BY** keyed theo orderId (không correlated/N+1):
  - brand: `SELECT order_id, count(*) total, count(*) FILTER (confirm='awaiting') awaiting, count(*) FILTER (confirm='confirmed') confirmed, count(*) FILTER (delivered_at IS NOT NULL) delivered, min(expected_delivery_date) min_expected FROM brand_order_requests GROUP BY 1`.
  - kcs: `SELECT order_id, count(*) FILTER (qc='pending') pending, ... pass, ... fail FROM goods_receipt_items WHERE order_id IS NOT NULL GROUP BY 1`.
  - shipment: `SELECT order_id, count(*) packs, count(*) FILTER (tracking IS NOT NULL) with_tracking, count(*) FILTER (delivery_status='delivered') delivered, count(*) FILTER (delivery_status='exception') exception, count(*) FILTER (delivery_status IN ('in_transit','out_for_delivery')) in_transit FROM shipments GROUP BY 1`.
  Gộp 3 map (theo orderId) vào base rows → trả `WorklistStatusRow[]`.

### Summarizer thuần (TDD) — `features/fulfillment/worklist-status.ts`
- Type `Badge = { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' | 'info' }`.
- `summarizeAddr({ addrDeliverable, addrVerifiedAt }): Badge`
- `summarizeBrand({ total, awaiting, confirmed, delivered, minExpected }): Badge` — total=0 → "Không cần"(muted); delivered=total → "✓ Đã giao"(ok); awaiting>0 → "Chờ confirm"(warn); confirmed>0 → `Confirm · ${fmt(minExpected)}`(info).
- `summarizeKcs({ pending, pass, fail }): Badge` — fail>0 → "Lỗi"(bad); pending>0 → "Chờ"(warn); pass>0 → "Đạt"(ok); else "—"(muted).
- `summarizeDelivery({ packs, withTracking, delivered, exception, inTransit }): Badge` — packs=0 → "Chưa"(muted); exception>0 → "Sự cố"(bad); delivered=packs → "Đã giao"(ok); inTransit>0 → "Đang chuyển"(info); withTracking>0 → "Có tracking"(info); else "Chưa ship"(muted).
- (Pipeline + pack-count hiển thị trực tiếp, không cần summarizer.)

### UI — `components/fulfillment/WorklistTable.tsx` (redesign)
- Mở rộng `WorklistRow` type với các field gom + addr.
- Header + render theo 8 cột §3; badge dùng `tone`→class (record màu). Ngày cột đầu.
- Mỗi hàng `<Link href={/f/fulfillment/${orderId}}>` (hoặc onClick router.push) — click mở chi tiết.
- Giữ filter "Tất cả trạng thái" (theo pipeline status như cũ).
- Trang `app/(dashboard)/f/fulfillment/page.tsx`: đổi `listFulfillmentWorklist` → `listWorklistStatus` (hoặc gọi summarizer ở page rồi truyền badge xuống — `worklist-status.ts` thuần, import value an toàn cho client; nhưng để tránh kéo db, page (RSC) gọi query + summarizer rồi truyền `WorklistRow` đã-tính-badge xuống bảng).

## 5. Guard / lỗi

- Đơn không có brand/kcs/shipment → map thiếu key → summarizer nhận 0 → badge "muted/—".
- Ngày null → "—".
- Không đổi logic #1–#4; chỉ đọc + hiển thị.

## 6. Test (TDD)

- `summarizeAddr/Brand/Kcs/Delivery` (thuần): mọi nhánh badge (vd brand: total0→Không cần, delivered=total→Đã giao, awaiting→Chờ, confirmed→Confirm+ngày; kcs fail/pending/pass/—; delivery các trạng thái).
- `listWorklistStatus` / UI = integration (repo không test DB) → verify tsc/build.

## 7. Ngoài phạm vi (Phần A)

- **Phần B**: fetch Lark detail khi bấm (live) + sync thêm vài cột status Lark vào list — spec riêng.
- Phân trang worklist (giữ render-all như hiện tại; tách nếu cần sau).
- Đổi pipeline status/logic #1–#4.
