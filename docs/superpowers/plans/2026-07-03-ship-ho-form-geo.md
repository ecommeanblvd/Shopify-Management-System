# Form ship hộ — Geo (country/city dropdown + phone dial-code) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Country + thành phố trong form tạo đơn ship hộ thành searchable dropdown (pick); thêm ô số điện thoại có mã vùng tự set theo country.

**Architecture:** Data tĩnh (`lib/geo/*`) + 1 combobox nhẹ tự viết (`components/ui/search-select.tsx`, không dep) + wiring trong `NewOrderForm.tsx`. Backend không đổi (action đã nhận `country`/`city`/`recipientPhone`).

**Tech Stack:** Next.js App Router (client component), Vitest, Tailwind. KHÔNG thêm dependency, KHÔNG API ngoài.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-03-ship-ho-form-geo-design.md`.
- KHÔNG thêm npm dependency; KHÔNG gọi API ngoài; KHÔNG đổi schema/`orders-actions.ts`/quote-adapter.
- Country lưu **ISO2**; city lưu string; phone lưu `recipientPhone = "+<dial> <số>"`.
- City combobox **allowFreeEntry=true** (list major cities không đủ mọi TP); country **allowFreeEntry=false**.
- `numeric`/DB không liên quan (chỉ UI + data tĩnh). Chạy trước push: `npx tsc --noEmit` + `npx vitest run` + eslint xanh.
- Chỉ áp cho form **tạo đơn** (`app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx`); không đụng import lô.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `lib/geo/countries.ts` (+test) | `COUNTRIES` (~250: iso2/name/dialCode) + `dialCodeFor` + `countryByIso` |
| `lib/geo/cities.ts` (+test) | `CITIES_BY_ISO` (major cities theo ISO) + `citiesFor` |
| `components/ui/search-select.tsx` (+test) | Combobox nhẹ + `filterOptions` thuần |
| `app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx` (modify) | Wire country/city SearchSelect + ô phone dial-code |

---

### Task 1: `lib/geo/countries.ts` — dataset nước + dial code

**Files:**
- Create: `lib/geo/countries.ts`
- Test: `lib/geo/countries.test.ts`

**Interfaces:**
- Produces:
  - `interface Country { iso2: string; name: string; dialCode: string }`
  - `const COUNTRIES: Country[]`
  - `function dialCodeFor(iso2: string): string | null`
  - `function countryByIso(iso2: string): Country | null`

- [ ] **Step 1: Write the failing test** `lib/geo/countries.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { COUNTRIES, dialCodeFor, countryByIso } from './countries';

describe('COUNTRIES dataset', () => {
  it('đủ ~250 nước, mỗi entry có iso2 (2 chữ hoa) + name + dialCode', () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(240);
    for (const c of COUNTRIES) {
      expect(c.iso2).toMatch(/^[A-Z]{2}$/);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.dialCode).toMatch(/^[0-9]{1,4}$/);
    }
  });
  it('iso2 không trùng', () => {
    const set = new Set(COUNTRIES.map((c) => c.iso2));
    expect(set.size).toBe(COUNTRIES.length);
  });
  it('có các nước MEAN hay ship + dial đúng', () => {
    expect(dialCodeFor('US')).toBe('1');
    expect(dialCodeFor('VN')).toBe('84');
    expect(dialCodeFor('GB')).toBe('44');
    expect(dialCodeFor('SA')).toBe('966');
    expect(dialCodeFor('AE')).toBe('971');
    expect(dialCodeFor('AU')).toBe('61');
    expect(dialCodeFor('JP')).toBe('81');
  });
});

