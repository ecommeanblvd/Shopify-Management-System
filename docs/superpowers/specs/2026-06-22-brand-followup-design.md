# Brand follow-up: cảnh báo quá hạn + đóng khi giao tới (hệ #2) — Design

> Sub-project #2 của chương trình vận hành đơn. #1 (verify địa chỉ) đã merge (#212).

**Ngày:** 2026-06-22
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.

## 1. Mục tiêu

Báo brand + theo dõi ngày giao dự kiến **đã build phần lớn**:
- Báo brand: `sendBrandRequest`/`sendPendingBrandRequests` → MMP.
- Brand confirm + `expectedDeliveryDate`: webhook `app/api/mmp/order-confirmations/route.ts`
  (MMP → SMS) tự set `brand_order_requests.{confirmStatus, expectedDeliveryDate, note,
  confirmedAt}` + line status.
- Follow-up: `BrandRequestsTable` (badge confirm, cột ngày giao, filter `followUpOnly`),
  `isFollowUpDue`, `listAwaitingGoods`.

**Còn thiếu (đã chốt 2 mảng):**
- (a) **Cảnh báo quá hạn**: hiện chỉ có filter trong bảng — cần banner/đếm chủ động.
- (b) **Đóng follow-up khi brand giao tới**: `BrandRequestsTable`/`isFollowUpDue` đọc
  `confirmStatus` (mãi `confirmed`) nên **không tự đóng** khi hàng đã về → request quá-ngày
  vẫn báo "due" vĩnh viễn dù brand đã giao.

KHÔNG làm: nhập tay ngày giao (brand confirm qua MMP webhook là đủ).

## 2. Quyết định đã chốt

- Mốc **"brand giao tới" = lúc NHẬP HÀNG (receipt)** — set khi `addReceiptItem` ghi item có
  `brandRequestId` (ngay khi hàng về, TRƯỚC KCS).
- Cảnh báo quá hạn = `isFollowUpDue` (confirmed + `expectedDeliveryDate ≤ hôm nay` + chưa
  giao).

## 3. Đã có sẵn (tái dùng)

- `goods_receipt_items.brandRequestId` (FK → brand_order_requests) — liên kết hàng nhập ↔
  request.
- `features/receiving/actions.ts`: `addReceiptItem(input{brandRequestId?,...})`, `recordQc`.
- `features/fulfillment/brand-logic.ts`: `isFollowUpDue(req, todayIso)`.
- `components/fulfillment/BrandRequestsTable.tsx`: filter `followUpOnly`.
- `features/fulfillment/brand-queries.ts`: `listBrandRequests` (đã trả confirmStatus,
  expectedDeliveryDate).

## 4. Kiến trúc & component

### (b) Đóng follow-up khi giao tới
- **Migration** `0074_brand-request-delivered-at.sql` (idx 74, sau 0073_lark-sync-runs):
  `ALTER TABLE brand_order_requests ADD COLUMN delivered_at timestamp;` + cập nhật
  `db/schema.ts` (`deliveredAt: timestamp('delivered_at')`) + journal entry.
- **`features/receiving/actions.ts` `addReceiptItem`**: sau khi insert receipt item, nếu
  `input.brandRequestId` có → `UPDATE brand_order_requests SET delivered_at = now(),
  updated_at = now() WHERE id = brandRequestId AND delivered_at IS NULL` (idempotent — chỉ set
  lần đầu). Trong cùng transaction nếu addReceiptItem dùng tx.
- **`isFollowUpDue`** (brand-logic.ts) — thêm điều kiện `deliveredAt == null` (nhận thêm field):
  ```ts
  isFollowUpDue(req: { confirmStatus: string; expectedDeliveryDate: string | null; deliveredAt: Date | string | null }, todayIso): boolean
  // = confirmStatus==='confirmed' && expectedDeliveryDate!=null && expectedDeliveryDate<=todayIso && deliveredAt==null
  ```
- **`listBrandRequests`** + **`BrandRequestsTable`** + **`listAwaitingGoods`**: trả thêm
  `deliveredAt`; bảng hiện cờ "✓ đã giao" + loại khỏi follow-up; `listAwaitingGoods` thêm điều
  kiện `delivered_at IS NULL` (chốt: dù line vì lý do gì còn brand_confirmed, đã giao thì
  không "đang chờ").

### (a) Cảnh báo quá hạn
- **`features/fulfillment/brand-logic.ts` `countOverdueFollowUps(rows, todayIso): number`** —
  **THUẦN**: đếm rows `isFollowUpDue`. Test thuần.
- **Banner**: component `BrandOverdueBanner` (client, type-only import) trên trang vận hành
  (`app/(dashboard)/f/fulfillment/page.tsx`) + trang `brand-requests`: hiện "⚠ N đơn brand
  quá hạn giao — cần follow-up" khi count>0, link tới brand-requests?followup=1 (hoặc bật
  `followUpOnly`). Count tính server-side (RSC) từ `listBrandRequests`.

## 5. Guard / lỗi

- `addReceiptItem` set `deliveredAt` **idempotent** (`WHERE delivered_at IS NULL`) — nhập lại
  không đổi mốc.
- `brandRequestId` null → không đụng brand request (giữ nguyên hành vi).
- isFollowUpDue/countOverdue thuần, không I/O.
- Banner count = 0 → không render.

## 6. Test (TDD)

- `isFollowUpDue` (thuần): confirmed+quá-ngày+chưa-giao → true; đã giao (deliveredAt) → false;
  chưa tới ngày → false; awaiting → false; confirmed không ngày → false.
- `countOverdueFollowUps` (thuần): đếm đúng số due.
- `addReceiptItem` set deliveredAt / listBrandRequests trả deliveredAt = integration (repo
  không test DB) → verify tsc/build.

## 7. Ngoài phạm vi (hệ #2)

- Nhập tay ngày giao/confirm (đã loại — dùng webhook MMP).
- KCS (hệ #3 — `recordQc` đã có sẵn, sẽ wire UI sau).
- Track API (#4), Label (#5).
- Nhắc qua email/Slack (chỉ banner trong app; thông báo ngoài để sau nếu cần).
