# Sinh giá ship FedEx vào ma trận market — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sinh giá offer FedEx ((cost+$5)×markup) theo từng (FedEx zone × bậc 0.5kg) và ghi vào ma trận shipping của market để apply lên Shopify.

**Architecture:** Hàm giá thuần (TDD) + script dựng zone theo (FedEx,DHL) cho mỗi market, quote engine per nước per bậc, ghi `market_store_overrides.shipping` (giữ rates DHL cũ). Operator apply qua trang markets sẵn có.

**Tech Stack:** Drizzle, Vitest, carrier-rates engine (quote/loadAccountSnapshot).

**Spec:** `docs/superpowers/specs/2026-06-12-fedex-offer-rate-matrix-design.md`

**Hằng số:** FedEx accountId `5683f3c0-9249-40c1-a3e7-d967f0d62c29`; store đích `cici-mean` (id `04b6d06f-2747-4a86-9084-2cef7c2f88fa`); 59 key chuẩn `"FedEx IP (a–b kg)"` (en-dash, số như "0", "0.5", "20.5", "25"); markup 15%; PACKING_FEE=$5; ROUND_UP=$0.5. Verify mẫu: Zone H 0.5kg → (39.35+5)×1.15 = 51.0025 → làm tròn lên $0.5 = **$51.50**.

---

### Task 1: Hàm giá thuần `fedexOfferPrice` (TDD)

**Files:**
- Create: `features/markets/domain/fedex-offer-pricing.ts`
- Test: `features/markets/domain/fedex-offer-pricing.test.ts`

- [ ] **Step 1.1: Test FAIL trước**

```ts
import { describe, it, expect } from 'vitest';
import { fedexOfferPrice, PACKING_FEE_USD, ROUND_UP_USD } from './fedex-offer-pricing';

describe('fedexOfferPrice', () => {
  it('1 nước: (cost+5)×factor làm tròn lên $0.5', () => {
    // cost 39.35, final 45.2525 → factor 1.15 → (39.35+5)×1.15=51.0525 → ceil .5 = 51.5
    expect(fedexOfferPrice([{ carrierCostDisplay: 39.35, finalDisplay: 45.2525 }])).toBe(51.5);
  });
  it('max trên nhiều nước', () => {
    const r = fedexOfferPrice([
      { carrierCostDisplay: 30, finalDisplay: 34.5 },   // (30+5)×1.15=40.25 → 40.5
      { carrierCostDisplay: 39.35, finalDisplay: 45.2525 }, // → 51.5
    ]);
    expect(r).toBe(51.5);
  });
  it('bỏ nước carrierCostDisplay=0', () => {
    expect(fedexOfferPrice([{ carrierCostDisplay: 0, finalDisplay: 0 },
      { carrierCostDisplay: 10, finalDisplay: 11.5 }])).toBe(17.5); // (10+5)×1.15=17.25→17.5
  });
  it('rỗng / toàn 0 → null', () => {
    expect(fedexOfferPrice([])).toBeNull();
    expect(fedexOfferPrice([{ carrierCostDisplay: 0, finalDisplay: 0 }])).toBeNull();
  });
  it('hằng số', () => { expect(PACKING_FEE_USD).toBe(5); expect(ROUND_UP_USD).toBe(0.5); });
});
```

Run: `npx vitest run features/markets/domain/fedex-offer-pricing.test.ts` → FAIL.

- [ ] **Step 1.2: Implement**

```ts
export const PACKING_FEE_USD = 5;
export const ROUND_UP_USD = 0.5;

export interface CountryQuote { carrierCostDisplay: number; finalDisplay: number }

/** Giá offer FedEx cho 1 shipping-zone tại 1 bậc cân: với mỗi nước tính
 *  (cost + $5) × markupFactor (factor = finalDisplay/carrierCostDisplay), lấy MAX
 *  trên các nước (cover toàn zone), làm tròn LÊN bội số $0.5. null khi không có
 *  nước nào định giá được. */
export function fedexOfferPrice(quotes: CountryQuote[]): number | null {
  let best: number | null = null;
  for (const q of quotes) {
    if (!(q.carrierCostDisplay > 0)) continue;
    const factor = q.finalDisplay / q.carrierCostDisplay;
    const price = (q.carrierCostDisplay + PACKING_FEE_USD) * factor;
    if (best === null || price > best) best = price;
  }
  if (best === null) return null;
  return Math.ceil(best / ROUND_UP_USD) * ROUND_UP_USD;
}
```

