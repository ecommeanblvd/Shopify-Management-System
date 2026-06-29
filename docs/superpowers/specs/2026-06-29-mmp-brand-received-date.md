# Nguồn receivedAt cho MMP từ bảng Lark "WH ngày MEAN nhận hàng" — Design

> receivedAt gửi MMP hiện lấy từ `goods_receipts` (chỉ ~160 đơn meanblvd dùng) → null hầu hết.
> Nguồn ĐÚNG là bảng Lark riêng (brand-received), cột "Visible - WH-Ngày MEAN nhận hàng gần nhất",
> phủ ~5.780 record. Đổi nguồn receivedAt sang bảng này.

**Ngày:** 2026-06-29 · **Nhánh:** `feat/mmp-brand-received` · Trạng thái: đã duyệt thiết kế.

## Nguồn dữ liệu (Lark)
- Base app_token (= wiki node, dùng trực tiếp được): `HxfAw0iRViHiNgkSlbBltpVkg3f`; table `tblFtdIn8H7ftfBL`. ~5.780 record (per line item).
- Field dùng:
  - `order_number` → `[{text:'#MBLVD21623'}]` (chuẩn hoá bỏ `#`).
  - `Lineitem SKU` → `[{text:'...'}]`.
  - `vendor` → string (brand).
  - **`Visible - WH-Ngày MEAN nhận hàng gần nhất`** → `{type:5, value:[epoch_ms]}` = ngày nhận. (KHÔNG dùng `WH-Ngày MEAN nhận hàng Return`.)

## Components
1. **Migration 0081** — bảng `mmp_line_received` (order_number bare, sku, received_at timestamp, vendor, unique(order_number,sku), updated_at). + journal.
2. **Lark client** (`features/lark/client.ts`): tách `searchAllRecordsIn(appToken, tableId, body)`; thêm hằng `BRAND_RECV_APP_TOKEN`/`BRAND_RECV_TABLE_ID` + `listBrandReceivedRecords()` (paginate hết).
3. **Parser thuần** (`features/lark/parse-brand-received.ts` + test): `parseBrandReceivedRow(fields)` → `{ orderNumber|null (bare), sku|null, vendor|null, receivedAt: Date|null }`. Helper `larkDateField(v)` đọc `{type:5,value:[ms]}` → ms.
4. **Sync** (`features/lark/sync-brand-received.ts`): fetch → parse → upsert `mmp_line_received` (theo order_number+sku, set received_at=max, vendor). Gắn vào cron `sync-lark` route (chạy sau syncLarkPacks, best-effort) + trả count.
5. **order-outbound** (`features/mmp/order-outbound.ts`): THAY nguồn receivedAt từ `goods_receipts` → `mmp_line_received` theo `order_number` + `sku`. Per-line receivedAt = map theo sku; order-level = max. Line vào payload = `isBrandStatus(status)` HOẶC có receivedAt (sku trong map).

## Guard
- App thiếu quyền base → fetch throw → sync best-effort (log, không chặn cron khác).
- order_number/sku rỗng → bỏ record. received field không phải số → null.
- Chuẩn hoá order_number bỏ `#` 2 phía khi match.

## Test (TDD)
- `parseBrandReceivedRow` (thuần): đọc đúng order/sku/vendor/receivedAt; field date type-5; rỗng→null.
- `larkDateField`: {type:5,value:[ms]}→ms; số trực tiếp→số; khác→null.
- migration/sync/order-outbound = integration → verify tsc/vitest/build + chạy thật (dry-count) trên prod.

## Ngoài phạm vi
- Bỏ hẳn goods_receipts (giữ code, chỉ đổi nguồn MMP).
- Hàng return (`WH-Ngày MEAN nhận hàng Return`).
- Chuyển app_token/table_id sang env (tạm hằng số — không phải secret).
