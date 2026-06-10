# Spec: Order Operations — Kho hàng lõi & Auto-allocation (Sub-project C+)

**Ngày:** 2026-06-10
**Module:** Vận hành đơn (`/f/fulfillment`) — nâng cấp **Kho hàng** thành mảnh lõi
**Specs nền:** [Phase 1](./2026-06-08-order-ops-fulfillment-phase1-design.md), [Phase A — Nhập kho & QC](./2026-06-09-order-ops-phaseA-goods-receiving-qc-design.md), [Phase D — Pick/Pack](./2026-06-09-order-ops-phaseD-pick-pack-design.md)

## 0. Bối cảnh & phạm vi

Phase A đã dựng phiếu nhập + QC từng kiện với 3 nguồn (`retail_for_order` / `po` / `consignment`); Phase 1/D có fulfillment line + pick/pack. Còn thiếu phần lõi: **kho hàng đúng nghĩa** và **tự động hoá cấp hàng**. Vận hành thực tế của MEAN là **cross-dock là chính** — phần lớn hàng về cho một đơn cụ thể rồi đi ngay; kho thật chỉ chứa hàng PO/ký gửi/return.

**Phạm vi spec này:**
1. Tồn kho **đa kho HN/SG** + ràng buộc toàn vẹn.
2. **Ledger `inventory_movements`** — mọi biến động tồn append-only, không UPDATE trực tiếp.
3. **Staging đi-đơn tách khỏi tồn kho** — hàng `retail_for_order` không vào tồn.
4. **Auto-allocation hai chiều**: đơn về tự tìm hàng trong kho; hàng nhập kho tự tìm đơn đang chờ. FIFO theo thời điểm đơn về, chống race bằng row lock.
5. UI: trang Kho theo kho + lịch sử movement + điều chỉnh/chuyển kho; màn **Khu chờ đi đơn**; nguồn hàng trên từng dòng đơn.

**Ngoài phạm vi:** tồn per-unit trong kho (WMS đầy đủ — để sau nếu quy mô cần); finance per-unit (sub-project E); returns intake UI (phase F2 — spec riêng, nhưng disposition `store` của return đi qua đúng đường ledger của spec này).

## 1. Quyết định đã chốt (cùng operator, 2026-06-10)

- **Auto-reserve ngay khi đơn về, không cần người duyệt** (phương án A). Nhiều đơn tranh một SKU → **FIFO theo `processedAtShopify`** của đơn.
- **Staging KHÔNG tính vào tồn kho** (phương án A): kho chỉ chứa hàng thật sự nằm kho; hàng đi-đơn theo dõi ở khu chờ riêng theo đơn. Kiểm kê vật lý = tồn kho + danh sách staging.
- **Đa kho HN/SG** (phương án B): tồn theo `(sku, warehouse_code)`; allocator ưu tiên kho khả dụng nhiều hơn, hoà → HN.
- **Hàng nhập kho tự cấp cho đơn chờ** (phương án A): sau mỗi lần `store` vào kho, re-allocator quét dòng `out_of_stock` cùng SKU, đơn cũ nhất trước.
- **Kiến trúc**: mở rộng nền hiện có (Phương án 1) — không bảng staging mới (suy ra từ `goods_receipt_items`), không per-unit inventory.

## 2. Mô hình dữ liệu (`db/schema.ts`)

### 2.1 `warehouse_inventory` (sửa)
- Thêm `warehouseCode: text` NOT NULL default `'HN'`.
- Unique đổi `sku` → `(sku, warehouse_code)`.
- Thêm check `qty_reserved <= qty_on_hand`.
- Migration dữ liệu: dòng hiện hữu giữ nguyên về `HN`.

### 2.2 `inventory_movements` (mới, append-only)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK | |
| warehouseInventoryId | uuid FK → warehouse_inventory | NOT NULL |
| deltaOnHand / deltaReserved | integer | một trong hai ≠ 0 |
| reason | enum `inventory_movement_reason` | `receipt_po / receipt_consignment / receipt_return / auto_allocate / release_allocation / pick / manual_adjust / transfer_in / transfer_out / migration` |
| refType / refId | text / uuid | kiện nhập, dòng fulfillment, đơn, phiếu chuyển kho |
| note | text | bắt buộc với `manual_adjust` |
| actor | text (user id / `system:allocator`) | |
| createdAt | timestamp | |

**Bất biến:** mọi thay đổi `qty_on_hand`/`qty_reserved` đi qua duy nhất helper `applyMovement(tx, …)` — ghi movement + UPDATE tổng trong **cùng transaction**, có `SELECT … FOR UPDATE` trên dòng tồn.

### 2.3 Staging (không bảng mới)
Khu chờ đi đơn = `goods_receipt_items` thoả: `disposition = 'allocate_to_order'` AND dòng fulfillment gắn kèm chưa `shipped`. Phase A từng cộng kiện này vào tồn (+on-hand +reserved) — **bỏ hành vi đó**; migration một lần gỡ phần đã cộng (movement `migration`, ghi chú rõ).

