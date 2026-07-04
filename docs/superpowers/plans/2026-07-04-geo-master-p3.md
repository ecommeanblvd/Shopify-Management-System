# Geo Master P3 — trang tra cứu zip↔carrier + cảnh báo lệch — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> Spec: `docs/superpowers/specs/2026-07-04-geo-master-design.md` §6.

**Goal:** Trang `/f/carrier-rates/geo-lookup`: nhập country+postcode(+city) → geo-master info + zone/remote-tier/surcharge từng carrier account + cảnh báo postcode "carrier có, master thiếu". TÁI DÙNG quote engine (extract match, không viết lại).

**Architecture:** (T1) extract `matchRemoteTier` thuần từ `quote.ts` giữ hành vi (test cũ là lưới); (T2) query `lookupCarrierGeo` gộp geo-master + per-account zone/tier; (T3) `geoRemoteDrift` so normalized; (T4) trang UI. KHÔNG migration.

**Tech Stack:** Next.js App Router, Drizzle, Vitest.

## Global Constraints

- **T1 refactor GIỮ NGUYÊN hành vi `quote()`** — `features/carrier-rates/engine/quote.test.ts` + `remote-city-match.test.ts` PHẢI xanh không đổi.
- **Cảnh báo lệch (T3) BẮT BUỘC normalize `carrierRemotePostcodes.postcodePattern` (raw) bằng `normPostcode` TRƯỚC khi so `geo_postcodes.postcodeNorm`** (spec §6 note — nếu không sẽ false-positive ở UK/NL/CA/PT/JP). Chỉ so pattern loại **postcode-thật** (bỏ wildcard `'*'` + city-pattern).
- RBAC trang: `view_carrier_rates` (mirror `carrier-rates/page.tsx`).
- Tái dùng `loadAccountSnapshot`, `sumRemoteFixed`, `listAccounts` — không viết lại.

---

### Task 1: Extract `matchRemoteTier` thuần (refactor giữ hành vi) + test

**Files:**
- Create `features/carrier-rates/engine/remote-match.ts`
- Modify `features/carrier-rates/engine/quote.ts`
- Test `features/carrier-rates/engine/remote-match-fn.test.ts`

**Interfaces (Produces):**
```ts
export function matchRemoteTier(
  perCountry: Map<string, string | null> | undefined,   // snap.remotePostcodes.get(country)
  postcode: string | null | undefined,
  city: string | null | undefined,
): { tier: string | null; matchedBy: 'postcode' | 'city' | 'country_default' | null };
```

- [ ] **Step 1: Đọc + hiểu block hiện tại**

Mở `features/carrier-rates/engine/quote.ts` ~610-682. Đó là block tính `matchedTier` + `matchedBy` từ `snap.remotePostcodes.get(country)` + `input.destinationPostcode` + `input.destinationCity` (3 tầng: postcode raw→stripped→prefix, city normalize, wildcard `'*'`), rồi `remote = sumRemoteFixed(...)`. Chỉ EXTRACT phần tính `{matchedTier, matchedBy}` (KHÔNG kéo `sumRemoteFixed` vào — cái đó ở lại quote).

- [ ] **Step 2: Tạo `remote-match.ts`** — copy CHÍNH XÁC logic 3 tầng + mọi normalize (postcode raw→stripped→prefix, city latin/uppercase) từ block đó vào hàm `matchRemoteTier` với chữ ký trên. Không đổi thứ tự/ngưỡng. `perCountry` undefined → `{ tier: null, matchedBy: null }`.

- [ ] **Step 3: Thay trong `quote.ts`** — thay block inline bằng:
```ts
  const { tier: matchedTier, matchedBy } = matchRemoteTier(
    snap.remotePostcodes.get(country), input.destinationPostcode, input.destinationCity,
  );
```
(import `matchRemoteTier` từ `./remote-match`; giữ nguyên phần `if (matchedBy !== null) { remote = sumRemoteFixed(...) ... }` phía sau.)

- [ ] **Step 4: Test hàm mới**

