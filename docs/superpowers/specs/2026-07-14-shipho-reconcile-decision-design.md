# Ship-hộ reconcile decision — Accept / Claim (đối soát khi bill về)

**Date:** 2026-07-14 · **Status:** Approved (design)

## Vấn đề
Khi hoá đơn carrier về, ship-hộ hiện **tự động** đẩy giá thu chính thức
(`order.reconciled`) sang MMP. Cần chèn **bước quyết định thủ công** cho các đơn
CÓ sai lệch giữa chi phí dự tính và cước bill thực: operator xem modal so sánh rồi
chọn **chấp nhận sai lệch (lỗi nội bộ)** hoặc **claim đơn vị vận chuyển**.

## Quyết định (brainstorming)
1. **Chỉ đơn CÓ sai lệch** (`deltaVnd ≠ 0`, bỏ qua lệch làm tròn ≤ vài đồng) mới cần
   duyệt tay. Đơn khớp → tự đẩy giá như cũ.
2. **Accept** (lỗi nội bộ): đẩy `order.reconciled` với giá tính lại theo bill
   (`finalChargedVnd`). Giá thu khách CHÍNH THỨC cập nhật.
3. **Claim** (đòi carrier): đẩy event mới `order.claim_pending` (status "đợi claim
   đơn vị vận chuyển") + lý do (tuỳ chọn). Giá thu **KHÔNG** update (giữ quote).
   Resolve claim xử lý ở bước SAU (ngoài scope lần này).

## Data model — shipHoOrders (migration 0108)
- `reconcileDecision` text: `null | 'pending_review' | 'accepted' | 'claiming'`
  - `pending_review` = bill về, có sai lệch, chờ operator.
  - `accepted` = đã chấp nhận (đã đẩy giá).
  - `claiming` = đã claim (đợi carrier; giá giữ quote).
- `reconcileDecisionAt` timestamp, `reconcileDecisionBy` text→user
- `claimReason` text (nullable)

## reconcile-actions (gate auto-emit)
Trong `reconcileShipHoFromCarrierBillsCore`, sau khi tính `actualChargedVnd` + delta:
- **|delta| ≤ tolerance (vài đồng):** emit `order.reconciled` như cũ; decision để null.
- **|delta| > tolerance:** KHÔNG emit; set `reconcileDecision='pending_review'`
  (chỉ khi decision hiện tại là null/pending — KHÔNG ghi đè accepted/claiming khi
  cron chạy lại). Vẫn lưu breakdown/actualChargedVnd để modal so sánh.

## Server actions (auth: manage_fulfillment)
- `acceptShipHoDiscrepancy(orderId)`: decision='accepted' + decisionAt/By; emit
  `order.reconciled` (finalChargedVnd, previousChargedVnd, deltaVnd…). Idempotent.
- `claimShipHoWithCarrier(orderId, reason?)`: decision='claiming' + claimReason;
  emit `order.claim_pending` (deltaVnd, reason; KHÔNG finalChargedVnd). Idempotent.

## MMP event mới — `order.claim_pending`
Envelope như các event ship-hộ khác. `data`: `{ deltaVnd, estimatedCostVnd,
billedCostVnd, reason?|null }`. MMP set đơn sang trạng thái "đợi claim đơn vị vận
chuyển"; **không** cập nhật giá thu. → viết vào `docs/mmp-outbound-integration.md`
cho team MMP thêm handler.

## UI — bảng đối soát ship-hộ
- Cột **Action** cuối bảng:
  - `pending_review` → nút **"Xử lý đối soát"**.
  - `accepted` → badge **✓ Đã chấp nhận**.
  - `claiming` → badge **⏳ Đợi claim**.
  - còn lại (khớp / chưa có bill) → trống.
- Nút mở **modal**: so sánh Chi phí dự tính ↔ Cước bill thực (tái dùng cấu trúc giá
  3 phía `shipHoPriceStructure`), + ô lý do (tuỳ chọn) + 2 nút:
  **"Chấp nhận sai lệch (lỗi nội bộ)"** / **"Claim đơn vị vận chuyển"**.

## Test
- reconcile gating: delta trong ngưỡng → emit + decision null; ngoài ngưỡng →
  pending_review + KHÔNG emit; cron chạy lại không ghi đè accepted/claiming.
- accept: decision='accepted', emit order.reconciled.
- claim: decision='claiming', emit order.claim_pending, KHÔNG đẩy giá.

## Ngoài scope
- Resolve claim (carrier credit/reject → cập nhật giá cuối) — làm đơn độc lập sau.
