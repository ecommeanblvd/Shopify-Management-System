# Spec: Order Operations — Goods Receiving & QC (Sub-project A)

**Ngày:** 2026-06-09
**Module:** Vận hành đơn (`/f/fulfillment`) — thêm lớp **Nhập kho & QC**
**Specs nền:** [Phase 1](./2026-06-08-order-ops-fulfillment-phase1-design.md), [Phase 2](./2026-06-09-order-ops-phase2-mmp-brand-requests-design.md)
**Nguồn yêu cầu:** sổ vận hành kho thực tế (`WH - Inventory (Nhập, QC, Pack)`) — bóc tách thành các sub-project A–F; đây là **A**.

## 0. Bối cảnh & phạm vi

Sổ vận hành kho theo dõi vòng đời từng đơn vị hàng vật lý: **Nhập → QC → WH-Action → Lưu kho/Transfer → Pick → Pack → Xuất → Return/Đối soát**. Hệ thống hiện có Phase 1 (tồn kho SKU gộp + pick/pack/ship) và Phase 2 (đẩy brand request khi hết hàng) nhưng **thiếu phần đầu**: Nhập kho và QC. Đó cũng là mắt xích nối Phase 2 → Phase 1: khi brand confirm và hàng về, hiện phải "cập nhật kho tay" — chính là Nhập + QC.

**Phạm vi A (spec này):** lớp phiếu nhập + QC theo **từng đơn vị hàng**, đổ vào `warehouse_inventory` (SKU gộp) sẵn có; link hàng-cho-đơn từ worklist brand-confirmed; ảnh/chứng từ qua S3; QC fail cho-đơn mở lại brand request.

**Ngoài phạm vi A (sub-project sau):** B. tồn kho cấp đơn vị (thay SKU-gộp); C. đa kho & transfer HN/SG; D. pick/pack nâng cao (mã pack, vật tư, CX); E. đối soát Finance per-unit; F. sync Shopify status + return.

## 1. Quyết định đã chốt

- **Mô hình:** lớp phiếu nhập + QC theo từng món, **đổ vào tồn gộp** (`warehouse_inventory`) hiện có. Không refactor Phase 1. Full unit-level để dành sub-project B.
- **1 dòng = 1 đơn vị hàng vật lý** (QC/ảnh/cân nặng riêng từng món). UI cho "thêm N đơn vị" tạo N dòng nhanh khi nhập consignment.
- **Link hàng cho-đơn:** từ **worklist brand-confirmed đang chờ hàng** (tích hợp Phase 2). Không nhập tay đơn ở v1.
- **Loại nguồn:** cả 3 — `retail_for_order`, `consignment`, `po`.
- **Ảnh/chứng từ:** S3 (`lib/storage/s3.ts` đã có). **QC fail bắt buộc ≥1 ảnh lỗi**; ảnh SP thực tế & BB giao nhận tùy chọn.
- **QC fail (hàng cho-đơn):** tạo bản ghi trả-brand + **mở lại** yêu cầu sản xuất (dòng đơn quay về `brand_requested`, brand request `confirmStatus='awaiting'`).
- **Giá lúc nhập:** lưu `domPrice`/`globalPrice` (+currency) dạng **trường tùy chọn** trên dòng nhập; không xây logic finance (để sub-project E).
- **Phân quyền:** tách `warehouse.receiving` và `warehouse.qc` (Role×Scope×Action hiện có).
- **`unitCode`:** sinh tự động kiểu `WH-xxxxx` (ánh xạ "WH unique code" của sheet). `goods_receipts.code` kiểu `GRN-xxxxx`.

## 2. Mô hình dữ liệu (`db/schema.ts`)

### 2.1 Enums mới
```
receipt_source_type:       'retail_for_order' | 'consignment' | 'po'
qc_result:                 'pending' | 'pass' | 'fail'
receipt_item_disposition:  'pending' | 'allocate_to_order' | 'store' | 'return_to_brand'
```
Mở rộng `fulfillmentLineStatusEnum`: **không cần** giá trị mới (tái dùng `in_stock`, `brand_requested` đã có).

### 2.2 `goods_receipts` — phiếu nhập (header)
| Cột | Kiểu | Ghi chú |
|----|------|--------|
| `id` | uuid PK | |
| `code` | text **unique notNull** | sinh tự động `GRN-00001`… (xem §6) |
| `warehouseCode` | text notNull default `'HN'` | đa kho ở sub-project C |
| `sourceType` | `receipt_source_type` notNull | một phiếu = một loại nguồn |
| `vendor` | text | nhà cung cấp/brand |
| `receivedAt` | timestamp notNull default now | |
| `receivedBy` | text FK→`user.id` set null | userId người nhận |
| `handoverDocKey` | text | S3 key BB giao nhận (nullable) |
| `note` | text | |
| `createdAt`/`updatedAt` | timestamp defaultNow notNull | |