```ts
// features/carrier-rates/engine/remote-match-fn.test.ts
import { describe, it, expect } from 'vitest';
import { matchRemoteTier } from './remote-match';

describe('matchRemoteTier', () => {
  it('undefined map → null', () => {
    expect(matchRemoteTier(undefined, '90210', 'X')).toEqual({ tier: null, matchedBy: null });
  });
  it('postcode khớp (ưu tiên trước city)', () => {
    const m = new Map<string, string | null>([['90210', 'Tier A'], ['BEVERLYHILLS', 'Tier B']]);
    expect(matchRemoteTier(m, '90210', 'Beverly Hills')).toEqual({ tier: 'Tier A', matchedBy: 'postcode' });
  });
  it('city fallback khi postcode miss', () => {
    const m = new Map<string, string | null>([['JEDDAH', 'Tier C']]);
    expect(matchRemoteTier(m, '00000', 'Jeddah')).toMatchObject({ matchedBy: 'city' });
  });
  it('wildcard country-default', () => {
    const m = new Map<string, string | null>([['*', 'Tier D']]);
    expect(matchRemoteTier(m, 'zzz', 'Nowhere')).toEqual({ tier: 'Tier D', matchedBy: 'country_default' });
  });
  it('miss hoàn toàn → null', () => {
    expect(matchRemoteTier(new Map(), '123', 'Y')).toEqual({ tier: null, matchedBy: null });
  });
});
```
(Nếu normalize thực tế khác — vd stripped/prefix — điều chỉnh key test cho khớp code THẬT copy được; giữ ý nghĩa 3 tầng.)

- [ ] **Step 5: Verify hành vi giữ nguyên**

Run: `npx vitest run features/carrier-rates/engine/` → TẤT CẢ xanh (quote.test + remote-city-match.test + remote-match-fn.test). Nếu quote/remote-city-match ĐỎ → extract sai, sửa cho khớp hành vi cũ.
Run: `npx tsc --noEmit` → 0.

- [ ] **Step 6: Commit**

```bash
git add features/carrier-rates/engine/remote-match.ts features/carrier-rates/engine/quote.ts features/carrier-rates/engine/remote-match-fn.test.ts
git commit -m "refactor(carrier): extract matchRemoteTier thuần từ quote (giữ hành vi) + test"
```

---

### Task 2: Query `lookupCarrierGeo` — geo-master + zone/tier từng account

**Files:** Create `features/geo/carrier-geo.ts`

**Interfaces:**
- Consumes: `lookupPostcode` (`./queries`), `listAccounts` (`@/features/carrier-rates/actions`), `loadAccountSnapshot` (`@/features/carrier-rates/engine/load`), `matchRemoteTier` (T1), `sumRemoteFixed` (`@/features/carrier-rates/engine/quote` — kiểm export; nếu chưa export thì export nó, hoặc dùng snapshot.surcharges filter theo brief map).
- Produces: `lookupCarrierGeo(country, postcode, city?)` → `{ geo, carriers }`.

- [ ] **Step 1: Implement**

```ts
// features/geo/carrier-geo.ts
import { lookupPostcode } from './queries';
import { listAccounts } from '@/features/carrier-rates/actions';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { matchRemoteTier } from '@/features/carrier-rates/engine/remote-match';

export interface CarrierGeoRow {
  accountId: string;
  accountName: string;
  carrierKey: string | null;
  zone: string | null;
  tier: string | null;
  matchedBy: 'postcode' | 'city' | 'country_default' | null;
}

export interface CarrierGeoLookup {
  geo: { valid: boolean | null; city: string | null; stateCode: string | null };
  carriers: CarrierGeoRow[];
}

export async function lookupCarrierGeo(country: string, postcode: string, city?: string): Promise<CarrierGeoLookup> {
  const cc = country.toUpperCase();
  const geoRes = await lookupPostcode(cc, postcode);
  const geo = { valid: geoRes.valid, city: geoRes.city, stateCode: geoRes.stateCode };
  // city để match remote: ưu tiên city người dùng nhập, fallback city tra được từ postcode.
  const cityForMatch = city ?? geoRes.city ?? undefined;

  const accounts = await listAccounts();
  const carriers: CarrierGeoRow[] = [];
  for (const a of accounts) {
    const snap = await loadAccountSnapshot(a.id);
    if (!snap) { carriers.push({ accountId: a.id, accountName: a.name, carrierKey: a.carrierKey ?? null, zone: null, tier: null, matchedBy: null }); continue; }
    const zone = snap.zonesByCountry.get(cc)?.label ?? null;
    const { tier, matchedBy } = matchRemoteTier(snap.remotePostcodes.get(cc), postcode, cityForMatch);
    carriers.push({ accountId: a.id, accountName: a.name, carrierKey: a.carrierKey ?? null, zone, tier, matchedBy });
  }
  return { geo, carriers };
}
```
(Kiểm field thật của `listAccounts()` (`name`/`carrierKey`) + `snap.zonesByCountry`/`snap.remotePostcodes` bằng tsc; chỉnh nếu tên lệch. Nếu muốn hiện phí remote thì thêm `sumRemoteFixed` — nhưng cần `chargeableWeightKg`+date; để P3 chỉ hiện tier/zone, KHÔNG tính phí (YAGNI — phí tuỳ cân, thuộc calculator).)

