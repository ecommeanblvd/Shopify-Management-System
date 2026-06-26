# Thêm carrier Aramex (Hợp Nhất) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa carrier Aramex (chạy qua Hợp Nhất, line ship Aramex) vào hệ thống: nhận diện đơn Aramex + có rate card HN (USD→VND@26000) để engine tính estimate.

**Architecture:** Aramex cắm vào model carrier-rates sẵn có (carriers→accounts→zones→tiers→cards→cells). Tái dùng pipeline import (RateSheetParser → buildRateCardCells → toCells) như DHL-2025; mỗi NƯỚC = 1 zone. Code mới: nhận diện "aramex", mở rộng union carrier-key + allowlist reconcile. Migration mở `fx_cost_per_display` precision + seed carrier row.

**Tech Stack:** Next.js, Drizzle, Vitest, pdftotext (-layout), tsx scripts.

## Global Constraints

- Dùng **bảng HN** (1 bảng). cost=**USD**, display=**VND**, fx = 1/26000 = **0.0000384615** (cost-unit cho 1 display-unit; engine: `display = cost / fx`).
- Migration mở `carrier_accounts.fx_cost_per_display` numeric(14,4) → **numeric(20,10)** (an toàn: 26000.0000 không đổi).
- Phạm vi cân **≤ 20kg**, bậc 0.5; >20kg → no tier → no estimate (Call). Giá all-in (fuel+VAT) → **không surcharge**.
- **Mỗi nước = 1 zone.** 20 nước (ISO-2): Bahrain BH, Bangladesh BD, Egypt EG, Jordan JO, Kuwait KW, South Africa ZA, Qatar QA, Saudi Arabia SA, United Arab Emirates AE, Switzerland CH, Oman OM, United States US, Singapore SG, Japan JP, China CN, Hong Kong HK, Taiwan TW, Thailand TH, India IN, Indonesia ID.
- Giữ ĐÚNG số trong PDF kể cả bất thường (vd Egypt 20.00kg=406.24) — rate card phản ánh bảng carrier công bố.
- Migrations hand-authored, KHÔNG chạy local (Railway chạy lúc deploy). Seed data chạy bằng script tsx (DRY-RUN mặc định, `--apply` để ghi) — **KHÔNG tự ý --apply lên prod**; chỉ build + DRY-RUN, user cấp phép mới apply.
- Verify mỗi task: `npx tsc --noEmit` + `npx vitest run` file liên quan; task cuối thêm vitest toàn bộ + `npm run lint` (0 errors) + `npm run build`.
- Branch: `feat/aramex-carrier` (đã tạo, spec `c1afdac`).
- Tham chiếu pattern: `scripts/import-dhl-2025.ts`, `features/carrier-rates/import/dhl-2025-rates.ts`, `features/carrier-rates/import/dhl-2025-zones.ts`, `features/carrier-rates/import/preview.ts` (buildRateCardCells), `features/carrier-rates/import/fedex-2025-rates.ts` (RateSheetParser/ParsedIpExport/LightRate/toCells).

---

### Task 1: Migration — mở fx precision + seed carrier row

**Files:**
- Modify: `db/schema.ts` (fxCostPerDisplay precision)
- Create: `drizzle/0080_aramex-carrier.sql`

**Interfaces:**
- Produces: carrier `key='aramex'` tồn tại; `fx_cost_per_display` chứa được giá trị nhỏ ~0.0000384615.

- [ ] **Step 1: Sửa schema.ts**

Trong `db/schema.ts`, dòng `fxCostPerDisplay: numeric('fx_cost_per_display', { precision: 14, scale: 4 })...` → đổi `{ precision: 20, scale: 10 }` (giữ `.notNull()`).

- [ ] **Step 2: Viết migration SQL**

