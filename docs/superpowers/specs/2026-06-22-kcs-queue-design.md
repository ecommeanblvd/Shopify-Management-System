# KCS — hàng đợi "Chờ KCS" gộp (hệ #3) — Design

> Sub-project #3 của chương trình vận hành đơn. #1 (verify địa chỉ), #2 (brand follow-up) đã merge.

**Ngày:** 2026-06-22
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.

## 1. Mục tiêu

KCS (kiểm chất lượng) **đã build đầy đủ**:
- Backend: `recordQc` (pass/fail + lý do + ảnh + disposition allocate/store/return + xử lý fail
  → mở lại brand request). Field QC đầy đủ trên `goods_receipt_items`
  (`qcResult/qcFailReason/qcFailPhotoKey/qcCheckedBy/qcCheckedAt/disposition`).
- UI: trang chi tiết phiếu nhập `receiving/[id]` có form QC pass/fail (lý do + ảnh, gate
  `manage_qc`); luồng đạt → disposition `allocate_to_order` → staging → đóng gói.

**Thiếu**: QC nằm **rải trong từng phiếu nhập** — chưa có **hàng đợi gộp** để KCS xem mọi đơn vị
`qcResult='pending'` across mọi phiếu ở 1 chỗ, làm liền tay.

## 2. Quyết định đã chốt

- **Trang riêng** `/f/warehouse/qc` (không phải tab trên receiving).
- Sort **cũ nhất trước** (FIFO).
- Tái dùng `recordQc` + form QC hiện có (tách dùng chung).

## 3. Đã có sẵn (tái dùng)

- `features/receiving/actions.ts`: `recordQc(input)`, `uploadReceiptImage(formData)`.
- `features/receiving/queries.ts`: `getReceiptDetail` (mẫu resolve ảnh signed URL).
- `app/(dashboard)/f/warehouse/receiving/[id]/page.tsx`: form QC inline (`passAction`/`failAction`).
- Quyền `manage_qc`, `view_receiving`.

## 4. Kiến trúc & component

### Tách dùng chung (DRY)
- **`features/receiving/qc-actions.ts`** ('use server') — tách từ `[id]` page:
  - `qcPassAction(formData: FormData)` — `recordQc({ itemId, qcResult: 'pass' })`.
  - `qcFailAction(formData: FormData)` — upload ảnh (nếu có) qua `uploadReceiptImage` →
    `recordQc({ itemId, qcResult: 'fail', qcFailReason, qcFailPhotoKey })`.
  - Cả hai `revalidatePath('/f/warehouse/qc')` (+ `revalidatePath('/f/warehouse/receiving')`).
- **`components/receiving/QcActions.tsx`** (server component, prop `{ itemId: string }`): nút
  "Đạt" (`<form action={qcPassAction}>`) + form "Không đạt" (`reason` required + `failPhoto`
  file required, `<form action={qcFailAction} encType="multipart/form-data">`). Giống markup
  hiện có trong `[id]`.
- **Refactor** `receiving/[id]/page.tsx`: thay form QC inline + `passAction`/`failAction` cục bộ
  bằng `<QcActions itemId={it.id} />` (import từ qc-actions). Giảm trùng.

### Query
- **`features/receiving/queries.ts` `listPendingQcItems()`**: select `goods_receipt_items`
  `qcResult='pending'`, join `goods_receipts` (code, sourceType), `shopify_orders` (orderNumber
  qua `orderId`, leftJoin), trả `{ id (itemId), unitCode, sku, productTitle, variantTitle,
  photoUrl (signed từ photoKey), receiptCode, sourceType, orderNumber, brandSlug (nếu có qua
  brandRequestId→brand_order_requests), createdAt }`. Sort `createdAt asc` (FIFO). Resolve ảnh
  signed URL như `getReceiptDetail`.

### Trang queue
- **`app/(dashboard)/f/warehouse/qc/page.tsx`**: gate session + `view_receiving` (redirect nếu
  thiếu). Lấy `listPendingQcItems()`. Mỗi item: ảnh (nếu có), mã unit + sku/title, phiếu/nguồn,
  đơn liên quan, brand; + `<QcActions itemId={it.id}/>` (chỉ render khi `manage_qc`). Trống →
  "Không có hàng chờ KCS." Header đếm tổng.
- **Nav**: thêm link "Chờ KCS" trong `app/(dashboard)/f/warehouse/layout.tsx` (cạnh
  receiving/staging), badge đếm pending nếu dễ (optional — có thể chỉ link).

## 5. Guard / lỗi

- `recordQc` đã chặn double-QC (`if item.qcResult !== 'pending' → throw 'Đơn vị này đã QC'`) →
  2 người QC cùng item: người sau lỗi (đã có). Sau QC, item rời queue (revalidate).
- Form fail: `reason` + `failPhoto` required (giữ như hiện tại).
- Gate `manage_qc` để hiện action; `view_receiving` để xem.
- ảnh resolve lỗi → bỏ qua ảnh (không chặn item).

## 6. Test (TDD)

- Ít logic thuần mới (chủ yếu query + UI). `recordQc` (disposition/fail) đã có test.
- `listPendingQcItems`/trang/qc-actions = integration (repo không test DB) → verify tsc/build.
- Nếu tách được helper thuần (vd format dòng item) thì test, nhưng không bắt buộc.

## 7. Ngoài phạm vi (hệ #3)

- Đổi logic QC/disposition (giữ nguyên `recordQc`/`decideDisposition`).
- QC theo lô/nhiều item một lần (giữ per-item).
- Track API (#4), Label (#5).
- Thống kê/he dashboard QC (chỉ queue + đếm).
