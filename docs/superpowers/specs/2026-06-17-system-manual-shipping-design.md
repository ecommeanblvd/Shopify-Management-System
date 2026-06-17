# Bảng giá ship HỆ THỐNG (seed từ cici-mean) → đẩy lên store, tên rate gộp

**Ngày:** 2026-06-17
**Trạng thái:** Chờ user review spec → writing-plans

## 1. Mục tiêu
Tạo **một bảng giá ship manual cấp HỆ THỐNG** (store-independent) làm nguồn sự thật duy nhất, seed từ cấu hình vàng của `cici-mean`, rồi **đẩy lên các store khác** (đợt đầu: Mirer) với:
- **Zone kết hợp FedEx×DHL** đúng như cici (mỗi zone = nhóm country cùng 1 zone FedEx và cùng 1 zone DHL).
- **Tên rate gộp**: `FedEx IP (a–b kg)` → `Standard shipping`; `DHL Express (a–b kg)` → `Express shipping` (cân nằm trong điều kiện, không trong tên) → checkout chỉ hiện 2 dòng/đơn.
- **Sửa được country zone lệch** trên Shopify qua **xoá + tạo lại** zone (Shopify không cho sửa country tại chỗ — user đã chấp nhận).

## 2. Bối cảnh đã rà (thực tế production)
- Giá ship manual hiện lưu **per-store** trong `market_store_overrides` (storeId, marketHandle, shipping jsonb). **Chỉ `cici-mean` có** (9 market: middle-east, united-states, greater-china, south-east-asia, europe, korea, japan, oceania, canada). Mirer/meanblvd/store#4 = 0.
- Cấu hình vàng cici: ~25 zone gộp `ME1/ME2/ME3, US1, GC1–4, SE1–7, EU1–5, KO1, JA1, OC1, CA1`; mỗi zone giữ cả `FedEx IP (a–b kg)` + `DHL Express (a–b kg)` theo bậc cân 0.5kg.
- `carrier_zones` (FedEx A–Z, DHL 1–10) + `carrier_zone_countries` chỉ là **input tham chiếu** (ZoneReferenceTable) + engine tính giá. **Không có code đẩy carrier_zones → Shopify zone.** Không generator tổng quát dựng zone kết hợp cho store bất kỳ → cấu trúc zone cici dựng tay/seed; `gen-fedex/dhl-offer-matrix.ts` (hardcode cici) chỉ đổ giá.
- Push hiện tại (`applyShippingToProfiles`): dựng tree từ `market_store_overrides` của store; tạo zone mới, **không cập nhật country zone đã tồn tại** (khớp theo tên, chỉ đụng rate). `pushCarrierRates` chỉ gắn participant vào zone CÓ SẴN, không tạo zone.
- Mirer Shopify đang mang 22 zone FedEx cũ (Zone A–Z) country **lệch** so với carrier_zones hiện hành; rate `Standard (x-y kg)` từ setup cũ → checkout 3 dòng (2 bậc Standard chồng mốc + FedEx engine).

## 3. Quyết định thiết kế (đã chốt với user)
1. **Bảng hệ thống riêng** (store-independent), seed 1 lần từ cici. cici thành 1 store đích bình thường.
2. Giai đoạn này **chỉ đọc + push** — KHÔNG làm UI sửa zone/giá (sửa vẫn qua script/cici như cũ). YAGNI.
3. Đợt đầu push **chỉ Mirer**; verify checkout (2 dòng) rồi mới nhân ra store khác.
4. Tên rate gộp cố định: FedEx→`Standard shipping`, DHL→`Express shipping`.
5. Đẩy kiểu **clean-rebuild**: xoá zone bị thay thế + tạo lại. Giữ zone VN/nội địa.

## 4. Kiến trúc — 5 đơn vị

### 4.1 Bảng `manual_shipping_config` (mới)
Store-independent, 1 dòng / market handle:
```
manual_shipping_config(
  id uuid pk,
  market_handle text not null unique,
  shipping jsonb not null,          -- MarketShipping: { zones: { [zoneName]: { countries[], rates: {[name]: {price,currency}} } } }
  version int not null default 1,
  updated_by text, updated_at timestamptz, created_at timestamptz
)
```
Cấu trúc `shipping` y hệt `market_store_overrides.shipping` nhưng bỏ `storeId`. (Bỏ `priceAdjustment` — ngoài phạm vi ship; nếu cần sau thì thêm.)

### 4.2 Seed + đọc (`features/markets/system-shipping.ts`, mới)
- `seedSystemShippingFromStore(sourceStoreId, userId)`: đọc mọi `market_store_overrides` của store nguồn (cici) → upsert vào `manual_shipping_config` theo `market_handle` (chỉ field `shipping`). Idempotent (chạy lại = update + tăng version, không nhân đôi). Trả số market đã seed.
- `listSystemShipping(): Promise<{ marketHandle, shipping }[]>` — đọc toàn bộ bảng.
- `buildSystemShippingTree(): Promise<ShippingTree>` — gộp `shipping.zones` của mọi market → 1 `ShippingTree` (giống `buildStoreShippingTree` nhưng nguồn là bảng hệ thống, không cần storeId).

### 4.3 Chuẩn hoá tên rate (`features/settings-sync/domain/shipping.ts`, hàm thuần)
`normalizeRateForShopify(rateName): { name: string; conditions: unknown[] }`
- Prefix `FedEx IP` → name `Standard shipping`; prefix `DHL Express` → name `Express shipping`; prefix khác → giữ nguyên `rateName`.
- Band parse từ `(a–b kg)` (tái dùng `parseWeightBand`, hỗ trợ `–`/`-`). Điều kiện: nếu `a>0` → `GREATER_THAN_OR_EQUAL_TO a+0.01`; luôn `LESS_THAN_OR_EQUAL_TO b` (đơn vị KILOGRAMS). Không có band → conditions rỗng.
- Nhiều rate cùng carrier trong 1 zone → nhiều method-def **cùng tên**, điều kiện cân lệch nhau (offset 0.01 đảm bảo không chồng mốc).

