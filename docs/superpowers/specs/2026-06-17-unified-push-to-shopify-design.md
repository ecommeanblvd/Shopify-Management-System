# Gộp push giá ship lên Shopify — 1 flow thống nhất

**Ngày:** 2026-06-17
**Trạng thái:** Đã duyệt thiết kế (brainstorm), chờ review spec → plan

## 1. Mục tiêu
Gộp **3 nút rời** trên trang Manual Shipping rates → **1 nút "⚡ Đẩy giá ship lên Shopify"** với flow dẫn dắt, tự lo thứ tự zone→rate và đăng ký engine. Giảm thao tác + tránh lỗi (đẩy engine khi zone chưa tồn tại).

3 nút hiện tại (sẽ thay): `🚀 Push Carrier Rates (engine)` (`PushCarrierRates`), `🔌 Bật giá carrier` (`CarrierServiceRegister`), `⚡ Đẩy giá ship lên Shopify` (`ShippingProfilePush`).

## 2. Bối cảnh cơ chế hiện có (đã rà)
- `applyShippingToProfiles` (settings-sync): tính **diff zone** (`zonesToCreate/zonesToDelete`) + rate, **tạo/sửa/xoá zone** cho khớp shipping tree của hệ thống. → Đây là cơ chế **đồng bộ zone**.
- `pushCarrierRates` (carrier-rates): **chỉ GẮN** "Engine Carrier Rates" (DeliveryParticipant carrier-calculated) vào zone **CÓ SẴN**; bỏ qua zone VN; **tự gọi `registerCarrierService`** khi Apply (không dryRun). Không tạo zone.
- `registerCarrierService`: đăng ký Shopify CarrierService (cần Shopify Plus).
- Manual rates đến từ shipping tree (`flattenShippingMatrix` → `ZoneView.rates: RateRow[]`), gộp các market override của store.

## 3. Quyết định thiết kế (chốt brainstorm)
1. **1 nút duy nhất** thay cả 3. Engine → tự đăng ký CarrierService trong flow (không cần nút riêng).
2. **Multi-store**: tick nhiều store, đẩy 1 lượt; dry-run + apply theo TỪNG store, báo kết quả mỗi store.
3. **4 nguồn rate** chọn được (tick nhiều): `FedEx engine`, `DHL engine`, `Manual FedEx`, `Manual DHL`.
4. **Zone tự đồng bộ**: quét diff zone trước; trùng → bỏ qua; chưa trùng → đẩy zone trước, rồi rate — **trong cùng 1 Apply**. Dry-run hiện rõ "+N zone, M rate".
5. **Engine + Manual cùng carrier** → hiện **cả 2** rate ở checkout (live + flat).
6. **Tên rate manual CỐ ĐỊNH, không đổi**: Manual FedEx = **"Standard shipping"**, Manual DHL = **"Express shipping"** (đã chuẩn hoá từ trước). Push dùng đúng tên này; KHÔNG rename.

## 4. Định danh nguồn manual theo TÊN
Sau chuẩn hoá, **tên rate chính là carrier**:
- Nguồn `Manual FedEx` ⇔ rate tên **"Standard shipping"** trong shipping tree.
- Nguồn `Manual DHL` ⇔ rate tên **"Express shipping"**.
Orchestrator lọc rate của shipping tree theo tên này ứng với nguồn được chọn. (Plan xác nhận format label thực tế trên 1 store; nếu label kèm bậc cân thì khớp theo prefix tên.)

## 5. Kiến trúc
- **UI**: `components/functions/PushToShopify.tsx` (client) — thay `PushCarrierRates` + `CarrierServiceRegister` + `ShippingProfilePush`. Dialog: (1) chọn nhiều store · (2) tick 4 nguồn rate · (3) Dry-run (báo per-store) · (4) Apply.
- **Orchestrator action**: `features/carrier-rates/push-orchestrator.ts` (`'use server'`):
  `pushShippingToStores({ storeIds: string[], sources: PushSource[], dryRun: boolean }) → PushStoreResult[]`
  với `PushSource = 'fedex_engine' | 'dhl_engine' | 'manual_fedex' | 'manual_dhl'`.
  Mỗi store, theo thứ tự:
  1. **Zone + manual**: nếu có chọn manual_* → gọi nhánh `applyShippingToProfiles` với shipping tree đã **lọc rate theo tên** (Standard/Express) theo nguồn chọn. Hàm này đã lo đồng bộ zone (create/update/delete) + rate. Nếu KHÔNG chọn manual nhưng có chọn engine → vẫn cần zone tồn tại: gọi đồng bộ **zone-only** (đẩy zone của tree, không rate) để đảm bảo engine có zone gắn.
  2. **Engine**: nếu có chọn `*_engine` → gọi `pushCarrierRates({ storeId, carriers, withBackup:false, dryRun })` (carriers suy từ nguồn engine chọn). `withBackup=false` vì backup flat đã do nguồn manual lo (tránh trùng/đổi tên).
  3. Gom kết quả: zone +N, rate đẩy theo nguồn, lỗi (nếu có) → `PushStoreResult`.
- **Phần thuần (test được)**: `planPush(sources)` → kế hoạch (carriers engine, tên rate manual cần lọc, có cần zone-only không). Unit test.

## 6. Kết quả & dry-run
`PushStoreResult { storeName, zoneCreated, zoneDeleted, ratePushed: Array<{ source, count }>, carrierServiceRegistered: boolean, errors: string[] }`.
- Dry-run: chỉ ĐẾM (zonesToCreate, rate ops, zone engine sẽ gắn) — không ghi, không đăng ký CarrierService.
- Apply: ghi thật; engine → đăng ký CarrierService 1 lần/store.

## 7. Edge cases
- Store thiếu shipping tree (chưa cấu hình market) → manual không có gì đẩy; báo "store chưa có cấu hình giá ship", bỏ qua manual, vẫn cho engine nếu zone tồn tại (nếu không → báo cần đồng bộ zone trước).
- Engine nhưng store không Shopify Plus → `registerCarrierService` lỗi → ghi vào `errors` của store đó, các store/nguồn khác vẫn chạy.
- 1 store lỗi → không chặn store khác (per-store try/catch).
- Không chọn nguồn nào / không chọn store nào → disable nút.

## 8. Files
- Create `components/functions/PushToShopify.tsx`; xoá usage 3 component cũ trong `app/(dashboard)/f/functions/manual-shipping-rates/page.tsx` (giữ file component cũ nếu còn dùng nơi khác — kiểm; nếu không, xoá).
- Create `features/carrier-rates/push-orchestrator.ts` + `push-orchestrator.test.ts` (planPush thuần).
- Tái dùng: `applyShippingToProfiles`/`previewShippingToProfiles` (+ thêm tham số lọc rate theo tên), `pushCarrierRates`, `registerCarrierService`.

## 9. Out of scope
- Không đổi tên rate, không đổi logic tính giá engine/manual.
- Không gộp/sửa các trang carrier-rates khác.
- Tự động chọn carrier rẻ nhất — KHÔNG (giữ "không auto-pick").

## 10. Testing
- `planPush` thuần: từng tổ hợp nguồn → kế hoạch đúng (carriers engine, tên manual, zone-only khi chỉ engine).
- Lọc rate theo tên (Standard/Express) thuần nếu tách được.
- Orchestrator I/O: smoke qua dry-run (đếm) trên 1 store.
