# Verify địa chỉ US 4 mức + US Census — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phân địa chỉ US thành 4 mức tin cậy (`addr_confidence`) + dùng US Census Geocoder (miễn phí) làm nguồn verify thứ 2, để giảm báo động giả cho nhà mới xây.

**Architecture:** `parseAddressVerification` (FedEx, thuần) trả thêm `confidence` (verified/zip_only/undeliverable). `verifyAndStoreOrderAddress` orchestrate: US + FedEx chưa xác nhận → gọi Census (best-effort, 4s) → khớp thì nâng `census_verified`. Lưu cột mới `addr_confidence`, GIỮ NGUYÊN `addr_deliverable` cho reconcile. Card + cột "Địa chỉ" worklist đọc `addr_confidence` (fallback boolean cho row cũ).

**Tech Stack:** Next.js App Router (RSC), Drizzle, Vitest, FedEx Address API, US Census Geocoder (free, no key), Tailwind.

## Global Constraints

- GIỮ NGUYÊN semantics + giá trị `addrDeliverable` (= FedEx positive DPV/Resolved/Matched). Census KHÔNG đổi `addrDeliverable`, chỉ đổi `addrConfidence`.
- 4 mức `addrConfidence`: `verified` | `census_verified` | `zip_only` | `undeliverable`.
- Census **chỉ** gọi khi `shipCountry === 'US'` AND FedEx confidence ∈ {zip_only, undeliverable}.
- Census **best-effort**: lỗi/timeout/không khớp → giữ tier FedEx; KHÔNG ném, KHÔNG vỡ verify/trang. Timeout **4s** (AbortController).
- Census endpoint: `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address={enc}&benchmark=Public_AR_Current&format=json`; match = `result.addressMatches[0].matchedAddress`.
- Migration **hand-authored**, KHÔNG chạy local. Journal latest idx 76 → next **0077**.
- Row cũ (`addrConfidence` null) → UI/list fallback hành vi boolean cũ.
- Verify từng task TS: `npx tsc --noEmit` sạch; task UI thêm `npx vitest run` + `npm run build` xanh.
- Branch: `feat/address-verify-tiers` (đã tạo, spec commit `1151fab`).

---

### Task 1: US Census client

**Files:**
- Create: `lib/census/client.ts`
- Test: `lib/census/client.test.ts`

**Interfaces:**
- Produces: `buildCensusUrl(oneLine: string): string`; `parseCensusMatch(raw: unknown): { matched: boolean; matchedAddress: string | null }`; `geocodeOneLine(oneLine: string): Promise<{ matched: boolean; matchedAddress: string | null }>`.

- [ ] **Step 1: Write the failing test**

Create `lib/census/client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCensusUrl, parseCensusMatch } from './client';

describe('buildCensusUrl', () => {
  it('encode địa chỉ + benchmark + format', () => {
    const u = buildCensusUrl('28014 Harper Meadow Lane, Fulshear, TX 77441');
    expect(u).toContain('geocoding.geo.census.gov/geocoder/locations/onelineaddress');
    expect(u).toContain('benchmark=Public_AR_Current');
    expect(u).toContain('format=json');
    expect(u).toContain('address=28014%20Harper%20Meadow%20Lane%2C%20Fulshear%2C%20TX%2077441');
  });
});

describe('parseCensusMatch', () => {
  it('có match → matched true + matchedAddress', () => {
    const r = parseCensusMatch({ result: { addressMatches: [{ matchedAddress: '28014 HARPER MEADOW LN, FULSHEAR, TX, 77441' }] } });
    expect(r.matched).toBe(true);
    expect(r.matchedAddress).toBe('28014 HARPER MEADOW LN, FULSHEAR, TX, 77441');
  });
  it('không match → matched false', () => {
    expect(parseCensusMatch({ result: { addressMatches: [] } })).toEqual({ matched: false, matchedAddress: null });
  });
  it('raw lỗi/thiếu → matched false', () => {
    expect(parseCensusMatch(null)).toEqual({ matched: false, matchedAddress: null });
    expect(parseCensusMatch({})).toEqual({ matched: false, matchedAddress: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/census/client.test.ts`
Expected: FAIL — "Cannot find module './client'".

- [ ] **Step 3: Write minimal implementation**

Create `lib/census/client.ts`:

```ts
/**
 * US Census Geocoder (miễn phí, không API key) — nguồn verify địa chỉ US thứ 2.
 * Best-effort: mọi lỗi/timeout → {matched:false}. Chỉ dùng cho địa chỉ US.
 * Docs: geocoding.geo.census.gov/geocoder (onelineaddress, benchmark Public_AR_Current).
 */
const BASE = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

/** URL geocode 1 dòng. THUẦN. */
export function buildCensusUrl(oneLine: string): string {
  const u = new URL(BASE);
  u.searchParams.set('address', oneLine);
  u.searchParams.set('benchmark', 'Public_AR_Current');
  u.searchParams.set('format', 'json');
  return u.toString();
}

interface CensusResponse {
  result?: { addressMatches?: Array<{ matchedAddress?: string }> };
}

/** Bóc match đầu tiên từ response Census. THUẦN; rỗng/lỗi → matched:false. */
export function parseCensusMatch(raw: unknown): { matched: boolean; matchedAddress: string | null } {
  const m = (raw as CensusResponse)?.result?.addressMatches?.[0];
  if (m?.matchedAddress) return { matched: true, matchedAddress: m.matchedAddress };
  return { matched: false, matchedAddress: null };
}

/** Geocode best-effort, timeout 4s. Lỗi/timeout/không khớp → {matched:false}. */
export async function geocodeOneLine(oneLine: string): Promise<{ matched: boolean; matchedAddress: string | null }> {
  if (!oneLine.trim()) return { matched: false, matchedAddress: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(buildCensusUrl(oneLine), { signal: ctrl.signal });
    const raw = await res.json();
    return parseCensusMatch(raw);
  } catch {
    return { matched: false, matchedAddress: null };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/census/client.test.ts`
Expected: PASS (5 test).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output.

```bash
git add lib/census/client.ts lib/census/client.test.ts
git commit -m "feat(ops): US Census geocoder client (free, best-effort)"
```

---

### Task 2: FedEx `parseAddressVerification` — field `confidence`

**Files:**
- Modify: `lib/fedex/address.ts`
- Test: `lib/fedex/address.test.ts` (thêm case)

**Interfaces:**
- Consumes: nothing new.
- Produces: `AddressVerification` thêm `confidence: 'verified' | 'zip_only' | 'undeliverable'`.

- [ ] **Step 1: Write the failing test**

Thêm vào `lib/fedex/address.test.ts`, trong `describe('parseAddressVerification', ...)` (sau case cuối, trước dấu `});` đóng describe):

```ts
  it('confidence: US positive → verified', () => {
    const v = parseAddressVerification(wrap({ attributes: { DPV: 'true' }, postalCode: '11228' }), 'US');
    expect(v.confidence).toBe('verified');
  });
  it('confidence: US notfound nhưng có ZIP → zip_only', () => {
    const v = parseAddressVerification(wrap({
      attributes: { DPV: 'false', Matched: 'false' },
      city: 'FULSHEAR', stateOrProvinceCode: 'TX', postalCode: '77441',
      customerMessages: [{ code: 'STANDARDIZED.ADDRESS.NOTFOUND' }],
    }), 'US');
    expect(v.confidence).toBe('zip_only');
  });
  it('confidence: US không có ZIP → undeliverable', () => {
    const v = parseAddressVerification(wrap({
      attributes: { DPV: 'false', Matched: 'false' },
      customerMessages: [{ code: 'STANDARDIZED.ADDRESS.NOTFOUND' }],
    }), 'US');
    expect(v.confidence).toBe('undeliverable');
  });
  it('confidence: ngoài US → verified', () => {
    const v = parseAddressVerification(wrap({ attributes: { DPV: 'false' } }), 'SA');
    expect(v.confidence).toBe('verified');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/fedex/address.test.ts`
Expected: FAIL — `confidence` undefined / property không tồn tại.

- [ ] **Step 3: Implement**

