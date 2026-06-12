# FedEx Demand Surcharge fetcher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps dùng checkbox (`- [ ]`).

**Goal:** Fetch + parse PDF demand surcharge FedEx (2 format), backfill config có mốc thời gian cho đối soát, cron tuần cảnh báo kỳ mới.

**Architecture:** module `features/carrier-rates/demand-fetcher/` (fetch/parse/regions/apply, parse+regions+apply THUẦN TDD), backfill script, cron route+script (chỉ cảnh báo).

**Tech Stack:** TypeScript, Drizzle/Postgres, Vitest, pdf-parse.

**Spec:** `docs/superpowers/specs/2026-06-12-fedex-demand-surcharge-fetcher-design.md`

**QUAN TRỌNG:** Parser phải viết theo TEXT THẬT do `pdf-parse` trả (khoảng trắng/thứ tự
có thể KHÁC bản đọc bằng mắt). Task 1 bắt buộc fetch PDF thật → chạy pdf-parse → dùng
text thật làm fixture test.

---

### Task 1: pdf-parse + fetch + parse (2 format, TDD theo text THẬT) + regions

**Files:**
- Modify: `package.json` (thêm `pdf-parse` + `@types/pdf-parse` nếu cần)
- Create: `features/carrier-rates/demand-fetcher/fetch.ts`
- Create: `features/carrier-rates/demand-fetcher/parse.ts` (+ test)
- Create: `features/carrier-rates/demand-fetcher/regions.ts` (+ test)
- Create (fixtures): `features/carrier-rates/demand-fetcher/__fixtures__/old-2025.txt`, `new-2026.txt`

- [ ] **Step 1: Thêm dep** `npm i pdf-parse` (+ `npm i -D @types/pdf-parse` nếu có). Xác nhận import được trong Node tsx.

- [ ] **Step 2: `fetch.ts`** — header browser (copy từ `features/carrier-rates/fuel-fetcher/fedex.ts` DEFAULT_HEADERS_HTML). Hàm:
```ts
const DEMAND_PAGE = 'https://www.fedex.com/en-vn/shipping/surcharges/demand-surcharge.html';
export async function fetchDemandPdfUrls(fetchImpl: typeof fetch = fetch): Promise<string[]> { /* GET trang, regex /content/dam/fedex/international/rates/fedex-ds-[^"']+\.pdf, unique, → tuyệt đối https://www.fedex.com<path> */ }
export async function fetchDemandPdfText(url: string, fetchImpl: typeof fetch = fetch): Promise<string> { /* GET PDF (Accept application/pdf, Referer=DEMAND_PAGE), pdf-parse(buffer) → text */ }
```

- [ ] **Step 3: CAPTURE TEXT THẬT** — chạy 1 lệnh tsx (ngoài test) fetch 2 PDF + pdf-parse + ghi ra `__fixtures__/old-2025.txt` (`fedex-ds-2025-jul-sep-638-en-vn.pdf`) và `new-2026.txt` (`fedex-ds-2026-jun-638-en-vn.pdf`). IN ra 40 dòng đầu mỗi text để ĐỌC layout thật (khoảng trắng, thứ tự số). Parser/test viết theo text NÀY, không theo trí nhớ.

- [ ] **Step 4: `regions.ts` + test (fail trước)**
```ts
// Map key chuẩn → ISO-2[]. Seed từ định nghĩa FedEx (PDF) + list config hiện tại.
export const REGION_COUNTRIES: Record<string, string[]> = {
  israel: ['IL'],
  europe: ['AL','AD','AM','AT','AZ','BY','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','GE','DE','GI','GR','GL','HU','IS','IE','IT','LV','LI','LT','LU','MK','MT','MD','MC','ME','NL','NO','PL','PT','RO','RU','SM','RS','SK','SI','ES','SE','CH','TR','UA','GB','VA','FO'],
  meisa: ['AF','BH','BD','BT','EG','JO','KW','KG','MV','NP','OM','PS','SA','LK','AE','UZ','DZ','AO','BJ','BW','BF','BI','CM','CV','TD','CG','CD','DJ','ER','ET','GA','GM','GH','GN','IQ','CI','KZ','KE','LB','LS','LR','LY','MG','MW','ML','MR','MU','MA','MZ','NA','NE','NG','PK','QA','RE','RW','SN','SC','ZA','SZ','TZ','TG','TN','UG','ZM','ZW'],
  lac: ['AI','AG','AR','AW','BS','BB','BZ','BM','BO','BQ','BR','VG','KY','CL','CO','CR','CW','DM','DO','EC','SV','GF','GD','GP','GT','GY','HT','HN','JM','MQ','MS','NI','PA','PY','PE','KN','LC','MF','VC','SX','SR','TT','TC','VI','UY','VE'],
  canada: ['CA'], mexico: ['MX'], usa: ['US','PR'],
  australia_nz: ['AU','NZ'], india: ['IN'],
  asia: ['AS','BN','KH','CN','CK','TL','FJ','PF','GU','HK','ID','JP','LA','MO','MY','MH','FM','MN','NC','MP','PW','PG','PH','WS','SG','KR','TW','TH','TO','VU','WF'],
};
export function regionToCountries(regionKey: string): string[] { return REGION_COUNTRIES[regionKey] ?? []; }
```
Test: regionToCountries('israel')→['IL']; 'meisa' includes 'SA','IQ','AE'; 'europe' includes 'DE','FR','UA'; 'bogus'→[].
(Đối chiếu list ISO Europe/MEISA/LAC với config FedEx hiện tại — phải khớp; nếu lệch nước nào thì sửa theo config hiện tại + định nghĩa PDF.)

