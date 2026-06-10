# Spec: Order Operations — Customer Returns Intake + QC (Sub-project F2)

**Ngày:** 2026-06-10
**Module:** Vận hành đơn — ghi nhận hàng khách trả về + QC (`/f/returns`)
**Specs nền:** [Sub-project A — Goods Receiving & QC](./2026-06-09-order-ops-phaseA-goods-receiving-qc-design.md), [Sub-project F1 — Fulfillment push](./2026-06-10-order-ops-phaseF1-shopify-fulfillment-push-design.md), [Sub-project C1 — Warehouse transfers](./2026-06-10-order-ops-phaseC1-warehouse-transfers-design.md)

## 0. Bối cảnh & phạm vi

F1 đóng vòng ship → Shopify. F2 xử lý chiều ngược: **khách trả hàng về**. Nhưng F2 **KHÔNG** push refund/return lên Shopify — việc hoàn tiền do team CX/Shopify quyết định, SMS chỉ **đọc** trạng thái refund mà Shopify gửi về (`shopifyOrderRefunds`, đã sync sẵn qua webhook).

**Phạm vi F2:** tạo phiếu **ghi nhận nội bộ** rằng hàng hoàn của một đơn đã về kho, **QC per-line (tách pass/fail theo số lượng)**, **QC pass → cộng tồn kho lại** (restock), và **hiển thị + đối chiếu** trạng thái refund từ Shopify (cờ "đã nhận + QC pass nhưng Shopify chưa refund").

**Ngoài phạm vi F2:** push refund/return lên Shopify (`refundCreate`/`returnCreate`); QC per-unit + ảnh bằng chứng từng món (nâng cấp sau nếu cần); exchange/đổi hàng; cron tự động đối chiếu refund. Disposition phức tạp (return-to-brand cho hàng hư) — F2 chỉ cần pass→restock, fail→không cộng tồn (ghi lý do).

## 1. Quyết định đã chốt

- **Chỉ ghi nhận nội bộ + QC, KHÔNG refund qua SMS.** Trạng thái refund phụ thuộc Shopify; SMS đọc từ `shopifyOrderRefunds`.
- **Bắt buộc gắn đơn Shopify.** Một phiếu hoàn = một đơn (`orderId NOT NULL`); line chọn từ các line của đơn → có cơ sở đối chiếu refund.
- **Granularity: per-line + tách pass/fail qty.** Mỗi dòng phiếu là 1 line của đơn với `returnedQty`, khi QC nhập `passQty`/`failQty` (ràng buộc `passQty + failQty ≤ returnedQty`).
- **QC pass → restock.** `qtyOnHand += passQty` vào `warehouseInventory` (tạo row nếu thiếu, đúng pattern receiving Phase A). QC fail → không cộng tồn, ghi `failReason`.
- **Refund: hiển thị + cờ đối chiếu.** Badge refund của đơn (số lần/tổng tiền refund từ `shopifyOrderRefunds`) + cờ `awaiting_refund` khi đã có hàng pass nhưng Shopify chưa refund.
- **Trang Returns riêng** ở route top-level `/f/returns` (theo convention C1 transfers), không nhồi vào trang chi tiết đơn.
- **Permission mới** `warehouse.returns` (`view`/`create`/`edit`) — không tái dùng `warehouse.receiving`/`warehouse.qc` để phân quyền độc lập.
- **Kiến trúc Hướng A: bảng riêng** `customerReturns` + `customerReturnLines` (không mở rộng `goodsReceipts` vì model đó là per-unit + nhiều cột vendor-specific, chỏi với per-line).
- **Layering** theo chuẩn dự án: `features/returns/logic.ts` (thuần, có test) + `queries.ts` + `actions.ts`; restock dùng `sql\`qtyOnHand + passQty\``.

## 2. Mô hình dữ liệu (`db/schema.ts`)

Enum: `customerReturnStatusEnum` = `customer_return_status` `['open','completed','cancelled']`.

### `customerReturns`
| Cột | Kiểu | Ghi chú |
|----|------|--------|
| `id` | uuid PK | |
| `code` | text unique | `CR-<orderNumber>-<seq>` (seq theo số phiếu hiện có của đơn) |
| `orderId` | uuid → `shopifyOrders` (cascade) **NOT NULL** | bắt buộc gắn đơn |
| `warehouseCode` | text NOT NULL default `'HN'` | kho nhận hàng hoàn |
| `status` | `customer_return_status` NOT NULL default `'open'` | open → completed / cancelled |
| `receivedAt` | timestamp NOT NULL default now | mốc nhận hàng về |
| `receivedBy` | text → `user` (set null) | người tạo phiếu |
| `qcDoneAt` | timestamp (nullable) | set khi submit QC |
| `qcDoneBy` | text → `user` (set null) | |
| `note` | text (nullable) | |
| `createdAt` / `updatedAt` | timestamp NOT NULL default now | |