Trong `lib/fedex/address.ts`:
- Thêm field vào `interface AddressVerification` (sau `deliverable: boolean;`):
```ts
  /** Mức tin cậy FedEx: verified (DPV/non-US) | zip_only (khớp ZIP, chưa rõ số nhà) | undeliverable (không khớp). */
  confidence: 'verified' | 'zip_only' | 'undeliverable';
```
- Trong `parseAddressVerification`, TRƯỚC `return {...}` cuối, tính `confidence`:
```ts
  // confidence: verified nếu FedEx positive hoặc ngoài US; còn lại (US không positive)
  // phân theo có ZIP chuẩn hoá hay không — zip_only (nhà mới xây hay gặp) vs undeliverable.
  const hasZip = !!(a?.postalCode && String(a.postalCode).trim());
  const confidence: AddressVerification['confidence'] =
    positive || !isUs ? 'verified' : hasZip ? 'zip_only' : 'undeliverable';
```
- Thêm `confidence` vào object return cuối:
```ts
  return { classification: parseClassification(raw), deliverable, issue, standardized: std || null, confidence, raw };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/fedex/address.test.ts`
Expected: PASS (mọi case cũ + 4 case mới).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output.

```bash
git add lib/fedex/address.ts lib/fedex/address.test.ts
git commit -m "feat(ops): parseAddressVerification trả confidence 3 mức FedEx"
```

---

### Task 3: Cột `addr_confidence` + migration 0077

**Files:**
- Modify: `db/schema.ts` (thêm cột vào `shopifyOrders`, cạnh các cột `addr*`)
- Create: `db/migrations/0077_addr-confidence.sql`
- Modify: `db/migrations/meta/_journal.json`

**Interfaces:**
- Produces: `schema.shopifyOrders.addrConfidence` (text, nullable).

- [ ] **Step 1: Thêm cột vào schema.ts**

Trong `db/schema.ts`, ngay SAU dòng `addrVerifiedAt: timestamp('addr_verified_at'),` (trong bảng `shopifyOrders`), thêm:

```ts
  addrConfidence: text('addr_confidence'), // verified|census_verified|zip_only|undeliverable (4 mức UI)
```

- [ ] **Step 2: Viết migration SQL (hand-authored)**

Create `db/migrations/0077_addr-confidence.sql`:

```sql
ALTER TABLE "shopify_orders" ADD COLUMN "addr_confidence" text;
```

- [ ] **Step 3: Thêm entry journal**

Trong `db/migrations/meta/_journal.json`, thêm vào cuối mảng `entries` (thêm `,` sau entry idx 76):

```json
{
"idx": 77,
"version": "7",
"when": 1783082400000,
"tag": "0077_addr-confidence",
"breakpoints": true
}
```

- [ ] **Step 4: Verify tsc**

Run: `npx tsc --noEmit` → no output. KHÔNG chạy db:migrate.

Run: `python3 -c "import json;json.load(open('db/migrations/meta/_journal.json'));print('journal OK')"` → "journal OK".

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations/0077_addr-confidence.sql db/migrations/meta/_journal.json
git commit -m "feat(ops): cột addr_confidence + migration 0077"
```

---

### Task 4: Orchestrate FedEx → Census trong verify

**Files:**
- Modify: `features/shopify-orders/address-verify.ts`
- Test: `features/shopify-orders/address-verify.test.ts` (mới — chỉ test `buildOneLine` thuần)

**Interfaces:**
- Consumes: `geocodeOneLine` (Task 1), `v.confidence` (Task 2), `schema.shopifyOrders.addrConfidence` (Task 3).
- Produces: `buildOneLine(o): string` (export, thuần); `verifyAndStoreOrderAddress` lưu `addrConfidence` (giá trị 4 mức) và trả thêm `confidence` trong kết quả.

- [ ] **Step 1: Write the failing test (buildOneLine thuần)**

Create `features/shopify-orders/address-verify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildOneLine } from './address-verify';

