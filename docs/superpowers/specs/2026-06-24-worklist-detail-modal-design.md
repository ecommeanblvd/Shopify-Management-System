# Worklist: sticky header + modal chi tiết đơn — Design

> Bảng Vận hành đơn: (1) header dính khi scroll; (2) click đơn → mở **modal** chi tiết (hiện đang
> nav sang page riêng styling như "tờ giấy trắng") với tóm tắt đơn (hệ thống) + khối Lark vận hành
> curated.

**Ngày:** 2026-06-24
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.
**Nhánh:** `feat/worklist-detail-modal`

## 1. Quyết định đã chốt

- **Sticky header**: `thead` `sticky top-0 z-10` + nền → dính khi scroll trang. CSS thuần.
- **Modal**: row click → mở `<Dialog>` (Radix, `components/ui/dialog.tsx` sẵn có), KHÔNG nav. Giữ route
  `[orderId]` làm deep-link (link số đơn mở tab mới được).
- Modal hiển thị 2 khối: **Tóm tắt đơn (hệ thống)** + **Lark vận hành (curated)**. KHÔNG khối chi phí,
  KHÔNG dump hết 89 cột. Theme tối (bỏ `bg-white`).
- Dữ liệu modal qua **server action** `getOrderDetailModal(orderId)` (bọc các query đã có). Lark live,
  best-effort (lỗi → `larkFields: []`).

## 2. Kiến trúc & luồng

```
WorklistTable (client) — row click → setState(openOrderId)
  → <OrderDetailDialog orderId> mở Dialog
      → useEffect/transition gọi server action getOrderDetailModal(orderId)
          → getFulfillmentDetail + listPacksForOrder + getLarkRecordsForOrder(curated)
      → render: loading skeleton → 2 khối
```

## 3. Components

### 3.1 `features/lark/detail.ts` (mở rộng, THUẦN + test)
- Hằng `LARK_DETAIL_FIELDS: string[]` — danh sách field-name curated (đúng tên Lark):
  `LOG-EP-Dispatch Status`, `Sub-Status`, `CX-FF Status (look up)`, `Final | Delivery Status`,
  `Ngày giao dự kiến`, `Ngày giao thực tế`, `Couriers`, `Tracking Number`, `Weights`,
  `Dimension ( điền tay)`, `LOG-Order Remark (Full)`, `CX/Khách note on order (look up)`.
- `pickLarkFields(fields: Record<string, unknown>, names: string[]): Array<{ label: string; value: string }>`
  — THUẦN: với mỗi name theo thứ tự, `larkText(fields[name])`; bỏ field rỗng. (Khác `flattenLarkRecord`:
  chỉ lấy danh sách + giữ thứ tự curated.)

### 3.2 `features/fulfillment/order-modal.ts` (mới — server action)
- `'use server'`. `getOrderDetailModal(orderId: string)` trả serializable bundle:
  ```ts
  {
    summary: {
      orderNumber: string | null; storeName: string | null; createdAtShopify: string | null;
      status: string; address: { line: string | null; deliverable: boolean | null; verifiedAt: string | null } | null;
      lines: Array<{ sku: string | null; qty: number; status: string; productTitle: string | null }>;
      packs: Array<{ code: string; carrierKey: string | null; trackingNumber: string | null; deliveryStatus: string | null; deliveredAt: string | null; weightKg: string | null }>;
    } | null;
    larkFields: Array<{ label: string; value: string }>;
  }
  ```
- Lõi: `getFulfillmentDetail(orderId)` (lines + address) + `listPacksForOrder(orderId)` (packs) + lấy
  storeName/orderNumber/status từ query đơn (hoặc bổ sung select). Lark: lấy record đầu tiên của
  `getLarkRecordsForOrder` **raw fields** → `pickLarkFields`. Nếu chưa có hàm trả raw fields, thêm
  `getLarkRawFieldsForOrder(orderId)` cạnh `getLarkRecordsForOrder` (best-effort → `{}`); modal pick từ đó.
- Auth: kiểm `view_fulfillment` như trang detail (server action tự check session/role).

### 3.3 `components/fulfillment/OrderDetailDialog.tsx` (mới, client)
- Props: `orderId: string | null`, `onClose: () => void` (controlled). Mở khi orderId != null.
- `useEffect` khi mở → `useTransition`/gọi `getOrderDetailModal` → state {loading, data}.
- Render trong `<Dialog open onOpenChange={onClose}>` `<DialogContent>`:
  - Header: số đơn + store + ngày + pipeline badge.
  - Khối "Tóm tắt": lines (bảng), địa chỉ + badge deliverable, packs (tracking link + chip giao + cân/kích thước).
  - Khối "Lark (vận hành)": bảng nhãn→giá trị từ `larkFields`; rỗng → "Không có dữ liệu Lark".
  - Tất cả token theme (không `bg-white`). Loading → skeleton/spinner.

### 3.4 `components/fulfillment/WorklistTable.tsx` (sửa)
- `thead` thêm `className="sticky top-0 z-10 bg-background"` (giữ nền cũ kèm sticky) — header dính khi scroll.
- State `const [openOrderId, setOpenOrderId] = useState<string | null>(null)`.
- Row `onClick`/`onKeyDown` → `setOpenOrderId(row.orderId)` thay `router.push`. (Bỏ `router`/nav row;
  giữ link số đơn `<a href>` deep-link với `stopPropagation`.)
- Render `<OrderDetailDialog orderId={openOrderId} onClose={() => setOpenOrderId(null)} />` cuối component.

### 3.5 `components/fulfillment/LarkDetailCard.tsx` (sửa nhẹ — page fallback)
- Bỏ `bg-white` → token theme (`bg-card`/`border-border`) để page `[orderId]` không còn "tờ giấy trắng".
  (Page vẫn giữ làm deep-link; chỉ sửa style.)

## 4. Guard / lỗi

- Lark fetch lỗi/thiếu env → `larkFields: []`; modal hiện "Không có dữ liệu Lark", không vỡ.
- `getOrderDetailModal` đơn không tồn tại → `summary: null`; modal hiện "Không tìm thấy đơn".
- Server action check quyền `view_fulfillment` (như trang).
- Sticky header không đụng logic lọc/render hàng.

## 5. Test (TDD)

- `pickLarkFields` (thuần): lấy đúng field theo danh sách + thứ tự, bỏ rỗng, field thiếu → bỏ.
- action / Dialog / sticky = integration → verify tsc/vitest/build.

## 6. Ngoài phạm vi

- Bỏ route `[orderId]` (giữ làm deep-link).
- Khối chi phí/đối soát Lark; link mở record Lark gốc.
- Sửa sâu OrderDetailPanel/PackPanel (modal có render gọn riêng).
- Edit dữ liệu trong modal (chỉ xem).