describe('dialCodeFor / countryByIso', () => {
  it('không phân biệt hoa thường', () => {
    expect(dialCodeFor('us')).toBe('1');
    expect(countryByIso('vn')?.name).toBeTruthy();
  });
  it('iso2 lạ → null', () => {
    expect(dialCodeFor('ZZ')).toBeNull();
    expect(countryByIso('ZZ')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/geo/countries.test.ts`
Expected: FAIL — "Cannot find module './countries'".

- [ ] **Step 3: Implement** `lib/geo/countries.ts`

Tạo file với helpers (code đầy đủ dưới đây) + mảng `COUNTRIES` **đầy đủ danh sách ISO-3166-1 alpha-2** (~250 nước), mỗi phần tử `{ iso2, name, dialCode }` với `dialCode` là mã gọi quốc tế (chỉ chữ số, không dấu `+`). Đây là dữ liệu tham chiếu chuẩn — điền TẤT CẢ các nước, không rút gọn. Bắt đầu bằng khối helper + một phần dataset mẫu; điền nốt toàn bộ theo chuẩn ISO/E.164:

```ts
/** Dataset tĩnh nước + mã gọi quốc tế (E.164). dialCode chỉ chữ số (không '+'). */
export interface Country {
  iso2: string;
  name: string;
  dialCode: string;
}

// Đầy đủ ISO-3166-1 alpha-2 (~250). dialCode = mã gọi quốc tế.
// (Điền TẤT CẢ các nước — dưới là mẫu định dạng + các nước MEAN hay ship;
//  bổ sung nốt phần còn lại của thế giới theo chuẩn.)
export const COUNTRIES: Country[] = [
  { iso2: 'US', name: 'United States', dialCode: '1' },
  { iso2: 'VN', name: 'Việt Nam', dialCode: '84' },
  { iso2: 'GB', name: 'United Kingdom', dialCode: '44' },
  { iso2: 'AU', name: 'Australia', dialCode: '61' },
  { iso2: 'CA', name: 'Canada', dialCode: '1' },
  { iso2: 'JP', name: 'Japan', dialCode: '81' },
  { iso2: 'SG', name: 'Singapore', dialCode: '65' },
  { iso2: 'CN', name: 'China', dialCode: '86' },
  { iso2: 'HK', name: 'Hong Kong', dialCode: '852' },
  { iso2: 'FR', name: 'France', dialCode: '33' },
  { iso2: 'DE', name: 'Germany', dialCode: '49' },
  { iso2: 'TH', name: 'Thailand', dialCode: '66' },
  { iso2: 'MY', name: 'Malaysia', dialCode: '60' },
  { iso2: 'PH', name: 'Philippines', dialCode: '63' },
  { iso2: 'SA', name: 'Saudi Arabia', dialCode: '966' },
  { iso2: 'AE', name: 'United Arab Emirates', dialCode: '971' },
  { iso2: 'QA', name: 'Qatar', dialCode: '974' },
  { iso2: 'KW', name: 'Kuwait', dialCode: '965' },
  { iso2: 'IL', name: 'Israel', dialCode: '972' },
  { iso2: 'KR', name: 'South Korea', dialCode: '82' },
  // … BỔ SUNG NỐT toàn bộ các nước còn lại (ISO-3166-1 alpha-2 đầy đủ) …
];

const BY_ISO: Map<string, Country> = new Map(COUNTRIES.map((c) => [c.iso2, c]));

export function countryByIso(iso2: string): Country | null {
  return BY_ISO.get((iso2 ?? '').trim().toUpperCase()) ?? null;
}

export function dialCodeFor(iso2: string): string | null {
  return countryByIso(iso2)?.dialCode ?? null;
}
```

> NOTE cho implementer: mảng `COUNTRIES` PHẢI đầy đủ ~250 nước (test yêu cầu `>= 240` + iso2 unique). Điền theo chuẩn ISO-3166-1 alpha-2 + mã E.164. Tên tiếng Anh (riêng VN để "Việt Nam" cho thân thiện). Không thêm dep.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/geo/countries.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify tsc + commit**

Run: `npx tsc --noEmit` → exit 0.

```bash
git add lib/geo/countries.ts lib/geo/countries.test.ts
git commit -m "feat(geo): dataset nước + dialCode + helpers"
```

---

### Task 2: `lib/geo/cities.ts` — major cities theo nước

**Files:**
- Create: `lib/geo/cities.ts`
- Test: `lib/geo/cities.test.ts`

**Interfaces:**
- Produces: `const CITIES_BY_ISO: Record<string, string[]>`; `function citiesFor(iso2: string): string[]`.

- [ ] **Step 1: Write the failing test** `lib/geo/cities.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { CITIES_BY_ISO, citiesFor } from './cities';

describe('citiesFor', () => {
  it('nước đã curate → list không rỗng (vd US có New York)', () => {
    const us = citiesFor('US');
    expect(us.length).toBeGreaterThan(5);
    expect(us).toContain('New York');
  });
  it('không phân biệt hoa thường', () => {
    expect(citiesFor('us').length).toBe(citiesFor('US').length);
  });
  it('nước chưa curate → mảng rỗng (không lỗi)', () => {
    expect(citiesFor('ZZ')).toEqual([]);
  });
  it('mọi list đều là string không rỗng, không trùng trong 1 nước', () => {
    for (const [iso, list] of Object.entries(CITIES_BY_ISO)) {
      expect(iso).toMatch(/^[A-Z]{2}$/);
      expect(new Set(list).size).toBe(list.length);
      for (const c of list) expect(c.trim().length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/geo/cities.test.ts`
Expected: FAIL — "Cannot find module './cities'".

- [ ] **Step 3: Implement** `lib/geo/cities.ts`

Curate major cities cho các nước MEAN hay ship tới (bám carrier zones). Điền ~15-40 TP lớn mỗi nước cho các ISO sau (tối thiểu): `US, CA, GB, AU, FR, DE, JP, KR, SG, CN, HK, TH, MY, PH, VN, SA, AE, QA, KW, IL`. Định dạng:

```ts
/** Major cities theo ISO2 (curate cho các nước hay ship). Không đủ mọi TP —
 *  form cho phép free-entry khi TP không có trong list. */
export const CITIES_BY_ISO: Record<string, string[]> = {
  US: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia',
       'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Seattle',
       'Boston', 'San Francisco', 'Atlanta', 'Miami', 'Washington', 'Las Vegas'],
  SA: ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Khobar', 'Dhahran', 'Taif', 'Tabuk'],
  AE: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Al Ain', 'Ras Al Khaimah', 'Fujairah'],
  VN: ['Hà Nội', 'Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ', 'Nha Trang', 'Huế'],
  // … BỔ SUNG các nước còn lại trong danh sách tối thiểu ở trên, ~15-40 TP/nước …
};

export function citiesFor(iso2: string): string[] {
  return CITIES_BY_ISO[(iso2 ?? '').trim().toUpperCase()] ?? [];
}
```

> NOTE: đủ các ISO trong danh sách tối thiểu; mỗi nước liệt kê TP lớn thật (không bịa). Test chỉ hard-check `US` chứa `New York` + rỗng cho `ZZ`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/geo/cities.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify tsc + commit**

Run: `npx tsc --noEmit` → exit 0.

```bash
git add lib/geo/cities.ts lib/geo/cities.test.ts
git commit -m "feat(geo): major cities theo nước + citiesFor"
```

---

### Task 3: `components/ui/search-select.tsx` — combobox nhẹ

**Files:**
- Create: `components/ui/search-select.tsx`
- Test: `components/ui/search-select.test.ts`

**Interfaces:**
- Produces:
  - `interface SelectOption { value: string; label: string }`
  - `function filterOptions(options: SelectOption[], query: string): SelectOption[]` (thuần)
  - `function SearchSelect(props: { value: string; onChange: (v: string) => void; options: SelectOption[]; placeholder?: string; allowFreeEntry?: boolean; disabled?: boolean }): JSX.Element`

- [ ] **Step 1: Write the failing test** `components/ui/search-select.test.ts` (chỉ test `filterOptions` thuần)

```ts
import { describe, it, expect } from 'vitest';
import { filterOptions, type SelectOption } from './search-select';

const OPTS: SelectOption[] = [
  { value: 'US', label: 'United States (US)' },
  { value: 'GB', label: 'United Kingdom (GB)' },
  { value: 'AE', label: 'United Arab Emirates (AE)' },
  { value: 'VN', label: 'Việt Nam (VN)' },
];

describe('filterOptions', () => {
  it('query rỗng → trả toàn bộ', () => {
    expect(filterOptions(OPTS, '')).toEqual(OPTS);
    expect(filterOptions(OPTS, '   ')).toEqual(OPTS);
  });
  it('lọc substring, không phân biệt hoa thường', () => {
    const r = filterOptions(OPTS, 'united');
    expect(r.map((o) => o.value)).toEqual(['US', 'GB', 'AE']);
  });
  it('prefix match ưu tiên trước substring', () => {
    // 'viet' chỉ khớp VN; 'v' prefix VN nhưng cũng substring trong không cái nào khác
    expect(filterOptions(OPTS, 'viet').map((o) => o.value)).toEqual(['VN']);
  });
  it('ưu tiên prefix: query "un" → tất cả United* (prefix) trước', () => {
    const r = filterOptions(OPTS, 'un');
    expect(r.map((o) => o.value)).toEqual(['US', 'GB', 'AE']);
  });
  it('không khớp → rỗng', () => {
    expect(filterOptions(OPTS, 'zzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/ui/search-select.test.ts`
Expected: FAIL — "Cannot find module './search-select'".

- [ ] **Step 3: Implement** `components/ui/search-select.tsx`

```tsx
'use client';

import { useState, useRef, useEffect } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

/** THUẦN: lọc option theo query — prefix match trước, rồi substring; query rỗng → toàn bộ. */
export function filterOptions(options: SelectOption[], query: string): SelectOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const prefix: SelectOption[] = [];
  const sub: SelectOption[] = [];
  for (const o of options) {
    const l = o.label.toLowerCase();
    if (l.startsWith(q)) prefix.push(o);
    else if (l.includes(q)) sub.push(o);
  }
  return [...prefix, ...sub];
}

/**
 * Combobox nhẹ (không dep): ô input lọc + list gợi ý click chọn.
 * allowFreeEntry=true → text gõ vào cũng là giá trị (city); false → chỉ nhận khi
 * click 1 option (country). Đóng khi click ra ngoài.
 */
export function SearchSelect({
  value, onChange, options, placeholder, allowFreeEntry = false, disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  allowFreeEntry?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;
  const shown = filterOptions(options, query).slice(0, 50);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (v: string) => { onChange(v); setOpen(false); setQuery(''); };

  return (
    <div ref={ref} className="relative">
      <input
        className="block w-full border rounded px-2 py-1 mt-1 disabled:opacity-50"
        placeholder={placeholder}
        disabled={disabled}
        value={open ? query : selectedLabel}
        onFocus={() => { if (!disabled) { setOpen(true); setQuery(''); } }}
        onChange={(e) => {
          setQuery(e.target.value);
          if (allowFreeEntry) onChange(e.target.value);
        }}
      />
      {open && shown.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-auto border rounded bg-background shadow">
          {shown.map((o) => (
            <button
              type="button"
              key={o.value}
              className="block w-full text-left px-2 py-1 text-sm hover:bg-muted"
              onClick={() => pick(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/ui/search-select.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify tsc + eslint + commit**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx eslint components/ui/search-select.tsx` → no errors.

```bash
git add components/ui/search-select.tsx components/ui/search-select.test.ts
git commit -m "feat(ui): SearchSelect combobox nhẹ + filterOptions"
```

---

### Task 4: Wire vào `NewOrderForm.tsx` (country/city dropdown + phone dial-code)

**Files:**
- Modify: `app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx`

**Interfaces:**
- Consumes: `COUNTRIES`, `dialCodeFor` (Task 1); `citiesFor` (Task 2); `SearchSelect`, `SelectOption` (Task 3).

**Bối cảnh file hiện tại:** `NewOrderForm` là client component với state `f` (object gồm `code, partnerBrandSlug, recipientName, country, city, postcode, address1, weightKg, dimLengthCm, dimWidthCm, dimHeightCm, packagingType, carrierAccountId`), helper `set(k)` cho input text, và `createShipHoOrder(...)` khi submit. Country/City hiện là `<input>` text; chưa có phone.

- [ ] **Step 1: Thêm imports + state phone** — đầu file, thêm:

```tsx
import { SearchSelect } from '@/components/ui/search-select';
import { COUNTRIES, dialCodeFor } from '@/lib/geo/countries';
import { citiesFor } from '@/lib/geo/cities';
```

Trong `useState` khởi tạo `f`, thêm field `phone: ''` (số thuần, không mã vùng). Giữ nguyên các field khác.

- [ ] **Step 2: Dựng options country (memo hằng) + đổi field Country** — thêm hằng ngoài component:

```tsx
const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.iso2, label: `${c.name} (${c.iso2})` }));
```

Thay ô Country `<input>` bằng:

```tsx
        <label className="text-sm">Quốc gia (ISO2) *
          <SearchSelect
            value={f.country}
            onChange={(v) => setF({ ...f, country: v, city: '' })}
            options={COUNTRY_OPTIONS}
            placeholder="Tìm quốc gia…"
          />
        </label>
```

(Đổi country **reset city** về '' vì city phụ thuộc nước.)

- [ ] **Step 3: Đổi field Thành phố → SearchSelect(allowFreeEntry)**

```tsx
        <label className="text-sm">Thành phố
          <SearchSelect
            value={f.city}
            onChange={(v) => setF({ ...f, city: v })}
            options={citiesFor(f.country).map((c) => ({ value: c, label: c }))}
            placeholder={f.country ? 'Chọn/nhập thành phố…' : 'Chọn quốc gia trước'}
            allowFreeEntry
            disabled={!f.country}
          />
        </label>
```

- [ ] **Step 4: Thêm ô Số điện thoại (dial code auto)** — chèn sau field "Người nhận":

```tsx
        <label className="text-sm">Số điện thoại
          <div className="flex gap-2 mt-1">
            <span className="inline-flex items-center px-2 border rounded bg-muted text-sm min-w-14 justify-center">
              {f.country && dialCodeFor(f.country) ? `+${dialCodeFor(f.country)}` : '—'}
            </span>
            <input
              className="block w-full border rounded px-2 py-1"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
              placeholder="Số điện thoại người nhận"
            />
          </div>
        </label>
```

- [ ] **Step 5: Ghép phone khi submit** — trong hàm `submit`, khi gọi `createShipHoOrder`, thêm `recipientPhone`:

```tsx
      const dial = f.country ? dialCodeFor(f.country) : null;
      const recipientPhone = f.phone.trim()
        ? (dial ? `+${dial} ${f.phone.trim()}` : f.phone.trim())
        : undefined;
      const r = await createShipHoOrder({
        code: f.code, partnerBrandSlug: f.partnerBrandSlug, recipientName: f.recipientName,
        recipientPhone,
        country: f.country, city: f.city, postcode: f.postcode, address1: f.address1,
        weightKg: f.weightKg, dimLengthCm: f.dimLengthCm || undefined, dimWidthCm: f.dimWidthCm || undefined,
        dimHeightCm: f.dimHeightCm || undefined, packagingType: f.packagingType || null,
        carrierKey: acc?.carrierKey, carrierAccountId: f.carrierAccountId || undefined, createdBy: userEmail,
      });
```

(Giữ nguyên phần còn lại của `submit` — chỉ thêm 2 dòng tính `dial`/`recipientPhone` và truyền `recipientPhone`.)

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx eslint "app/(dashboard)/f/ship-ho"` → no errors.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx"
git commit -m "feat(ship-ho): form country/city search-dropdown + phone dial-code"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1 countries + dialCodeFor/countryByIso → Task 1. ✔
- §3.2 cities + citiesFor → Task 2. ✔
- §4 SearchSelect + filterOptions → Task 3. ✔
- §5 form: country dropdown (ISO2, no free-entry), city dropdown (free-entry, reset khi đổi country, disabled khi chưa chọn), phone dial-code auto → Task 4. ✔
- §6 lưu country ISO2/city string/recipientPhone; backend không đổi → Task 4 (chỉ truyền field action đã có). ✔
- §7 test thuần dialCodeFor/citiesFor/filterOptions → Task 1/2/3. ✔
- §8 YAGNI: không dep/API/validate-phone → toàn plan không thêm dep. ✔

**2. Placeholder scan:** không TBD/TODO. Hai NOTE (Task 1/2) yêu cầu điền đủ dataset chuẩn — đây là dữ liệu tham chiếu (điền theo ISO/E.164), không phải placeholder logic; test ràng buộc số lượng + entry chính.

**3. Type consistency:**
- `Country {iso2,name,dialCode}` (Task 1) dùng ở Task 4 (`COUNTRIES.map`, `dialCodeFor`). ✔
- `citiesFor(iso2): string[]` (Task 2) dùng ở Task 4. ✔
- `SelectOption {value,label}` + `SearchSelect` props (Task 3) khớp cách gọi ở Task 4 (value/onChange/options/allowFreeEntry/disabled/placeholder). ✔
- `filterOptions` (Task 3) — test riêng, không dùng ngoài component. ✔
- Field `f.phone` (Task 4 Step 1) dùng ở Step 4/5. ✔

## Execution Handoff (điền sau khi lưu plan)
