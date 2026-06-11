# Spec: Kho hàng per-unit — món tồn theo `goods_receipt_items`

**Ngày:** 2026-06-11
**Module:** Vận hành đơn → Kho hàng (`/f/warehouse`)
**Specs nền:** [Warehouse core & auto-allocation](./2026-06-10-warehouse-core-auto-allocation-design.md), [Phase A Nhập kho & QC](./2026-06-09-order-ops-phaseA-goods-receiving-qc-design.md)

## 0. Bối cảnh & quyết định (cùng operator, 2026-06-11)

Module hiện tính tồn **gộp theo SKU** (`warehouseInventory`: sku×kho → số đếm).
Kho thật của MEAN chạy **per-unit**: mỗi món là cá thể (hàng return/ký gửi/PO),
có mã riêng, QC riêng, vị trí riêng, nguồn riêng, giá vốn riêng. File thật
`WH - Inventory` có **833 món** (728 đang trong kho, 105 đã xuất).

Quyết định đã chốt:
1. **Per-unit là nguồn sự thật**; allocator cấp **đúng món** (FIFO ngày nhập).
   Tồn gộp theo SKU = rollup đếm món.
2. **Tái dùng `goods_receipt_items`** (đã per-unit, sẵn unitCode/QC/giá vốn/
   nguồn/truy vết) làm bảng món tồn — KHÔNG dựng bảng mới.
3. **File XLSX import 1 lần** để seed; từ nay món mới vào qua luồng Nhập-QC.
4. **Cơ sở = kho riêng**: warehouseCode = `GVM` (470), `AP` (208), `DM` (155)
   — bỏ gộp HN/SG.
5. **Lưu giá vốn** mỗi món (đã có cột `domPrice`/`globalPrice`).

## 1. Mô hình dữ liệu

### 1.1 `goods_receipt_items` (mở rộng) — món tồn per-unit
Thêm cột:
- `currentWarehouseCode text` — kho hiện tại của món (GVM/AP/DM). Set khi lưu
  kho; đổi khi chuyển kho. (`goods_receipts.warehouseCode` giữ là nơi nhập gốc.)
- `location text` — vị trí trong kho ("Kệ 6-F"). NULL nếu chưa xếp.
- `stockStatus` enum `warehouse_item_status` (xem §2). Default `pending`.

Cột sẵn có dùng lại nguyên: `unitCode` (=mã WH), `sku`, `productTitle`,
`variantTitle`, `qcResult`, `qcFailReason`, `disposition`, `fulfillmentLineId`,
`orderId`, `domPrice`/`domPriceCurrency`, `globalPrice`/`globalPriceCurrency`,
`weightKg`, `receiptId`.

### 1.2 `warehouseInventory` + `inventoryMovements` (GIỮ NGUYÊN) — rollup + sổ cái
- `warehouseInventory` (sku×warehouseCode → qtyOnHand/qtyReserved) = **rollup**:
  qtyOnHand = số món `in_stock`+`allocated` của (sku, kho);
  qtyReserved = số món `allocated`.
  **Món `staging` KHÔNG vào rollup** (giữ nguyên nguyên tắc spec gốc: hàng
  đi-đơn không nằm tồn kho — theo dõi riêng ở Khu chờ).
- Mọi biến động vẫn qua `applyMovement` như T1–T11, nhưng mỗi movement gắn
  **một món**: `refType='item'`, `refId`=goods_receipt_items.id, delta ±1.
- → Tái dùng toàn bộ ledger/rollup/UI movement đã dựng; chỉ đổi "ai sinh ra
  movement" (giờ là thao tác trên 1 món cụ thể).

### 1.3 warehouseCode
Đổi tập giá trị HN/SG → **GVM/AP/DM**. `warehouseInventory` production đang
RỖNG nên clean slate. Quy tắc hoà (tie) của `pickWarehouse`: ưu tiên theo thứ
tự cấu hình `['GVM','AP','DM']` (thay 'HN' cũ).

## 2. Vòng đời món (`warehouse_item_status`)

Enum: `pending` · `in_stock` · `staging` · `allocated` · `picked` · `shipped`
· `qc_failed` · `returned_to_vendor`.

- `pending`: vừa nhận, chưa QC xong.
- `in_stock`: QC pass + disposition `store`, sẵn trong kho (đếm vào rollup, allocator cấp được).
- `staging`: QC pass + disposition `allocate_to_order`, chờ đủ món để đi (khu chờ).
- `allocated`: đã giữ cho 1 đơn (`fulfillmentLineId` set), chưa pick.
- `picked` → `packed` không cần (dòng đơn lo) → `shipped`: rời kho.
- `qc_failed`: QC fail, chưa xử.
- `returned_to_vendor`: QC fail → trả brand.

Hook pick/release/huỷ đơn (đã có ở actions/release) cập nhật `stockStatus` của
món song song với trạng thái dòng đơn — món là sự thật, dòng đơn tham chiếu.