### 4.4 Builder clean-rebuild (`features/settings-sync/domain/shipping.ts`)
`buildCleanRebuildVariables(current: NormalizedShipping, systemTree: ShippingTree, locationGroupId): { id, profile }`:
- **Xoá**: mọi zone Shopify hiện có mà country **giao** với tập country của `systemTree` (zone bị thay thế — gồm Zone A–Z cũ của Mirer). Zone không giao country nào (VN nội địa, zone ngoài phạm vi) → **giữ**. Output `methodDefinitionsToDelete`/`zonesToDelete` phù hợp (xoá cả zone).
- **Tạo**: mọi zone trong `systemTree` → `zonesToCreate` với `countries` + `methodDefinitionsToCreate` là **mảng** def đã chuẩn hoá (mỗi rate → 1 def qua `normalizeRateForShopify`). Vì luôn tạo mới (sau khi xoá) → không diff/update rate → tránh phức tạp nhiều-def-trùng-tên.
- Bỏ zone không có rate (engine-only) như hiện hành.

### 4.5 Push (`shipping-profiles-actions.ts` + `push-orchestrator.ts`)
- `previewSystemShippingToProfiles(storeId, profileIds, opts)` / `applySystemShippingToProfiles(...)`: dùng `buildSystemShippingTree()` (store-independent) + `buildCleanRebuildVariables`. **Lọc carrier theo tên NGUỒN, không phải tên đã gộp**: nguồn `manual_fedex` → giữ rate prefix `FedEx IP`; `manual_dhl` → giữ rate prefix `DHL Express` (lọc trên tree TRƯỚC khi `normalizeRateForShopify` đổi tên → `Standard/Express shipping`). Backup profile trước khi xoá (tái dùng cơ chế snapshot hiện có). Dry-run chỉ đếm (xoá N zone / tạo M zone / K rate), không ghi.
  - **Lưu ý clean-rebuild khi chỉ chọn 1 carrier**: vì luôn xoá+tạo lại zone, nếu chỉ push 1 carrier thì zone tạo lại chỉ có rate carrier đó → **mất rate carrier kia**. Vậy clean-rebuild **mặc định gồm CẢ 2 carrier** (Standard + Express) trong mỗi zone; `opts.rateNames` chỉ thu hẹp khi user cố ý chọn 1 nguồn (và chấp nhận hệ quả). Dry-run cảnh báo rõ.
- `pushShippingToStores`: đọc nguồn **hệ thống** thay per-store override. Thứ tự mỗi store: clean-rebuild manual (zone+rate) → rồi engine (`pushCarrierRates` gắn participant vào zone vừa tạo). Per-store try/catch, 1 store lỗi không chặn store khác.
- Đường cũ `buildStoreShippingTree`/`applyShippingToProfiles` (per-store override) **giữ nguyên** cho tương thích, nhưng orchestrator chuyển sang đường hệ thống.

### 4.6 Trang manual-shipping-rates (`app/(dashboard)/f/functions/manual-shipping-rates/page.tsx`)
- Đổi nguồn hiển thị bảng giá từ `listOverridesForStore(activeStore)` → `listSystemShipping()` (store-independent). ZoneReferenceTable (carrier_zones) giữ nguyên.
- Store selector chỉ còn để **chọn store đích khi push** (qua `PushToShopify`).

## 5. Luồng dữ liệu
`cici market_store_overrides → seedSystemShippingFromStore → manual_shipping_config → buildSystemShippingTree → (trang hiển thị) / (push: normalizeRateForShopify + buildCleanRebuildVariables) → Shopify từng store`

## 6. An toàn & vận hành
- Migration tay (drizzle-kit generate đang hỏng do snapshot 0060/0061) — `CREATE TABLE IF NOT EXISTS`, thêm journal entry tay.
- Seed chạy 1 lần (action có RBAC `apply_markets`); idempotent.
- Push: backup profile trước; dry-run bắt buộc xem trước; chạy Mirer trước.
- Clean-rebuild xoá zone → mất rate trong zone đó, nhưng tạo lại ngay trong cùng flow (PHASE xoá trước, tạo sau). Nếu PHASE tạo lỗi giữa chừng → re-run chữa lành (idempotent vì lại xoá+tạo).

## 7. Out of scope
- UI sửa zone/giá hệ thống (chỉ đọc + push).
- Đổi engine FedEx/DHL (carrier-calculated) & logic tính giá.
- Đổi `carrier_zones` (vẫn là input tham chiếu).
- Push store khác ngoài Mirer (đợt sau, cùng cơ chế).

## 8. Testing
- `normalizeRateForShopify` (thuần): FedEx IP→Standard+điều kiện (offset 0.01), DHL Express→Express, band thiếu→rỗng, prefix lạ→giữ tên.
- `seedSystemShippingFromStore`: copy đúng số market từ cici; chạy lại = update (không nhân đôi), version tăng.
- `buildSystemShippingTree`: gộp zones nhiều market đúng.
- `buildCleanRebuildVariables`: cho current (Zone A–Z cũ + VN) + systemTree → xoá đúng zone giao country (gồm A–Z), GIỮ VN, tạo đúng zone hệ thống với method-def mảng đã chuẩn hoá. Snapshot/assert.
- Smoke: dry-run `applySystemShippingToProfiles` trên Mirer → đếm hợp lý (>0 xoá, >0 tạo).
