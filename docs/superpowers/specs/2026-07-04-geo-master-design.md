# SMS Geo Master — country → state → city → zip + đối chiếu carrier — Design

> SMS làm nguồn geo chuẩn, đầy đủ dần: states/provinces + cities + postcodes trong DB,
> nạp từ GeoNames theo nước; API lookup+validate cho MMP và form ship-hộ;
> tra cứu ngược zip → zone + remote tier từng carrier + cảnh báo lệch.

**Ngày:** 2026-07-04
**Trạng thái:** đã duyệt thiết kế, chờ plan P1.
**Nhánh:** `feat/geo-master` (P1) → P2 → P3.

## 1. Bối cảnh & hiện trạng (đã khảo sát)

- Geo hiện tại: `lib/geo/countries.ts` (252 nước, static, có dialCode) + `lib/geo/cities.ts`
  (curated ~20 nước, static). **Chưa có** state/province chuẩn (text tự do), **chưa có** postcode dataset.
- **Vùng sâu vùng xa theo carrier ĐÃ CÓ** — không xây lại: `carrierRemotePostcodes`
  (pattern+tier+effective window per carrier account) + `carrierSurcharges` kind `remote_fixed`;
  quote engine tra 3 tầng postcode→city→wildcard (`features/carrier-rates/engine/quote.ts:615-685`);
  import FedEx ODA/DHL có sẵn (`scripts/import-fedex-oda.ts` — chunk 1000, delete-first idempotent, windowed).
- MMP pull endpoint đã live: `GET /api/mmp/ship-ho/countries|cities` (HMAC body-rỗng).
- `shipHoOrders` đã có `country/city/province/postcode` (text tự do).

## 2. Quyết định đã chốt (brainstorm)

| Chủ đề | Quyết định |
|---|---|
| Vai trò zip | **Lookup + validate/autofill** (gõ zip → tra city/state, báo sai) — KHÔNG dropdown triệu zip |
| Nguồn | **GeoNames** (CC-BY, per-country file) — **nạp trước ~20 nước hay ship**, build dần |
| Kết nối carrier | **Tra cứu ngược + cảnh báo lệch**: trang zip → zone + remote tier từng carrier; report postcode trong remote-list không tồn tại trong geo master |
| Countries | Giữ static `lib/geo/countries.ts` (đủ tốt) |
| Nước chưa nạp | Fallback hành vi hiện tại (curated cities + free-entry) — không vỡ MMP |

## 3. Data model (P1, migration mới)

### 3.1 `geo_states`
`id` uuid PK · `countryCode` text (ISO-2) · `code` text (admin1, vd 'CA') · `name` text ·
UNIQUE(`countryCode`,`code`). Nguồn: GeoNames admin1 (suy từ file postal).

### 3.2 `geo_cities`
`id` uuid PK · `countryCode` · `stateCode` text null · `name` text · `nameNorm` text
(UPPERCASE strip non-alnum — cùng normalize với quote engine) · UNIQUE(`countryCode`,`stateCode`,`nameNorm`).
Nguồn: distinct place-name từ file postal GeoNames.

### 3.3 `geo_postcodes`
`id` uuid PK · `countryCode` · `postcode` text (raw) · `postcodeNorm` text (uppercase alnum) ·
`city` text · `stateCode` text null · `lat`/`lng` numeric null ·
UNIQUE(`countryCode`,`postcodeNorm`,`city`) · INDEX(`countryCode`,`postcodeNorm`).
(1 zip có thể thuộc nhiều place → giữ nhiều dòng; lookup trả dòng đầu + đủ list khi cần.)

### 3.4 `geo_imports`
`id` uuid PK · `countryCode` unique · `source` text ('geonames') · `importedAt` timestamp ·
`rows` int. → MMP/UI biết nước nào đã có data (bật autofill) vs chưa (free-entry).

## 4. Importer + cron (P1)

- `scripts/import-geonames.ts --country US,CA,GB,...`:
  tải `https://download.geonames.org/export/zip/{CC}.zip` → parse TSV (country, postcode,
  place, admin1 name/code, lat, lng) → normalize → **delete-first per country + chunk 1000 insert**
  (pattern `import-fedex-oda.ts`) → upsert `geo_states`/`geo_cities`/`geo_postcodes` + ghi `geo_imports`.