- [ ] **Step 1.3:** vitest file PASS; tsc sạch. Commit `feat(markets): hàm giá thuần fedexOfferPrice (+$5 × markup, làm tròn $0.5)` + trailer.

---

### Task 2: Script sinh + ghi ma trận (dry-run)

**Files:**
- Create: `scripts/gen-fedex-offer-matrix.ts`

- [ ] **Step 2.1: Đọc** `features/carrier-rates/engine/load.ts` (loadAccountSnapshot), `engine/quote.ts` (quote signature: `quote(snap, { destinationCountry, weightKg, effectiveDate })` → breakdown.carrierCostDisplay/finalDisplay), `features/markets/types.ts` (MarketShipping/ShippingZone/ShippingRate), một script ghi DB mẫu (vd scripts/import-warehouse-items.ts) cho dotenv/transaction.

- [ ] **Step 2.2: Script** (dry-run mặc định / --apply). Cấu trúc:

```ts
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote } from '@/features/carrier-rates/engine/quote';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { fedexOfferPrice } from '@/features/markets/domain/fedex-offer-pricing';

const FEDEX = '5683f3c0-9249-40c1-a3e7-d967f0d62c29';
const STORE = '04b6d06f-2747-4a86-9084-2cef7c2f88fa'; // cici-mean

// upper-bound parse từ key "FedEx IP (a–b kg)" → b (số). Dùng EN-DASH '–'.
function upperOf(key: string): number | null {
  const m = key.match(/–\s*([\d.]+)\s*kg/); return m ? Number(m[1]) : null;
}
// trích "Zone H"→"H", "Zone 9"→"9"
function zoneShort(label: string): string { return label.replace(/^Zone\s+/i, '').trim(); }

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '*** --apply: SẼ GHI market_store_overrides ***' : 'DRY-RUN — chỉ in, không ghi.');

  // 1) Bộ 59 key chuẩn: lấy từ shipping config middle-east hiện có.
  const [seed] = await db.select({ shipping: schema.marketStoreOverrides.shipping })
    .from(schema.marketStoreOverrides)
    .where(and(eq(schema.marketStoreOverrides.storeId, STORE), eq(schema.marketStoreOverrides.marketHandle, 'middle-east'))).limit(1);
  const sampleZone = Object.values((seed.shipping as { zones: Record<string, { rates: Record<string, unknown> }> }).zones)[0];
  const fedexKeys = Object.keys(sampleZone.rates).filter((k) => /^FedEx IP/.test(k)); // 59 key
  const keyUpper = new Map(fedexKeys.map((k) => [k, upperOf(k)!]));

  // 2) country → (fedexZone, dhlZone) qua carrier_zone_countries (FedEx) + DHL account.
  // (tải 2 map; DHL accountId tra theo name ILIKE '%DHL%'.)
  // ... build fedexZoneOf: Map<cc, label>, dhlZoneOf: Map<cc, label> ...

  // 3) snapshot FedEx (1 lần), date=now.
  const snap = await loadAccountSnapshot(FEDEX, new Date());

  // 4) mỗi market của STORE: dựng zones + rates.
  const markets = await db.select().from(schema.marketTemplates); // 11
  let touched = 0;
  for (const mk of markets) {
    const countries = (Array.isArray(mk.countries) ? mk.countries : []).map((c) => String(c).toUpperCase());
    // gom theo (fedexZone, dhlZone); bỏ nước không có fedexZone.
    const groups = new Map<string, { fz: string; dz: string; ccs: string[] }>();
    for (const cc of countries) {
      const fz = fedexZoneOf.get(cc); if (!fz) continue;
      const dz = dhlZoneOf.get(cc) ?? '?';
      const k = `${fz}||${dz}`;
      const g = groups.get(k) ?? { fz, dz, ccs: [] }; g.ccs.push(cc); groups.set(k, g);
    }
    if (groups.size === 0) continue;
    // shipping config hiện có của (STORE, market) — để merge giữ DHL.
    const [cur] = await db.select({ shipping: schema.marketStoreOverrides.shipping, version: schema.marketStoreOverrides.version })
      .from(schema.marketStoreOverrides)
      .where(and(eq(schema.marketStoreOverrides.storeId, STORE), eq(schema.marketStoreOverrides.marketHandle, mk.handle))).limit(1);
    const curZones = (cur?.shipping as { zones?: Record<string, { countries: string[]; rates: Record<string, unknown> }> })?.zones ?? {};
    const outZones: Record<string, { countries: string[]; rates: Record<string, unknown> }> = { ...curZones };
    for (const g of groups.values()) {
      const zoneName = `${mk.name} — DHL ${zoneShort(g.dz)} / FedEx ${zoneShort(g.fz)}`;
      // quote mỗi nước ở mỗi bậc → fedexOfferPrice.
      const fedexRates: Record<string, { type: 'flat'; price: number; currency: 'USD' }> = {};
      for (const key of fedexKeys) {
        const b = keyUpper.get(key)!;
        const cq = g.ccs.map((cc) => {
          const q = quote(snap, { destinationCountry: cc, weightKg: b, effectiveDate: new Date() });
          return q.ok ? { carrierCostDisplay: q.breakdown.carrierCostDisplay, finalDisplay: q.breakdown.finalDisplay } : { carrierCostDisplay: 0, finalDisplay: 0 };
        });
        const price = fedexOfferPrice(cq);
        if (price !== null) fedexRates[key] = { type: 'flat', price, currency: 'USD' };
      }
      // merge: GIỮ rates cũ (DHL...) của zone nếu có, ĐÈ key FedEx IP.
      const prevRates = outZones[zoneName]?.rates ?? {};
      outZones[zoneName] = { countries: g.ccs, rates: { ...prevRates, ...fedexRates } };
      touched++;
    }
    if (apply) {
      const shipping = { zones: outZones };
      await db.insert(schema.marketStoreOverrides)
        .values({ storeId: STORE, marketHandle: mk.handle, shipping, version: (cur?.version ?? 0) + 1 })
        .onConflictDoUpdate({ target: [schema.marketStoreOverrides.storeId, schema.marketStoreOverrides.marketHandle],
          set: { shipping, version: (cur?.version ?? 0) + 1, updatedAt: sql`now()` } });
    }
    console.log(`  [${mk.handle}] ${groups.size} zone × ${fedexKeys.length} bậc`);
  }
  console.log(`Tổng zone chạm: ${touched}. ${apply ? 'ĐÃ GHI.' : 'DRY-RUN — chưa ghi.'}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

