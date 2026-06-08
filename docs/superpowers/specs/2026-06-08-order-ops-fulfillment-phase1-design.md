# Spec: Order Operations / Fulfillment — Phase 1

**Ngày:** 2026-06-08
**Module:** Vận hành đơn hàng (Order Operations) — route mới `/f/fulfillment`

## 0. Bối cảnh & phân chia phase

Toàn bộ vòng đời vận hành đơn được bóc tách thành 4 phase độc lập (mỗi phase một spec → plan → triển khai riêng):

- **Phase 1 (spec này):** Nền tảng order-ops + state machine + check tồn kho MEAN + hiển thị kệ/tầng + trọn luồng còn-hàng **pick → pack → ship** + quản lý kho. Hết hàng chỉ gắn cờ `out_of_stock` (điểm vào Phase 2, chưa xây).
- **Phase 2 (sau):** Đẩy đơn thiếu hàng ra MMP (hệ ngoài) qua tích hợp 2 chiều; brand confirm + điền ngày giao dự kiến; theo dõi.
- **Phase 3 (sau):** Metafield min/max production time → tính ship-by; so ngày brand; phối hợp CX gửi email.
- **Phase 4 (sau):** Tracking delivered; cửa sổ return/refund 30 ngày; auto-complete.

State machine ở Phase 1 được thiết kế **mở rộng được** cho các phase sau.

## 1. Mục tiêu Phase 1

Khi đơn về từ store → tạo bản ghi vận hành → tự động đối chiếu tồn kho MEAN theo từng dòng sản phẩm. Dòng **còn hàng** hiển thị **kệ/tầng** để ops đi lấy; dòng **hết hàng** gắn cờ "cần đặt brand". Dòng còn hàng đi tiếp **đã lấy → đóng gói → giao carrier**, trừ tồn khi lấy. Ops có worklist và trang quản lý kho (nhập tay).

## 2. Nguồn dữ liệu & quyết định đã chốt

- Tồn kho: **kho MEAN riêng**, nhập/quản lý tay trong app; độc lập tồn MMP. Key theo **SKU**.
- Vị trí: **kệ (`shelf`) + tầng (`floor`)**, thêm `bin` tùy chọn. Một SKU 1 vị trí ở v1.
- Theo dõi **line-level** (mỗi dòng trạng thái riêng), đơn có trạng thái **rollup** suy ra từ các dòng.
- MMP là hệ ngoài (chỉ liên quan từ Phase 2).

## 3. Mô hình dữ liệu (Drizzle, `db/schema.ts`)

### 3.1 Enums
```
fulfillmentLineStatus: 'pending_check' | 'in_stock' | 'out_of_stock' | 'picked' | 'packed' | 'shipped'
fulfillmentOrderStatus: 'received' | 'checking' | 'awaiting_brand' | 'ready_to_pick' | 'picking' | 'packed' | 'shipped'
```
(Enum khai báo dạng `pgEnum`. Giá trị thiết kế để Phase 2–4 thêm: `brand_confirmed`, `delivered`, `returned`, `completed`…)

### 3.2 `warehouse_inventory` — tồn kho MEAN
| Cột | Kiểu | Ghi chú |
|----|------|--------|
| `id` | uuid PK | |
| `sku` | text **unique notNull** | khóa đối chiếu với `shopify_order_lines.sku` |
| `productTitle` | text | hiển thị |
| `variantTitle` | text | |
| `qtyOnHand` | integer notNull default 0 | tồn vật lý |
| `qtyReserved` | integer notNull default 0 | đã giữ cho đơn đang xử lý; available = onHand − reserved |
| `shelf` | text | kệ |
| `floor` | text | tầng |
| `bin` | text | ngăn (tùy chọn) |
| `note` | text | |
| `updatedBy` | text | userId |
| `updatedAt` | timestamp defaultNow notNull | |
| `createdAt` | timestamp defaultNow notNull | |