- Nạp đầu: các nước có curated cities hiện tại (~20: US CA GB AU FR DE IT ES NL SE NO DK JP KR SG AE SA KW QA VN…
  theo `CITIES_BY_ISO` keys ∩ GeoNames coverage).
- Cron `cron:sync-geo` (railway.cron-geo.json, tháng/lần): re-import các nước trong `geo_imports`.

## 5. API + form (P2)

Query thuần phía server (`features/geo/queries.ts`): `listStates(country)`, `listCities(country, state?)`
(DB → fallback `CITIES_BY_ISO` khi chưa nạp), `lookupPostcode(country, code)` → `{ valid, city, stateCode, candidates }`.

MMP endpoints (HMAC body-rỗng như hiện có, mirror `requireMmpSignature`):
- `GET /api/mmp/ship-ho/states?country=US` → `{ country, states: [{code,name}] }`
- `GET /api/mmp/ship-ho/cities?country=US&state=CA` → nâng cấp đọc DB, param `state` optional; giữ shape `{country, cities}` (không vỡ tích hợp hiện tại)
- `GET /api/mmp/ship-ho/postcode?country=US&code=90210` → `{ valid, city, state, candidates? }`

Form ship-hộ nội bộ: gõ zip → autofill city/state (server action dùng cùng query); zip không hợp lệ → cảnh báo nhưng không chặn (dữ liệu chưa phủ 100%).

## 6. Đối chiếu carrier (P3)

- **Trang tra cứu** `/f/carrier-rates/geo-lookup` (RBAC `view_carrier_rates`): nhập country+postcode(+city) →
  bảng: thông tin geo master (city/state/valid) + mỗi carrier account: zone (`carrierZoneCountries`) +
  remote tier match (tái dùng logic match 3 tầng của quote engine, KHÔNG viết lại — extract/`import` hàm match hiện có).
- **Cảnh báo lệch**: query so `carrierRemotePostcodes` (chỉ pattern postcode chính xác, bỏ wildcard/city-pattern)
  với `geo_postcodes` cho các nước đã nạp → list postcode "carrier có, master không" hiện trên trang lookup
  (badge count) — nghi list hãng lỗi thời hoặc master thiếu.
  - ⚠️ **BẮT BUỘC normalize trước khi so**: `carrierRemotePostcodes.postcodePattern` lưu **raw** (vd `'SW1A 1AA'`,
    `'5000-289'` có dấu cách/gạch), còn `geo_postcodes.postcodeNorm` là **stripped** (`normPostcode`). Phải áp
    `normPostcode(postcodePattern)` (hoặc thử cả 3 key raw→stripped→prefix như quote engine `quote.ts:625-628`)
    TRƯỚC khi so — nếu không sẽ báo false-positive "lệch" hàng loạt ở nước postcode có separator (UK/NL/CA/PT/JP).

## 7. Test & lỗi

- Thuần: parser TSV GeoNames (dòng lỗi → skip + count), normalize postcode/city (khớp quote engine),
  `lookupPostcode` (hit/miss/multi-candidate/nước chưa nạp).
- Import: idempotent (chạy 2 lần = 1 kết quả), delete-first đúng country scope.
- API: HMAC 401, shape, fallback nước chưa nạp; `/cities` giữ tương thích shape cũ.
- Lỗi mạng khi tải GeoNames → abort nước đó, không phá dữ liệu nước cũ (delete-first chỉ sau khi tải+parse OK).

## 8. YAGNI / không làm

- Không nạp toàn thế giới ngay (build dần theo `geo_imports`).
- Không xây lại remote-area/quote engine — chỉ đọc + tái dùng match.
- Không bảng đối chiếu riêng (so trực tiếp khi xem trang lookup).
- Không admin2/quận-huyện, không đa ngôn ngữ tên địa danh (phase sau nếu cần).
- Không đổi shape endpoint MMP đang live.

## 9. Phân rã phase

| Phase | Deliverable |
|---|---|
| **P1** | 4 bảng + migration + importer GeoNames + nạp ~20 nước + queries thuần + test |
| **P2** | 3 API MMP (states/cities-DB/postcode) + form ship-hộ autofill/validate |
| **P3** | Trang geo-lookup zip↔carrier + cảnh báo lệch |
