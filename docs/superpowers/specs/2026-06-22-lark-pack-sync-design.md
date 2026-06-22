# Tích hợp Lark → fill cân/dims/tracking vào shipments (mảng B) — Design

> Sub-project B của chương trình đối soát ship. Mảng A (order-driven reconcile) đã
> merge (#201). B đổ dữ liệu vận hành thật từ Lark vào shipments → đơn chuyển từ
> "Chờ cân đo" sang "Chờ billed" (có ước tính engine).

**Ngày:** 2026-06-22
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.

## 1. Mục tiêu

Kho pack hàng trên **Lark Base (Bitable)** — bảng **"Tạo pack/ tracking"** (~3.000 records,
4 view FedEx/DHL). Mỗi record = 1 pack với cân nặng, kích thước, tracking, carrier, mã đơn.
Hệ thống cần **kéo dữ liệu này về fill vào `shipments`** để engine tính được cước và đối
soát với billed.

Kết nối đã xác minh chạy (smoke test read-only): `tenant_access_token` OK, đọc records OK,
field thật về đầy đủ.

## 2. Quyết định đã chốt (brainstorm)

- **Tạo mới + cảnh báo:** đơn Lark khớp order Shopify nhưng chưa có shipment → **tạo
  shipment mới**. Đơn Lark KHÔNG khớp order nào → **liệt kê cảnh báo**, không tạo bừa.
- **Trigger cả hai:** nút "Đồng bộ Lark" (thủ công) + cron mỗi giờ — chung 1 lõi.
- **Ghi đè:** Lark có giá trị thì ghi đè field tương ứng (kho là nguồn cân đo); Lark trống
  → giữ dữ liệu cũ.

## 3. Nguồn Lark — field mapping (từ field thật)

Bảng "Tạo pack/ tracking", lấy qua Bitable API. Mapping Lark field → shipment:

| shipment field | ← Lark field | ghi chú |
|---|---|---|
| (khóa update) | `Log Unique code` | → `shipments.logUniqueCode` (unique index). Khóa upsert chính. |
| (khóa create) | `Order Number` | "#MBLVD29149"/"TA2017"/"#MIRER163" → resolve order Shopify. |
| `actualWeightKg` | `Weights` | string "24" → parseFloat. Guard giá trị vô lý. |
| dims (`dimLengthCm/Width/Height`) | `Dimension ( điền tay)` | "60x40x40"→3 chiều; "28x42"→2 chiều (chiều 3 null); rác→null. |
| `trackingNumber` | `Tracking Number` | "25G8E12S". |
| `carrierKey` | `Couriers` | "FedEx"→`fedex`, "DHL"→`dhl`, khác→null+cảnh báo. |
| `labelCreatedAt` | `Label Created Date` | ngày tạo nhãn. |
| `packagingType` | `Select VTĐG1` | linked record — lấy tên nếu rút được; optional, không chặn. |

**Khớp order (đã verify prod):**
- `resolveOrderIds` (tái dùng từ import-actions) so trực tiếp `shopifyOrderNumber`, thử cả
  `MBLVD29149` và `#MBLVD29149`.
- **meanblvd** (4466 đơn): Shopify lưu `#MBLVD<n>` = đúng dạng Lark → khớp trực tiếp.
- **tinhatelier**: `TA<n>` → khớp.
- **mirermirer**: Shopify `#MIR1001`, Lark `#MIRER163` → **prefix lệch → không khớp → rơi
  vào cảnh báo unmatched** (chỉ 11 đơn; giới hạn đã biết, xử lý sau nếu cần).
- Store chưa kết nối (HC/MCN/MTB/MXHS) + DISCN → bucket **skip** (như importer).

## 4. Kiến trúc & component

- **`features/lark/client.ts`** — Lark Bitable API.
  - `getTenantToken()`: POST `/open-apis/auth/v3/tenant_access_token/internal` {app_id, app_secret};
    cache trong RAM tới gần hết hạn (~2h).
  - `listAllRecords()`: GET `/open-apis/bitable/v1/apps/{appToken}/tables/{tableId}/records`,
    phân trang `page_token` (≤500/lần), gộp hết.
  - Đọc env: `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_BASE_APP_TOKEN`, `LARK_TABLE_ID`,
    `LARK_DOMAIN` (default `https://open.larksuite.com`). **Không secret trong code.**
- **`features/lark/parse-pack-row.ts`** — **THUẦN**. `parsePackRow(fields) → PackRow | null`.
  - `PackRow { orderNumber: string; logUniqueCode: string | null; weightKg: number | null;
    dims: {l:number;w:number;h:number|null} | null; trackingNumber: string | null;
    carrierKey: 'fedex'|'dhl'|null; labelDate: Date | null; warnings: string[] }`.
  - Helpers: `parseWeight("24")`, `parseDims("60x40x40"|"28x42")`, `normalizeCourier("FedEx")`.
  - Lark field thường là string hoặc `[{text,type}]` (rich) — đọc cả 2 dạng.
- **`features/lark/classify.ts`** — **THUẦN**. `classifyPackRows(rows, shipmentByLogCode, orderIdByNumber, storePrefixLookup) → { create[], update[], unmatched[], skipped[] }`.
  - update: `logUniqueCode` khớp shipment đã có.
  - create: chưa có shipment + `Order Number` resolve được orderId.
  - unmatched: store connected nhưng order không resolve (cảnh báo).
  - skipped: store disconnected / DISCN / no_prefix.
- **`features/lark/sync.ts`** — orchestrate (I/O): `syncLarkPacks() → LarkSyncSummary`.
  - listAllRecords → parsePackRow → tải `shipmentByLogCode` + `orderIdByNumber` → classify →
    áp update/create trong `db.transaction` → lưu `lark_sync_runs` → trả summary.
  - Upsert: chỉ ghi đè field khi Lark có giá trị; idempotent (khóa logUniqueCode/tracking unique).
- **Server action** `syncLarkPacksAction()` (gate quyền như action đối soát) + **nút "Đồng bộ
  Lark"** trên trang Đối soát ship → toast `tạo X · cập nhật Y · không khớp Z`.
- **Cron** `app/api/cron/sync-lark/route.ts` (xác thực `CRON_SECRET`), mỗi giờ → cùng lõi.
- **Migration nhỏ** `lark_sync_runs`: `id, ran_at, created, updated, unmatched_count,
  skipped_count, unmatched jsonb (danh sách {orderNumber, reason}), error text`. Banner cảnh
  báo đọc bản ghi mới nhất (giống unmatched-billed #196 — component nhận summary từ RSC,
  `import type` only).

## 5. Guard & xử lý lỗi

- **Token/list fail** → throw thông điệp rõ; action trả lỗi cho UI (không crash); cron log +
  500 + ghi `lark_sync_runs.error`.
- **Cân (`Weights`)**: parse số; `<=0` / NaN / **> ngưỡng vô lý (đề xuất 100kg)** → bỏ field
  cân + thêm warning (không nuốt rác vào engine).
- **Dims**: 3 chiều / 2 chiều / rác → l/w/(h|null) / null. Không chặn field khác.
- **Carrier**: FedEx/DHL→fedex/dhl; rỗng/khác → null + warning.
- **Create thiếu carrier/tracking**: vẫn tạo shipment (vào "Chờ cân đo/Chờ billed" của mảng
  A), thiếu field nào cảnh báo field đó. (Carrier null → engine không tính được → "Chờ
  billed" có ghi chú, đúng mảng A.)
- **Ghi đè**: chỉ khi Lark có giá trị; Lark trống giữ nguyên. Re-sync idempotent.

## 6. Test (TDD)

- **`parse-pack-row` (thuần):** dims 3/2 chiều/rác; Weights "24"→24, "0"/""/">100"→guard;
  Couriers FedEx/DHL/lạ; ngày; thiếu tracking; field dạng string vs `[{text}]`.
- **`classify` (thuần):** khớp logUniqueCode→update; khớp order chưa-shipment→create; order
  không resolve→unmatched; store disconnected/DISCN→skip; idempotent (re-run cùng input).
- **`store-prefix`:** xác nhận `#MIRER163` → matched MIR (đã verify) — và **mirermirer rơi
  unmatched là hành vi đúng** (test ghi rõ giới hạn này).
- **client/sync:** integration (repo không có test DB) → verify tsc/build + smoke script.

## 7. Ngoài phạm vi (mảng B)

- Sửa khớp prefix mirermirer (MIRER vs MIR) — để lần sau nếu volume tăng (giờ 11 đơn, vào
  cảnh báo).
- Ghi ngược từ hệ thống lên Lark (one-way: Lark → hệ thống).
- Đồng bộ field ngoài cân/dims/tracking/carrier/ngày (giá, COD, SKU… — Lark giữ, không kéo).
- Webhook realtime từ Lark (chỉ pull theo nút + cron).
