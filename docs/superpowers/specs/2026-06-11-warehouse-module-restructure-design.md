# Spec: Tách "Kho hàng" thành module độc lập (điều hướng + route)

**Ngày:** 2026-06-11
**Phạm vi:** điều hướng/sidebar, cấu trúc route, redirect — KHÔNG đổi logic nghiệp vụ.
**Specs nền:** [Warehouse core & auto-allocation](./2026-06-10-warehouse-core-auto-allocation-design.md), [Phase A — Nhập kho & QC](./2026-06-09-order-ops-phaseA-goods-receiving-qc-design.md)

## 0. Bối cảnh & quyết định (cùng operator, 2026-06-11)

Hiện tại "Nhập kho & QC" chiếm một mục sidebar riêng, trong khi Kho hàng và Khu chờ
— phần lõi của hệ thống — chỉ là 2 nút trong header trang Vận hành đơn. Nhập & QC
thực chất chỉ là MỘT BƯỚC của quy trình kho.

Quyết định đã chốt:
1. **Một module "Kho hàng" duy nhất** trên sidebar; bên trong là các tab
   `Tồn kho · Khu chờ · Nhập kho & QC`. Mục "Nhập kho & QC" rời sidebar.
2. **Chuyển URL sang `/f/warehouse/*`**, redirect vĩnh viễn từ URL cũ.
3. "Yêu cầu brand" và worklist GIỮ ở Vận hành đơn (không gộp vào Kho hàng).

## 1. Sidebar (`lib/nav.ts`)

```
Dashboard
Orders
Vận hành đơn      → /f/fulfillment
Kho hàng          → /f/warehouse        (icon: Warehouse, lucide-react)
Carrier rates
Đối soát phí ship
Products
Functions
Settings
```

- Xoá item `Nhập kho & QC` (`/f/fulfillment/receiving`).
- Item `Kho hàng` hiện khi role có `view_fulfillment` **hoặc** `view_receiving`
  → `NavItem.requires` hiện chỉ nhận 1 permission; mở rộng kiểu này thành
  `Permission | Permission[] | null` (mảng = OR) và cập nhật chỗ filter trong
  `Sidebar.tsx` (hàm `hasPermission` gọi theo từng phần tử).

## 2. Route mới + layout tab

```
app/(dashboard)/f/warehouse/
  layout.tsx              ← tab bar dùng chung
  page.tsx                ← Tồn kho   (WarehouseBoard — chuyển từ f/fulfillment/warehouse)
  staging/page.tsx        ← Khu chờ   (StagingBoard — chuyển từ f/fulfillment/staging)
  receiving/page.tsx      ← Nhập kho & QC (chuyển từ f/fulfillment/receiving)
  receiving/[id]/page.tsx ← Chi tiết phiếu nhập (chuyển nguyên trạng)
```

- `layout.tsx`: server component, render heading module + tab bar
  `Tồn kho · Khu chờ · Nhập kho & QC`; tab active theo segment hiện tại
  (client sub-component nhỏ dùng `usePathname`, hoặc so khớp segment server-side
  — chọn cách đơn giản khớp codebase). Tab "Nhập kho & QC" chỉ render khi role
  có `view_receiving`. Tab bar cũng active khi đang ở route con
  (`/f/warehouse/receiving/[id]` → tab Nhập kho & QC sáng).
- Mỗi `page.tsx` GIỮ NGUYÊN guard quyền hiện có của nó (view_fulfillment cho
  Tồn kho/Khu chờ, view_receiving cho Nhập & QC) — layout chỉ lo hiển thị tab.
- Nội dung trang không đổi — chỉ di chuyển file + sửa import path nếu cần.

## 3. Redirect (next.config)

Redirect vĩnh viễn (`permanent: true`):

| Cũ | Mới |
|---|---|
| `/f/fulfillment/warehouse` | `/f/warehouse` |
| `/f/fulfillment/staging` | `/f/warehouse/staging` |
| `/f/fulfillment/receiving` | `/f/warehouse/receiving` |
| `/f/fulfillment/receiving/:id` | `/f/warehouse/receiving/:id` |

Lưu ý thứ tự khai báo: rule `:id` đứng được sau rule tĩnh (path khác nhau, không
che nhau). Kiểm tra file cấu hình Next thực tế của repo (`next.config.*`) và
giữ các cấu hình sẵn có.

## 4. Dọn tham chiếu nội bộ

- `app/(dashboard)/f/fulfillment/page.tsx`: bỏ 2 nút "Kho MEAN", "Khu chờ"
  (đã có sidebar); giữ "Yêu cầu brand" + BackfillButton.
- `features/fulfillment/warehouse-actions.ts`: mọi
  `revalidatePath('/f/fulfillment/warehouse')` → `/f/warehouse`.
- `features/receiving/actions.ts`: `revalidatePath` các path receiving cũ →
  `/f/warehouse/receiving` (+ `/[id]` tương ứng).
- Grep toàn repo `/f/fulfillment/(warehouse|staging|receiving)` — mọi link/href
  còn lại trỏ sang path mới (kể cả link trong receiving/page.tsx sang `[id]`).

## 5. Không đổi

- Toàn bộ logic kho: ledger, allocator, release, staging queries, migration script.
- Permissions hiện có (`view_fulfillment`, `view_receiving`, `manage_warehouse`,
  `manage_receiving`…) — không thêm permission mới.
- `/f/fulfillment` (worklist), `/f/fulfillment/[orderId]`,
  `/f/fulfillment/brand-requests` giữ nguyên.

## 6. Kiểm thử & nghiệm thu

- `npx vitest run` xanh nguyên (không đụng logic — 822+ pass).
- `npx tsc --noEmit`, eslint các file đổi: sạch.
- `npx next build` pass (route mới + redirects hợp lệ).
- Kiểm tay: 4 route mới render đúng; 3+1 redirect cũ→mới hoạt động; tab bar
  active đúng theo trang; user chỉ có `view_receiving` thấy module Kho hàng
  nhưng chỉ vào được tab Nhập & QC.