Index: `goods_receipts_source_idx` trên `sourceType`.

### 2.3 `goods_receipt_items` — mỗi đơn vị hàng
| Cột | Kiểu | Ghi chú |
|----|------|--------|
| `id` | uuid PK | |
| `receiptId` | uuid FK→`goods_receipts.id` cascade notNull | |
| `unitCode` | text **unique notNull** | sinh tự động `WH-00001`… |
| `sku` | text | khóa đối chiếu `warehouse_inventory.sku` |
| `productTitle` | text | |
| `variantTitle` | text | |
| `photoKey` | text | S3 ảnh SP thực tế (nullable) |
| `qcResult` | `qc_result` notNull default `'pending'` | |
| `qcFailReason` | text | bắt buộc khi fail |
| `qcFailPhotoKey` | text | S3, **bắt buộc khi fail** |
| `qcCheckedBy` | text FK→`user.id` set null | |
| `qcCheckedAt` | timestamp | |
| `disposition` | `receipt_item_disposition` notNull default `'pending'` | |
| `vendorReturnDocKey` | text | S3 BB trả vendor (khi return) |
| `brandRequestId` | uuid FK→`brand_order_requests.id` set null | hàng cho-đơn |
| `fulfillmentLineId` | uuid FK→`order_fulfillment_lines.id` set null | hàng cho-đơn |
| `orderId` | uuid FK→`shopify_orders.id` set null | denormalized |
| `domPrice` | numeric | tùy chọn (→ sub-project E) |
| `domPriceCurrency` | text | |
| `globalPrice` | numeric | tùy chọn |
| `globalPriceCurrency` | text | |
| `weightKg` | numeric | tùy chọn |
| `createdAt`/`updatedAt` | timestamp defaultNow notNull | |

Index: `goods_receipt_items_receipt_idx` trên `receiptId`; `goods_receipt_items_qc_idx` trên `qcResult`; `goods_receipt_items_line_idx` trên `fulfillmentLineId`.

Audit: dùng `recordAudit` (auditLog) cho thao tác; `orderFulfillmentEvents` khi line đổi trạng thái. Không thêm bảng event.

## 3. Luồng & hiệu ứng tồn kho (tái dùng Phase 1)

1. **Tạo phiếu nhập** (header): chọn `sourceType`, vendor, kho (mặc định HN), ảnh BB (tùy chọn).
2. **Thêm đơn vị hàng:**
   - `retail_for_order`: chọn từ **worklist dòng `brand_confirmed` đang chờ hàng** → gắn `brandRequestId + fulfillmentLineId + orderId + sku + title`.
   - `consignment`/`po`: nhập `sku` + title (tùy chọn ảnh SP).
3. **QC từng đơn vị:** `pass` / `fail`. Fail bắt buộc `qcFailReason` + `qcFailPhotoKey`.
4. **QC pass → áp disposition + hiệu ứng tồn:**
   - **Mọi món pass:** `warehouse_inventory.qtyOnHand += 1` cho SKU (upsert row nếu chưa có; location để trống).
   - `retail_for_order` → `allocate_to_order`: thêm `qtyReserved += 1`; set dòng đơn `warehouseInventoryId`, `allocatedQty += qty`, status `in_stock`; ghi `orderFulfillmentEvents`; cập nhật rollup đơn (logic Phase 1). *(Đóng vòng brand_confirmed → in_stock → ready_to_pick.)*
   - `consignment`/`po` → `store`: chỉ `+= onHand`. Sẵn cho lần `checkStock` kế tiếp.
5. **QC fail → `return_to_brand`:**
   - `retail_for_order`: set dòng đơn về `brand_requested`; brand request `confirmStatus='awaiting'`, `expectedDeliveryDate=null`, `note += "QC fail: <lý do>"`; ghi event. **Không** cộng tồn. Ghi `vendorReturnDocKey` (tùy chọn).
   - `consignment`/`po`: chỉ ghi nhận, không ảnh hưởng đơn.

**Bất biến:**
- Một dòng `brand_confirmed` chỉ được allocate bởi **một** item pass (item thứ 2 cho cùng line không tự allocate — báo lỗi/ở `pending`).
- QC pass là **một chiều** (không un-QC trong A); sửa nhầm → thao tác kho thủ công (ngoài phạm vi A).
- Idempotent: áp disposition 2 lần cho cùng item không cộng tồn 2 lần (chỉ áp khi `disposition` đang `pending`).

## 4. Pure logic (`features/receiving/logic.ts`)

Tách thuần (không DB), unit-test được:
- `decideDisposition(sourceType, qcResult): Disposition` — pass+retail→allocate; pass+(consignment|po)→store; fail→return_to_brand; pending→pending.
- `validateQc(input): {ok} | {error}` — fail bắt buộc reason + failPhotoKey.
- `inventoryEffect(item): { onHandDelta, reservedDelta, lineStatus?: 'in_stock' | 'brand_requested' }` — suy ra delta tồn + trạng thái line mới từ (sourceType, qcResult).
- `nextUnitCode(maxSeq)` / `nextReceiptCode(maxSeq)` — format số thứ tự (xem §6).

