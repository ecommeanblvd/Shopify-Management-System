# Spec: Order Operations — Pick/Pack Enhanced (Sub-project D)

**Ngày:** 2026-06-09
**Module:** Vận hành đơn (`/f/fulfillment`) — nâng cấp bước Pack
**Specs nền:** [Phase 1](./2026-06-08-order-ops-fulfillment-phase1-design.md), [Phase 2](./2026-06-09-order-ops-phase2-mmp-brand-requests-design.md), [Sub-project A](./2026-06-09-order-ops-phaseA-goods-receiving-qc-design.md)
**Nguồn yêu cầu:** sổ vận hành kho (cột pack: mã `PK-…`, WH-Check Packed, điều phối CX). Đây là sub-project **D**.

## 0. Bối cảnh & phạm vi

Hệ thống hiện đóng gói "mù": `markLine`/`markOrder` chỉ flip `packedAt` rồi `shippedAt`, không tạo kiện, không mã PK, không gom dòng vào parcel, không bước kiểm tra. Bảng `shipments` **đã sẵn** mô hình kiện hàng (`logUniqueCode`=mã PK, `carrierKey`, dims, `actualWeightKg`, `packagingType`, `originHub`) và `orderFulfillmentLines.shipmentId` để gán dòng — nhưng luồng pack chưa dùng.

**Phạm vi D:** biến Pack thành quy trình đóng kiện thật — gom dòng `picked` vào **pack (= shipment)** với mã PK tự sinh + carrier/dims/weight/packaging, **bước Check-Packed riêng** (bắt buộc trước ship), rồi **ship theo từng kiện** (nhập tracking → dòng shipped). Một đơn có thể nhiều kiện.

**Ngoài phạm vi D:** tách số lượng 1 dòng ra nhiều kiện (cần unit-level → sub-project B); vật tư/quà tặng & điều phối CX (slice riêng); đa kho/transfer (C); finance (E); sync Shopify/return (F).

## 1. Quyết định đã chốt

- **Pack = một `shipments` row** (tái dùng), **nhiều pack/đơn**. Mã PK tự sinh `PK-NNNNN` lưu vào `logUniqueCode`.
- Gán dòng vào kiện qua `orderFulfillmentLines.shipmentId`. **V1: trọn một dòng vào một kiện** (không tách qty).
- **Check-Packed** là bước riêng, **quyền riêng** `fulfillment.pack_check`, **bắt buộc** trước khi ship.
- Đóng kiện nhập **carrier + dims + weight + packagingType + originHub**. Carrier để trống = dùng mặc định theo đơn (`shopifyOrders.shippingCarrierKey`, theo policy shipment hiện có); operator override per pack.
- Line status machine **không đổi** (`picked → packed → shipped`); chỉ thay cách kích hoạt: packed/shipped đi qua thao tác pack thay vì flip mù. Pick giữ `markLine`.

## 2. Mô hình dữ liệu (`db/schema.ts`)

Tái dùng `shipments` + `orderFulfillmentLines.shipmentId` đã có. **Chỉ thêm** vào `shipments`:

| Cột | Kiểu | Ghi chú |
|----|------|--------|
| `checkPackedBy` | text FK→`user.id` set null | người check-packed |
| `checkPackedAt` | timestamp (nullable) | mốc check-packed; NULL = chưa check |

Migration: `ALTER TABLE shipments ADD COLUMN check_packed_by ... , check_packed_at ...`.

Các cột pack khác (`logUniqueCode`, `carrierKey`, `dimLengthCm/WidthCm/HeightCm`, `actualWeightKg`, `packagingType` (enum `'bag'|'box'`), `originHub`, `trackingNumber`, `labelCreatedAt`, `note`) đã tồn tại — dùng nguyên.

## 3. Luồng & state machine

Line status (`order_fulfillment_lines.status`) giữ nguyên Phase 1: `in_stock → picked → packed → shipped`.

1. **Pick** — `markLine`/`markOrder` (Phase 1): `in_stock → picked`, trừ tồn. Không đổi.
2. **Đóng kiện** (`createPack`): chọn ≥1 dòng `picked` của một đơn → tạo `shipments` row (auto `PK-NNNNN`, carrier/dims/weight/packaging/originHub nhập tay, đều optional trừ ràng buộc §5) → cập nhật mỗi dòng: `shipmentId = pack.id`, `status = 'packed'`, `packedAt = now`. Nhiều kiện = gọi nhiều lần với subset khác nhau.
3. **Check-Packed** (`markCheckPacked`): set `checkPackedBy/At` trên pack. Quyền `check_packed`. Bắt buộc trước ship.
4. **Ship kiện** (`shipPack`): yêu cầu pack đã check-packed và có ≥1 dòng; nhập `trackingNumber` (+ `labelCreatedAt = now`); cập nhật mọi dòng của pack: `status = 'shipped'`, `shippedAt = now`. Ghi `orderFulfillmentEvents`.
5. **Rollup**: sau mỗi thao tác chạy `rollupOrderStatus` (Phase 1) trong cùng transaction.