Create `drizzle/0080_aramex-carrier.sql`:
```sql
ALTER TABLE "carrier_accounts" ALTER COLUMN "fx_cost_per_display" TYPE numeric(20, 10);

INSERT INTO "carriers" ("key", "name")
VALUES ('aramex', 'Aramex (Hợp Nhất)')
ON CONFLICT ("key") DO NOTHING;
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output (schema thay đổi precision, không vỡ kiểu).

(KHÔNG chạy migration local — Railway chạy lúc deploy.)

- [ ] **Step 4: Commit**
```bash
git add db/schema.ts drizzle/0080_aramex-carrier.sql
git commit -m "feat(carrier): migration mở fx precision (20,10) + seed carrier aramex"
```

---

### Task 2: Nhận diện carrier "aramex"

**Files:**
- Modify: `features/lark/parse-pack-row.ts`
- Modify: `features/shopify-orders/sync/detect-carrier.ts`
- Test: `features/lark/parse-pack-row.test.ts`, `features/shopify-orders/sync/detect-carrier.test.ts`

**Interfaces:**
- Produces: `normalizeCourier` + `detectCarrierKey` trả `'aramex'`; type `CarrierKey = 'fedex' | 'dhl' | 'aramex'`; `PackRow.carrierKey: 'fedex' | 'dhl' | 'aramex' | null`.

- [ ] **Step 1: Test detect-carrier**

Trong `features/shopify-orders/sync/detect-carrier.test.ts` thêm:
```ts
it('nhận Aramex', () => {
  expect(detectCarrierKey([{ title: 'Aramex', code: null } as any])).toBe('aramex');
  expect(detectCarrierKey([{ title: 'ARAMEX_EXPRESS', code: null } as any])).toBe('aramex');
});
```
Trong `features/lark/parse-pack-row.test.ts` thêm (trong describe parsePackRow, dùng đúng cách test sẵn có gọi parsePackRow với field 'Couriers'):
```ts
it('Couriers = Aramex → carrierKey aramex', () => {
  const r = parsePackRow({ 'Order Number': '#X', 'Couriers': 'Aramex' });
  expect(r.carrierKey).toBe('aramex');
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run features/shopify-orders/sync/detect-carrier.test.ts features/lark/parse-pack-row.test.ts`
Expected: FAIL (aramex chưa nhận).

- [ ] **Step 3: Implement**

`features/shopify-orders/sync/detect-carrier.ts`:
- `export type CarrierKey = 'fedex' | 'dhl' | 'aramex';`
- Trong vòng lặp, sau nhánh dhl/fedex thêm: `if (/\baramex\b/.test(haystack)) return 'aramex';`

`features/lark/parse-pack-row.ts`:
- Type `PackRow.carrierKey` → `'fedex' | 'dhl' | 'aramex' | null`.
- `normalizeCourier` return type → `'fedex' | 'dhl' | 'aramex' | null`; thêm `if (s.includes('aramex')) return 'aramex';` (trước/sau fedex/dhl đều được — 3 nhãn rời nhau).

- [ ] **Step 4: Run → pass**

Run: `npx vitest run features/shopify-orders/sync/detect-carrier.test.ts features/lark/parse-pack-row.test.ts`
Expected: PASS.

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` (có thể báo lỗi ở nơi tiêu thụ CarrierKey union — nếu có, ghi lại cho Task 3; nếu Task 2 muốn tự xanh thì xử lý ngay các lỗi union do 2 file này gây ra).
```bash
git add features/lark/parse-pack-row.ts features/shopify-orders/sync/detect-carrier.ts features/lark/parse-pack-row.test.ts features/shopify-orders/sync/detect-carrier.test.ts
git commit -m "feat(carrier): nhận diện carrier 'aramex' (Lark Couriers + Shopify)"
```

---

### Task 3: Reconcile allowlist + lan kiểu carrierKey

**Files:**
- Modify: `features/shipments/reconcile.ts`
- Modify: các file tsc báo lỗi do union mở rộng (vd `features/shipments/reconcile-view.ts`)

**Interfaces:**
- Produces: account `key='aramex'` được reconcile xử lý; mọi union carrierKey chấp nhận 'aramex'.

- [ ] **Step 1: Sửa allowlist + kiểu reconcile.ts**

`features/shipments/reconcile.ts`:
- Dòng `if (a.key !== 'fedex' && a.key !== 'dhl') continue;` → `if (a.key !== 'fedex' && a.key !== 'dhl' && a.key !== 'aramex') continue;`
- Kiểu `carrierKey?: 'fedex' | 'dhl'` (dòng ~110) → thêm `| 'aramex'`.

- [ ] **Step 2: tsc-driven — sửa các nơi union còn báo lỗi**

Run: `npx tsc --noEmit`
Với MỖI lỗi kiểu kiểu `Type '"aramex"' is not assignable to '"fedex" | "dhl"'`: mở rộng union đó thêm `'aramex'` (thường ở `reconcile-view.ts`, chỗ map carrierKey). KHÔNG đổi logic, chỉ mở union. Lặp tới khi `tsc` sạch.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run features/shipments/`
Expected: tsc no output; test shipments pass.

- [ ] **Step 4: Commit**
```bash
git add features/shipments/
git commit -m "feat(carrier): reconcile chấp nhận account 'aramex' + lan kiểu carrierKey"
```

---

### Task 4: Hằng zones + tiers Aramex

**Files:**
- Create: `features/carrier-rates/import/aramex-hn-zones.ts`
- Test: `features/carrier-rates/import/aramex-hn-zones.test.ts`

**Interfaces:**
- Produces: `ARAMEX_COUNTRIES: Array<{ label: string; iso: string }>` (20, đúng thứ tự PDF); `ARAMEX_TIER_UPPERS: number[]` (0.5..20.0 bậc 0.5); `ARAMEX_ZONE_LABELS: string[]` (= labels).

- [ ] **Step 1: Test**

Create `features/carrier-rates/import/aramex-hn-zones.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ARAMEX_COUNTRIES, ARAMEX_TIER_UPPERS, ARAMEX_ZONE_LABELS } from './aramex-hn-zones';

describe('aramex zones/tiers', () => {
  it('20 nước, ISO-2 hợp lệ, không trùng', () => {
    expect(ARAMEX_COUNTRIES).toHaveLength(20);
    const isos = ARAMEX_COUNTRIES.map((c) => c.iso);
    expect(new Set(isos).size).toBe(20);
    expect(isos.every((i) => /^[A-Z]{2}$/.test(i))).toBe(true);
    expect(ARAMEX_COUNTRIES[0]).toEqual({ label: 'Bahrain', iso: 'BH' });
    expect(ARAMEX_COUNTRIES.find((c) => c.label === 'Japan')?.iso).toBe('JP');
  });
  it('tiers 0.5..20 bậc 0.5 (40 bậc)', () => {
    expect(ARAMEX_TIER_UPPERS).toHaveLength(40);
    expect(ARAMEX_TIER_UPPERS[0]).toBe(0.5);
    expect(ARAMEX_TIER_UPPERS[39]).toBe(20);
  });
  it('zone labels = country labels', () => {
    expect(ARAMEX_ZONE_LABELS).toEqual(ARAMEX_COUNTRIES.map((c) => c.label));
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run features/carrier-rates/import/aramex-hn-zones.test.ts`
Expected: FAIL (module thiếu).

- [ ] **Step 3: Implement**

Create `features/carrier-rates/import/aramex-hn-zones.ts`:
```ts
/** Aramex HN (Hợp Nhất) — mỗi nước 1 zone. Thứ tự = cột bảng giá HN. */
export const ARAMEX_COUNTRIES: Array<{ label: string; iso: string }> = [
  { label: 'Bahrain', iso: 'BH' },
  { label: 'Bangladesh', iso: 'BD' },
  { label: 'Egypt', iso: 'EG' },
  { label: 'Jordan', iso: 'JO' },
  { label: 'Kuwait', iso: 'KW' },
  { label: 'South Africa', iso: 'ZA' },
  { label: 'Qatar', iso: 'QA' },
  { label: 'Saudi Arabia', iso: 'SA' },
  { label: 'United Arab Emirates', iso: 'AE' },
  { label: 'Switzerland', iso: 'CH' },
  { label: 'Oman', iso: 'OM' },
  { label: 'United States', iso: 'US' },
  { label: 'Singapore', iso: 'SG' },
  { label: 'Japan', iso: 'JP' },
  { label: 'China', iso: 'CN' },
  { label: 'Hong Kong', iso: 'HK' },
  { label: 'Taiwan', iso: 'TW' },
  { label: 'Thailand', iso: 'TH' },
  { label: 'India', iso: 'IN' },
  { label: 'Indonesia', iso: 'ID' },
];

/** Bậc cân (upperKg): 0.5,1.0,…,20.0. Tier phủ (prev, this]; cân ceil lên bậc 0.5 kế. */
export const ARAMEX_TIER_UPPERS: number[] = Array.from({ length: 40 }, (_, i) => (i + 1) * 0.5);

export const ARAMEX_ZONE_LABELS: string[] = ARAMEX_COUNTRIES.map((c) => c.label);
```

- [ ] **Step 4: Run → pass**

Run: `npx vitest run features/carrier-rates/import/aramex-hn-zones.test.ts`
Expected: PASS.

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output.
```bash
git add features/carrier-rates/import/aramex-hn-zones.ts features/carrier-rates/import/aramex-hn-zones.test.ts
git commit -m "feat(carrier): hằng zones/tiers Aramex HN (20 nước, 40 bậc)"
```

---

### Task 5: Parser bảng giá Aramex HN (pdftotext → cells)

**Files:**
- Create: `features/carrier-rates/import/aramex-hn-rates.ts`
- Test: `features/carrier-rates/import/aramex-hn-rates.test.ts`

**Interfaces:**
- Consumes: `ParsedIpExport`, `LightRate`, `RateCellInput`, `toCells` từ `./fedex-2025-rates`; `RateSheetParser` (xem `./preview.ts` cho shape: `{ parse(text): ParsedIpExport; expectedPackageCells: number; expectedPakCells: number }`); `ARAMEX_COUNTRIES`, `ARAMEX_TIER_UPPERS` (Task 4).
- Produces: `aramexHnParser: RateSheetParser` (zone = country label, package-only, ≤20kg, heavy=[]).

- [ ] **Step 1: Test parser (slice pdftotext)**

Create `features/carrier-rates/import/aramex-hn-rates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { aramexHnParser } from './aramex-hn-rates';

// Slice -layout: header nhóm 1 + 2 dòng cân, header nhóm 2 + 2 dòng cân.
const TEXT = [
  'COUNTRY     BAHRAIN     BANGLADESH     EGYPT     JORDAN    KUWAIT     SOUTH AFRICA    QATAR    SAUDI ARABIA    UNITED ARAB EMIRATES    SWITZERLAND',
  ' Weight         1             2           3         4         5           6          7            8              9          10',
  '   0,50       18,31        18,34        19,72     20,17    18,48        22,08      20,09        18,64          18,34       25,35',
  '   1,00       27,61        28,02        30,41     30,41    25,54        32,61      28,31        26,64          24,08       35,11',
  'COUNTRY     OMAN     UNITED STATES     SINGAPORE     JAPAN    CHINA    HONG KONG    TAIWAN    THAILAND    INDIA    INDONESIA',
  ' Weight        11            12            13        14       15         16         17          18         19         20',
  '   0,50       12,17        18,14         6,83      17,85    12,01      12,98      10,91         8,13       13,4       23,49',
  '   1,00       18,26        26,08         8,48      19,72    13,43      15,33      13,72        11,33       21,37      26,81',
].join('\n');

describe('aramexHnParser', () => {
  it('parse đúng giá theo (nước, cân)', () => {
    const parsed = aramexHnParser.parse(TEXT);
    const get = (zone: string, weight: number) =>
      parsed.light.find((r) => r.zone === zone && r.weight === weight)?.rate;
    expect(get('Bahrain', 0.5)).toBe(18.31);
    expect(get('Switzerland', 1.0)).toBe(35.11);
    expect(get('Japan', 0.5)).toBe(17.85);
    expect(get('Indonesia', 1.0)).toBe(26.81);
    expect(parsed.light.every((r) => r.packageType === 'package')).toBe(true);
    expect(parsed.heavy).toEqual([]);
  });
  it('mỗi dòng cân → 10 nước; 2 dòng × 2 nhóm = 40 light rate', () => {
    const parsed = aramexHnParser.parse(TEXT);
    expect(parsed.light).toHaveLength(40);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run features/carrier-rates/import/aramex-hn-rates.test.ts`
Expected: FAIL (module thiếu).

- [ ] **Step 3: Implement**

Create `features/carrier-rates/import/aramex-hn-rates.ts`:
```ts
/**
 * Parser bảng giá Aramex HN (Hợp Nhất), trích từ `pdftotext -layout`.
 * Bố cục: 2 nhóm 10 nước (ma trận nước × cân 0.5..20.0). Mỗi NƯỚC = 1 zone
 * (zone label = tên nước). Giá all-in USD (fuel+VAT). Package-only, không heavy
 * (>20kg = Call, ngoài phạm vi). Emit shape ParsedIpExport để dùng toCells chung.
 */
import type { ParsedIpExport, LightRate, RateCellInput } from './fedex-2025-rates';
import { toCells } from './fedex-2025-rates';
import { ARAMEX_COUNTRIES, ARAMEX_TIER_UPPERS } from './aramex-hn-zones';

const GROUP1 = ARAMEX_COUNTRIES.slice(0, 10).map((c) => c.label);
const GROUP2 = ARAMEX_COUNTRIES.slice(10).map((c) => c.label);

function num(s: string): number { return Number(s.replace(/\./g, '').replace(',', '.')); }

/** Dòng cân: "  0,50  18,31  18,34 …" → [weight, ...10 prices]. Null nếu không phải. */
function parseWeightRow(line: string): { weight: number; prices: number[] } | null {
  const m = line.trim().match(/^(\d{1,2},\d{2})\s+(.+)$/);
  if (!m) return null;
  const weight = num(m[1]);
  if (weight > 20) return null; // chỉ ≤20kg
  const prices = m[2].trim().split(/\s+/).map(num).filter((n) => Number.isFinite(n));
  if (prices.length < 10) return null;
  return { weight, prices: prices.slice(0, 10) };
}

function sectionRates(lines: string[], headerMatch: (l: string) => boolean, nextMatch: (l: string) => boolean, countries: string[]): LightRate[] {
  const start = lines.findIndex(headerMatch);
  if (start < 0) return [];
  const out: LightRate[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (nextMatch(lines[i])) break;
    const row = parseWeightRow(lines[i]);
    if (!row) continue;
    countries.forEach((zone, idx) => out.push({ packageType: 'package', zone, weight: row.weight, rate: row.prices[idx] }));
  }
  return out;
}

export function parseAramexHn(fullText: string): ParsedIpExport {
  const lines = fullText.split(/\r?\n/);
  const isG1 = (l: string) => /\bBAHRAIN\b/i.test(l) && /\bSWITZERLAND\b/i.test(l);
  const isG2 = (l: string) => /\bOMAN\b/i.test(l) && /\bINDONESIA\b/i.test(l);
  const light = [
    ...sectionRates(lines, isG1, isG2, GROUP1),
    ...sectionRates(lines, isG2, () => false, GROUP2),
  ];
  return { light, heavy: [] };
}

export const aramexHnParser = {
  parse: parseAramexHn,
  // 20 nước × 40 bậc = 800 ô package, 0 pak.
  expectedPackageCells: ARAMEX_COUNTRIES.length * ARAMEX_TIER_UPPERS.length,
  expectedPakCells: 0,
};

/** Tiện ích cho script seed: parsed → cells theo tier uppers Aramex. */
export function aramexHnCells(fullText: string): RateCellInput[] {
  return toCells(parseAramexHn(fullText), ARAMEX_TIER_UPPERS);
}
```

> Nếu `ParsedIpExport`/`LightRate`/`toCells`/`RateSheetParser` có field khác (vd `light` tên khác, hay LightRate cần thêm field), đọc `features/carrier-rates/import/fedex-2025-rates.ts` + `preview.ts` và CHỈNH cho khớp shape thật; giữ ý nghĩa (zone=country, package, ≤20kg). Báo lại nếu lệch.

- [ ] **Step 4: Run → pass**

Run: `npx vitest run features/carrier-rates/import/aramex-hn-rates.test.ts`
Expected: PASS.

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output.
```bash
git add features/carrier-rates/import/aramex-hn-rates.ts features/carrier-rates/import/aramex-hn-rates.test.ts
git commit -m "feat(carrier): parser bảng giá Aramex HN (pdftotext → cells)"
```

---

### Task 6: Script seed Aramex + engine quote test + final gate

**Files:**
- Create: `scripts/import-aramex-hn.ts`
- Test: `features/carrier-rates/import/aramex-quote.test.ts`

**Interfaces:**
- Consumes: `aramexHnParser`/`aramexHnCells` (Task 5), `ARAMEX_COUNTRIES`/`ARAMEX_TIER_UPPERS`/`ARAMEX_ZONE_LABELS` (Task 4), `buildRateCardCells` (`import/preview.ts`), `quote`+`CarrierAccountSnapshot`+`QuoteInput` (`engine/quote.ts`).

- [ ] **Step 1: Engine quote test (USD→VND)**

Create `features/carrier-rates/import/aramex-quote.test.ts`. Dựng 1 `CarrierAccountSnapshot` tối thiểu cho Aramex (đọc `engine/quote.ts` cho field bắt buộc: id,name,costCurrency,displayCurrency,fxCostPerDisplay,dimDivisorCm3PerKg,chargeableRoundingKg,chargeableRoundingMode,totalsRoundingMode,zonesByCountry,weightTiers,surcharges,remotePostcodes), 1 zone Japan (tier 0.5=17.85, 1.0=19.72 USD), gọi `quote`:
```ts
import { describe, it, expect } from 'vitest';
import { quote, type CarrierAccountSnapshot, type QuoteInput } from '@/features/carrier-rates/engine/quote';

const FX = 1 / 26000; // cost USD / 1 VND
function snap(): CarrierAccountSnapshot {
  return {
    id: 'a', name: 'Aramex HN', costCurrency: 'USD', displayCurrency: 'VND',
    fxCostPerDisplay: FX, dimDivisorCm3PerKg: 5000,
    chargeableRoundingKg: null, chargeableRoundingMode: null, totalsRoundingMode: null,
    zonesByCountry: new Map([['JP', { /* ZoneSnap: đọc shape thật */ } as any]]),
    weightTiers: [ /* WeightTierSnap 0.5 & 1.0, cells Japan 17.85 / 19.72 — theo shape thật */ ] as any,
    surcharges: [], remotePostcodes: new Map(),
  };
}
describe('aramex quote', () => {
  it('1.0kg đi Japan → cost ~19.72 USD, display VND ≈ 512720', () => {
    const input: QuoteInput = { weightKg: 1.0, destinationCountry: 'JP' } as QuoteInput;
    const r = quote(snap(), input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Math.round(r.finalCostDisplay ?? r.carrierCostDisplay)).toBeGreaterThan(500000);
      expect(Math.round(r.finalCostDisplay ?? r.carrierCostDisplay)).toBeLessThan(520000);
    }
  });
});
```
> Đọc `engine/quote.ts` để lấy ĐÚNG shape `ZoneSnap`/`WeightTierSnap`/`QuoteResult` (tên field cost/display) và sửa test cho khớp. Mục tiêu: chứng minh fx mới (precision 10) cho ra VND đúng (~512.720 cho $19.72). Nếu dựng snapshot quá phức tạp, thay bằng test trực tiếp phép đổi: `Math.round(19.72 / FX)` === 512720 và assert engine dùng cùng công thức (đọc dòng `* fx` trong quote.ts).

- [ ] **Step 2: Run → fail rồi implement tới pass**

Run: `npx vitest run features/carrier-rates/import/aramex-quote.test.ts`
Điều chỉnh test theo shape thật tới khi PASS (đây là test xác nhận, không có code sản phẩm mới ngoài script).

- [ ] **Step 3: Viết script seed (mô phỏng import-dhl-2025.ts)**

Create `scripts/import-aramex-hn.ts` theo MẪU `scripts/import-dhl-2025.ts`. Khác biệt:
- Carrier key 'aramex' (đã seed ở migration). Tạo (hoặc tìm theo name) **carrier account**: costCurrency 'USD', displayCurrency 'VND', fxCostPerDisplay '0.0000384615', dimDivisorCm3PerKg '5000', chargeableRoundingKg NULL, weightUnit 'kg', enabled true.
- Zones: tạo 1 zone/nước từ `ARAMEX_COUNTRIES` (label), zone-countries = iso.
- Tiers: `ARAMEX_TIER_UPPERS`.
- Cells: `buildRateCardCells(aramexHnParser, pdftotextOutput, ARAMEX_TIER_UPPERS, ARAMEX_ZONE_LABELS)` — đọc PDF qua `pdftotext -layout` (execFileSync như dhl script).
- Rate card: label 'Aramex HN 2025-10', effectiveFrom '2025-10-01', open.
- DRY-RUN mặc định; `--apply` mới ghi; idempotent (ON CONFLICT / check tồn tại theo unique index).
- Default PDF path: `/Users/macos/Downloads/BẢNG GIÁ INECSO XUẤT HAN.pdf`.

Script KHÔNG có test tự động (I/O DB + đọc PDF); xác minh bằng chạy DRY-RUN ở Step 5.

- [ ] **Step 4: Final verification gate**

Run: `npx tsc --noEmit && npx vitest run && npm run lint && npm run build`
Expected: tsc no output; vitest toàn bộ pass (0 fail); lint 0 errors; build xanh.

- [ ] **Step 5: DRY-RUN script (KHÔNG --apply)**

Run: `DATABASE_URL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'') npx tsx scripts/import-aramex-hn.ts 2>&1 | tail -30`
Expected: in ra sẽ tạo 1 account, 20 zone, 40 tier, 1 card, ~800 cells; spot-check vài giá (Bahrain 0.5=18.31, Japan 1.0=19.72). KHÔNG ghi DB (chưa --apply).

> Áp lên prod (`--apply`) là bước riêng cần user cấp phép — KHÔNG tự chạy.

- [ ] **Step 6: Commit**
```bash
git add scripts/import-aramex-hn.ts features/carrier-rates/import/aramex-quote.test.ts
git commit -m "feat(carrier): script seed Aramex HN (DRY-RUN) + quote test USD→VND"
```

---

## Self-Review

**Spec coverage:** §3.1 migration fx+carrier → Task 1. §3.2 nhận diện → Task 2. §3.3 reconcile allowlist → Task 3. §3.4 seed (account/zones/tiers/card/cells) → Task 4 (zones/tiers) + Task 5 (parser/cells) + Task 6 (script account+card). §3.5 chạy seed → Task 6 (DRY-RUN; apply = bước user). §5 test (detection/quote/seed) → Task 2/6. Đủ.

**Placeholder scan:** Task 5/6 có ghi chú "đọc shape thật & chỉnh" — đây là chỉ dẫn bám interface thật (ParsedIpExport/ZoneSnap), không phải placeholder lười; code mẫu đầy đủ kèm fallback. Còn lại có code/command cụ thể.

**Type consistency:**
- `CarrierKey = 'fedex'|'dhl'|'aramex'` (Task 2) ← reconcile + union (Task 3). ✔
- `aramexHnParser`/`aramexHnCells` (Task 5) ← script (Task 6). ✔
- `ARAMEX_COUNTRIES`/`ARAMEX_TIER_UPPERS`/`ARAMEX_ZONE_LABELS` (Task 4) ← parser (Task 5) + script (Task 6). ✔
- `fxCostPerDisplay` precision (20,10) (Task 1) ← account seed 0.0000384615 (Task 6). ✔

**Rủi ro cần lưu khi review:** (a) data PDF có ô bất thường (Egypt 20kg) — giữ đúng PDF, flag user; (b) shape `RateSheetParser`/`ParsedIpExport`/`ZoneSnap`/`WeightTierSnap` phải khớp file thật — Task 5/6 yêu cầu implementer đọc & chỉnh; (c) chuẩn hoá country (ISO-2) phải khớp cách engine `load.ts` match — Task 6 DRY-RUN xác minh ô mẫu ra giá.