## 5. UI & Phân quyền

**Route:** `/f/fulfillment/receiving`
- **Danh sách phiếu nhập** + nút "Phiếu nhập mới".
- **Chi tiết phiếu** (`/f/fulfillment/receiving/[id]`): header + bảng đơn vị hàng; mỗi dòng có nút QC pass/fail + upload ảnh; nút áp disposition (hoặc tự áp khi QC).
- **Tab "Chờ hàng về"**: liệt kê dòng `brand_confirmed` chưa nhận đủ; nút "Nhận hàng" tạo/điền item cho-đơn.
- **Upload ảnh:** server action nhận `FormData` → `putObject` (S3) → trả key; hiển thị qua `getSignedDownloadUrl` (route hoặc action ký URL).

**Permissions — thêm vào `CATALOG` (`lib/auth/permissions.ts`):**
- `warehouse.receiving`: `['view','create','edit']`
- `warehouse.qc`: `['view','create','edit']`
- Seed (`permission-map.ts`): admin = đủ; operator = đủ cả hai. Role WH/QC riêng do admin tạo ở `/admin/roles`.
- Gate: tạo phiếu/thêm item = `warehouse.receiving:create`; ghi QC = `warehouse.qc:create`; xem = `*:view`.

**Nav (`lib/nav.ts`):** thêm mục "Nhập kho & QC" → `/f/fulfillment/receiving`, requires `warehouse.receiving:view`.

## 6. Sinh mã tuần tự (`code`, `unitCode`)

- `goods_receipts.code` = `GRN-` + số 5 chữ số, `goods_receipt_items.unitCode` = `WH-` + số 5 chữ số.
- Sinh trong transaction: lấy `max(seq)` hiện tại từ bảng tương ứng (parse phần số) + 1; unique constraint là chốt chặn cuối. Đơn giản, đủ cho throughput 1 kho. (Đa kho/throughput cao → sequence DB ở sub-project sau.)

## 7. Env

Thêm vào `.env.example` (đã được `lib/storage/s3.ts` đọc):
```
S3_ENDPOINT=
S3_REGION=auto
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET=
```
Khi chưa cấu hình S3: upload báo lỗi rõ; QC pass (không ảnh) vẫn chạy; QC fail (cần ảnh) sẽ bị chặn cho tới khi cấu hình S3.

## 8. Testing

- **Pure logic** (`features/receiving/logic.test.ts`, không DB): `decideDisposition` (bảng quyết định), `validateQc` (fail thiếu ảnh → error), `inventoryEffect` (3 nguồn × pass/fail), `nextUnitCode`/`nextReceiptCode` format.
- **Manual/E2E** (sau): tạo phiếu → thêm item cho-đơn từ worklist → QC pass → dòng đơn vào `in_stock` → xuất hiện ở worklist pick; QC fail → dòng về `brand_requested`.

## 9. Files

- `db/schema.ts` — 3 enums + `goods_receipts` + `goods_receipt_items` + migration.
- `features/receiving/logic.ts` + `logic.test.ts` — pure.
- `features/receiving/queries.ts` — list phiếu, worklist "chờ hàng về", chi tiết phiếu (+ signed URLs).
- `features/receiving/actions.ts` — `createReceipt`, `addReceiptItem`, `recordQc` (áp disposition + hiệu ứng tồn), `uploadReceiptImage` (S3). Gated + audited.
- `app/(dashboard)/f/fulfillment/receiving/{page.tsx,[id]/page.tsx}` (+ tab "Chờ hàng về").
- `lib/auth/permissions.ts` (CATALOG) + `lib/auth/permission-map.ts` (seeds).
- `lib/nav.ts` — mục Nhập kho & QC.
- `.env.example` — `S3_*`.

## 10. Edge cases

- **SKU trống** trên dòng đơn: hàng cho-đơn vẫn allocate theo `fulfillmentLineId` (không phụ thuộc SKU); `warehouse_inventory` upsert cần SKU — nếu SKU trống thì bỏ qua bước cộng tồn gộp, chỉ set line `in_stock` + dùng `allocatedQty` (đánh dấu đã có hàng riêng cho đơn). Ghi chú rõ trong logic.
- **Nhận dư** (item pass cho line đã đủ allocate): item ở `pending`/cảnh báo, không allocate chồng.
- **Brand request đã `awaiting` lại fail tiếp:** giữ `awaiting`, cộng dồn ghi chú.
- **S3 chưa cấu hình:** chặn QC fail (cần ảnh); cho QC pass không ảnh.
- **Race sinh `code`:** unique constraint + retry 1 lần khi đụng.
