# Sync Lark QC → cột KCS + polish worklist (Brand/Vận chuyển) — Design

> Gộp 2 việc liên quan trên bảng worklist: (A) đổ trạng thái QC từ Lark (table khác) vào cột KCS;
> (B) polish hiển thị Brand (ẩn khi không cần) + Vận chuyển (hiện tracking thật + trạng thái API).

**Ngày:** 2026-06-24
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.
**Nhánh:** `feat/lark-qc-kcs`

## 1. Bối cảnh

Cột KCS trên worklist rỗng vì hệ thống (`goods_receipt_items.qcResult`) chưa được chấm. QC thực tế
nằm trong **table Lark khác** `tblfnOiEwzcXmemM` (CÙNG base, app hiện tại đọc được — không cần secret
mới), field **"QC Check"** (single-select): `QC Pass` / `QC Failed` / `Tiếp nhận - chưa QC` / `Gửi dư`,
nối đơn qua **"Order Number final"** (vd `#MBLVD29248`), mỗi đơn nhiều dòng line-item. Đồng thời polish
Brand (ẩn khi "không cần") và Vận chuyển (hiện mã tracking + trạng thái API thay vì "có tracking").

## 2. Quyết định đã chốt

- KCS lấy từ Lark QC table; gom mỗi đơn 1 trạng thái; ưu tiên hệ thống `goods_receipt_items` nếu có,
  else dùng Lark QC; **ẩn ô khi cả hai rỗng**.
- Brand: **ẩn ô** khi "Không cần"/rỗng (tone muted).
- Vận chuyển: hiện **mã tracking** + chip trạng thái API per kiện; mã tracking là **link** sang trang hãng.
- **Đổi tên env** `LARK_TABLE_ID` → `LARK_LOG_TABLE_ID`; code đọc `LARK_LOG_TABLE_ID ?? LARK_TABLE_ID`
  (fallback, không downtime). Thêm env mới `LARK_QC_TABLE_ID` (= `tblfnOiEwzcXmemM`, không phải secret).
- QC sync best-effort: thiếu `LARK_QC_TABLE_ID` → bỏ qua phần QC, không vỡ sync logistics.

## 3. Mapping QC Check → KCS

| QC Check (Lark) | KCS badge | tone |
|---|---|---|
| `QC Failed` | Lỗi | bad |
| `Tiếp nhận - chưa QC` | Chờ | warn |
| `QC Pass` | Đạt | ok |
| `Gửi dư` | Gửi dư | info |
| (đơn không có dòng QC) | (ẩn) | — |

Gom nhiều dòng/đơn theo ưu tiên: có `QC Failed` → Lỗi; else có `Tiếp nhận - chưa QC` → Chờ; else có
`QC Pass` → Đạt; else có `Gửi dư` → Gửi dư.

## 4. Components

### 4.1 `features/lark/client.ts` (sửa)
- Đổi `env('LARK_TABLE_ID')` (2 chỗ) → helper `logTableId()` đọc `process.env.LARK_LOG_TABLE_ID ?? process.env.LARK_TABLE_ID` (throw nếu cả hai thiếu).
- Thêm `searchQcByOrderNumbers` KHÔNG cần — thay vào đó đọc toàn bộ QC table như logistics: thêm
  `listAllQcRecords(): Promise<LarkRecord[]>` đọc `process.env.LARK_QC_TABLE_ID` (paginate 500, giống `listAllRecords`). Trả `[]` nếu thiếu env.

### 4.2 `features/lark/parse-qc-row.ts` (mới, THUẦN + test)
- `parseQcRow(fields): { orderNumber: string | null; qcCheck: string | null }` — `larkText(fields['Order Number final'])`, `larkText(fields['QC Check'])`.
- `reduceQcStatus(values: string[]): 'fail' | 'pending' | 'pass' | 'extra' | null` — ưu tiên Failed > chưa-QC > Pass > Gửi dư; rỗng → null. (Thuần, test mọi nhánh.)

### 4.3 `db/schema.ts` + migration `0078`
- `lark_order_status` thêm cột `qc_status text` (giá trị: fail|pending|pass|extra|null).
- Migration `0078_lark-qc-status.sql`: `ALTER TABLE "lark_order_status" ADD COLUMN "qc_status" text;`
- Journal idx 77 → **78**.

### 4.4 `features/lark/sync.ts` (mở rộng)
- Sau khi sync logistics: nếu có `LARK_QC_TABLE_ID` → `listAllQcRecords()` → `parseQcRow` từng dòng →
  gom `Map<orderNumber(bare), string[]>` → `reduceQcStatus` → map orderNumber→orderId (reuse
  `resolveOrderIds`) → upsert `lark_order_status.qcStatus` (chunk 200, onConflictDoUpdate; đơn đã có
  row logistics thì update, chưa có thì insert row mới chỉ qc_status). Đếm `qcUpserted` vào summary.
