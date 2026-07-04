# Geo Master P2 — API states/postcode + cities đọc DB + form autofill — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> Spec: `docs/superpowers/specs/2026-07-04-geo-master-design.md` §5.

**Goal:** 3 API MMP (states mới, cities nâng-đọc-DB, postcode lookup mới) + form ship-hộ autofill city từ postcode. Tái dùng queries P1 (`listStates/listCities/lookupPostcode`).

**Architecture:** Route mỏng mirror `countries/route.ts` (HMAC `requireMmpSignature`) gọi queries P1; form thêm server action `lookupPostcodeAction` + autofill client. KHÔNG migration, KHÔNG đổi query P1.

**Tech Stack:** Next.js App Router, Drizzle, React 19, Vitest.

## Global Constraints

- HMAC body-rỗng như `countries`/`cities` đang live (`requireMmpSignature`).
- `/cities` GIỮ shape `{ country, cities: string[] }` (không vỡ MMP đang tích hợp) — chỉ đổi nguồn sang `listCities` (DB khi nạp, fallback curated khi chưa).
- Nước chưa nạp: `/postcode` trả `valid: null` (không biết → MMP/form cho free-entry, KHÔNG chặn).
- Route data-path (đọc DB) KHÔNG unit-test (env test không có DB) — chỉ test auth(401)+validation(400); data-path verify bằng smoke prod. Logic thuần đã test ở P1.
- Tiếng Việt, sentence case.

---

### Task 1: 3 route geo API (states / cities-DB / postcode) + test auth + smoke

**Files:**
- Create `app/api/mmp/ship-ho/states/route.ts`
- Create `app/api/mmp/ship-ho/postcode/route.ts`
- Modify `app/api/mmp/ship-ho/cities/route.ts`
- Modify `features/mmp/geo-routes.test.ts`

**Interfaces:** Consumes `requireMmpSignature` (`@/features/mmp/require-signature`); `listStates`, `listCities`, `lookupPostcode` (`@/features/geo/queries`).

- [ ] **Step 1: `states/route.ts`**

```ts
/**
 * GET /api/mmp/ship-ho/states?country=US
 * MMP → SMS: state/province theo nước. HMAC body-rỗng.
 * Trả: { country, states: [{ code, name }] } — [] nếu nước chưa nạp.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireMmpSignature } from '@/features/mmp/require-signature';
import { listStates } from '@/features/geo/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await requireMmpSignature(req);
  if (denied) return denied;
  const country = (new URL(req.url).searchParams.get('country') ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json({ error: 'country (ISO-3166-1 alpha-2) required' }, { status: 400 });
  }
  return NextResponse.json({ country, states: await listStates(country) });
}
```

- [ ] **Step 2: `postcode/route.ts`**

```ts
/**
 * GET /api/mmp/ship-ho/postcode?country=US&code=90210
 * MMP → SMS: tra + validate postcode. HMAC body-rỗng.
 * Trả: { country, code, valid, city, state, candidates } — valid=null nghĩa nước chưa nạp (cho free-entry).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireMmpSignature } from '@/features/mmp/require-signature';
import { lookupPostcode } from '@/features/geo/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await requireMmpSignature(req);
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const country = (sp.get('country') ?? '').toUpperCase();
  const code = (sp.get('code') ?? '').trim();
  if (!/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json({ error: 'country (ISO-3166-1 alpha-2) required' }, { status: 400 });
  }
  if (!code) return NextResponse.json({ error: 'code (postcode) required' }, { status: 400 });
  const r = await lookupPostcode(country, code);
  return NextResponse.json({
    country, code, valid: r.valid, city: r.city, state: r.stateCode, candidates: r.candidates,
  });
}
```

- [ ] **Step 3: nâng `cities/route.ts`**

