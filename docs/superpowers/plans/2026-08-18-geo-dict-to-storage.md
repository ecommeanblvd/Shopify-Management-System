# Geo Dictionary → Supabase Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Chuyển 2 bảng từ điển nặng `geo_postcodes` (173MB) + `geo_cities` (52MB) từ Postgres sang file nén per-country trên Supabase Storage — giữ NGUYÊN dữ liệu và hành vi tra cứu — để DB SMS từ 761MB về ~500MB (dưới quota free). Đã được CEO duyệt (phương án 2, 2026-08-18).

**Architecture:** `geo-store.ts` mới đọc file `geo-dict/{CC}.json.gz` từ Supabase Storage (lazy, cache in-memory theo country). `geo_imports` + `geo_states` GIỮ trong DB (nhỏ, giảm diện thay đổi). Importer/cron build file thay vì insert rows. Sau khi parity-check + backup CSV → drop 2 bảng + 1 index thừa của `carrier_remote_postcodes`.

**Tech Stack:** Next.js + drizzle (hiện có), thêm `@supabase/supabase-js`; gzip qua `node:zlib`.

## Global Constraints

- KHÔNG đổi chữ ký public: `listCities(cc, state?)`, `lookupPostcode(cc, code)` (queries.ts), `geoRemoteDrift(country)` (carrier-geo.ts) — mọi caller (3 API ship-ho, NewOrderForm, geo-lookup page) không được đổi.
- `isCountryImported`, `listStates` giữ nguyên DB (không đụng).
- Behavior giữ nguyên: nước chưa nạp → `listCities` fallback `CITIES_BY_ISO`, `lookupPostcode` trả `valid: null`; postcode so sánh qua `normPostcode` như cũ.
- KHÔNG đụng `carrier_remote_postcodes` data/engine — chỉ drop index thừa `carrier_remote_postcodes_lookup_idx` (prefix của unique idx).
- Env mới: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (SMS project `rjabevsgslcltpdktesb`) — server-only, thêm `.env` local + Railway (main app + cron-geo service) TRƯỚC khi deploy code đọc Storage.
- Bucket Storage: `geo-dict`, private.
- Drop bảng CHỈ sau khi: (1) backup CSV về `/Users/macos/Documents/sms-prod-backups/geo-YYYYMMDD/`, (2) file trên Storage parity-check OK, (3) code đọc file đã chạy đúng ở local.
- Repo convention: tests vitest (`npm test`), `npx tsc --noEmit` sạch; tiếng Việt cho comment/label như code hiện có; commit không đẩy secrets.

---

### Task 1: geo-store — đọc từ điển từ Storage

**Files:**
- Create: `features/geo/geo-store.ts`, `features/geo/geo-store.test.ts`

**Interfaces:**
- Produces:

```ts
export interface GeoCountryFile {
  cities: Array<{ name: string; stateCode: string | null }>
  // postcodeNorm → danh sách city ứng viên (giữ thứ tự city asc như query cũ)
  postcodes: Record<string, Array<{ city: string; stateCode: string | null }>>
}
export interface GeoStoreDeps { fetchFile: (cc: string) => Promise<Buffer | null> } // null = file không tồn tại
export function createGeoStore(deps: GeoStoreDeps): {
  getCities(cc: string, state?: string): Promise<string[] | null>       // null = chưa có file
  getPostcode(cc: string, norm: string): Promise<Array<{ city: string; stateCode: string | null }> | null>
  getPostcodeSet(cc: string): Promise<Set<string> | null>
  invalidate(cc?: string): void
}
export const geoStore: ReturnType<typeof createGeoStore>  // default instance dùng Supabase Storage
```

- Default `fetchFile`: `@supabase/supabase-js` `storage.from('geo-dict').download(`${cc}.json.gz`)` với env `SUPABASE_URL`/`SUPABASE_SECRET_KEY`; gunzip bằng `node:zlib` `gunzipSync`; parse JSON. Cache: Map<cc, GeoCountryFile> module-level; file ~vài MB/nước → chấp nhận giữ trong RAM.
- TDD với fetchFile giả (fixture nhỏ 2 nước): cities lọc theo state; postcode hit/miss; country không có file → null; cache gọi fetchFile đúng 1 lần/nước; invalidate xoá cache.

- [ ] Step 1: viết test (RED) · Step 2: implement (GREEN) · Step 3: `npx tsc --noEmit && npm test` · Step 4: commit `feat(geo): geo-store doc tu dien tu Supabase Storage`

---

### Task 2: Script build file + upload (chạy từ DB hiện tại)

**Files:**
- Create: `scripts/build-geo-files.ts`

**Interfaces:**
- Consumes: DB hiện tại (`geoImports`, `geoCities`, `geoPostcodes`), `GeoCountryFile` shape từ Task 1.
- CLI: `npx tsx scripts/build-geo-files.ts [--country CC,CC] [--upload]` — mặc định build tất cả nước trong `geo_imports`; không `--upload` thì chỉ ghi ra `./tmp-geo-files/` để kiểm tra.

Steps trong script: đọc rows theo nước → dựng `GeoCountryFile` (cities order by name asc; postcodes group theo `postcodeNorm`, giữ city asc) → `gzipSync(JSON.stringify(...))` → upload `geo-dict/{CC}.json.gz` (upsert). In ra size từng file + tổng.

