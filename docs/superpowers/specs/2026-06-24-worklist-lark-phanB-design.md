# Worklist Phần B — Lark detail live + cột status Lark synced — Design

> Phần B của "redesign worklist + chi tiết Lark". Phần A (cột status hệ thống, đã merge PR #217)
> đã giao bảng nhìn-nhanh từ dữ liệu hệ thống. Phần B bổ sung **dữ liệu Lark**: card chi tiết
> live + 1 cột status Lark (synced) trên list.

**Ngày:** 2026-06-24
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.
**Nhánh:** `feat/worklist-lark-detail`

## 1. Mục tiêu

- **Card chi tiết (live):** mở `/f/fulfillment/[orderId]` → fetch Lark theo Order Number → hiển thị
  **tất cả field** của (các) record Lark khớp đơn, dạng bảng nhãn→giá trị. Không lưu DB.
- **Cột Lark trên list (synced):** thêm **1 cột gộp "Lark (vận hành)"** vào bảng worklist, đọc từ
  bảng `lark_order_status` được cron `sync-lark` upsert. List KHÔNG gọi Lark lúc render.

## 2. Quyết định đã chốt

- Card detail = **live fetch** (1 record theo Order Number, không cache DB).
- Card detail hiển thị = **tất cả field** (bảng key→value), không curate → không phải sửa code khi
  Lark thêm cột.
- List Lark = **synced** (đọc DB), KHÔNG live — live cho hàng nghìn đơn mỗi load là bất khả thi.
- Cột list = **1 cột gộp** "Lark (vận hành)" stack 4 thông tin: Dispatch · CX-FF · Delivery + Ngày
  giao dự kiến (chip text muted, KHÔNG tô tone vì vocab Lark mình không kiểm soát).
- 4 field Lark được chọn (tên field thật trong base, đã verify qua API):
  - `LOG-EP-Dispatch Status` (type 3, single-select) → `dispatchStatus`
  - `CX-FF Status (look up)` (type 19, lookup) → `cxFfStatus`
  - `Final | Delivery Status` (type 20, formula) → `deliveryStatus`
  - `Ngày giao dự kiến` (type 5, date) → `expectedDeliveryDate`

## 3. Kiến trúc & luồng

```
Lark base ──┬─(cron, all records)──> parseLarkStatus ──> upsert lark_order_status ──> cột list
            └─(live, 1 Order #)─────────────────────────> getLarkRecordsForOrder ──> LarkDetailCard
```

Hai đường độc lập: list đọc DB synced; detail gọi Lark trực tiếp khi mở trang.

## 4. Components (mỗi unit 1 trách nhiệm)

### 4.1 `features/lark/client.ts` (mở rộng)
- Thêm `searchRecordsByOrderNumber(orderNumber: string): Promise<LarkRecord[]>` —
  `POST /open-apis/bitable/v1/apps/{appToken}/tables/{tableId}/records/search` với filter
  `field_name="Order Number"`, `operator="is"`, `value=[orderNumber]`. Tái dùng `getTenantToken()`
  + `env()`. Read-only. Trả `[]` khi không khớp. Phân trang (đơn nhiều kiện → nhiều record, hiếm
  khi >1 trang nhưng vẫn loop `page_token` cho an toàn).

### 4.2 `db/schema.ts` + migration `0076` (hand-authored)
Bảng mới `lark_order_status` (1 dòng / đơn — snapshot Lark mới nhất):
- `id uuid pk default gen_random_uuid()`
- `orderId uuid not null unique` → FK `shopify_orders(id)` on delete cascade
- `dispatchStatus text`
- `cxFfStatus text`
- `deliveryStatus text`
- `expectedDeliveryDate date`
- `syncedAt timestamp not null`
- index trên `orderId` (unique đã đủ; thêm index không cần).

Journal: latest idx 75 → **next 0076** (`0076_lark-order-status`). Migration viết tay, Railway
chạy khi deploy. KHÔNG chạy migrate local.

### 4.3 `features/lark/parse-status-row.ts` (mới, THUẦN + test)
- `export interface LarkStatusRow { dispatchStatus: string|null; cxFfStatus: string|null; deliveryStatus: string|null; expectedDeliveryDate: Date|null; }`
- `export function parseLarkStatus(fields: Record<string, unknown>): LarkStatusRow`
  - Dùng lại helper kiểu `larkText` (string | number | lookup-array `[{text}]` | `{text}` → string|null).
  - `expectedDeliveryDate`: field type 5 = epoch ms → dùng lại logic `larkEpochToVnMidnight` (epoch
    → UTC-midnight ngày-lịch VN) như `parse-pack-row.ts`. Non-number/null → null.
- Test thuần: mỗi field qua các kiểu (string, lookup-array, null); date epoch → đúng ngày VN; field
  thiếu → null.

### 4.4 `features/lark/sync.ts` (mở rộng)
- Trong cùng `syncLarkPacks()` (đã đọc `listAllRecords()` 1 lần): build thêm map
  `orderId → LarkStatusRow` từ cùng records (tái dùng `resolveOrderIds` đã match Order Number →
  orderId). Đơn nhiều record → ghi đè có điều kiện (field Lark có giá trị mới ghi; record sau bù
  field record trước thiếu).
- Upsert `lark_order_status` theo `orderId` (onConflictDoUpdate), chunk 200/tx như hiện tại.
- `syncedAt = new Date()`.
- Thêm đếm `larkStatusUpserted` vào `LarkSyncSummary` (không phá field cũ).

### 4.5 List: `worklist-status-queries.ts` + `WorklistTable.tsx`
- Query: thêm 1 LEFT JOIN `lark_order_status` theo `orderId` vào base query (vẫn 4 query tổng — JOIN
  thêm vào base, không phải query thứ 5; không N+1). Mở rộng `WorklistStatusRow` với
  `lark: { dispatchStatus, cxFfStatus, deliveryStatus, expectedDeliveryDate } | null`.
- `WorklistTable.tsx`: thêm **1 cột** "Lark (vận hành)" (sau cột "Vận chuyển", trước "Tình trạng")
  render compact: 3 dòng chip text muted (Dispatch / CX-FF / Delivery, bỏ dòng nếu null) + dòng
  "Dự kiến: dd/MM/yyyy" nếu có. Tất cả null → "—". Cập nhật `colSpan` empty-state 8 → **9**.
- `page.tsx`: `WorklistStatusRow` đã gồm `lark` → truyền xuống; không cần summarizer mới (render
  trực tiếp text, không cần tone).

### 4.6 Detail: `features/lark/detail.ts` + `components/fulfillment/LarkDetailCard.tsx`
- `features/lark/detail.ts`: `getLarkRecordsForOrder(orderNumber: string): Promise<Array<{ recordId: string; fields: Array<{ label: string; value: string }> }>>`
  — gọi `searchRecordsByOrderNumber`, làm phẳng mỗi record thành list `{label, value}` (value qua
  `larkText`-style stringify cho mọi kiểu; bỏ field rỗng). Catch lỗi/thiếu env → trả `[]` (card tự
  hiện trạng thái trống).
- `LarkDetailCard.tsx` (RSC, async hoặc nhận props từ page): nhận records → render mỗi record 1 khối
  bảng nhãn→giá trị; 0 record → "Không tìm thấy dữ liệu Lark cho đơn này".
- `[orderId]/page.tsx`: lấy `orderNumber` từ `detail` (đã có), gọi `getLarkRecordsForOrder` trong
  `Promise.all` sẵn có, render `<LarkDetailCard>` cuối trang. force-dynamic đã bật.

## 5. Guard / lỗi

- Lark down / thiếu env / token fail → `getLarkRecordsForOrder` trả `[]`, card hiện "không lấy được
  dữ liệu Lark"; **không** ném lỗi làm vỡ trang chi tiết.
- Đơn chưa có dòng `lark_order_status` → cột list "—".
- `searchRecordsByOrderNumber` chỉ match exact Order Number; đơn không có trong Lark → `[]`.
- Sync mở rộng KHÔNG được làm hỏng path patch shipment hiện tại (giữ try/catch + summary cũ).

## 6. Test (TDD)

- `parseLarkStatus` (thuần): mọi nhánh field (string / lookup-array / null / date epoch→VN).
- `searchRecordsByOrderNumber`, sync upsert, list JOIN, detail flatten, UI = integration (repo
  không test DB / không gọi Lark thật trong test) → verify `tsc` + `build` xanh.
- Toàn bộ suite hiện có vẫn xanh.

## 7. Ngoài phạm vi (Phần B)

- Tô tone/màu cho status Lark (vocab không kiểm soát → để text muted).
- Cache DB cho detail live (YAGNI — 1 record/lần mở; token Lark đã cache RAM).
- Tách 4 field Lark thành 4 cột rời (đã chọn gộp 1 cột; tách sau nếu cần).
- Sync 2 chiều / ghi ngược Lark (one-way như hiện tại).
- Đổi logic Phần A / pipeline #1–#4.