### 2.4 `order_fulfillment_lines` (giữ nguyên cột)
`warehouseInventoryId` + `allocatedQty` sẵn có đủ chỉ nguồn kho (kho nằm trong dòng inventory); nguồn staging suy từ `goods_receipt_items.fulfillment_line_id`.

## 3. Logic (pure, TDD trước)

`features/warehouse/allocation-logic.ts` (mới):
- `pickWarehouse(candidates: {code, available}[]) → code | null` — nhiều khả dụng nhất, hoà → HN.
- `planAllocation(line {sku, qty}, stocks) → {warehouseCode, qty} | null` — v1 cấp **đủ-hoặc-không** (không partial): thiếu thì dòng `out_of_stock` đi luồng brand-request như cũ.
- `fifoOrder(lines: {orderProcessedAt}[])` — sắp thứ tự cấp khi hàng hạn chế.
- `movementFor(reason, …) → MovementDraft` — builder hợp lệ hoá delta/reason/ref.

`features/warehouse/ledger.ts` (mới): `applyMovement(tx, draft)` — lock dòng tồn, kiểm bất biến (không âm, reserved ≤ on-hand), insert movement, update tổng.

## 4. Luồng nghiệp vụ

**(a) Đơn mới về** — cuối `ensureFulfillmentForOrder`, gọi `allocateOrder(orderId)`: từng dòng `pending_check` có SKU → `planAllocation`; đủ → movement `auto_allocate` (+reserved), dòng → `in_stock` (+`warehouseInventoryId`, `allocatedQty`); thiếu → `out_of_stock`. Rollup hiện có đưa đơn đủ mọi dòng → `ready_to_pick` (đơn 1 món tự "đi luôn").
**(b) Nhập kho `store`** (PO/ký gửi/return QC pass) — movement `receipt_*` (+on-hand) vào kho của phiếu; ngay sau đó `reallocateSku(sku)`: dòng `out_of_stock` cùng SKU, **đơn cũ nhất trước**, cấp như (a).
**(c) Hàng đi-đơn QC pass** — disposition `allocate_to_order`: KHÔNG movement; dòng đơn → `in_stock` (đường staging); kiện hiện ở Khu chờ.
**(d) Pick từ kho** — hook vào pick action hiện có: dòng có `warehouseInventoryId` → movement `pick` (−on-hand −reserved). Kiện staging ship → không movement.
**(e) Nhả hàng** — đơn huỷ (sync thấy `cancelledAtShopify`) hoặc dòng biến mất khi re-sync: movement `release_allocation` (−reserved) rồi `reallocateSku` cho đơn khác.
**(f) Chuyển kho** — action tay: cặp movement `transfer_out`/`transfer_in` cùng ref, cùng transaction.
**(g) QC fail** — giữ nguyên Phase A (trả brand / mở lại brand request), không đụng tồn.

## 5. UI

1. **`/f/fulfillment/warehouse`** (nâng cấp): tab `HN / SG / Tất cả`; cột SKU · tên · on-hand · reserved · **khả dụng** · vị trí; click SKU → drawer lịch sử movement (lý do, tham chiếu đơn/phiếu, người, lúc); nút **Điều chỉnh** (bắt buộc lý do) và **Chuyển kho**.
2. **`/f/fulfillment/staging`** (mới — Khu chờ đi đơn): nhóm theo đơn — món đã về / còn thiếu / tuổi chờ; đủ món → badge "sẵn sàng đi"; click → kiện chi tiết (mã, ảnh, QC).
3. **Trang đơn fulfillment**: mỗi dòng hiện nguồn — `Kho HN` / `Kho SG` / `Khu chờ` / `Chờ brand`.
4. Phân quyền: tái dùng `manage_warehouse` / `view_receiving` hiện có; điều chỉnh tay + chuyển kho cần `manage_warehouse`.

## 6. Edge cases & bất biến

- **Race hai đơn cùng SKU cuối:** mọi allocate qua `applyMovement` với `FOR UPDATE` — transaction sau thấy available=0 → `out_of_stock`.
- **Re-sync đơn** giữ tiến độ (cơ chế `onConflictDoNothing` hiện có); dòng bị xoá → (e).
- **Điều chỉnh tay xuống dưới reserved** bị chặn bởi check `reserved ≤ on_hand` (nhả reservation trước).
- **SKU trống** (line không SKU): bỏ qua allocator, dòng ở `pending_check` cho operator xử lý tay — như hiện tại.
- **Backfill lần đầu:** chạy allocator cho toàn bộ đơn đang `pending_check`/`out_of_stock` hiện hữu theo FIFO (script một lần, có dry-run).

## 7. Kiểm thử

- Logic thuần (allocation-logic, movement builder): unit test trước khi viết action — pattern `features/receiving/logic.test.ts`.
- Ledger: test bất biến (âm kho, reserved vượt on-hand, delta 0) bị từ chối.
- Action: test luồng (a)–(e) mức logic-with-fake-rows như receiving/packing đang làm; integration DB thật guard sau `TEST_DATABASE_URL` (convention sẵn có).