- Thiếu env → bỏ qua, không lỗi.

### 4.5 `features/fulfillment/worklist-status.ts` + query (mở rộng)
- `summarizeKcs` nhận thêm `larkQc?: string | null`: nếu hệ thống có dữ liệu (pending/pass/fail > 0) →
  dùng logic cũ; else nếu `larkQc` có → map (fail→Lỗi/bad, pending→Chờ/warn, pass→Đạt/ok, extra→Gửi dư/info);
  else `{ label: '—', tone: 'muted' }`.
- `worklist-status-queries.ts`: LEFT JOIN `lark_order_status` đã có (Phần B) → select thêm `qcStatus`;
  thêm `larkQc` vào `WorklistStatusRow`. Page truyền `summarizeKcs({...r.kcs, larkQc: r.larkQc})`.

### 4.6 `components/fulfillment/WorklistTable.tsx` (sửa)
- **Brand**: render ô trống khi `row.brand.tone === 'muted'` (chỉ "Không cần"/no-data là muted).
- **KCS**: render ô trống khi `row.kcs.tone === 'muted'`.
- **Vận chuyển**: thay `BadgeCell b={row.delivery}` bằng:
  - `row.ship.tracks` (mảng `{trackingNumber, carrierKey, deliveryStatus}`) rỗng → giữ badge `summarizeDelivery` (Chưa/Chưa ship).
  - Có tracks → mỗi tracking 1 dòng: link `carrierTrackingUrl(carrierKey, trackingNumber)` (mở tab mới) + chip `formatTrackingStatus(deliveryStatus)`.

### 4.7 `worklist-status-queries.ts` — ship tracks
- `shipAgg` GROUP BY giữ counts; THÊM `json_agg(json_build_object('trackingNumber', tracking_number, 'carrierKey', carrier_key, 'deliveryStatus', delivery_status)) FILTER (WHERE tracking_number IS NOT NULL)` → `tracks`. Map vào `row.ship.tracks` (mặc định `[]`). Vẫn trong cùng query (không N+1).

### 4.8 Helper thuần (TDD) — `features/fulfillment/worklist-status.ts`
- `formatTrackingStatus(s: string | null): Badge` — delivered→Đã giao/ok; in_transit|out_for_delivery→Đang chuyển/info; exception→Sự cố/bad; else→Chưa cập nhật/muted.
- `carrierTrackingUrl(carrierKey: string | null, tracking: string): string` — fedex→`https://www.fedex.com/fedextrack/?trknbr=${enc}`; dhl→`https://www.dhl.com/global-en/home/tracking.html?tracking-id=${enc}`; else → `#`.

## 5. Guard / lỗi

- Thiếu `LARK_QC_TABLE_ID` → QC sync bỏ qua, sync logistics vẫn chạy.
- Đổi env table id có fallback → không downtime khi Railway chưa đổi.
- Đơn không có QC (cả hệ thống lẫn Lark) → cột KCS ẩn.
- Tracking null deliveryStatus → "Chưa cập nhật".
- `carrierTrackingUrl` carrier lạ → `#` (không link gãy).

## 6. Test (TDD)

- `parseQcRow` / `reduceQcStatus` (thuần): mọi nhánh ưu tiên + rỗng.
- `summarizeKcs` (thuần): hệ thống-có-data ưu tiên; fallback larkQc 4 nhánh; cả rỗng → muted.
- `formatTrackingStatus` / `carrierTrackingUrl` (thuần): mọi nhánh.
- sync QC / query json_agg / UI = integration → verify tsc/vitest/build.

## 7. Ngoài phạm vi

- Sửa 3 file WIP của user (OrdersTable/order-actions/AddressVerifyCard — follow-up địa chỉ Orders).
- Ghi ngược QC sang Lark (one-way).
- Wiki scope cho Lark app (không cần — QC table cùng base, đọc qua app token sẵn có).
- Đổi luồng QC hệ thống `goods_receipt_items`.

## 8. Việc phía user (Railway, không phải secret)
- Thêm `LARK_QC_TABLE_ID=tblfnOiEwzcXmemM` (service web + cron Lark).
- Đổi `LARK_TABLE_ID` → `LARK_LOG_TABLE_ID` (code có fallback nên đổi lúc nào cũng được; có thể giữ cả hai trong giai đoạn chuyển).