- [ ] **Step 2: tsc + smoke prod**

Run: `npx tsc --noEmit` → 0.
Run: `railway run npx tsx -e "import('./features/geo/carrier-geo').then(async m => { console.log(JSON.stringify(await m.lookupCarrierGeo('US','90210'), null, 1)); process.exit(0); })" 2>&1 | tail -20` — kỳ vọng geo.valid true + mảng carriers có zone (nếu account có cấu hình US). Mạng lỗi → báo.

- [ ] **Step 3: Commit**

```bash
git add features/geo/carrier-geo.ts
git commit -m "feat(geo): lookupCarrierGeo — geo-master + zone/remote-tier từng carrier account"
```

---

### Task 3: `geoRemoteDrift` — cảnh báo postcode carrier có, master thiếu

**Files:** Modify `features/geo/carrier-geo.ts` · Test `features/geo/carrier-geo-drift.test.ts`

**Interfaces:**
- Produces: `isPostcodePattern(p)` (thuần), `geoRemoteDrift(country)` → `{ checked: number; missing: string[] }`.

- [ ] **Step 1: Test hàm thuần nhận dạng pattern (FAIL trước)**

```ts
// features/geo/carrier-geo-drift.test.ts
import { describe, it, expect } from 'vitest';
import { isPostcodePattern } from './carrier-geo';

describe('isPostcodePattern', () => {
  it('wildcard * → false', () => { expect(isPostcodePattern('*')).toBe(false); });
  it('city UPPERCASE chữ → false', () => { expect(isPostcodePattern('JEDDAH')).toBe(false); });
  it('có chữ số → postcode true', () => {
    expect(isPostcodePattern('98077')).toBe(true);
    expect(isPostcodePattern('SW1A 1AA')).toBe(true); // alnum có số
  });
});
```

- [ ] **Step 2: Implement (thêm vào `carrier-geo.ts`)**

```ts
import { and, eq, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { normPostcode } from './geonames-parse';

/** Pattern là postcode-thật khi có ít nhất 1 chữ số (loại wildcard '*' + city thuần chữ). */
export function isPostcodePattern(p: string): boolean {
  return /\d/.test(p);
}

/** Postcode trong remote-list carrier (đã normalize) KHÔNG tồn tại trong geo master (nước đã nạp). */
export async function geoRemoteDrift(country: string): Promise<{ checked: number; missing: string[] }> {
  const cc = country.toUpperCase();
  const [imp] = await db.select({ id: schema.geoImports.id }).from(schema.geoImports)
    .where(eq(schema.geoImports.countryCode, cc)).limit(1);
  if (!imp) return { checked: 0, missing: [] }; // nước chưa nạp → không so

  const patterns = await db.selectDistinct({ p: schema.carrierRemotePostcodes.postcodePattern })
    .from(schema.carrierRemotePostcodes)
    .where(and(eq(schema.carrierRemotePostcodes.countryCode, cc), isNotNull(schema.carrierRemotePostcodes.postcodePattern)));
  const master = await db.select({ n: schema.geoPostcodes.postcodeNorm })
    .from(schema.geoPostcodes).where(eq(schema.geoPostcodes.countryCode, cc));
  const masterSet = new Set(master.map((r) => r.n));

  const missing: string[] = [];
  let checked = 0;
  for (const { p } of patterns) {
    if (!p || !isPostcodePattern(p)) continue; // bỏ wildcard + city-pattern
    checked++;
    if (!masterSet.has(normPostcode(p))) missing.push(p); // NORMALIZE trước khi so (spec §6)
  }
  return { checked, missing };
}
```