Index: `orderId`, `status`.

### `customerReturnLines`
| Cột | Kiểu | Ghi chú |
|----|------|--------|
| `id` | uuid PK | |
| `returnId` | uuid → `customerReturns` (cascade) NOT NULL | |
| `shopifyLineId` | text NOT NULL | line của đơn được chọn |
| `sku` | text (nullable) | snapshot |
| `productTitle` | text (nullable) | snapshot |
| `variantTitle` | text (nullable) | snapshot |
| `returnedQty` | integer NOT NULL | KH trả về (>0) |
| `passQty` | integer NOT NULL default 0 | QC đạt → restock |
| `failQty` | integer NOT NULL default 0 | QC hư |
| `failReason` | text (nullable) | |
| `restockedQty` | integer NOT NULL default 0 | audit số đã cộng tồn (= passQty lúc submit) |
| `warehouseInventoryId` | uuid → `warehouseInventory` (nullable) | row tồn được cộng |
| `createdAt` / `updatedAt` | timestamp NOT NULL default now | |

Index: `returnId`. Checks: `returned_qty > 0`, `pass_qty >= 0`, `fail_qty >= 0`.

Migration: 1 enum + 2 bảng (+ indexes/checks).

## 3. Luồng

### 3.1 Tạo phiếu (`createReturn`)
1. Operator mở `/f/returns` → "Tạo phiếu hoàn" → search & chọn 1 đơn Shopify.
2. Chọn các line cần ghi nhận trả về + nhập `returnedQty` mỗi dòng (chặn vượt `quantity` của line trừ đi qty đã hoàn ở các phiếu trước — non-cancelled).
3. `validateReturnDraft` → sinh `code` qua `nextReturnCode(orderNumber, seq)` → insert `customerReturns` (status `open`) + `customerReturnLines`.

### 3.2 QC + restock (`submitReturnQc`)
1. Mở `/f/returns/[id]` → mỗi dòng nhập `passQty` / `failQty` / `failReason`.
2. `validateReturnQc` (mỗi dòng `passQty+failQty ≤ returnedQty`, không âm).
3. **Transaction:**
   - Với mỗi dòng có `sku` và `passQty>0`: upsert `warehouseInventory` theo sku → `qtyOnHand += passQty` (insert row mới nếu sku chưa có, đúng pattern `features/receiving/actions.ts`). Ghi `warehouseInventoryId` + `restockedQty = passQty`.
   - Dòng `failQty` → không đụng tồn (chỉ lưu `failReason`).
   - Cập nhật `customerReturns.status = 'completed'`, `qcDoneAt = now`, `qcDoneBy = userId`.
4. Idempotent: phiếu đã `completed` → `submitReturnQc` từ chối (không cộng tồn lần 2).

### 3.3 Huỷ (`cancelReturn`)
- Chỉ khi `status = 'open'` → `cancelled`. Phiếu `completed` không huỷ (đã cộng tồn).

**Bất biến/edge:**
- Không cộng tồn 2 lần (chặn theo `status`).
- Dòng không có sku → không restock (`onHandDelta = 0`), vẫn ghi nhận pass/fail.
- Over-return: tổng `returnedQty` (các phiếu non-cancelled) ≤ `quantity` của line.

## 4. Pure logic (`features/returns/logic.ts`)

Thuần, test không DB/không mạng:
- `nextReturnCode(orderNumber: string, seq: number): string` → `CR-<orderNumber>-<seq>`.
- `validateReturnDraft(input): { ok:true } | { ok:false; error:string }` — `orderId` bắt buộc; ≥1 dòng; mỗi dòng `returnedQty>0`; không trùng `shopifyLineId`.
- `validateReturnQc(lines: { returnedQty; passQty; failQty }[]): { ok:true } | { ok:false; error:string }` — `passQty≥0`, `failQty≥0`, `passQty+failQty ≤ returnedQty`.
- `restockEffect(line: { sku: string | null; passQty: number }): { onHandDelta: number }` — `onHandDelta = sku ? passQty : 0`.
- `refundReconcileFlag(input: { totalPassQty: number; shopifyRefundCount: number }): 'refunded' | 'awaiting_refund' | 'none'` — `shopifyRefundCount>0 → 'refunded'`; `totalPassQty>0 && refundCount===0 → 'awaiting_refund'`; còn lại `'none'`.