- [ ] **Step 5: `parse.ts` + test (fail trước, theo TEXT THẬT)**
Interface `DemandPeriod { effectiveFrom: Date; effectiveTo: Date | null; exportRates: Record<string, number> }`. `parseDemandPdfText(text): DemandPeriod`.
- Detect format: có "Effective from" → MỚI; có "Demand Surcharge from" → CŨ.
- CŨ: lấy from/to từ "Demand Surcharge from <Month D, YYYY> to <Month D, YYYY>"; mỗi "Export shipments from Vietnam to <region> <num> VND <num> VND" → region key + Priority(num đầu). `effectiveTo` = to + 1 ngày.
- MỚI: `effectiveFrom`= "Effective from <Month D, YYYY>", `effectiveTo`=null; trong khối Export, mỗi dòng "<region words> <exportNum> <importNum>" → region key + exportNum.
- Chuẩn hoá region: regex robust (case-insensitive, nuốt khoảng trắng/xuống dòng) khớp: israel; europe(/europe/); meisa(/MEISA|Middle East/i); lac(/LAC|Latin America/i); canada; mexico; usa(/USA|United States/i); australia_nz(/Australia/i); asia(/^Asia\b/i); india(/^India\b/i).
- Chỉ giữ rate > 0.
- Test (dùng text fixture THẬT từ Step 3):
  - old-2025 → effectiveFrom = 2025-07-21 UTC, effectiveTo = 2025-09-22 UTC, exportRates = { israel: 11200 }.
  - new-2026 → effectiveFrom = 2026-06-18 UTC, effectiveTo = null, exportRates = { israel: 28400, europe: 28400, meisa: 39700 } (bỏ các 0).
  - parseMonth: "June 18, 2026" → Date.UTC(2026,5,18).
  - text rỗng/rác → throw.
LƯU Ý: nếu pdf-parse trả số dính chữ (vd "28400VND" hay cột MEISA xuống dòng) thì điều chỉnh regex theo text thật — ĐÂY là lý do bắt buộc fixture thật.

- [ ] **Step 6:** `npx vitest run features/carrier-rates/demand-fetcher/` xanh + `npx tsc --noEmit` sạch. **Commit**
```bash
git add package.json package-lock.json features/carrier-rates/demand-fetcher/
git commit -m "feat(carrier-rates): demand-fetcher fetch + parse PDF (2 format) + map vùng (TDD)"
```

---

### Task 2: buildDemandRows + backfill script + apply + verify

**Files:**
- Create: `features/carrier-rates/demand-fetcher/apply.ts` (+ test)
- Create: `scripts/backfill-fedex-demand.ts`

- [ ] **Step 1: `apply.ts` `buildDemandRows` + test (THUẦN, fail trước)**
```ts
export interface DemandRowSpec { countryCodes: string[]; valueVndPerKg: number; startsAt: Date; endsAt: Date | null; regionKey: string; }
/** periods sắp tăng theo effectiveFrom. Kỳ format-mới (effectiveTo=null) → endsAt = effectiveFrom kỳ kế (hoặc null nếu mới nhất). Bỏ vùng không map được (regionToCountries=[]). */
export function buildDemandRows(periods: DemandPeriod[]): { rows: DemandRowSpec[]; unmappedRegions: string[] }
```
Test: (a) 2 kỳ format-mới nối window (kỳ1.endsAt = kỳ2.effectiveFrom; kỳ2 mới nhất endsAt=null); (b) kỳ cũ giữ effectiveTo sẵn; (c) mỗi vùng>0 ra 1 row đúng countryCodes; (d) vùng lạ → vào unmappedRegions, không tạo row.