- [ ] **Step 3: PASS + tsc + commit**

Run: `npx vitest run features/geo/carrier-geo-drift.test.ts` → PASS. `npx tsc --noEmit` → 0.
```bash
git add features/geo/carrier-geo.ts features/geo/carrier-geo-drift.test.ts
git commit -m "feat(geo): geoRemoteDrift — cảnh báo postcode carrier lệch master (normalize trước khi so)"
```

---

### Task 4: Trang UI `/f/carrier-rates/geo-lookup`

**Files:**
- Create `app/(dashboard)/f/carrier-rates/geo-lookup/page.tsx`
- Create `app/(dashboard)/f/carrier-rates/geo-lookup/GeoLookupView.tsx`
- Modify `app/(dashboard)/f/carrier-rates/page.tsx` (thêm link "Tra cứu geo")

**Interfaces:** Consumes `lookupCarrierGeo`, `geoRemoteDrift` (T2/T3); RBAC như carrier-rates page.

- [ ] **Step 1: Server page**

RBAC `view_carrier_rates` (mirror `carrier-rates/page.tsx` — auth/getRole/hasPermission, Forbidden nếu thiếu). `force-dynamic`. Đọc `searchParams` `{ country?, postcode?, city? }`; nếu có country+postcode → gọi `lookupCarrierGeo(country, postcode, city)` + `geoRemoteDrift(country)`; truyền vào `<GeoLookupView>`. Không có input → chỉ form.

- [ ] **Step 2: `GeoLookupView.tsx` (client)**

Form GET (country + postcode + city optional) đẩy vào query. Nếu có kết quả:
- **Geo master**: `valid` (✓ hợp lệ / ⚠ không tìm thấy / — chưa nạp) + city + state.
- **Bảng carrier**: mỗi account 1 dòng — Account · Carrier · Zone · Remote tier (matchedBy: postcode/city/mặc-định-nước / — không remote).
- **Badge drift**: nếu `drift.missing.length > 0` → chip cảnh báo "N postcode trong remote-list không có trong geo master (nghi lỗi thời)" + list (thu gọn, tối đa ~20).

Tiếng Việt, dùng Card/Table sẵn có, tone màu như các bảng khác (tier có → info; không → muted; drift → warning).

- [ ] **Step 3: Link ở carrier-rates page** — thêm `<Link href="/f/carrier-rates/geo-lookup">Tra cứu geo</Link>` (buttonVariants outline) cạnh nút hiện có ở header.

- [ ] **Step 4: tsc + eslint + commit**

Run: `npx tsc --noEmit` → 0. `npx eslint "app/(dashboard)/f/carrier-rates/geo-lookup" "app/(dashboard)/f/carrier-rates/page.tsx"` → 0.
```bash
git add "app/(dashboard)/f/carrier-rates/geo-lookup" "app/(dashboard)/f/carrier-rates/page.tsx"
git commit -m "feat(geo): trang tra cứu zip↔carrier (zone+remote tier từng account + cảnh báo lệch)"
```

---

## Self-Review (đã chạy)

- **Spec coverage §6:** trang lookup zone+tier từng carrier (T2+T4) ✓ · tái dùng match không viết lại (T1 extract) ✓ · cảnh báo lệch normalize-trước-khi-so (T3) ✓ · RBAC view_carrier_rates ✓.
- **Placeholder scan:** T1 refactor (code có sẵn), T2/T3 code thật, T4 mô tả cấu trúc + field mapping.
- **Type consistency:** `matchRemoteTier` chữ ký dùng ở quote + carrier-geo; `lookupCarrierGeo` dùng listAccounts/loadAccountSnapshot (kiểm field tsc); `normPostcode` dùng ở drift (khớp import P1); `isPostcodePattern` thuần test riêng.
- **Rủi ro:** T1 refactor phải giữ hành vi (quote.test + remote-city-match.test là gate — nếu đỏ, extract sai); field `listAccounts`/`snap.zonesByCountry` kiểm bằng tsc; drift normalize là điểm final-review-P1 đã nhấn — T3 làm đúng.
