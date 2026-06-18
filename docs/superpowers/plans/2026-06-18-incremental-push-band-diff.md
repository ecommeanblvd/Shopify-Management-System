# Incremental Push — Band-Aware In-Place Rate Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the store's zone structure already matches the system, push updates rate prices in place (no zone delete/create); delete+recreate happens only for a new store or zone drift.

**Architecture:** Add band-aware reading of Shopify method definitions (each `Standard shipping`/`Express shipping` method def identified by its weight upper bound), a pure diff builder `buildSystemUpdateVariables` that emits price updates for matching zones and create/delete only where structure differs, and a new `manual-update` phase in `pushShippingStep` that runs the fast path when the diff is update-only, else falls back to the existing clean-rebuild phases.

**Tech Stack:** TypeScript, Next.js server actions, Drizzle, Shopify Admin GraphQL (`deliveryProfileUpdate`), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-18-incremental-push-band-diff-design.md` (authoritative).
- Band identity key = `"<zoneName>.<mappedName>.<upper>"` where `upper` = `String(Math.round(upperKg * 1000) / 1000)`; flat rate (no `LESS_THAN_OR_EQUAL_TO` condition) uses sentinel upper `"flat"`.
- `mappedName` is the Shopify-stored name: `FedEx IP …` → `Standard shipping`, `DHL Express …` → `Express shipping` (existing `normalizeRateForShopify` / `RATE_NAME_MAP`).
- Do NOT change `rateIdByZoneAndName`, `denormalizeToMutationInput`, or `buildProfileUpdateVariables` — other push paths depend on them.
- Reuse the hardened `graphqlCall` and the `send()`/`read()` retry wrappers already in `push-step.ts`. `TRANSIENT = /internal server error|unexpected response|timeout|429|502|503|504|gateway/i`.
- Snapshot backup (insert into `settings_snapshots`, domain `'shipping_system'`) must still happen before any write, exactly as the current `manual-delete` phase does.
- Shopify weight-condition shape (verified live): `methodConditions: [{ field: 'TOTAL_WEIGHT', operator: 'GREATER_THAN_OR_EQUAL_TO' | 'LESS_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: number, unit: 'KILOGRAMS' } }]`. The lower bound carries the `+0.01` offset (e.g. `0.51`); the upper bound (`LESS_THAN_OR_EQUAL_TO`) is exact.
- Run all tests with `npx vitest run <path>`. Type-check with `npx tsc --noEmit`. Lint changed files with `npx eslint <files>`.

---

## File Structure

- `features/settings-sync/domain/shipping.ts` (modify) — extend `SHIPPING_QUERY` with `methodConditions`; extend response types; add `upperBandFromConditions`, `bandKeyOf`, types `BandRate`/`BandRateMap`; add `bandRates` to `NormalizedShipping`; populate it in `normalizeProfileNode`.
- `features/carrier-rates/push/system-update-diff.ts` (create) — pure `buildSystemUpdateVariables(current, systemTree, locationGroupId)` returning `{ id, profile, plan }`.
- `features/carrier-rates/push/system-update-diff.test.ts` (create) — unit tests for the diff builder.
- `features/settings-sync/domain/shipping.band.test.ts` (create) — unit tests for band parsing + band-aware normalize.
- `features/carrier-rates/push-step.ts` (modify) — `manual-update` cursor + phase; branch at cursor init.

---

## Task 1: Band-aware read (query + normalize)

**Files:**
- Modify: `features/settings-sync/domain/shipping.ts`
- Test: `features/settings-sync/domain/shipping.band.test.ts` (create)

**Interfaces:**
- Produces:
  - `interface BandRate { id: string; price: number; currency: string }`
  - `type BandRateMap = Record<string, BandRate>` — key `"<zoneName>.<mappedName>.<upper>"`
  - `function upperBandFromConditions(conds: WeightCondition[]): string` — returns `String(round)` upper, or `"flat"` when no `LESS_THAN_OR_EQUAL_TO` weight condition.
  - `function bandKeyOf(zoneName: string, mappedName: string, upper: string): string`
  - `NormalizedShipping.bandRates: BandRateMap` (new required field; populated by `normalizeProfileNode`, `{}` in the empty fallback).

- [ ] **Step 1: Write the failing test**

Create `features/settings-sync/domain/shipping.band.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { upperBandFromConditions, bandKeyOf, normalizeShopifyDeliveryProfile } from './shipping';

describe('upperBandFromConditions', () => {
  it('returns the LESS_THAN_OR_EQUAL_TO value as the upper band', () => {
    const conds = [
      { field: 'TOTAL_WEIGHT', operator: 'GREATER_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 0.51, unit: 'KILOGRAMS' } },
      { field: 'TOTAL_WEIGHT', operator: 'LESS_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 1, unit: 'KILOGRAMS' } },
    ];
    expect(upperBandFromConditions(conds as never)).toBe('1');
  });

  it('returns "flat" when there is no upper weight condition', () => {
    expect(upperBandFromConditions([] as never)).toBe('flat');
  });

  it('rounds to 3 decimals', () => {
    const conds = [{ field: 'TOTAL_WEIGHT', operator: 'LESS_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 0.5, unit: 'KILOGRAMS' } }];
    expect(upperBandFromConditions(conds as never)).toBe('0.5');
  });
});

describe('normalizeShopifyDeliveryProfile band map', () => {
  it('keeps two same-named bands distinct (no collision)', () => {
    const data = {
      deliveryProfiles: { edges: [{ node: {
        id: 'gid://p/1', name: 'General', default: true,
        profileLocationGroups: [{ locationGroup: { id: 'gid://lg/1' }, locationGroupZones: { edges: [{ node: {
          zone: { id: 'gid://z/NA2', name: 'NA2', countries: [{ code: { countryCode: 'US', restOfWorld: false } }] },
          methodDefinitions: { edges: [
            { node: { id: 'gid://md/A', name: 'Standard shipping', rateProvider: { __typename: 'DeliveryRateDefinition', price: { amount: '54.5', currencyCode: 'USD' } },
              methodConditions: [{ field: 'TOTAL_WEIGHT', operator: 'LESS_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 0.5, unit: 'KILOGRAMS' } }] } },
            { node: { id: 'gid://md/B', name: 'Standard shipping', rateProvider: { __typename: 'DeliveryRateDefinition', price: { amount: '66', currencyCode: 'USD' } },
              methodConditions: [
                { field: 'TOTAL_WEIGHT', operator: 'GREATER_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 0.51, unit: 'KILOGRAMS' } },
                { field: 'TOTAL_WEIGHT', operator: 'LESS_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 1, unit: 'KILOGRAMS' } },
              ] } },
          ] },
        } }] } }],
      } }] },
    };
    const norm = normalizeShopifyDeliveryProfile(data);
    expect(norm.bandRates[bandKeyOf('NA2', 'Standard shipping', '0.5')]).toEqual({ id: 'gid://md/A', price: 54.5, currency: 'USD' });
    expect(norm.bandRates[bandKeyOf('NA2', 'Standard shipping', '1')]).toEqual({ id: 'gid://md/B', price: 66, currency: 'USD' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/settings-sync/domain/shipping.band.test.ts`
Expected: FAIL — `upperBandFromConditions`/`bandKeyOf` not exported; `bandRates` undefined.

- [ ] **Step 3: Extend the query**

In `features/settings-sync/domain/shipping.ts`, inside `SHIPPING_QUERY`, change the `methodDefinitions` selection to also read conditions:

```ts
                  methodDefinitions(first: 50) {
                    edges {
                      node {
                        id
                        name
                        rateProvider {
                          __typename
                          ... on DeliveryRateDefinition {
                            price { amount currencyCode }
                          }
                        }
                        methodConditions {
                          field
                          operator
                          conditionCriteria {
                            __typename
                            ... on Weight { value unit }
                          }
                        }
                      }
                    }
                  }
```

- [ ] **Step 4: Extend response types + add band types/helpers**

In the same file, extend the loosely-typed method-definition node and add helpers. Find the response interface block (the `ShopifyProfileNode` types around `methodDefinitions`) and add `methodConditions` to the node type:

```ts
// add to the methodDefinitions edges node type:
//   methodConditions?: WeightCondition[];

export interface WeightCondition {
  field: string;
  operator: string;
  conditionCriteria?: { __typename?: string; value?: number; unit?: string };
}

export interface BandRate { id: string; price: number; currency: string }
export type BandRateMap = Record<string, BandRate>;

/** Upper band (kg) = value của điều kiện LESS_THAN_OR_EQUAL_TO; không có → 'flat'.
 *  Làm tròn 3 chữ số để khớp ổn định (tránh lệch dấu phẩy động). */
export function upperBandFromConditions(conds: WeightCondition[] | undefined): string {
  const upper = (conds ?? []).find(
    (c) => c.field === 'TOTAL_WEIGHT' && c.operator === 'LESS_THAN_OR_EQUAL_TO',
  )?.conditionCriteria?.value;
  return typeof upper === 'number' ? String(Math.round(upper * 1000) / 1000) : 'flat';
}

export function bandKeyOf(zoneName: string, mappedName: string, upper: string): string {
  return `${zoneName}.${mappedName}.${upper}`;
}
```

Add `bandRates: BandRateMap;` to the `ShopifyIds`-adjacent `NormalizedShipping` interface:

```ts
export interface NormalizedShipping {
  tree: ShippingTree;
  shopifyIds: ShopifyIds;
  bandRates: BandRateMap;
}
```

- [ ] **Step 5: Populate `bandRates` in `normalizeProfileNode` + the empty fallback**

In `normalizeProfileNode`, initialize and fill the band map alongside the existing rate loop:

```ts
  const bandRates: BandRateMap = {};
  // ... inside the `for (const re of z.methodDefinitions?.edges ?? [])` loop, after the
  // existing rateIdByZoneAndName assignment, add:
  if (rp?.__typename === 'DeliveryRateDefinition' && rp.price) {
    const upper = upperBandFromConditions(m.methodConditions);
    bandRates[bandKeyOf(zoneName, m.name, upper)] = {
      id: m.id, price: Number(rp.price.amount), currency: rp.price.currencyCode,
    };
  }
  // ... and return:
  return { tree, shopifyIds, bandRates };
```

In `normalizeShopifyDeliveryProfile`'s empty fallback object, add `bandRates: {}`:

```ts
    return { tree: { zones: {} }, shopifyIds: { profileId: '', locationGroupId: '', zoneIdByName: {}, rateIdByZoneAndName: {} }, bandRates: {} };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run features/settings-sync/domain/shipping.band.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Confirm no regressions + types**

Run: `npx vitest run features/settings-sync && npx tsc --noEmit`
Expected: existing settings-sync tests PASS; tsc clean. (Adding a required `bandRates` field — if any test constructs a `NormalizedShipping` literal, update it to include `bandRates: {}`.)

- [ ] **Step 8: Commit**

```bash
git add features/settings-sync/domain/shipping.ts features/settings-sync/domain/shipping.band.test.ts
git commit -m "feat(push): đọc band-aware method definitions (weight conditions + bandRates map)"
```

---

## Task 2: Pure diff builder `buildSystemUpdateVariables`

**Files:**
- Create: `features/carrier-rates/push/system-update-diff.ts`
- Test: `features/carrier-rates/push/system-update-diff.test.ts` (create)

**Interfaces:**
- Consumes (from Task 1 / existing `shipping.ts`): `NormalizedShipping` (with `bandRates`), `ShippingTree`, `normalizeRateForShopify`, `parseWeightBand`, `bandKeyOf`, `BandRate`.
- Produces:
  ```ts
  interface RateUpdate { id: string; price: number; currency: string }
  interface RateCreate { name: string; price: number; currency: string; upperKg: number | null }
  interface ZoneUpdate { zoneId: string; updates: RateUpdate[]; creates: RateCreate[] }
  interface ZoneCreateFull { name: string; countries: string[]; rates: Array<{ name: string; price: number; currency: string; upperKg: number | null }> }
  interface SystemUpdatePlan {
    zoneUpdates: ZoneUpdate[];
    zonesToCreate: ZoneCreateFull[];
    zonesToDelete: string[];
    rateDeletes: string[];
    counts: { updates: number; creates: number; zoneCreates: number; zoneDeletes: number; rateDeletes: number };
  }
  function isUpdateOnly(plan: SystemUpdatePlan): boolean   // zonesToCreate empty && zonesToDelete empty
  function buildSystemUpdatePlan(current: NormalizedShipping, systemTree: ShippingTree): SystemUpdatePlan
  ```

- [ ] **Step 1: Write the failing test**

Create `features/carrier-rates/push/system-update-diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSystemUpdatePlan, isUpdateOnly } from './system-update-diff';
import type { NormalizedShipping } from '@/features/settings-sync/domain/shipping';
import { bandKeyOf } from '@/features/settings-sync/domain/shipping';

// Store: zone NA2 (US) with two Standard shipping bands (upper 0.5 @ 54.5, upper 1 @ 66).
function storeNA2(): NormalizedShipping {
  return {
    tree: { zones: { NA2: { countries: ['US'], rates: { 'Standard shipping': { type: 'flat', price: 66, currency: 'USD' } } } } },
    shopifyIds: { profileId: 'gid://p/1', locationGroupId: 'gid://lg/1', zoneIdByName: { NA2: 'gid://z/NA2' }, rateIdByZoneAndName: {} },
    bandRates: {
      [bandKeyOf('NA2', 'Standard shipping', '0.5')]: { id: 'gid://md/A', price: 54.5, currency: 'USD' },
      [bandKeyOf('NA2', 'Standard shipping', '1')]: { id: 'gid://md/B', price: 66, currency: 'USD' },
    },
  };
}

const sysNA2 = (p05: number, p1: number) => ({
  zones: { NA2: { countries: ['US'], rates: {
    'FedEx IP (0–0.5 kg)': { type: 'flat' as const, price: p05, currency: 'USD' },
    'FedEx IP (0.5–1 kg)': { type: 'flat' as const, price: p1, currency: 'USD' },
  } } },
});

describe('buildSystemUpdatePlan', () => {
  it('price-only change → only updates, no create/delete', () => {
    const plan = buildSystemUpdatePlan(storeNA2(), sysNA2(60, 70));
    expect(plan.zonesToCreate).toHaveLength(0);
    expect(plan.zonesToDelete).toHaveLength(0);
    expect(plan.zoneUpdates).toEqual([{ zoneId: 'gid://z/NA2', updates: [
      { id: 'gid://md/A', price: 60, currency: 'USD' },
      { id: 'gid://md/B', price: 70, currency: 'USD' },
    ], creates: [] }]);
    expect(isUpdateOnly(plan)).toBe(true);
  });

  it('identical prices → no-op', () => {
    const plan = buildSystemUpdatePlan(storeNA2(), sysNA2(54.5, 66));
    expect(plan.zoneUpdates).toHaveLength(0);
    expect(plan.counts.updates).toBe(0);
    expect(isUpdateOnly(plan)).toBe(true);
  });

  it('new zone → zonesToCreate, not update path', () => {
    const sys = { zones: { ...sysNA2(60, 70).zones, EU1: { countries: ['DE'], rates: { 'FedEx IP (0–0.5 kg)': { type: 'flat' as const, price: 40, currency: 'USD' } } } } };
    const plan = buildSystemUpdatePlan(storeNA2(), sys);
    expect(plan.zonesToCreate.map((z) => z.name)).toEqual(['EU1']);
    expect(isUpdateOnly(plan)).toBe(false);
  });

  it('band added in system (missing on store) → methodDefinitionsToCreate in zone', () => {
    const sys = { zones: { NA2: { countries: ['US'], rates: {
      ...sysNA2(60, 70).zones.NA2.rates,
      'FedEx IP (1–2 kg)': { type: 'flat' as const, price: 80, currency: 'USD' },
    } } } };
    const plan = buildSystemUpdatePlan(storeNA2(), sys);
    expect(plan.zoneUpdates[0].creates).toEqual([{ name: 'Standard shipping', price: 80, currency: 'USD', upperKg: 2 }]);
    expect(isUpdateOnly(plan)).toBe(true); // create within existing zone stays on fast path
  });

  it('band on store not in system → rateDeletes', () => {
    const sys = { zones: { NA2: { countries: ['US'], rates: {
      'FedEx IP (0–0.5 kg)': { type: 'flat' as const, price: 60, currency: 'USD' },
    } } } };
    const plan = buildSystemUpdatePlan(storeNA2(), sys);
    expect(plan.rateDeletes).toContain('gid://md/B');
    expect(isUpdateOnly(plan)).toBe(true);
  });

  it('country drift → zone deleted + recreated', () => {
    const sys = { zones: { NA2: { countries: ['US', 'CA'], rates: sysNA2(60, 70).zones.NA2.rates } } };
    const plan = buildSystemUpdatePlan(storeNA2(), sys);
    expect(plan.zonesToDelete).toEqual(['gid://z/NA2']);
    expect(plan.zonesToCreate.map((z) => z.name)).toEqual(['NA2']);
    expect(isUpdateOnly(plan)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/carrier-rates/push/system-update-diff.test.ts`
Expected: FAIL — module `./system-update-diff` not found.

- [ ] **Step 3: Implement the diff builder**

Create `features/carrier-rates/push/system-update-diff.ts`:

```ts
import type { NormalizedShipping, ShippingTree } from '@/features/settings-sync/domain/shipping';
import { bandKeyOf, normalizeRateForShopify, parseWeightBand } from '@/features/settings-sync/domain/shipping';

export interface RateUpdate { id: string; price: number; currency: string }
export interface RateCreate { name: string; price: number; currency: string; upperKg: number | null }
export interface ZoneUpdate { zoneId: string; updates: RateUpdate[]; creates: RateCreate[] }
export interface ZoneCreateFull {
  name: string; countries: string[];
  rates: Array<{ name: string; price: number; currency: string; upperKg: number | null }>;
}
export interface SystemUpdatePlan {
  zoneUpdates: ZoneUpdate[];
  zonesToCreate: ZoneCreateFull[];
  zonesToDelete: string[];
  rateDeletes: string[];
  counts: { updates: number; creates: number; zoneCreates: number; zoneDeletes: number; rateDeletes: number };
}

/** Update-only (fast path) khi KHÔNG phải tạo/xoá zone nào. Tạo/xoá band trong
 *  zone đang có vẫn nằm trên fast path (nhẹ). */
export function isUpdateOnly(plan: SystemUpdatePlan): boolean {
  return plan.zonesToCreate.length === 0 && plan.zonesToDelete.length === 0;
}

const sameCountries = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((c) => sb.has(c));
};

/** Đặc tả 1 rate hệ thống → (tên-gộp Shopify, cận-trên-band). */
function mappedRate(rateName: string): { mappedName: string; upper: string; upperKg: number | null } {
  const mappedName = normalizeRateForShopify(rateName).name;
  const band = parseWeightBand(rateName);
  const upperKg = band ? band.upper : null;
  const upper = upperKg == null ? 'flat' : String(Math.round(upperKg * 1000) / 1000);
  return { mappedName, upper, upperKg };
}

export function buildSystemUpdatePlan(current: NormalizedShipping, systemTree: ShippingTree): SystemUpdatePlan {
  const plan: SystemUpdatePlan = {
    zoneUpdates: [], zonesToCreate: [], zonesToDelete: [], rateDeletes: [],
    counts: { updates: 0, creates: 0, zoneCreates: 0, zoneDeletes: 0, rateDeletes: 0 },
  };
  const storeZones = current.tree.zones;
  const sysZones = systemTree.zones ?? {};

  for (const [zoneName, sysZone] of Object.entries(sysZones)) {
    const storeZone = storeZones[zoneName];
    const fullCreate: ZoneCreateFull = {
      name: zoneName, countries: sysZone.countries,
      rates: Object.entries(sysZone.rates).map(([rn, r]) => {
        const m = mappedRate(rn);
        return { name: m.mappedName, price: r.price, currency: r.currency, upperKg: m.upperKg };
      }),
    };

    // Zone mới HOẶC lệch nước → tạo full (+ xoá zone cũ nếu lệch nước).
    if (!storeZone) { plan.zonesToCreate.push(fullCreate); continue; }
    if (!sameCountries(storeZone.countries, sysZone.countries)) {
      plan.zonesToDelete.push(current.shopifyIds.zoneIdByName[zoneName]);
      plan.zonesToCreate.push(fullCreate);
      continue;
    }

    // Zone khớp nước → diff theo band.
    const updates: RateUpdate[] = [];
    const creates: RateCreate[] = [];
    const seenKeys = new Set<string>();
    for (const [rn, r] of Object.entries(sysZone.rates)) {
      const m = mappedRate(rn);
      const key = bandKeyOf(zoneName, m.mappedName, m.upper);
      seenKeys.add(key);
      const existing = current.bandRates[key];
      if (!existing) {
        creates.push({ name: m.mappedName, price: r.price, currency: r.currency, upperKg: m.upperKg });
      } else if (existing.price !== r.price || existing.currency !== r.currency) {
        updates.push({ id: existing.id, price: r.price, currency: r.currency });
      }
    }
    // Band trên store thuộc zone này nhưng KHÔNG còn trong system → xoá.
    const prefix = `${zoneName}.`;
    for (const [k, br] of Object.entries(current.bandRates)) {
      if (k.startsWith(prefix) && !seenKeys.has(k)) plan.rateDeletes.push(br.id);
    }
    if (updates.length || creates.length) plan.zoneUpdates.push({ zoneId: current.shopifyIds.zoneIdByName[zoneName], updates, creates });
  }

  plan.counts = {
    updates: plan.zoneUpdates.reduce((s, z) => s + z.updates.length, 0),
    creates: plan.zoneUpdates.reduce((s, z) => s + z.creates.length, 0),
    zoneCreates: plan.zonesToCreate.length,
    zoneDeletes: plan.zonesToDelete.length,
    rateDeletes: plan.rateDeletes.length,
  };
  return plan;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/carrier-rates/push/system-update-diff.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint features/carrier-rates/push/system-update-diff.ts features/carrier-rates/push/system-update-diff.test.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add features/carrier-rates/push/system-update-diff.ts features/carrier-rates/push/system-update-diff.test.ts
git commit -m "feat(push): pure band-aware diff builder buildSystemUpdatePlan"
```

---

## Task 3: Wire `manual-update` fast path into `pushShippingStep`

**Files:**
- Modify: `features/carrier-rates/push-step.ts`
- Test: `features/carrier-rates/push/system-update-mutation.test.ts` (create)

**Interfaces:**
- Consumes: `buildSystemUpdatePlan`, `isUpdateOnly`, `SystemUpdatePlan`, `ZoneUpdate` (Task 2); `normalizeRateForShopify`/`weightConditionsFromName` via the existing `md`-style builder; `read()`/`send()` (existing in `push-step.ts`).
- Produces:
  - New cursor variant `{ phase: 'manual-update'; updateStart: number }` added to the `PushCursor` union.
  - `function buildUpdateMutationProfile(locationGroupId: string, zoneChunk: ZoneUpdate[], rateDeletes: string[]): Record<string, unknown>` — exported helper, the only unit-tested piece (builds the `deliveryProfileUpdate` `profile` for one chunk).

- [ ] **Step 1: Write the failing test (mutation shape)**

Create `features/carrier-rates/push/system-update-mutation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildUpdateMutationProfile } from '../push-step';

describe('buildUpdateMutationProfile', () => {
  it('builds zonesToUpdate with methodDefinitionsToUpdate (price) + create (with weight condition)', () => {
    const profile = buildUpdateMutationProfile('gid://lg/1',
      [{ zoneId: 'gid://z/NA2', updates: [{ id: 'gid://md/A', price: 60, currency: 'USD' }], creates: [{ name: 'Standard shipping', price: 80, currency: 'USD', upperKg: 2 }] }],
      ['gid://md/X']);
    const lg = (profile.locationGroupsToUpdate as any[])[0];
    expect(lg.id).toBe('gid://lg/1');
    expect(lg.zonesToUpdate[0].id).toBe('gid://z/NA2');
    expect(lg.zonesToUpdate[0].methodDefinitionsToUpdate[0]).toEqual({ id: 'gid://md/A', rateDefinition: { price: { amount: '60', currencyCode: 'USD' } } });
    const created = lg.zonesToUpdate[0].methodDefinitionsToCreate[0];
    expect(created.name).toBe('Standard shipping');
    expect(created.rateDefinition).toEqual({ price: { amount: '80', currencyCode: 'USD' } });
    expect(created.weightConditionsToCreate).toBeTruthy(); // upper 2kg → has a condition
    expect(profile.methodDefinitionsToDelete).toEqual(['gid://md/X']);
  });

  it('omits methodDefinitionsToDelete when no rate deletes', () => {
    const profile = buildUpdateMutationProfile('gid://lg/1',
      [{ zoneId: 'gid://z/NA2', updates: [{ id: 'gid://md/A', price: 60, currency: 'USD' }], creates: [] }], []);
    expect(profile.methodDefinitionsToDelete).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/carrier-rates/push/system-update-mutation.test.ts`
Expected: FAIL — `buildUpdateMutationProfile` not exported.

- [ ] **Step 3: Add the cursor variant + the exported mutation-profile builder**

In `features/carrier-rates/push-step.ts`:

Add to the `PushCursor` union:

```ts
export type PushCursor =
  | { phase: 'manual-delete' }
  | { phase: 'manual-update'; updateStart: number }
  | { phase: 'manual-create'; zoneStart: number }
  | { phase: 'engine'; shopCursor: string | null; csId: string };
```

Add imports at the top:

```ts
import { weightConditionsFromName } from '@/features/settings-sync/domain/shipping';
import { buildSystemUpdatePlan, isUpdateOnly, type SystemUpdatePlan, type ZoneUpdate } from './push/system-update-diff';
```

> Note: `weightConditionsFromName` is currently module-private in `shipping.ts`. Export it (add `export` to its declaration) so the create-with-band path can attach conditions. This is a pure helper; exporting is safe.

Add the exported builder near the top of the module (after constants):

```ts
/** Dựng `profile` cho deliveryProfileUpdate cho MỘT chunk update: zonesToUpdate
 *  (methodDefinitionsToUpdate giá + methodDefinitionsToCreate band thiếu) +
 *  methodDefinitionsToDelete (band dư). Cận trên band → weightConditionsToCreate
 *  qua tên gộp "<upper> kg" (tái dùng weightConditionsFromName). */
export function buildUpdateMutationProfile(
  locationGroupId: string,
  zoneChunk: ZoneUpdate[],
  rateDeletes: string[],
): Record<string, unknown> {
  const zonesToUpdate = zoneChunk.map((z) => {
    const zu: Record<string, unknown> = { id: z.zoneId };
    if (z.updates.length) {
      zu.methodDefinitionsToUpdate = z.updates.map((u) => ({
        id: u.id, rateDefinition: { price: { amount: String(u.price), currencyCode: u.currency } },
      }));
    }
    if (z.creates.length) {
      zu.methodDefinitionsToCreate = z.creates.map((c) => {
        const wc = c.upperKg == null ? [] : weightConditionsFromName(`x (0–${c.upperKg} kg)`);
        return {
          name: c.name,
          rateDefinition: { price: { amount: String(c.price), currencyCode: c.currency } },
          ...(wc.length ? { weightConditionsToCreate: wc } : {}),
        };
      });
    }
    return zu;
  });
  const profile: Record<string, unknown> = { locationGroupsToUpdate: [{ id: locationGroupId, zonesToUpdate }] };
  if (rateDeletes.length) profile.methodDefinitionsToDelete = rateDeletes;
  return profile;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/carrier-rates/push/system-update-mutation.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Branch at cursor init — choose fast path vs clean-rebuild**

In `pushShippingStep`, in the `if (cursor === null)` block, BEFORE the existing `if (plan.manualSourcePrefixes.length > 0) { cursor = { phase: 'manual-delete' }; }`, compute the diff once and pick the path. Replace the manual branch with:

```ts
  if (cursor === null) {
    if (plan.manualSourcePrefixes.length > 0) {
      const updatePlan = buildSystemUpdatePlan(p.normalized, manualTree);
      cursor = isUpdateOnly(updatePlan)
        ? { phase: 'manual-update', updateStart: 0 }
        : { phase: 'manual-delete' };
    } else if (plan.engineCarriers.length) {
      const { carrierServiceId } = await registerCarrierService(store.id);
      cursor = { phase: 'engine', shopCursor: null, csId: carrierServiceId };
    } else {
      return { /* unchanged "nothing to push" result */ } as PushStepResult;
    }
  }
```

> `manualTree` and `p.normalized` are already in scope (built before `send`). Keep the existing "nothing to push" object exactly as it is now — only the manual branch changes.

- [ ] **Step 6: Implement the `manual-update` phase**

Add this phase block BEFORE the existing `if (cursor.phase === 'manual-delete')` block:

```ts
  // ── phase 'manual-update' — store khớp cấu trúc: update giá tại chỗ, KHÔNG xoá zone.
  if (cursor.phase === 'manual-update') {
    const updatePlan: SystemUpdatePlan = buildSystemUpdatePlan(p.normalized, manualTree);
    // Snapshot backup trước khi ghi (giống manual-delete).
    if (cursor.updateStart === 0) {
      const snapshotPayload = [{ profileId: p.profileId, name: p.name, normalized: p.normalized }];
      await db.insert(schema.settingsSnapshots).values({
        storeId, domain: 'shipping_system', payload: snapshotPayload as object,
        payloadHash: hashPayload(snapshotPayload), capturedBy: userId,
      });
    }
    const zoneChunk = updatePlan.zoneUpdates.slice(cursor.updateStart, cursor.updateStart + BATCH);
    if (zoneChunk.length) {
      // rateDeletes chỉ gửi 1 lần (ở chunk đầu) để tránh xoá lặp.
      const dels = cursor.updateStart === 0 ? updatePlan.rateDeletes : [];
      const profile = buildUpdateMutationProfile(lgId, zoneChunk, dels);
      const err = await sendProfile(profile);
      if (err) {
        return {
          done: true, cursor: null,
          progress: { phase: 'Cập nhật giá', current: cursor.updateStart, total: updatePlan.zoneUpdates.length },
          result: { storeId, zoneCreated: 0, rateOps: updatePlan.counts.updates, engineZones: 0, errors: [`${p.name}: ${err}`] },
        };
      }
    }
    const nextStart = cursor.updateStart + BATCH;
    let nextCursor: PushCursor | null;
    if (nextStart < updatePlan.zoneUpdates.length) {
      nextCursor = { phase: 'manual-update', updateStart: nextStart };
    } else if (plan.engineCarriers.length) {
      const { carrierServiceId } = await registerCarrierService(store.id);
      nextCursor = { phase: 'engine', shopCursor: null, csId: carrierServiceId };
    } else {
      nextCursor = null;
    }
    return {
      done: nextCursor === null, cursor: nextCursor,
      progress: { phase: 'Cập nhật giá', current: Math.min(nextStart, updatePlan.zoneUpdates.length), total: updatePlan.zoneUpdates.length },
      result: { storeId, zoneCreated: 0, rateOps: updatePlan.counts.updates, engineZones: 0, errors: [] },
    };
  }
```

- [ ] **Step 7: Extract a profile-sending helper `sendProfile`**

The existing `send(prof)` calls `graphqlCall(... query: SHIPPING_MUTATION, variables: { id, profile: prof })` where `prof` is the inner `profile`. The update path passes a full `profile` object, so reuse the SAME mechanism. Rename/confirm: `send` already takes `prof: Record<string, unknown>` and wraps it as `{ id, profile: prof }`. So define `const sendProfile = send;` (alias) OR call `send(profile)` directly. Use `send(profile)` directly and delete the `sendProfile` reference in Step 6 (replace `sendProfile(profile)` with `send(profile)`).

> Verify: `send`'s retry + `userErrors` handling applies equally to update mutations. It does — `deliveryProfileUpdate` returns the same `userErrors` shape.

- [ ] **Step 8: Run the full push test suite + types**

Run: `npx vitest run features/carrier-rates && npx tsc --noEmit && npx eslint features/carrier-rates/push-step.ts`
Expected: PASS / clean.

- [ ] **Step 9: Manual smoke (dry, read-only) against a real store**

Run this one-off to confirm the diff classifies the current Mirer store as update-only after the recent price regen (no zone create/delete expected):

```bash
npx dotenv -- tsx -e '
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { loadStore, readProfiles } from "@/features/settings-sync/shipping-profiles-actions";
import { buildSystemShippingTree } from "@/features/markets/system-shipping";
import { filterTreeByRatePrefixes } from "@/features/carrier-rates/push-plan";
import { buildSystemUpdatePlan, isUpdateOnly } from "@/features/carrier-rates/push/system-update-diff";
(async () => {
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.shopDomain,"mirermirer-official.myshopify.com")).limit(1);
  const store = await loadStore(s.id);
  const profiles = await readProfiles(store);
  const p = profiles.find((x:any)=>x.isDefault) ?? profiles[0];
  const tree = filterTreeByRatePrefixes(await buildSystemShippingTree(), ["FedEx IP","DHL Express"]);
  const plan = buildSystemUpdatePlan(p.normalized, tree);
  console.log("counts", JSON.stringify(plan.counts), "updateOnly", isUpdateOnly(plan));
  process.exit(0);
})();
' 2>&1 | grep -vE "WARN|Better Auth" | tail -3
```

Expected: prints `counts {...}` and `updateOnly true` (store was just clean-rebuilt with matching zones; only prices differ). If `updateOnly false`, inspect `counts.zoneCreates/zoneDeletes` to see which zones drifted (acceptable — means clean-rebuild will run for those).

- [ ] **Step 10: Commit**

```bash
git add features/carrier-rates/push-step.ts features/carrier-rates/push/system-update-mutation.test.ts features/settings-sync/domain/shipping.ts
git commit -m "feat(push): manual-update fast path — update giá tại chỗ khi store khớp cấu trúc"
```

---

## Task 4: Full verification + finish

**Files:** none (verification only)

- [ ] **Step 1: Full suite, types, lint, build**

Run:
```bash
npx tsc --noEmit && npx vitest run && npm run build
```
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 2: Confirm clean-rebuild path still intact**

Manually re-read `pushShippingStep`: the `manual-delete` and `manual-create` phases must be byte-for-byte unchanged except for the new branch at init. The fast path is purely additive.

- [ ] **Step 3: Open PR**

```bash
git push -u origin feat/push-band-diff
gh pr create --base main --head feat/push-band-diff --title "feat(push): incremental in-place price update (band-aware diff)" --body "Spec docs/superpowers/specs/2026-06-18-incremental-push-band-diff-design.md. Store khớp cấu trúc → update giá tại chỗ, không xoá/tạo zone; store mới / lệch nước → clean-rebuild như cũ. Tests + build xanh.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-Review notes

- **Spec coverage:** query extension (T1), band-aware normalize (T1), `buildSystemUpdateVariables`/plan (T2), `manual-update` phase + path decision (T3), snapshot-before-write (T3 Step 6), reuse retry/hardened client (T3 Step 7), engine phase untouched (T4 Step 2). All spec sections mapped.
- **Naming consistency:** `bandKeyOf`, `upperBandFromConditions`, `BandRateMap`, `buildSystemUpdatePlan`, `isUpdateOnly`, `buildUpdateMutationProfile`, cursor `manual-update`/`updateStart`, `BATCH` (existing =5) — used identically across tasks.
- **Known follow-up (out of scope):** the design wrote `buildSystemUpdateVariables`; the plan implements it as `buildSystemUpdatePlan` returning a structured plan (cleaner for chunking) plus `buildUpdateMutationProfile` for the Shopify shape — same behavior, split for testability.
