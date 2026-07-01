# Auto-track shipments đa-carrier (Sub-project A) — Design

> Phần A của "tối ưu bảng Vận hành đơn". Mục tiêu: hệ thống **tự** cập nhật trạng thái giao
> hàng theo tracking number của từng carrier (thay vì stale/thủ công), làm nền cho phần
> delivery của chuỗi trạng thái (Sub-project B) và bỏ phụ thuộc Lark cho tracking.

**Ngày:** 2026-07-01 · **Trạng thái:** đã duyệt cấu trúc (A→B→C), build A trước.

## 1. Vấn đề
Cột "Vận chuyển" đọc `shipments.deliveryStatus` nhưng chỉ FedEx có API (`trackFedex`) và
**chỉ cập nhật khi bấm tay** — **không cron**. **DHL (3.039 đơn, hãng lớn nhất) không có
tracking**. → đơn delivered vẫn hiển thị "Đang chuyển".

## 2. Đã có sẵn (tái dùng, KHÔNG migration)
- `shipments`: `deliveryStatus`, `deliverySource` ('lark'|'fedex'|'dhl'), `deliveredAt`,
  `lastTrackedAt`, `trackDetail`, `trackingNumber`, `carrierKey`, `labelCreatedAt`.
- `lib/fedex/track.ts`: `trackFedex()`, `parseFedexTrack()`, `DeliveryStatus` type
  (`in_transit|out_for_delivery|delivered|exception|unknown`).
- `features/shipments/track.ts`: `trackAndStoreShipment()` (FedEx-only), `trackPendingShipments()`
  (FedEx-only: chưa giao, label ≤45 ngày, oldest `lastTrackedAt` first, rate-limit 300ms).

## 3. Phạm vi phase này
- **DHL + FedEx** (Aramex sau). Credentials DHL **chưa có** → code dựng sẵn, **gate bằng env
  `DHL_TRACK_API_KEY`**; thiếu key → bỏ qua DHL (không lỗi), FedEx vẫn chạy ngay.

## 4. Kiến trúc

### 4.1 DHL client — `lib/dhl/track.ts` (MỚI)
DHL Express **Shipment Tracking – Unified** API.
- `trackDhl(trackingNumber): Promise<DhlTrackResult>` (I/O):
  - `GET https://api-eu.dhl.com/track/shipments?trackingNumber={n}&service=express`,
    header `DHL-API-Key: process.env.DHL_TRACK_API_KEY`.
  - Không có key → `throw new Error('no_dhl_key')` (caller nuốt, không tính failed).
  - HTTP 404 (không thấy đơn) → trả `{ statusCode: null, status: 'unknown', description: null, deliveredAt: null }`.
  - HTTP 429 → `throw new Error('dhl_rate_limited')` (caller dừng vòng DHL sớm).
- `parseDhlTrack(raw): DhlTrackResult` (THUẦN, test được): đọc `shipments[0].status`
  (`statusCode`, `status`, `description`, `timestamp`). `deliveredAt` = khi
  `statusCode==='delivered'` → `new Date(timestamp)`, else null.
- `mapDhlStatus(statusCode, description): DeliveryStatus` (THUẦN):
  - `delivered` → `delivered`
  - `failure` → `exception`
  - `transit` → nếu description khớp /out for delivery|with delivery courier|being delivered/i
    → `out_for_delivery`, else `in_transit`
  - `pre-transit` → `in_transit`
  - còn lại / null → `unknown`
- `DhlTrackResult` = cùng shape `FedexTrackResult` (`{ statusCode, status, description, deliveredAt }`),
  dùng lại `DeliveryStatus` import từ `@/lib/fedex/track`.

### 4.2 Tổng quát hoá `features/shipments/track.ts` (SỬA)
- `trackAndStoreShipment(shipmentId)`: dispatch theo `carrierKey`:
  - `'fedex'` → `trackFedex`, `deliverySource: 'fedex'`.
  - `'dhl'` → `trackDhl`, `deliverySource: 'dhl'`; lỗi `'no_dhl_key'`/`'dhl_rate_limited'`
    → trả `{ ok:false, error }` (không ghi DB).
  - khác → `{ ok:false, error:'unsupported carrier' }`.
  - Nhánh ghi DB giữ nguyên (deliveryStatus/trackDetail/deliveredAt/lastTrackedAt).
- `trackPendingShipments({ limit })`: đổi filter `carrierKey='fedex'` → `IN ('fedex','dhl')`.
  Bỏ khỏi `failed`: các error `'no tracking'|'unsupported carrier'|'no_dhl_key'`. Khi gặp
  `'dhl_rate_limited'` → ngừng poll các đơn DHL còn lại trong lượt (vẫn tiếp FedEx). Rate-limit
  300ms giữ nguyên. Trả `{ tracked, delivered, failed }` (thêm `skippedDhlNoKey` để quan sát).

### 4.3 Cron
- Script `scripts/cron/track-shipments.ts` (MỚI) → `trackPendingShipments({ limit: 200 })`,
  in summary, exit 0/1. (Pattern giống `scripts/cron/sync-lark.ts`.)
- `package.json`: `"cron:track-shipments": "dotenv -- tsx scripts/cron/track-shipments.ts"`.
- `railway.cron-track.json` (MỚI): copy `railway.cron-lark.json`, `startCommand:
  "npm run cron:track-shipments"`. (Bạn wire Railway Cron service + lịch, vd mỗi 2–3h.)
- Route HTTP `app/api/cron/track-shipments/route.ts` (MỚI): GET + `Bearer CRON_SECRET` →
  `trackPendingShipments()` (cho external HTTPS cron; pattern giống sync-lark route).

## 5. Data flow
Cron → `trackPendingShipments` → chọn đơn chưa giao (fedex+dhl, ≤45 ngày, oldest-first) →
mỗi đơn `trackAndStoreShipment` → gọi API hãng → map `DeliveryStatus` → cập nhật
`shipments.deliveryStatus/deliverySource/deliveredAt/lastTrackedAt/trackDetail`. Bảng Vận hành
đọc như cũ → tự tươi.

## 6. Error handling
- Thiếu DHL key → DHL bị bỏ qua sạch (đếm `skippedDhlNoKey`), FedEx vẫn chạy. Không throw.
- Lỗi 1 đơn (network/parse) → tính `failed`, không chặn đơn khác.
- 429 DHL → dừng nhánh DHL lượt đó (tránh ban), FedEx tiếp.
- deliveredAt chỉ set khi hãng báo delivered (không ghi đè bằng null).

## 7. Testing (Vitest)
`lib/dhl/track.test.ts`:
1. `mapDhlStatus`: delivered→delivered; failure→exception; transit→in_transit;
   transit + "Out for delivery"→out_for_delivery; pre-transit→in_transit; unknown/null→unknown.
2. `parseDhlTrack`: payload mẫu delivered → status delivered + deliveredAt đúng; transit →
   in_transit, deliveredAt null; mảng shipments rỗng → unknown.

`features/shipments/track.test.ts` (nếu chưa có, thêm) — dispatch thuần hoá khó test vì I/O;
kiểm bằng cách tách map (đã test ở lib). Ưu tiên test pure DHL parser (nguồn lỗi chính).

## 8. Ngoài phạm vi (làm sau)
- Aramex tracking (Sub-project A sau khi có nguồn track Aramex/Hợp Nhất).
- Chuỗi trạng thái vòng đời dùng deliveryStatus này (Sub-project B).
- Đăng ký Railway Cron service + lịch chạy (bạn thao tác trên Railway; tôi cấp file config).