## 3. Allocator chọn đúng món (`features/warehouse/allocate.ts`)

`allocateLine` đổi lõi:
1. Tìm các món `in_stock` của `line.sku`, gom theo `currentWarehouseCode`,
   chọn kho bằng `pickWarehouse` (nhiều khả dụng nhất, hoà → GVM).
2. Trong kho đó, chọn món **cũ nhất** (FIFO theo `receiptId`→`receivedAt`,
   hoặc `qcCheckedAt`). Khoá món FOR UPDATE.
3. Set món: `stockStatus='allocated'`, `fulfillmentLineId=line.id`.
4. `applyMovement` (+reserved, reason `auto_allocate`, refType `item`, refId
   món) lên rollup. Dòng đơn → `in_stock` (+`allocatedQty`, +`warehouseInventoryId`
   trỏ rollup row của sku×kho để UI cũ vẫn chạy).
- `release`: tìm món theo `fulfillmentLineId`, set `in_stock`, gỡ link, movement −reserved.
- `pick`: món `allocated`→`picked` rồi `shipped`; movement −onHand −reserved.
- "Đủ-hoặc-không" giữ nguyên (mỗi dòng cần ≥1 món; thiếu → out_of_stock).

## 4. Import 833 món (script 1 lần, dry-run/--apply)

Đọc XLSX, cho mỗi món upsert theo `unitCode` (=mã WH, cột "WH - Unique code"):
- `sku`←"Lineitem SKU final", `productTitle`←"Lineitem Name",
  `variantTitle`← ghép "Color Extract"+"Size Extract".
- `currentWarehouseCode`← phần sau dấu `|` của "Warehouse" (GVM/AP/DM).
- `location`←"Vị trí tại kho".
- `qcResult`← "QC Check" (Pass/Failed), `qcFailReason`←"Lý do QC failed".
- `disposition`← "WH - Action" (Lưu kho→`store`, Tạm nhập→`allocate_to_order`).
- **source**: lưu NGUYÊN VĂN "Import - Inventory type" (Return/Consignment/PO/
  TQ/Cancel/MEAN Design/Đồ lỗi) vào `goods_receipts` (cột `vendor`/`note` hoặc
  thêm `sourceLabel`). KHÔNG ép vào `receiptSourceTypeEnum` hiện tại (chỉ có
  retail_for_order/consignment/po) — giữ raw để không mất thông tin 7 loại.
- `stockStatus`: QC Failed→`qc_failed`(19); Tạm nhập→`staging`(8); "Ngày xuất
  kho-DB final"≠"Chưa xuất đơn"→`shipped`(105); còn lại→`in_stock`(~700).
- `domPrice`/`globalPrice` + currency, `weightKg`←"Weight (kg)", `receivedAt`←"Ngày Import".
- Tạo `goods_receipts` tổng hợp (gom theo source×kho) để gắn `receiptId` (NOT NULL).
Sau import: recompute `warehouseInventory` rollup từ món (đếm theo stockStatus).
**105 món đã shipped**: import làm lịch sử (stockStatus shipped), KHÔNG vào tồn.

## 5. UI (`/f/warehouse`)

- Tab kho: **GVM / AP / DM / Tất cả** (thay HN/SG).
- Bảng tồn: vẫn theo SKU (rollup) — SKU · tên · khả dụng · giữ · tổng.
- Click SKU → **danh sách từng món**: mã WH, vị trí, trạng thái, nguồn, ngày
  nhập, giá vốn, đơn đã gắn. (Thay drawer chỉ-movement bằng drawer món + movement.)
- Điều chỉnh/chuyển kho: ở cấp **món** (chọn món để chuyển/đánh hỏng), không
  chỉnh số đếm tay nữa (số đếm là rollup).
- Khu chờ (staging): giữ — giờ là các món `stockStatus='staging'`.

## 6. Migration model cũ

- `warehouseInventory` rỗng → đổi warehouseCode GVM/AP/DM clean.
- `goods_receipt_items` cũ (từ Nhập-QC nếu có): backfill `stockStatus` suy từ
  qcResult+disposition+fulfillmentLine; `currentWarehouseCode`←receipt.warehouseCode.
- Script migrate-warehouse-staging (T8) cũ: đã chạy, không đụng lại.

## 7. Kiểm thử

- Pure: `pickWarehouse` tie→GVM; chọn món FIFO; map stockStatus từ row XLSX.
- Ledger/rollup: bất biến giữ (reserved≤onHand), movement per-item.
- Allocator: cấp đúng món cũ nhất; release/pick đúng món; đủ-hoặc-không.
- Import: dry-run đếm đúng (728 in_stock / 8 staging / 19 qc_failed / 105 shipped),
  rollup khớp số món; idempotent theo unitCode.
- Integration (DB thật, guard TEST_DATABASE_URL): cấp→pick→ship 1 món.