### 3.3 `order_fulfillment` — 1 dòng/đơn
| Cột | Kiểu | Ghi chú |
|----|------|--------|
| `id` | uuid PK | |
| `orderId` | uuid FK→`shopify_orders.id` cascade **unique** notNull | |
| `status` | `fulfillmentOrderStatus` notNull default `'received'` | rollup (denormalized, cập nhật khi line đổi) |
| `createdAt` / `updatedAt` | timestamp | |

Index: `order_fulfillment_status_idx` trên `status`.

### 3.4 `order_fulfillment_lines` — mỗi dòng sản phẩm
| Cột | Kiểu | Ghi chú |
|----|------|--------|
| `id` | uuid PK | |
| `fulfillmentId` | uuid FK→`order_fulfillment.id` cascade notNull | |
| `orderLineId` | uuid FK→`shopify_order_lines.id` cascade notNull unique | |
| `sku` | text | copy từ order line (order line có thể null sku → xem edge case) |
| `qty` | integer notNull | |
| `status` | `fulfillmentLineStatus` notNull default `'pending_check'` | |
| `warehouseInventoryId` | uuid FK→`warehouse_inventory.id` nullable | vị trí đã cấp khi in_stock |
| `allocatedQty` | integer notNull default 0 | số đã reserve |
| `shipmentId` | uuid FK→`shipments.id` nullable | nối khi ship |
| `pickedAt`/`packedAt`/`shippedAt` | timestamp nullable | |
| `updatedAt` | timestamp | |

Index trên `fulfillmentId`.

### 3.5 `order_fulfillment_events` — audit log
| Cột | Kiểu |
|----|------|
| `id` uuid PK · `fulfillmentId` FK · `lineId` uuid nullable · `fromStatus` text · `toStatus` text · `actor` text · `note` text · `createdAt` timestamp |

## 4. State machine

### 4.1 Line (`order_fulfillment_lines.status`)
```
pending_check ──check──> in_stock      (available ≥ qty: reserve, gán vị trí)
pending_check ──check──> out_of_stock  (available < qty)  [Phase 2 tiếp nhận]
in_stock ──pick──> picked   (trừ qtyOnHand & qtyReserved)
picked  ──pack──> packed
packed  ──ship──> shipped   (nối shipmentId nếu có)
```
Cho phép re-check khi đang `pending_check`/`out_of_stock` (tồn thay đổi). Không re-check dòng đã `picked`+.

### 4.2 Order rollup (suy từ tập line; hàm thuần `rollupOrderStatus(lines)`)
Theo thứ tự ưu tiên:
1. Mọi line `shipped` → `shipped`.
2. Có line `out_of_stock` (và chưa ship hết) → `awaiting_brand`.
3. Mọi line `in_stock`/`picked`/`packed`/`shipped` (không còn `pending_check`/`out_of_stock`):
   - có `packed`/`shipped` nhưng chưa xong → `packed`;
   - có `picked` → `picking`;
   - tất cả `in_stock` → `ready_to_pick`.
4. Còn line `pending_check` → `checking`.
5. Mặc định → `received`.

Rollup được tính lại và lưu vào `order_fulfillment.status` sau mỗi transition.

## 5. Thuật toán check kho (hàm thuần `checkStock`)

Input: danh sách `{ sku, qty }` + map tồn `Map<sku, { available, location }>`.
Mỗi dòng: nếu `sku` có trong map và `available ≥ qty` → `in_stock` (allocatedQty=qty, gắn vị trí); ngược lại `out_of_stock`. Hàm thuần, không DB — DB lo việc đọc tồn + reserve trong transaction.

Reserve/decrement (trong server action, transaction):
- Khi check ra `in_stock`: `qtyReserved += qty`.
- Khi `picked`: `qtyOnHand -= qty`, `qtyReserved -= qty`.
- Khi hủy/cancel đơn hoặc đổi về out_of_stock từ in_stock: nhả reserve (`qtyReserved -= allocatedQty`).

## 6. Tích hợp & luồng tạo bản ghi