**Bất biến / edge:**
- Chỉ gom dòng `status='picked'` vào kiện; dòng đã `packed/shipped` không gom lại (báo lỗi/bỏ qua).
- `shipPack` chặn nếu `checkPackedAt` null hoặc pack không có dòng.
- Idempotent: ship một pack đã shipped → no-op/throw rõ ràng.
- Hủy/sửa kiện sai: ngoài phạm vi v1 (thao tác DB thủ công) — chỉ nêu, không xây.

## 4. Pure logic (`features/packing/logic.ts`)

Tách thuần (không DB), unit-test được:
- `nextSeqCode(prefix, maxSeq)` / `parseSeq(prefix, code)` — sinh `PK-NNNNN` (8 chữ số, lexicographic-safe). *(Tự chứa trong D để PR độc lập; sau DRY chung với receiving vào `lib/`.)*
- `canShipPack(pack: { checkPackedAt: Date | null; lineCount: number }): { ok: true } | { ok: false; error }` — phải đã check-packed + có ≥1 dòng.
- `validatePackDims(input)` — nếu nhập dim/weight thì phải > 0 (cho phép để trống).

## 5. Phân quyền & UI

**Permissions (`lib/auth/permissions.ts` CATALOG):**
- Thêm scope `fulfillment.pack_check` (label "Vận hành — kiểm tra đóng gói"), actions `['view','create']`.
- `rbac.ts`: thêm legacy `Permission`: `view_pack_check`, `check_packed`.
- `permission-map.ts` `OLD_TO_NEW`: `view_pack_check → ['fulfillment.pack_check:view']`, `check_packed → ['fulfillment.pack_check:view','fulfillment.pack_check:create']`. Thêm cả hai vào `OPERATOR_OLD`. Admin tự có qua `allPermissionKeys()`.
- Đóng kiện/ship reuse `manage_fulfillment` (đã map `fulfillment.operations:edit`).

**UI** — mở rộng trang chi tiết đơn (`app/(dashboard)/f/fulfillment/[orderId]/page.tsx` + component pack mới trong `components/fulfillment/`):
- Khu **"Đóng kiện"**: chọn các dòng `picked` (checkbox) + form carrier/dims/weight/packaging/originHub → nút "Tạo kiện".
- **Danh sách kiện của đơn**: mỗi pack hiện mã PK, carrier, dims/weight, các dòng thuộc kiện, trạng thái check-packed; nút **"Check packed"** (quyền `check_packed`); nút **"Ship"** + ô tracking (disabled tới khi check-packed).
- Nav không đổi.

## 6. Files

- `db/schema.ts` — thêm 2 cột vào `shipments` + migration.
- `lib/auth/{permissions.ts, rbac.ts, permission-map.ts}` — scope/permission `pack_check`.
- `features/packing/{logic.ts, logic.test.ts}` — pure (PK code, canShipPack, validatePackDims).
- `features/packing/queries.ts` — `listPacksForOrder(orderId)`, dòng picked chưa gán kiện.
- `features/packing/actions.ts` — `createPack`, `markCheckPacked`, `shipPack` (gated + audited + tx + rollup).
- `components/fulfillment/PackPanel.tsx` (mới) + cập nhật `app/(dashboard)/f/fulfillment/[orderId]/page.tsx`.

## 7. Testing

- **Pure** (`features/packing/logic.test.ts`): `nextSeqCode/parseSeq`, `canShipPack` (chưa check / không dòng / ok), `validatePackDims`.
- **Manual/E2E** (sau): pick 2 dòng → tạo 1 kiện gồm 2 dòng (PK sinh ra) → ship bị chặn vì chưa check-packed → check-packed → ship (nhập tracking) → 2 dòng `shipped`, đơn rollup `shipped`. Tách 1 đơn thành 2 kiện và ship từng kiện.

## 8. Tích hợp & lưu ý

- Pack = shipment nên dữ liệu kiện (tracking, carrier, dims, weight) **nuôi thẳng** carrier-rate engine + đối soát phí ship (shipments là nguồn của các module đó).
- `createPack` để `carrierKey` null nếu operator không chọn → engine dùng `shopifyOrders.shippingCarrierKey` (policy hiện có).
- Mã PK tự sinh tách biệt mã do importer phí-ship cũ điền (cùng cột `logUniqueCode`); chấp nhận chung cột, không xung đột vì pack mới do app tạo.