Đổi import `CITIES_BY_ISO` → `listCities`; thêm optional `state`; giữ shape:
```ts
import { listCities } from '@/features/geo/queries';
// ... trong GET, sau validate country:
  const state = (new URL(req.url).searchParams.get('state') ?? '').toUpperCase() || undefined;
  return NextResponse.json({ country, cities: await listCities(country, state) });
```
(Bỏ import `CITIES_BY_ISO` khỏi route — giờ nằm trong `listCities`.)

- [ ] **Step 4: Cập nhật `features/mmp/geo-routes.test.ts`**

Route đọc-DB không unit-test data-path. Giữ test `countries` (static, happy-path OK). Với `cities`/`states`/`postcode`: chỉ test **401 (thiếu chữ ký)** + **400 (thiếu/sai country)** — KHÔNG gọi happy-path (sẽ chạm DB). Xoá các assertion cities happy-path cũ (New York…). Thêm:

```ts
import { GET as statesGET } from '@/app/api/mmp/ship-ho/states/route';
import { GET as postcodeGET } from '@/app/api/mmp/ship-ho/postcode/route';

// unsignedReq helper mới (không header):
function unsignedReq(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

describe('geo routes — auth + validation (không chạm DB)', () => {
  it('states thiếu chữ ký → 401', async () => {
    expect((await statesGET(unsignedReq('https://x/api/mmp/ship-ho/states?country=US'))).status).toBe(401);
  });
  it('postcode thiếu chữ ký → 401', async () => {
    expect((await postcodeGET(unsignedReq('https://x/api/mmp/ship-ho/postcode?country=US&code=90210'))).status).toBe(401);
  });
  it('states ký đúng nhưng thiếu country → 400', async () => {
    expect((await statesGET(signedReq('https://x/api/mmp/ship-ho/states'))).status).toBe(400);
  });
  it('postcode ký đúng nhưng thiếu code → 400', async () => {
    expect((await postcodeGET(signedReq('https://x/api/mmp/ship-ho/postcode?country=US'))).status).toBe(400);
  });
});
```
Sửa block `cities` cũ: bỏ 3 test happy-path (country=US/lowercase/ZW cities), GIỮ `thiếu country → 400` + `chữ ký sai → 401`.

- [ ] **Step 5: test + tsc + eslint**

Run: `npx vitest run features/mmp/geo-routes.test.ts` → PASS.
Run: `npx tsc --noEmit` → 0.
Run: `npx eslint app/api/mmp/ship-ho/states/route.ts app/api/mmp/ship-ho/postcode/route.ts app/api/mmp/ship-ho/cities/route.ts features/mmp/geo-routes.test.ts` → 0.

- [ ] **Step 6: Smoke prod (đọc-thuần, data thật đã nạp)**

Run:
```
railway run npx tsx -e "import('./features/geo/queries').then(async m => { console.log('states US', (await m.listStates('US')).length); console.log('cities US/CA', (await m.listCities('US','CA')).length); console.log('90210', JSON.stringify(await m.lookupPostcode('US','90210'))); console.log('VN(chưa nạp)', JSON.stringify(await m.lookupPostcode('VN','700000'))); process.exit(0); })" 2>&1 | tail -6
```
Expected: states US 52; cities US/CA >0; 90210 → `valid:true, city:"Beverly Hills"`; VN → `valid:null`.

- [ ] **Step 7: Commit**

```bash
git add app/api/mmp/ship-ho/states/route.ts app/api/mmp/ship-ho/postcode/route.ts app/api/mmp/ship-ho/cities/route.ts features/mmp/geo-routes.test.ts
git commit -m "feat(geo): API MMP states + postcode lookup + cities đọc DB (fallback nước chưa nạp)"
```

---

### Task 2: Form ship-hộ — autofill city từ postcode

**Files:**
- Create `features/geo/geo-actions.ts`
- Modify `app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx`

**Interfaces:** Consumes `lookupPostcode` (P1). Produces server action `lookupPostcodeAction(country, code)`.

- [ ] **Step 1: Server action**