- **Tạo order-ops khi sync đơn:** thêm bước "ensure `order_fulfillment` + lines tồn tại" vào đường `upsertOrder()` (webhook + backfill + cron). Idempotent (unique `orderId`).
- **Backfill 1 lần** cho đơn cũ: server action `backfillFulfillmentRecords()` (RBAC, fire-and-forget kiểu backfill hiện có).
- **Auto check kho** ngay khi tạo lines (status `pending_check` → check). Nút "Check lại" thủ công trên UI.

## 7. UI

Nav mới: `{ href: '/f/fulfillment', label: 'Vận hành đơn', icon: ClipboardList, requires: 'view_fulfillment' }`.

- **`/f/fulfillment`** — Worklist: bảng đơn (order#, store, ngày, #dòng, đếm còn/hết, trạng thái rollup), lọc theo trạng thái, sort theo ngày nhận. Server page (auth + RBAC).
- **`/f/fulfillment/[orderId]`** — Chi tiết: bảng từng dòng (SKU, tên, qty, trạng thái, **kệ/tầng** nếu in_stock / badge "Cần đặt brand" nếu out_of_stock), nút **Đã lấy / Đóng gói / Giao carrier** (per-line + "làm cả đơn"); nút "Check lại tồn".
- **`/f/fulfillment/warehouse`** — Quản lý kho: bảng `warehouse_inventory`, thêm/sửa SKU + qty + kệ/tầng/bin, điều chỉnh tồn. Server actions có RBAC `manage_warehouse`.

## 8. Server actions (`features/fulfillment/*`, `'use server'`, RBAC + revalidatePath)
- `checkStockForOrder(orderId)` — chạy check + reserve (transaction), cập nhật line + rollup.
- `markLine(lineId, next)` — transition `picked`/`packed`/`shipped` (validate hợp lệ; trừ tồn khi picked), ghi event, cập nhật rollup.
- `markOrder(orderId, next)` — áp cho mọi line in-stock đủ điều kiện (batch).
- `upsertWarehouseItem(...)`, `adjustStock(sku, delta)` — quản lý kho.
- `backfillFulfillmentRecords()` — tạo bản ghi cho đơn cũ.

## 9. RBAC (`lib/auth/rbac.ts`)
Thêm permissions: `view_fulfillment` (admin/operator/viewer), `manage_fulfillment` (admin/operator), `manage_warehouse` (admin/operator).

## 10. Test
- Thuần (unit, Vitest): `checkStock` (đủ/thiếu/không có SKU), `rollupOrderStatus` (mọi tổ hợp line: hỗn hợp, toàn in_stock, có out_of_stock, đã ship hết), validate transition hợp lệ (không pack khi chưa pick…).
- Tích hợp nhẹ: reserve/decrement đúng qty (có thể test hàm tính tồn thuần tách khỏi DB).

## 11. Edge cases
- **Order line không có `sku`** (null): coi như `out_of_stock` (không đối chiếu được) + note "thiếu SKU".
- **Đơn đã cancel trên Shopify** (`cancelledAtShopify`): không tạo/được đánh dấu, không reserve; nếu đã reserve thì nhả.
- **Tồn thay đổi sau khi đã reserve**: reserve giữ chỗ; available phản ánh đúng cho đơn sau.
- **Qty đặt > tồn nhưng >0**: v1 coi cả dòng `out_of_stock` (không cho phép tách một phần ở Phase 1).
- **Re-sync đơn (webhook update)**: không ghi đè trạng thái fulfillment đã tiến triển; chỉ tạo nếu chưa có.

## 12. Ngoài phạm vi (YAGNI Phase 1)
- Đẩy đơn ra MMP / brand confirm / ngày giao (Phase 2).
- Production time metafield, ship-by, email CX (Phase 3).
- Delivered tracking, return window 30 ngày, auto-complete (Phase 4).
- Tách lô một phần (partial line fulfillment), nhiều vị trí kho cho 1 SKU, sinh nhãn carrier tự động, đồng bộ fulfillment ngược lên Shopify.
