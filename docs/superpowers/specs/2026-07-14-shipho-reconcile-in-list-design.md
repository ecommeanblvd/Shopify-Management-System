# Ship-hộ: cột "Đối soát" + action ngay trong table chính

**Date:** 2026-07-14 · **Status:** Approved (design)

## Mục tiêu
Đưa trạng thái + nút đối soát vào **table chính** `/f/ship-ho` (hiện chỉ có ở trang
`/f/ship-ho/reconcile`). Operator xử lý đối soát ngay tại danh sách, không cần vào
trang riêng.

## Trạng thái cột "Đối soát" (cột RIÊNG, cạnh Margin; giữ cột lifecycle "Trạng thái")
| Điều kiện | Nhãn | Hành động |
|---|---|---|
| `reconcileStatus != 'reconciled'` (có tracking, chưa có bill) | **Chờ bill** (mờ) | — |
| chưa ship / không tracking | **—** | — |
| reconciled + decision `null` (khớp tự động) | **✓ Đã đối soát** (xanh) | — |
| reconciled + decision `accepted` / `claim_credited` / `claim_rejected` | **✓ Đã đối soát** (xanh) | — |
| reconciled + decision `pending_review` (có sai lệch) | **⚠ Cần đối soát** (amber) | click → modal accept/claim |
| reconciled + decision `claiming` | **⏳ Đang claim** (amber) | click → modal kết luận credited/rejected |

## Tái dùng (không nhân đôi)
Tách modal + bảng cấu trúc giá 3 phía hiện có (ReconciledRowsTable) thành component
dùng chung: `components/ship-ho/reconcile-decision-ui.tsx`:
- `ReconciledRowData` (type, gồm `structure` + `reconcileDecision`).
- `StructureDetail` (bảng so 3 phía).
- `ReconcileStatusCell({ row, acceptAction, claimAction, resolveAction })` — client,
  tự render badge theo trạng thái + tự quản modal (accept/claim khi pending_review,
  resolve khi claiming). Chặn click-row (stopPropagation) khi bấm.
- helper `vnd`/`signed`.

Trang `/f/ship-ho/reconcile` (ReconciledRowsTable) refactor để dùng `ReconcileStatusCell`
cho cột Action (1 nguồn sự thật).

## Main list `page.tsx`
- Query thêm: `reconcileDecision, deltaVnd, chargedVnd, actualChargedVnd, carrierCostVnd,
  actualCarrierCostVnd, quoteBreakdown, actualBillBreakdown, markupPercent, service`,
  weights (chargeableWeightKg, actualWeightKg), billNumber.
- Tính `shipHoPriceStructure` CHỈ cho đơn reconciled (nhẹ).
- Thêm `<th>Đối soát</th>` + `<td><ReconcileStatusCell .../></td>`; truyền 3 server
  action (acceptShipHoDiscrepancy, claimShipHoWithCarrier, resolveShipHoClaim).
- Cell nằm trong `OrderRow` (row clickable→detail): badge/nút stopPropagation, modal
  render qua portal (Dialog) nên không kích hoạt navigate.

## Test
- `ReconcileStatusCell`: map trạng thái → nhãn đúng, chỉ pending_review/claiming là nút.
  (unit test thuần cho hàm map trạng thái → {label, tone, actionable}.)
- Không đổi logic backend (đã có accept/claim/resolve + gating).

## Ngoài scope
Không đổi luồng backend/MMP. Chỉ là surfacing UI của luồng đối soát đã có.