- [ ] **Step 2: `scripts/backfill-fedex-demand.ts` (dry-run/--apply)**
- `fetchDemandPdfUrls()` → fetch+parse mỗi PDF → mảng DemandPeriod (sắp theo effectiveFrom) → `buildDemandRows`.
- Dry-run: in từng kỳ (from→to) + vùng + rate + #nước; in `unmappedRegions` nếu có (DỪNG cảnh báo operator map thiếu). Không ghi.
- `--apply`: lấy FedEx carrierAccountId; `db.transaction`: DELETE `demand_per_kg` của FedEx, INSERT các DemandRowSpec (kind='demand_per_kg', value=String(valueVndPerKg), countryCodes, startsAt, endsAt, applyMode:'always', active:true, note kèm regionKey + kỳ).
- Idempotent đủ dùng (chạy lại = xoá+ghi lại y hệt).

- [ ] **Step 3: Dry-run thật** `dotenv -- tsx scripts/backfill-fedex-demand.ts` — coordinator ĐỌC output kiểm từng kỳ hợp lý (Israel 11200 Jul–Sep 2025, 28400 hiện tại; MEISA 39700…; LAC/Canada/Mexico/USA → 0 ở kỳ gần đây). Sửa parser nếu lệch.

- [ ] **Step 4: Apply + verify** `--apply`; quote thử pack FedEx IL ở 2025-08 (kỳ 11200) vs hiện tại (28400) qua `loadAccountSnapshot`+`quote` → `breakdown.demand` đúng theo kỳ. `npx vitest run` + `npx tsc --noEmit` xanh. **Commit**
```bash
git add features/carrier-rates/demand-fetcher/apply.ts features/carrier-rates/demand-fetcher/apply.test.ts scripts/backfill-fedex-demand.ts
git commit -m "feat(carrier-rates): backfill demand FedEx theo kỳ từ PDF (sửa đối soát 2025)"
```

---

### Task 3: Cron cảnh báo + tổng kiểm + push

**Files:**
- Create: `app/api/cron/refresh-demand/route.ts`
- Create: `scripts/cron/refresh-fedex-demand.ts`

- [ ] **Step 1:** READ `app/api/cron/refresh-fuel/route.ts` + `scripts/cron/refresh-fedex-fuel.ts` để theo mẫu (CRON_SECRET auth, runtime nodejs, force-dynamic, shape trả JSON).

- [ ] **Step 2: Logic cảnh báo chung** (đặt trong `features/carrier-rates/demand-fetcher/alert.ts` hoặc trong route):
- `fetchDemandPdfUrls()` → mỗi PDF: parse → `effectiveFrom`. Lấy danh sách startsAt của `demand_per_kg` FedEx trong DB. **Kỳ có effectiveFrom CHƯA khớp dòng nào** → kỳ mới.
- Với kỳ mới: ghi cảnh báo `recordAudit('fedex_demand_new_period', { url, from, to, exportRates })` (READ `lib/logging/audit.ts` cho chữ ký recordAudit) + push vào summary. Parse fail 1 PDF → cảnh báo `{ url, error }`, không làm hỏng cả run.
- **KHÔNG auto-apply.** Trả JSON `{ checkedAt, newPeriods: [...], parseErrors: [...] }`.

- [ ] **Step 3: Route + script** gọi logic trên (route: auth CRON_SECRET → chạy → JSON; script: chạy trực tiếp cho Railway cron). Thêm npm script `cron:refresh-demand` nếu refresh-fuel có pattern tương ứng.

- [ ] **Step 4: Tổng kiểm** `npx tsc --noEmit && npx vitest run && npx eslint . && npx next build` xanh.

- [ ] **Step 5: Commit + push**
```bash
git add "app/api/cron/refresh-demand/route.ts" scripts/cron/refresh-fedex-demand.ts package.json
git commit -m "feat(carrier-rates): cron tuần cảnh báo kỳ demand FedEx mới (không auto-apply)"
git push origin main
```

---

## Self-Review
- **Spec coverage:** §1 dep→T1; §2 fetch→T1; §3 parse→T1; §4 regions→T1; §5 apply→T2; §6 backfill→T2; §7 cron→T3; §8 test→T1/T2. Đủ.
- **Type consistency:** DemandPeriod, DemandRowSpec, regionToCountries, fetchDemandPdfUrls/Text nhất quán.
- **Placeholder scan:** fixture text THẬT (Step 3 T1) thay cho phỏng đoán; region ISO list cần đối chiếu config hiện tại (đã ghi rõ).
- **Rủi ro chính:** pdf-parse text khác bản đọc mắt → đã bắt buộc fixture thật + chỉnh regex theo đó.