## 5. Queries (`features/returns/queries.ts`)

- `listReturns()` → mỗi phiếu: `code`, số đơn (`shopifyOrderNumber`), `receivedAt`, `status`, tổng `passQty`, badge refund (đếm/tổng tiền từ `shopifyOrderRefunds` theo `orderId`) + `refundReconcileFlag`.
- `getReturnWithLines(id)` → phiếu + lines + thông tin đơn + refund của đơn.
- `searchOrdersForReturn(q)` → đơn theo `shopifyOrderNumber`/khách (picker tạo phiếu).
- `getOrderLinesForReturn(orderId)` → lines của đơn + `quantity` + qty đã hoàn (các phiếu non-cancelled) để chặn over-return.

## 6. Actions (`features/returns/actions.ts`)

- `createReturn({ orderId, lines })` — gate `warehouse.returns:create`; validate; sinh code; insert phiếu+lines (`open`).
- `submitReturnQc({ returnId, lines: [{ lineId, passQty, failQty, failReason }] })` — gate `warehouse.returns:edit`; validate; transaction restock + set `completed`.
- `cancelReturn(returnId)` — gate `warehouse.returns:edit`; chỉ khi `open`.

## 7. Permission / Nav / UI

- **Permission** (`lib/auth/permissions.ts`): thêm catalog `{ key:'warehouse.returns', label:'Kho — Hàng hoàn', actions:['view','create','edit'] }`.
- **Nav** (`lib/nav.ts`): alias `view_returns` → `warehouse.returns:view`; entry `/f/returns` "Hàng hoàn".
- **UI:**
  - `/f/returns` (`page.tsx`) — bảng phiếu (code, đơn, ngày nhận, status, badge refund + cờ lệch màu) + nút "Tạo phiếu hoàn" (modal/flow: search đơn → chọn line + nhập `returnedQty`).
  - `/f/returns/[id]` (`[id]/page.tsx`) — form QC từng dòng (`passQty`/`failQty`/`failReason`), nút "Hoàn tất QC" (gọi `submitReturnQc`), panel refund status + cờ đối chiếu; nút "Huỷ" khi `open`.

## 8. Testing

- **Pure** (`features/returns/logic.test.ts`):
  - `nextReturnCode` — định dạng.
  - `validateReturnDraft` — thiếu đơn / rỗng dòng / qty≤0 / trùng line.
  - `validateReturnQc` — `passQty+failQty` =, <, > `returnedQty`; số âm.
  - `restockEffect` — có sku (passQty), không sku (0).
  - `refundReconcileFlag` — 3 nhánh (`refunded`/`awaiting_refund`/`none`).
- **Manual/E2E:** tạo phiếu cho 1 đơn → QC `passQty=2` → `warehouseInventory.qtyOnHand` tăng đúng 2 + `restockedQty=2`; phiếu pass mà đơn chưa có refund trên Shopify → list hiện cờ `awaiting_refund`; submit QC lần 2 bị từ chối (không cộng tồn lặp).

## 9. Files

- `db/schema.ts` — enum `customer_return_status` + bảng `customerReturns`, `customerReturnLines` + migration.
- `features/returns/logic.ts` + `logic.test.ts` — pure logic.
- `features/returns/queries.ts` — list/detail/picker queries.
- `features/returns/actions.ts` — `createReturn`, `submitReturnQc`, `cancelReturn`.
- `lib/auth/permissions.ts` — permission `warehouse.returns`.
- `lib/nav.ts` — alias `view_returns` + nav entry `/f/returns`.
- `app/(dashboard)/f/returns/page.tsx` + `app/(dashboard)/f/returns/[id]/page.tsx` + components (form tạo, form QC, badge refund).

## 10. Lưu ý / tích hợp

- `shopifyOrderRefunds` đã được sync qua webhook (`features/shopify-orders/webhook/dispatch.ts`) và sync đơn (`upsert-order.ts`) — F2 chỉ đọc, không ghi.
- Restock đi qua `warehouseInventory` (keyed by `sku`, unique) như receiving — cùng nguồn tồn để pick/pack đơn sau dùng lại.
- `shopifyLineId`/`quantity` lấy từ `shopifyOrderLines` của đơn; over-return tính trên các phiếu non-cancelled.
- Migration tạo qua công cụ migration hiện có của dự án (xác minh lệnh ở bước plan).