- [ ] Step 1: implement script · Step 2: TẠO BUCKET `geo-dict` (private) — SQL trên SMS project: `insert into storage.buckets (id, name, public) values ('geo-dict','geo-dict',false) on conflict do nothing;` (controller chạy qua dashboard) · Step 3: điền env SUPABASE_URL/SUPABASE_SECRET_KEY vào `.env` local (controller đưa — KHÔNG commit) · Step 4: chạy build KHÔNG upload, xem size hợp lý; chạy lại với `--upload` · Step 5: commit `feat(geo): script build + upload geo-dict files`

---

### Task 3: Chuyển queries + carrier-geo sang geo-store

**Files:**
- Modify: `features/geo/queries.ts` (listCities, lookupPostcode), `features/geo/carrier-geo.ts` (geoRemoteDrift)

**Interfaces:**
- Consumes: `geoStore` (Task 1). Chữ ký public GIỮ NGUYÊN (Global Constraints).
- `listCities`: `isCountryImported` (DB, giữ nguyên) → nếu imported: `geoStore.getCities(cc, state)`; store trả null (file thiếu dù DB nói imported — bất nhất) → fallback `CITIES_BY_ISO[cc] ?? []` + `console.warn`. Chưa imported → fallback như cũ.
- `lookupPostcode`: imported → `geoStore.getPostcode(cc, normPostcode(code))` → `pickLookupResult(rows)` với rows map về `{city, stateCode}`; store null → `{valid: null, ...}` như nước chưa nạp.
- `geoRemoteDrift`: thay query `geoPostcodes` bằng `geoStore.getPostcodeSet(cc)`; set null → coi như nước chưa nạp (`{checked: 0, missing: []}`).
- Test hiện có (`lookup-logic.test.ts`, `carrier-geo-drift.test.ts`) phải vẫn xanh; sửa/mở rộng test drift nếu nó mock DB.

- [ ] Step 1: sửa code + test · Step 2: `npx tsc --noEmit && npm test` · Step 3: smoke local: `npm run dev`, gọi `/api/mmp/ship-ho/postcode?...` với 1 postcode JP thật → city đúng như trước (so với kết quả DB cũ) · Step 4: commit `refactor(geo): tra cuu postcodes/cities qua geo-store (Storage)`

---

### Task 4: Importer/cron ghi file thay vì ghi bảng

**Files:**
- Modify: `scripts/import-geonames.ts` — phần ghi `geoCities`/`geoPostcodes` đổi thành build `GeoCountryFile` + upload (tái dùng logic Task 2 — extract helper chung nếu tiện, vd `features/geo/build-file.ts`); GIỮ ghi `geoStates` + `geoImports` như cũ.
- `scripts/cron/sync-geo.ts` không đổi (nó chỉ spawn import-geonames).

- [ ] Step 1: đọc kỹ import-geonames.ts trước khi sửa · Step 2: sửa + chạy thử `--country SG --apply` (nước nhỏ) rồi verify file SG mới trên Storage + lookup SG vẫn đúng · Step 3: `npx tsc --noEmit && npm test` · Step 4: commit `refactor(geo): import-geonames ghi geo-dict files thay vi DB rows`

---

### Task 5: Parity check, backup, drop bảng + index thừa

**Files:**
- Create: `scripts/verify-geo-parity.ts` (so sánh DB vs Storage: mỗi nước — count cities khớp, sample 200 postcodes ngẫu nhiên tra cả 2 đường phải giống nhau; exit 1 nếu lệch)
- Create: `db/migrations/<next>_drop-geo-tables.sql`:

```sql
drop index if exists carrier_remote_postcodes_lookup_idx;
drop table if exists geo_postcodes;
drop table if exists geo_cities;
```

- Modify: `db/schema.ts` — xoá định nghĩa `geoPostcodes`, `geoCities` + index liên quan (giữ geoStates/geoImports); xoá import còn sót.

- [ ] Step 1: chạy verify-geo-parity → PASS toàn bộ nước · Step 2 (controller): backup CSV 2 bảng về `/Users/macos/Documents/sms-prod-backups/geo-$(date +%Y%m%d)/` (COPY qua dashboard export hoặc psql nếu có DATABASE_URL local) · Step 3: apply migration lên prod (SAU khi CEO xác nhận lần cuối) · Step 4: `npx tsc --noEmit && npm test && npm run build` · Step 5: commit `feat(db): drop geo_postcodes/geo_cities + index thua (chuyen sang Storage)`

---

### Task 6: Deploy + hậu kiểm

- [ ] Step 1 (controller/CEO): thêm env `SUPABASE_URL` + `SUPABASE_SECRET_KEY` vào Railway (service app chính + service cron-geo) TRƯỚC khi push
- [ ] Step 2: push master → Railway deploy; smoke prod: form ship-ho autocomplete city + postcode lookup chạy đúng
- [ ] Step 3: xác nhận Database Size trên Supabase org usage đã về ~500MB (dashboard cần vài phút–1h refresh)
- [ ] Step 4: Second Brain — append `Activity Log.md` + `Decisions.md` (quyết định: geo dictionary sống ở Storage, lý do quota; thay thế: dictionary trong Postgres) của project Shopify-Management-System
- [ ] Step 5: dọn `tmp-geo-files/` + gitignore nó

## Self-review

- Coverage: đọc (T1,T3), ghi (T2,T4), an toàn dữ liệu (T5 backup+parity), vận hành (T6). Mọi caller giữ nguyên chữ ký — không cần sửa UI/API.
- Rủi ro chính: file thiếu/hỏng trên Storage → hành vi fallback rõ ràng (null → như nước chưa nạp, không crash); env thiếu trên Railway → fail rõ khi build store (throw có tên biến).
- Không placeholder; type `GeoCountryFile` dùng thống nhất T1/T2/T4/T5.