(Engineer hoàn thiện: build `fedexZoneOf`/`dhlZoneOf` từ `carrier_zone_countries` 2 account; import `and, eq`; xác nhận `marketStoreOverrides` unique target `(store_id, market_handle)`; in vài giá mẫu Zone H 0.5kg.)

- [ ] **Step 2.3:** `npx tsc --noEmit` sạch. Chạy DRY-RUN `npx tsx scripts/gen-fedex-offer-matrix.ts` — in số zone/bậc mỗi market + giá mẫu. KHÔNG --apply (Task 3). Dán output.

- [ ] **Step 2.4:** eslint script sạch. Commit `feat(markets): script sinh ma trận giá offer FedEx` + trailer.

---

### Task 3: Apply ma trận + verify + push

- [ ] **Step 3.1:** Probe BASELINE: in shipping config middle-east hiện có (giá FedEx H 0.5kg cũ = $37.06) để so sau.
- [ ] **Step 3.2:** Dry-run lần cuối, kiểm giá mẫu hợp lý (Zone H 0.5kg = $51.50; tăng dần theo cân). Rồi `npx tsx scripts/gen-fedex-offer-matrix.ts --apply`.
- [ ] **Step 3.3:** Verify DB: middle-east giờ có 3 zone FedEx rates mới (H/F/H), key DHL CŨ còn nguyên; các market khác (us, europe…) có zone FedEx mới; giá FedEx H 0.5kg = $51.50. In bảng vài market × vài bậc.
- [ ] **Step 3.4:** `npx tsc --noEmit && npx vitest run` (mong +5 test) `&& npx eslint .` sạch; `npx next build` pass.
- [ ] **Step 3.5:** Final review subagent (hàm giá + script + dữ liệu đã ghi); `git push origin main`. Báo operator vào `/f/markets` review + apply lên Shopify (script KHÔNG tự push Shopify).