describe('buildOneLine', () => {
  it('ghép street + city + state(strip prefix) + zip', () => {
    expect(buildOneLine({
      shipAddress1: '28014 Harper Meadow Lane', shipAddress2: null,
      shipCity: 'Fulshear', shipProvinceCode: 'US-TX', shipPostcode: '77441', shipCountry: 'US',
    })).toBe('28014 Harper Meadow Lane, Fulshear, TX 77441');
  });
  it('gộp address2, bỏ phần rỗng', () => {
    expect(buildOneLine({
      shipAddress1: '1 Main St', shipAddress2: 'Apt 5',
      shipCity: 'Brooklyn', shipProvinceCode: 'NY', shipPostcode: '11228', shipCountry: 'US',
    })).toBe('1 Main St Apt 5, Brooklyn, NY 11228');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/shopify-orders/address-verify.test.ts`
Expected: FAIL — `buildOneLine` không export.

- [ ] **Step 3: Implement buildOneLine + wire Census**

Trong `features/shopify-orders/address-verify.ts`:
- Thêm import (cạnh import `verifyAddress`):
```ts
import { geocodeOneLine } from '@/lib/census/client';
```
- Thêm helper `buildOneLine` (export, đặt cạnh `buildAddressInput`):
```ts
/** 1 dòng địa chỉ cho US Census ("street, city, ST zip"). THUẦN. Strip tiền tố
 *  nước khỏi mã bang ("US-TX" → "TX"). */
export function buildOneLine(o: OrderAddressFields): string {
  const street = [o.shipAddress1, o.shipAddress2 ?? ''].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
  const state = (o.shipProvinceCode ?? '').split('-').pop() ?? '';
  return `${street}, ${o.shipCity ?? ''}, ${state} ${o.shipPostcode ?? ''}`.replace(/\s+/g, ' ').trim();
}
```
- Thay block `try { const v = await verifyAddress(input); ... }` bằng:
```ts
  try {
    const v = await verifyAddress(input);
    // confidence cuối: nâng zip_only/undeliverable (US) lên census_verified nếu Census khớp.
    let confidence: string = v.confidence;
    let standardized = v.standardized;
    if (o.shipCountry === 'US' && (v.confidence === 'zip_only' || v.confidence === 'undeliverable')) {
      const census = await geocodeOneLine(buildOneLine(o));
      if (census.matched) {
        confidence = 'census_verified';
        if (census.matchedAddress) standardized = census.matchedAddress;
      }
    }
    await db.update(schema.shopifyOrders).set({
      addrClass: v.classification, addrDeliverable: v.deliverable,
      addrIssue: v.issue, addrStandardized: standardized, addrConfidence: confidence,
      addrVerifiedAt: new Date(),
    }).where(eq(schema.shopifyOrders.id, orderId));
    return { ok: true, deliverable: v.deliverable, issue: v.issue, confidence };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'verify failed' };
  }
```
- Mở rộng kiểu trả về của `verifyAndStoreOrderAddress` (signature) thêm `confidence?: string`:
```ts
): Promise<{ ok: boolean; deliverable?: boolean; issue?: string | null; confidence?: string; error?: string }> {
```

> Lưu ý: `OrderAddressFields` là kiểu của `o` (đối tượng select trong hàm). Nếu chưa có tên kiểu tường minh, dùng đúng kiểu inline mà `buildAddressInput` nhận (cùng các field `shipAddress1/2, shipCity, shipProvinceCode, shipPostcode, shipCountry`). Kiểm tra tên kiểu hiện có trong file và tái dùng; nếu là inline thì khai báo `interface OrderAddressFields { shipAddress1: string | null; shipAddress2: string | null; shipCity: string | null; shipProvinceCode: string | null; shipPostcode: string | null; shipCountry: string | null }` và dùng cho cả `buildAddressInput`/`buildOneLine` (DRY).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/shopify-orders/address-verify.test.ts`
Expected: PASS (2 test).

- [ ] **Step 5: Verify tsc + suite**

Run: `npx tsc --noEmit` → no output.
Run: `npx vitest run` → toàn bộ xanh.

- [ ] **Step 6: Commit**

```bash
git add features/shopify-orders/address-verify.ts features/shopify-orders/address-verify.test.ts
git commit -m "feat(ops): verify orchestrate FedEx→Census, lưu addr_confidence 4 mức"
```

---

### Task 5: AddressVerifyCard 4 mức + detail select

**Files:**
- Modify: `components/fulfillment/AddressVerifyCard.tsx`
- Modify: `features/fulfillment/queries.ts` (select `addrConfidence` trong `getFulfillmentDetail`)

**Interfaces:**
- Consumes: `schema.shopifyOrders.addrConfidence`.
- Produces: `FulfillmentAddress` thêm `addrConfidence: string | null`; card render nhãn 4 mức.

- [ ] **Step 1: Select addrConfidence trong getFulfillmentDetail**

Trong `features/fulfillment/queries.ts`, trong `const [ord] = await db.select({...})` (block địa chỉ), thêm sau `addrVerifiedAt: schema.shopifyOrders.addrVerifiedAt,`:

```ts
    addrConfidence: schema.shopifyOrders.addrConfidence,
```

- [ ] **Step 2: Mở rộng FulfillmentAddress + nhãn 4 mức**

Trong `components/fulfillment/AddressVerifyCard.tsx`:
- Thêm field vào `interface FulfillmentAddress` (sau `addrStandardized: string | null;`):
```ts
  addrConfidence: string | null;
```
- Thêm map nhãn (sau `CLASS_MAP`):
```ts
const CONFIDENCE_MAP: Record<string, { label: string; cls: string; border: boolean }> = {
  verified:        { label: '✓ Giao được', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', border: false },
  census_verified: { label: '✓ Xác nhận qua Census', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', border: false },
  zip_only:        { label: '⚠ Chưa xác minh số nhà (ZIP hợp lệ)', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', border: false },
  undeliverable:   { label: '⚠ Không giao được', cls: 'bg-red-500/15 text-red-700 dark:text-red-400', border: true },
};
```
- Thay block hiển thị trạng thái deliverable. Tìm đoạn:
```tsx
    <Card className={a.addrDeliverable === false ? 'border-red-500/40' : undefined}>
```
đổi thành (border đỏ chỉ khi undeliverable; fallback boolean cho row cũ):
```tsx
    <Card className={(a.addrConfidence ? a.addrConfidence === 'undeliverable' : a.addrDeliverable === false) ? 'border-red-500/40' : undefined}>
```
- Trong khối `{a.addrVerifiedAt ? (...)}`, thay riêng `<span>` deliverable (đoạn `{a.addrDeliverable ? '✓ Giao được' : '⚠ Không giao được — kiểm tra trước khi ship'}`) bằng nhánh dùng `addrConfidence` khi có, fallback boolean khi null:
```tsx
            {(() => {
              const conf = a.addrConfidence ? CONFIDENCE_MAP[a.addrConfidence] : null;
              if (conf) return <span className={`rounded px-2 py-0.5 font-medium ${conf.cls}`}>{conf.label}</span>;
              return (
                <span className={`rounded px-2 py-0.5 font-medium ${a.addrDeliverable ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}`}>
                  {a.addrDeliverable ? '✓ Giao được' : '⚠ Không giao được — kiểm tra trước khi ship'}
                </span>
              );
            })()}
```
> Giữ nguyên các `<span>` khác (class địa chỉ, addrIssue, standardized). Chỉ thay span deliverable + className Card.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc no output; vitest toàn bộ pass; build xanh.

- [ ] **Step 4: Commit**

```bash
git add components/fulfillment/AddressVerifyCard.tsx features/fulfillment/queries.ts
git commit -m "feat(ops): AddressVerifyCard nhãn 4 mức addr_confidence"
```

---

### Task 6: `summarizeAddr` 4 mức + cột list

**Files:**
- Modify: `features/fulfillment/worklist-status.ts`
- Test: `features/fulfillment/worklist-status.test.ts`
- Modify: `features/fulfillment/worklist-status-queries.ts`

**Interfaces:**
- Consumes: `schema.shopifyOrders.addrConfidence`.
- Produces: `summarizeAddr` đọc thêm `addrConfidence`; `WorklistStatusRow` thêm `addrConfidence: string | null`.

- [ ] **Step 1: Cập nhật test summarizeAddr**

Trong `features/fulfillment/worklist-status.test.ts`, trong `describe('summarizeAddr', ...)`, thêm:

```ts
  it('census_verified → ok', () => expect(summarizeAddr({ addrDeliverable: false, addrVerifiedAt: new Date(), addrConfidence: 'census_verified' }).tone).toBe('ok'));
  it('zip_only → warn', () => expect(summarizeAddr({ addrDeliverable: false, addrVerifiedAt: new Date(), addrConfidence: 'zip_only' }).tone).toBe('warn'));
  it('undeliverable → bad', () => expect(summarizeAddr({ addrDeliverable: false, addrVerifiedAt: new Date(), addrConfidence: 'undeliverable' }).tone).toBe('bad'));
  it('confidence null → fallback boolean (ok)', () => expect(summarizeAddr({ addrDeliverable: true, addrVerifiedAt: new Date(), addrConfidence: null }).tone).toBe('ok'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/fulfillment/worklist-status.test.ts`
Expected: FAIL — `addrConfidence` không có trong signature / nhánh chưa xử lý.

- [ ] **Step 3: Mở rộng summarizeAddr**

Trong `features/fulfillment/worklist-status.ts`, thay `summarizeAddr` bằng:

```ts
export function summarizeAddr(o: { addrDeliverable: boolean | null; addrVerifiedAt: Date | string | null; addrConfidence?: string | null }): Badge {
  if (o.addrConfidence) {
    switch (o.addrConfidence) {
      case 'verified':
      case 'census_verified': return { label: '✓ Giao được', tone: 'ok' };
      case 'zip_only': return { label: '⚠ ZIP hợp lệ, chưa rõ số nhà', tone: 'warn' };
      case 'undeliverable': return { label: '⚠ Không giao được', tone: 'bad' };
    }
  }
  if (!o.addrVerifiedAt) return { label: 'Chưa verify', tone: 'muted' };
  if (o.addrDeliverable === false) return { label: '⚠ Không giao được', tone: 'bad' };
  return { label: '✓ Giao được', tone: 'ok' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/fulfillment/worklist-status.test.ts`
Expected: PASS (3 case cũ + 4 case mới).

- [ ] **Step 5: Thêm addrConfidence vào query + row**

Trong `features/fulfillment/worklist-status-queries.ts`:
- `interface WorklistStatusRow`: thêm sau `addrVerifiedAt: Date | null;`:
```ts
  addrConfidence: string | null;
```
- Trong `db.select({...})` của `base`, sau `addrVerifiedAt: schema.shopifyOrders.addrVerifiedAt,`:
```ts
    addrConfidence: schema.shopifyOrders.addrConfidence,
```
- Trong `return base.map((r) => { ... })`, đảm bảo `addrConfidence` được trả ra. Nếu block return liệt kê field tường minh, thêm `addrConfidence: r.addrConfidence,`. Nếu dùng `...r` thì đã tự có.

> `app/(dashboard)/f/fulfillment/page.tsx` gọi `summarizeAddr(r)` — `r` nay có `addrConfidence` nên tự dùng nhánh mới, không cần sửa page. `WorklistTable` chỉ render `Badge`, tone `warn` đã có màu — không cần sửa.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc no output; vitest toàn bộ pass; build xanh.

- [ ] **Step 7: Commit**

```bash
git add features/fulfillment/worklist-status.ts features/fulfillment/worklist-status.test.ts features/fulfillment/worklist-status-queries.ts
git commit -m "feat(ops): summarizeAddr 4 mức + cột list đọc addr_confidence"
```

---

## Self-Review

**Spec coverage:**
- §3 4 trạng thái → Task 2 (FedEx 3 mức) + Task 4 (census_verified) + Task 5/6 (UI). §4 luồng → Task 4. §5.1 Census client → Task 1. §5.2 parseAddressVerification → Task 2. §5.3 orchestrate → Task 4. §5.4 schema+migration → Task 3. §5.5 card → Task 5. §5.6 summarizeAddr+query → Task 6. §6 guard (best-effort, US-only, null fallback) → Task 1 (best-effort), Task 4 (US-only gọi), Task 5/6 (fallback null). §7 test thuần → Task 1/2/4/6. Đủ.

**Type consistency:**
- `confidence` union (Task 2) ⊂ giá trị `addrConfidence` string (Task 3/4); Task 4 thêm `'census_verified'` → cột text chứa được. ✔
- `CONFIDENCE_MAP` keys (Task 5) = 4 mức = `summarizeAddr` switch (Task 6) = giá trị Task 4 ghi. ✔
- `buildOneLine`/`OrderAddressFields` (Task 4) field names khớp select trong verify + `buildAddressInput`. ✔
- `geocodeOneLine` trả `{matched, matchedAddress}` (Task 1) = Task 4 dùng `census.matched`/`census.matchedAddress`. ✔
- `WorklistStatusRow.addrConfidence` (Task 6) khớp `summarizeAddr` optional param. ✔

**Placeholder scan:** không TBD/TODO; mọi step có code/command cụ thể. ✔