```ts
// features/geo/geo-actions.ts
'use server';
import { requireManageShipHo } from '@/features/ship-ho/require-manage'; // kiểm tên guard thực tế trong features/ship-ho
import { lookupPostcode } from './queries';

export async function lookupPostcodeAction(country: string, code: string) {
  await requireManageShipHo(); // chỉ staff ship-hộ; nếu guard tên khác → dùng đúng guard sẵn có của ship-ho actions
  if (!/^[A-Z]{2}$/.test(country) || !code.trim()) return { valid: false as boolean | null, city: null, stateCode: null, candidates: [] };
  return lookupPostcode(country, code.trim());
}
```
(Mở `features/ship-ho/orders-actions.ts` xem guard RBAC nó dùng — DÙNG ĐÚNG guard đó, đừng bịa `requireManageShipHo` nếu tên khác.)

- [ ] **Step 2: Wire vào `NewOrderForm.tsx`**

Thêm state + handler: khi `postcode` đổi (debounce ~500ms) và có `country`, gọi `lookupPostcodeAction`; nếu `valid===true` và `city` trả về → autofill `f.city` (nếu user chưa nhập city hoặc city rỗng) + set hint `✓ {city}{state?}`; `valid===false` → hint `⚠ Không tìm thấy postcode`; `valid===null` → không hint (nước chưa nạp).

```tsx
  const [geoHint, setGeoHint] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const geoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onPostcode(v: string) {
    patch({ postcode: v });
    if (geoTimer.current) clearTimeout(geoTimer.current);
    if (!f.country || !v.trim()) { setGeoHint(null); return; }
    geoTimer.current = setTimeout(async () => {
      const r = await lookupPostcodeAction(f.country, v);
      if (r.valid === true) {
        setGeoHint({ tone: 'ok', text: `✓ ${r.city}${r.stateCode ? ' · ' + r.stateCode : ''}` });
        if (r.city) patch({ city: r.city });
      } else if (r.valid === false) {
        setGeoHint({ tone: 'warn', text: '⚠ Không tìm thấy postcode' });
      } else setGeoHint(null);
    }, 500);
  }
```
(import `useRef`; import `lookupPostcodeAction` từ `@/features/geo/geo-actions`.)

Đổi input postcode hiện tại (`onChange={set('postcode')}`) → `onChange={(e) => onPostcode(e.target.value)}`; render `geoHint` dưới input:
```tsx
          <label className="text-sm">Postcode<input className={inputCls} value={f.postcode} onChange={(e) => onPostcode(e.target.value)} />
            {geoHint && <span className={`block text-xs mt-0.5 ${geoHint.tone === 'ok' ? 'text-emerald-600' : 'text-amber-600'}`}>{geoHint.text}</span>}
          </label>
```

> Không chặn submit khi postcode invalid (data chưa phủ 100%) — chỉ gợi ý. Không đổi logic quote/submit khác.

- [ ] **Step 3: tsc + eslint + commit**

Run: `npx tsc --noEmit` → 0.
Run: `npx eslint features/geo/geo-actions.ts "app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx"` → 0.
```bash
git add features/geo/geo-actions.ts "app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx"
git commit -m "feat(geo): form ship-hộ autofill city từ postcode (lookup, không chặn)"
```

---

## Self-Review (đã chạy)

- **Spec coverage §5:** states API (T1) ✓ · cities đọc DB giữ shape (T1) ✓ · postcode lookup API (T1) ✓ · form autofill/validate không chặn (T2) ✓ · không đổi query P1 ✓.
- **Placeholder scan:** sạch; guard RBAC action + tên query có note "kiểm thực tế".
- **Type consistency:** route dùng `listStates/listCities/lookupPostcode` đúng chữ ký P1; `lookupPostcode` trả `valid: boolean|null` → route/form map 3 nhánh; `/cities` giữ `string[]`.
- **Rủi ro:** test route đổi (bỏ data-path happy-path cities cũ → auth/validation) — smoke prod bù data-path; guard RBAC của server action phải khớp guard ship-ho thật (T2 note); debounce dùng useRef tránh stale.
