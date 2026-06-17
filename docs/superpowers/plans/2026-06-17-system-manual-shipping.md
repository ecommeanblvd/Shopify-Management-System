# Bảng giá ship HỆ THỐNG → push store (tên rate gộp) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo bảng giá ship manual cấp hệ thống (seed từ cici-mean), đẩy lên Shopify từng store với tên rate gộp `Standard shipping`/`Express shipping` và zone kết hợp FedEx×DHL, qua clean-rebuild (xoá+tạo lại).

**Architecture:** Một bảng `manual_shipping_config` store-independent là nguồn sự thật. Các hàm THUẦN (`normalizeRateForShopify`, `buildCleanRebuildVariables`, merge/seed) được TDD; các action chạm DB/Shopify là wrapper mỏng quanh hàm thuần, verify bằng tsc + smoke dry-run. Push dùng clean-rebuild: xoá zone bị thay thế (theo country giao) rồi tạo lại zone hệ thống — tránh hẳn việc Shopify không sửa được country zone tại chỗ.

**Tech Stack:** Next.js (App Router, server actions), Drizzle ORM (pgTable, migration tay), Vitest, Shopify Admin GraphQL 2025-01 (deliveryProfileUpdate).

**Spec:** `docs/superpowers/specs/2026-06-17-system-manual-shipping-design.md`

---

## Bối cảnh kiểu dữ liệu (đọc trước khi code)

`features/settings-sync/domain/shipping.ts`:
```ts
export interface ShippingTree { zones: Record<string, ShippingZone>; }
export interface ShippingZone { countries: string[]; rates: Record<string, ShippingRate>; }
export interface ShippingRate { type: 'flat'; price: number; currency: string; }
export interface ShopifyIds { profileId: string; locationGroupId: string; zoneIdByName: Record<string,string>; rateIdByZoneAndName: Record<string,string>; }
export interface NormalizedShipping { tree: ShippingTree; shopifyIds: ShopifyIds; }
export function parseWeightBand(rateName: string): { lower: number; upper: number } | null
const BAND_LOWER_OFFSET_KG = 0.01;                 // private
function weightConditionsFromName(rateName: string): unknown[]   // private, cùng file — tái dùng được
```
`features/markets/types.ts`: `MarketShipping { zones: Record<string, { countries: string[]; rates: Record<string,{type,price,currency}> }> }`; `MarketStoreOverride { storeId; marketHandle; priceAdjustment; shipping: MarketShipping|null }`.

Phase-send đã chứng minh (trong `applyShippingToProfiles`, dùng lại nguyên văn cho action mới): PHASE 1 gửi `profile.zonesToDelete` + `profile.methodDefinitionsToDelete`; PHASE 2 `zonesToUpdate`; PHASE 3 `zonesToCreate` theo lô 3 (lọc bỏ zone không có rate).

---

## File Structure

- `db/schema.ts` — thêm bảng `manualShippingConfig`.
- `db/migrations/0066_manual-shipping-config.sql` + journal — tạo bảng.
- `features/settings-sync/domain/shipping.ts` — thêm `normalizeRateForShopify`, `buildCleanRebuildVariables` (thuần).
- `features/carrier-rates/push-plan.ts` — thêm `manualSourcePrefixes` vào plan + `filterTreeByRatePrefixes`.
- `features/markets/system-shipping-domain.ts` (mới) — `planSeedRows`, `mergeSystemShippingRows` (thuần).
- `features/markets/system-shipping.ts` (mới) — `seedSystemShippingFromStore`, `listSystemShipping`, `buildSystemShippingTree` (action DB).
- `features/settings-sync/shipping-profiles-actions.ts` — `previewSystemShippingToProfiles`, `applySystemShippingToProfiles`.
- `features/carrier-rates/push-orchestrator.ts` — route sang nguồn hệ thống.
- `app/(dashboard)/f/functions/manual-shipping-rates/page.tsx` — đọc bảng hệ thống.
- Tests: `*.test.ts` cạnh mỗi file thuần.

---

## Task 1: Bảng `manual_shipping_config` + migration

**Files:**
- Modify: `db/schema.ts`
- Create: `db/migrations/0066_manual-shipping-config.sql`
- Modify: `db/migrations/meta/_journal.json`

- [ ] **Step 1: Thêm bảng vào schema**

Trong `db/schema.ts`, ngay sau khối `marketStoreOverrides` (dòng ~211-223), thêm:
```ts
export const manualShippingConfig = pgTable('manual_shipping_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  marketHandle: text('market_handle').notNull().unique(),
  shipping: jsonb('shipping').notNull(),
  version: integer('version').notNull().default(1),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

- [ ] **Step 2: Viết migration SQL (tay — drizzle-kit generate đang hỏng)**

Tạo `db/migrations/0066_manual-shipping-config.sql`:
```sql
CREATE TABLE IF NOT EXISTS "manual_shipping_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_handle" text NOT NULL,
	"shipping" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "manual_shipping_config_market_handle_unique" UNIQUE("market_handle")
);
```

- [ ] **Step 3: Thêm journal entry**

Trong `db/migrations/meta/_journal.json`, thêm vào cuối mảng `entries` (sau entry idx 65):
```json
		{
			"idx": 66,
			"version": "7",
			"when": 1782132000000,
			"tag": "0066_manual-shipping-config",
			"breakpoints": true
		}
```
(Nhớ thêm dấu `,` sau entry 65.)

- [ ] **Step 4: Verify schema biên dịch**

Run: `npx tsc --noEmit 2>&1 | grep -iE "schema.ts" | head`
Expected: rỗng (không lỗi). **KHÔNG chạy `db:migrate`** (DATABASE_URL = production; migration sẽ chạy lúc Railway deploy).

- [ ] **Step 5: Commit**
```bash
git add db/schema.ts db/migrations/0066_manual-shipping-config.sql db/migrations/meta/_journal.json
git commit -m "feat(shipping): bảng manual_shipping_config cấp hệ thống"
```

---

## Task 2: `normalizeRateForShopify` (thuần, TDD)

**Files:**
- Modify: `features/settings-sync/domain/shipping.ts`
- Test: `features/settings-sync/domain/shipping.test.ts`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `features/settings-sync/domain/shipping.test.ts`:
```ts
import { normalizeRateForShopify } from './shipping';

describe('normalizeRateForShopify', () => {
  it('FedEx IP → Standard shipping + điều kiện cân (offset 0.01)', () => {
    expect(normalizeRateForShopify('FedEx IP (1.5–2 kg)')).toEqual({
      name: 'Standard shipping',
      conditions: [
        { criteria: { value: 1.51, unit: 'KILOGRAMS' }, operator: 'GREATER_THAN_OR_EQUAL_TO' },
        { criteria: { value: 2, unit: 'KILOGRAMS' }, operator: 'LESS_THAN_OR_EQUAL_TO' },
      ],
    });
  });
  it('DHL Express → Express shipping', () => {
    expect(normalizeRateForShopify('DHL Express (0–0.5 kg)').name).toBe('Express shipping');
  });
  it('bậc đầu lower=0 → chỉ có điều kiện trên', () => {
    expect(normalizeRateForShopify('FedEx IP (0–0.5 kg)').conditions).toEqual([
      { criteria: { value: 0.5, unit: 'KILOGRAMS' }, operator: 'LESS_THAN_OR_EQUAL_TO' },
    ]);
  });
  it('prefix lạ → giữ nguyên tên', () => {
    expect(normalizeRateForShopify('Standard (2-2.5kg)').name).toBe('Standard (2-2.5kg)');
  });
});
```

- [ ] **Step 2: Chạy test — thất bại**

Run: `npx vitest run features/settings-sync/domain/shipping.test.ts -t normalizeRateForShopify`
Expected: FAIL ("normalizeRateForShopify is not a function").

- [ ] **Step 3: Cài đặt**

Trong `features/settings-sync/domain/shipping.ts`, sau hàm `weightConditionsFromName` (dòng ~326-333), thêm:
```ts
const RATE_NAME_MAP: Array<{ prefix: string; name: string }> = [
  { prefix: 'FedEx IP', name: 'Standard shipping' },
  { prefix: 'DHL Express', name: 'Express shipping' },
];

/** Đổi tên rate nguồn (FedEx IP / DHL Express theo bậc cân) → tên gộp + điều kiện
 *  cân (cân vào điều kiện, không vào tên). Prefix lạ → giữ nguyên tên. */
export function normalizeRateForShopify(rateName: string): { name: string; conditions: unknown[] } {
  const mapped = RATE_NAME_MAP.find((m) => rateName.startsWith(m.prefix));
  return { name: mapped ? mapped.name : rateName, conditions: weightConditionsFromName(rateName) };
}
```

- [ ] **Step 4: Chạy test — pass**

Run: `npx vitest run features/settings-sync/domain/shipping.test.ts -t normalizeRateForShopify`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**
```bash
git add features/settings-sync/domain/shipping.ts features/settings-sync/domain/shipping.test.ts
git commit -m "feat(shipping): normalizeRateForShopify — gộp tên rate + điều kiện cân"
```

---

## Task 3: Lọc tree theo prefix nguồn + plan `manualSourcePrefixes` (thuần, TDD)

**Files:**
- Modify: `features/carrier-rates/push-plan.ts`
- Test: `features/carrier-rates/push-plan.test.ts`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `features/carrier-rates/push-plan.test.ts`:
```ts
import { planPush, filterTreeByRatePrefixes } from './push-plan';

describe('manualSourcePrefixes', () => {
  it('manual_fedex → prefix FedEx IP; manual_dhl → DHL Express', () => {
    expect(planPush(['manual_fedex']).manualSourcePrefixes).toEqual(['FedEx IP']);
    expect(planPush(['manual_dhl']).manualSourcePrefixes).toEqual(['DHL Express']);
    expect(planPush(['manual_fedex', 'manual_dhl']).manualSourcePrefixes).toEqual(['FedEx IP', 'DHL Express']);
  });
});

describe('filterTreeByRatePrefixes', () => {
  const tree = { zones: { Z1: { countries: ['HK'], rates: {
    'FedEx IP (0–0.5 kg)': { type: 'flat', price: 10, currency: 'USD' },
    'DHL Express (0–0.5 kg)': { type: 'flat', price: 12, currency: 'USD' },
  } } } } as const;
  it('giữ rate khớp prefix, bỏ rate khác', () => {
    const out = filterTreeByRatePrefixes(tree as never, ['FedEx IP']);
    expect(Object.keys(out.zones.Z1.rates)).toEqual(['FedEx IP (0–0.5 kg)']);
  });
  it('prefixes rỗng → giữ nguyên', () => {
    expect(filterTreeByRatePrefixes(tree as never, [])).toEqual(tree);
  });
});
```

- [ ] **Step 2: Chạy test — thất bại**

Run: `npx vitest run features/carrier-rates/push-plan.test.ts -t manualSourcePrefixes`
Expected: FAIL.

- [ ] **Step 3: Cài đặt**

Trong `features/carrier-rates/push-plan.ts`:
- Thêm map nguồn→prefix cạnh `MANUAL_RATE_NAME`:
```ts
const MANUAL_SOURCE_PREFIX: Record<string, string> = { manual_fedex: 'FedEx IP', manual_dhl: 'DHL Express' };
```
- Thêm field `manualSourcePrefixes: string[]` vào interface `PushPlan`.
- Trong `planPush`, sau khi tính `manualRateNames`, thêm:
```ts
  const manualSourcePrefixes: string[] = [];
  if (sources.includes('manual_fedex')) manualSourcePrefixes.push(MANUAL_SOURCE_PREFIX.manual_fedex);
  if (sources.includes('manual_dhl')) manualSourcePrefixes.push(MANUAL_SOURCE_PREFIX.manual_dhl);
```
  và trả thêm `manualSourcePrefixes` trong object return.
- Thêm hàm (cạnh `filterTreeByRateNames`), import type sẵn có `ShippingTree, ShippingZone, ShippingRate`:
```ts
export function filterTreeByRatePrefixes(tree: ShippingTree, prefixes: string[]): ShippingTree {
  if (!prefixes.length) return tree;
  const zones: Record<string, ShippingZone> = {};
  for (const [zn, z] of Object.entries(tree.zones)) {
    const rates: Record<string, ShippingRate> = {};
    for (const [rn, r] of Object.entries(z.rates)) if (prefixes.some((p) => rn.startsWith(p))) rates[rn] = r;
    zones[zn] = { countries: z.countries, rates };
  }
  return { zones };
}
```
(Nếu `ShippingZone`/`ShippingRate` chưa import trong push-plan.ts, thêm vào dòng import từ `@/features/settings-sync/domain/shipping`.)

- [ ] **Step 4: Chạy test — pass**

Run: `npx vitest run features/carrier-rates/push-plan.test.ts`
Expected: PASS (tất cả, gồm test cũ).

- [ ] **Step 5: Commit**
```bash
git add features/carrier-rates/push-plan.ts features/carrier-rates/push-plan.test.ts
git commit -m "feat(push): lọc tree theo prefix nguồn + manualSourcePrefixes"
```

---

## Task 4: `buildCleanRebuildVariables` (thuần, TDD)

**Files:**
- Modify: `features/settings-sync/domain/shipping.ts`
- Test: `features/settings-sync/domain/shipping.test.ts`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `features/settings-sync/domain/shipping.test.ts`:
```ts
import { buildCleanRebuildVariables, type NormalizedShipping, type ShippingTree } from './shipping';

describe('buildCleanRebuildVariables', () => {
  const current: NormalizedShipping = {
    tree: { zones: {
      'Zone G': { countries: ['HK', 'TH'], rates: {} },   // zone FedEx cũ — country giao
      'VN nội địa': { countries: ['VN'], rates: {} },       // không giao → GIỮ
    } },
    shopifyIds: {
      profileId: 'gid://profile/1', locationGroupId: 'gid://lg/1',
      zoneIdByName: { 'Zone G': 'gid://zone/G', 'VN nội địa': 'gid://zone/VN' },
      rateIdByZoneAndName: {},
    },
  };
  const systemTree: ShippingTree = { zones: {
    GC1: { countries: ['HK'], rates: { 'FedEx IP (1.5–2 kg)': { type: 'flat', price: 30, currency: 'USD' } } },
    SE2: { countries: ['TH'], rates: { 'DHL Express (0–0.5 kg)': { type: 'flat', price: 20, currency: 'USD' } } },
  } };

  const out = buildCleanRebuildVariables(current, systemTree, 'gid://lg/1');

  it('xoá zone giao country (Zone G), GIỮ zone VN', () => {
    expect(out.profile.zonesToDelete).toEqual(['gid://zone/G']);
  });
  it('tạo lại zone hệ thống với tên rate đã gộp + điều kiện cân', () => {
    const lg = (out.profile.locationGroupsToUpdate as any[])[0];
    const gc1 = lg.zonesToCreate.find((z: any) => z.name === 'GC1');
    expect(gc1.countries).toEqual([{ code: 'HK', includeAllProvinces: true }]);
    expect(gc1.methodDefinitionsToCreate[0].name).toBe('Standard shipping');
    expect(gc1.methodDefinitionsToCreate[0].weightConditionsToCreate).toHaveLength(2);
    expect(gc1.methodDefinitionsToCreate[0].rateDefinition).toEqual({ price: { amount: '30', currencyCode: 'USD' } });
  });
  it('id = profileId', () => { expect(out.id).toBe('gid://profile/1'); });
});
```

- [ ] **Step 2: Chạy test — thất bại**

Run: `npx vitest run features/settings-sync/domain/shipping.test.ts -t buildCleanRebuildVariables`
Expected: FAIL ("buildCleanRebuildVariables is not a function").

- [ ] **Step 3: Cài đặt**

Trong `features/settings-sync/domain/shipping.ts`, sau `buildProfileUpdateVariables`, thêm:
```ts
/** Clean-rebuild: xoá mọi zone Shopify hiện có mà country GIAO với systemTree
 *  (zone bị thay thế), rồi TẠO LẠI toàn bộ zone hệ thống với method-def đã gộp
 *  tên + điều kiện cân. Zone không giao country nào (VN nội địa) được GIỮ. */
export function buildCleanRebuildVariables(
  current: NormalizedShipping,
  systemTree: ShippingTree,
  locationGroupId: string,
): { id: string; profile: Record<string, unknown> } {
  const md = (name: string, r: ShippingRate) => {
    const norm = normalizeRateForShopify(name);
    return {
      name: norm.name,
      rateDefinition: { price: { amount: String(r.price), currencyCode: r.currency } },
      ...(norm.conditions.length ? { weightConditionsToCreate: norm.conditions } : {}),
    };
  };

  const systemCountries = new Set<string>();
  for (const z of Object.values(systemTree.zones)) for (const c of z.countries) systemCountries.add(c);

  const zonesToDelete: string[] = [];
  for (const [name, zone] of Object.entries(current.tree.zones)) {
    if (zone.countries.some((c) => systemCountries.has(c))) zonesToDelete.push(current.shopifyIds.zoneIdByName[name]);
  }

  const zonesToCreate = Object.entries(systemTree.zones)
    .filter(([, z]) => Object.keys(z.rates).length > 0)
    .map(([name, z]) => ({
      name,
      countries: z.countries.map((c) => ({ code: c, includeAllProvinces: true })),
      methodDefinitionsToCreate: Object.entries(z.rates).map(([rn, r]) => md(rn, r)),
    }));

  const profile: Record<string, unknown> = {};
  if (zonesToDelete.length) profile.zonesToDelete = zonesToDelete;
  profile.locationGroupsToUpdate = [{ id: locationGroupId, zonesToCreate }];
  return { id: current.shopifyIds.profileId, profile };
}
```

- [ ] **Step 4: Chạy test — pass**

Run: `npx vitest run features/settings-sync/domain/shipping.test.ts`
Expected: PASS (toàn bộ file, gồm test cũ).

- [ ] **Step 5: Commit**
```bash
git add features/settings-sync/domain/shipping.ts features/settings-sync/domain/shipping.test.ts
git commit -m "feat(shipping): buildCleanRebuildVariables — xoá zone giao country + tạo lại zone hệ thống"
```

---

## Task 5: Domain thuần cho bảng hệ thống — `planSeedRows`, `mergeSystemShippingRows` (TDD)

**Files:**
- Create: `features/markets/system-shipping-domain.ts`
- Test: `features/markets/system-shipping-domain.test.ts`

- [ ] **Step 1: Viết test thất bại**

Tạo `features/markets/system-shipping-domain.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { planSeedRows, mergeSystemShippingRows } from './system-shipping-domain';

describe('planSeedRows', () => {
  it('lấy override có shipping, bỏ override shipping null', () => {
    const rows = planSeedRows([
      { storeId: 's', marketHandle: 'europe', priceAdjustment: null, shipping: { zones: { EU1: { countries: ['FR'], rates: {} } } } },
      { storeId: 's', marketHandle: 'korea', priceAdjustment: null, shipping: null },
    ] as never);
    expect(rows).toEqual([{ marketHandle: 'europe', shipping: { zones: { EU1: { countries: ['FR'], rates: {} } } } }]);
  });
});

describe('mergeSystemShippingRows', () => {
  it('gộp zones của nhiều market thành 1 tree', () => {
    const tree = mergeSystemShippingRows([
      { marketHandle: 'europe', shipping: { zones: { EU1: { countries: ['FR'], rates: {} } } } },
      { marketHandle: 'korea', shipping: { zones: { KO1: { countries: ['KR'], rates: {} } } } },
    ] as never);
    expect(Object.keys(tree.zones).sort()).toEqual(['EU1', 'KO1']);
  });
});
```

- [ ] **Step 2: Chạy test — thất bại**

Run: `npx vitest run features/markets/system-shipping-domain.test.ts`
Expected: FAIL (module không tồn tại).

- [ ] **Step 3: Cài đặt**

Tạo `features/markets/system-shipping-domain.ts`:
```ts
import type { ShippingTree } from '@/features/settings-sync/domain/shipping';
import type { MarketShipping, MarketStoreOverride } from './types';

export interface SystemShippingRow { marketHandle: string; shipping: MarketShipping; }

/** Lọc override của store nguồn → các dòng seed (chỉ market có shipping). */
export function planSeedRows(overrides: MarketStoreOverride[]): SystemShippingRow[] {
  return overrides
    .filter((o): o is MarketStoreOverride & { shipping: MarketShipping } => o.shipping != null)
    .map((o) => ({ marketHandle: o.marketHandle, shipping: o.shipping }));
}

/** Gộp zones của mọi market hệ thống thành 1 ShippingTree. */
export function mergeSystemShippingRows(rows: SystemShippingRow[]): ShippingTree {
  const zones: ShippingTree['zones'] = {};
  for (const r of rows) if (r.shipping?.zones) Object.assign(zones, r.shipping.zones);
  return { zones };
}
```

- [ ] **Step 4: Chạy test — pass**

Run: `npx vitest run features/markets/system-shipping-domain.test.ts`
Expected: PASS (2 test).

- [ ] **Step 5: Commit**
```bash
git add features/markets/system-shipping-domain.ts features/markets/system-shipping-domain.test.ts
git commit -m "feat(shipping): domain thuần seed/merge bảng giá hệ thống"
```

---

## Task 6: Action DB cho bảng hệ thống (wrapper mỏng)

**Files:**
- Create: `features/markets/system-shipping.ts`

- [ ] **Step 1: Cài đặt** (không unit test — chạm DB; verify tsc + smoke ở Task 9)

Tạo `features/markets/system-shipping.ts`:
```ts
'use server';

import { headers } from 'next/headers';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listOverridesForStore } from './actions';
import { planSeedRows, mergeSystemShippingRows, type SystemShippingRow } from './system-shipping-domain';
import type { ShippingTree } from '@/features/settings-sync/domain/shipping';

async function requireApply(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'apply_markets')) throw new Error('forbidden');
  return session.user.id;
}

/** Seed bảng hệ thống từ override của store nguồn (cici). Idempotent: upsert theo
 *  market_handle, tăng version. Trả số market seed. */
export async function seedSystemShippingFromStore(sourceStoreId: string): Promise<number> {
  const userId = await requireApply();
  const rows = planSeedRows(await listOverridesForStore(sourceStoreId));
  for (const r of rows) {
    const [existing] = await db.select().from(schema.manualShippingConfig)
      .where(eq(schema.manualShippingConfig.marketHandle, r.marketHandle)).limit(1);
    if (existing) {
      await db.update(schema.manualShippingConfig)
        .set({ shipping: r.shipping, version: existing.version + 1, updatedBy: userId, updatedAt: new Date() })
        .where(eq(schema.manualShippingConfig.marketHandle, r.marketHandle));
    } else {
      await db.insert(schema.manualShippingConfig).values({ marketHandle: r.marketHandle, shipping: r.shipping, version: 1, updatedBy: userId });
    }
  }
  return rows.length;
}

export async function listSystemShipping(): Promise<SystemShippingRow[]> {
  const rows = await db.select().from(schema.manualShippingConfig);
  return rows.map((r) => ({ marketHandle: r.marketHandle, shipping: r.shipping as SystemShippingRow['shipping'] }));
}

export async function buildSystemShippingTree(): Promise<ShippingTree> {
  return mergeSystemShippingRows(await listSystemShipping());
}
```
Thêm `import { eq } from 'drizzle-orm';` ở đầu file.

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit 2>&1 | grep -iE "system-shipping" | head`
Expected: rỗng.

- [ ] **Step 3: Commit**
```bash
git add features/markets/system-shipping.ts
git commit -m "feat(shipping): action seed/đọc/build tree bảng giá hệ thống"
```

---

## Task 7: Push action hệ thống — `previewSystemShippingToProfiles` / `applySystemShippingToProfiles`

**Files:**
- Modify: `features/settings-sync/shipping-profiles-actions.ts`

- [ ] **Step 1: Cài đặt** (wrapper mỏng — verify tsc + smoke Task 9)

Trong `features/settings-sync/shipping-profiles-actions.ts`:
- Thêm import:
```ts
import { buildSystemShippingTree } from '@/features/markets/system-shipping';
import { filterTreeByRatePrefixes } from '@/features/carrier-rates/push-plan';
import { buildCleanRebuildVariables } from './domain/shipping';
```
- Thêm hàm preview (đếm — KHÔNG ghi):
```ts
/** Dry-run clean-rebuild bảng hệ thống lên các profile. `sourcePrefixes` lọc
 *  carrier nguồn (FedEx IP / DHL Express) TRƯỚC khi gộp tên. */
export async function previewSystemShippingToProfiles(
  storeId: string, profileIds: string[], sourcePrefixes: string[],
): Promise<ProfilePushResult[]> {
  await requireApplyPermission();
  const store = await loadStore(storeId);
  const systemTree = filterTreeByRatePrefixes(await buildSystemShippingTree(), sourcePrefixes);
  if (Object.keys(systemTree.zones).length === 0) throw new Error('Bảng giá hệ thống trống — chạy seed trước.');
  const profiles = await readProfiles(store);
  const selected = new Set(profileIds);
  return profiles.filter((p) => selected.has(p.profileId)).map((p) => {
    const { profile } = buildCleanRebuildVariables(p.normalized, systemTree, p.normalized.shopifyIds.locationGroupId);
    const lg = (profile.locationGroupsToUpdate as Array<Record<string, unknown>>)[0];
    const creates = ((lg.zonesToCreate as Array<Record<string, unknown>>) ?? []).filter((z) => ((z.methodDefinitionsToCreate as unknown[])?.length ?? 0) > 0);
    return {
      profileId: p.profileId, name: p.name,
      zonesToCreate: creates.length,
      zonesToDelete: ((profile.zonesToDelete as string[]) ?? []).length,
      rateOps: creates.reduce((n, z) => n + ((z.methodDefinitionsToCreate as unknown[])?.length ?? 0), 0),
      error: null,
    };
  });
}
```
- Thêm hàm apply (ghi thật, tái dùng phase-send y như `applyShippingToProfiles`):
```ts
/** Đẩy clean-rebuild bảng hệ thống lên profile (ghi thật). */
export async function applySystemShippingToProfiles(
  storeId: string, profileIds: string[], sourcePrefixes: string[],
): Promise<ProfilePushResult[]> {
  const userId = await requireApplyPermission();
  const store = await loadStore(storeId);
  const systemTree = filterTreeByRatePrefixes(await buildSystemShippingTree(), sourcePrefixes);
  if (Object.keys(systemTree.zones).length === 0) throw new Error('Bảng giá hệ thống trống — chạy seed trước.');
  const token = await getStoreToken(store.id);
  const profiles = await readProfiles(store);
  const selected = new Set(profileIds);
  const results: ProfilePushResult[] = [];
  for (const p of profiles.filter((pp) => selected.has(pp.profileId))) {
    const { id, profile } = buildCleanRebuildVariables(p.normalized, systemTree, p.normalized.shopifyIds.locationGroupId);
    const lg = (profile.locationGroupsToUpdate as Array<Record<string, unknown>>)[0];
    const zonesToCreate = ((lg.zonesToCreate as Array<Record<string, unknown>>) ?? [])
      .filter((z) => ((z.methodDefinitionsToCreate as unknown[])?.length ?? 0) > 0);
    const base: ProfilePushResult = {
      profileId: p.profileId, name: p.name,
      zonesToCreate: zonesToCreate.length,
      zonesToDelete: ((profile.zonesToDelete as string[]) ?? []).length,
      rateOps: zonesToCreate.reduce((n, z) => n + ((z.methodDefinitionsToCreate as unknown[])?.length ?? 0), 0),
      error: null,
    };
    const send = async (prof: Record<string, unknown>) => {
      const res = await graphqlCall({ shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query: SHIPPING_MUTATION, variables: { id, profile: prof } });
      if ((res as { errors?: unknown }).errors) return JSON.stringify((res as { errors?: unknown }).errors).slice(0, 200);
      const ue = (res.data as { deliveryProfileUpdate?: { userErrors?: Array<{ message: string }> } })?.deliveryProfileUpdate?.userErrors;
      return ue && ue.length ? ue.map((e) => e.message).join('; ') : null;
    };
    try {
      // PHASE 1 — xoá zone bị thay TRƯỚC (giải phóng nước, tránh "Region already exists").
      if (profile.zonesToDelete) base.error = await send({ zonesToDelete: profile.zonesToDelete });
      // PHASE 2 — tạo lại zone hệ thống theo lô 3 (gửi cả ~25 zone/1 mutation → Shopify 500).
      for (let i = 0; !base.error && i < zonesToCreate.length; i += 3) {
        base.error = await send({ locationGroupsToUpdate: [{ id: lg.id, zonesToCreate: zonesToCreate.slice(i, i + 3) }] });
      }
    } catch (e) {
      base.error = (e as Error).message;
    }
    results.push(base);
  }
  await recordAudit({
    action: 'shipping.push_system', userId, storeId, featureKey: 'markets',
    target: results.map((r) => r.name).join(', '),
    requestSummary: `Push system shipping → ${results.length} profile`,
    result: results.some((r) => r.error) ? 'error' : 'success',
    errorDetail: results.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`).join('; ') || null,
  });
  return results;
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit 2>&1 | grep -iE "shipping-profiles" | head`
Expected: rỗng.

- [ ] **Step 3: Commit**
```bash
git add features/settings-sync/shipping-profiles-actions.ts
git commit -m "feat(push): preview/apply clean-rebuild bảng giá hệ thống lên profile"
```

---

## Task 8: Route orchestrator + trang sang nguồn hệ thống

**Files:**
- Modify: `features/carrier-rates/push-orchestrator.ts`
- Modify: `app/(dashboard)/f/functions/manual-shipping-rates/page.tsx`

- [ ] **Step 1: Orchestrator dùng nguồn hệ thống**

Trong `features/carrier-rates/push-orchestrator.ts`, đổi import + nhánh zone/manual:
```ts
import { previewSystemShippingToProfiles, applySystemShippingToProfiles, listShippingProfiles } from '@/features/settings-sync/shipping-profiles-actions';
```
Thay khối nhánh manual (dòng ~26-38) bằng:
```ts
      // 1) Clean-rebuild bảng giá HỆ THỐNG (zone kết hợp + tên rate gộp). Lọc carrier
      //    nguồn theo prefix (FedEx IP / DHL Express). Khi không chọn manual nào →
      //    plan.manualSourcePrefixes rỗng → systemTree giữ CẢ 2 carrier (đủ rate cho zone).
      if (plan.manualSourcePrefixes.length > 0) {
        const profiles = await listShippingProfiles(storeId);
        const ids = profiles.map((p) => p.profileId);
        const rows = input.dryRun
          ? await previewSystemShippingToProfiles(storeId, ids, plan.manualSourcePrefixes)
          : await applySystemShippingToProfiles(storeId, ids, plan.manualSourcePrefixes);
        for (const r of rows) {
          res.zoneCreated += r.zonesToCreate;
          res.rateOps += r.rateOps;
          if (r.error) res.errors.push(`${r.name}: ${r.error}`);
        }
      }
```
(Engine giữ nguyên ở khối dưới.)

- [ ] **Step 2: Trang đọc bảng hệ thống**

Trong `app/(dashboard)/f/functions/manual-shipping-rates/page.tsx`:
- Đổi import:
```ts
import { listSystemShipping } from '@/features/markets/system-shipping';
```
- Thay 2 dòng load overrides (dòng ~34-35):
```ts
  const systemRows = await listSystemShipping();
  const markets: MarketZones[] = systemRows.map((r) => ({ marketHandle: r.marketHandle, zones: flattenShippingMatrix(r.shipping) }));
```
(Giữ `activeId`/store selector cho việc chọn store đích khi push.)

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`
Run: `npm run build 2>&1 | tail -3`
Expected: build thành công.

- [ ] **Step 4: Commit**
```bash
git add features/carrier-rates/push-orchestrator.ts "app/(dashboard)/f/functions/manual-shipping-rates/page.tsx"
git commit -m "feat(push): orchestrator + trang dùng nguồn bảng giá hệ thống"
```

---

## Task 9: Seed + dry-run Mirer (vận hành, sau khi deploy migration)

**Files:**
- Create (tạm): `scripts/seed-system-shipping.ts`

> **Lưu ý:** Migration `manual_shipping_config` chỉ tồn tại trên production SAU khi Railway deploy branch này. Task 9 chạy SAU deploy.

- [ ] **Step 1: Script seed + dry-run**

Tạo `scripts/seed-system-shipping.ts`:
```ts
import { db, schema } from '../db/client';
import { eq } from 'drizzle-orm';
import { planSeedRows, mergeSystemShippingRows } from '../features/markets/system-shipping-domain';
import { listOverridesForStore } from '../features/markets/actions';

async function main() {
  const apply = process.argv.includes('--apply');
  const [cici] = await db.select().from(schema.stores).where(eq(schema.stores.shopDomain, 'cici-mean.myshopify.com')).limit(1);
  const rows = planSeedRows(await listOverridesForStore(cici.id));
  console.log(`Seed ${rows.length} market từ cici → manual_shipping_config (apply=${apply})`);
  if (apply) for (const r of rows) {
    const [ex] = await db.select().from(schema.manualShippingConfig).where(eq(schema.manualShippingConfig.marketHandle, r.marketHandle)).limit(1);
    if (ex) await db.update(schema.manualShippingConfig).set({ shipping: r.shipping, version: ex.version + 1, updatedAt: new Date() }).where(eq(schema.manualShippingConfig.marketHandle, r.marketHandle));
    else await db.insert(schema.manualShippingConfig).values({ marketHandle: r.marketHandle, shipping: r.shipping, version: 1 });
  }
  const tree = mergeSystemShippingRows((await db.select().from(schema.manualShippingConfig)).map((x: any) => ({ marketHandle: x.marketHandle, shipping: x.shipping })));
  console.log(`Bảng hệ thống hiện có ${Object.keys(tree.zones).length} zone`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run seed (xem trước, không ghi)**

Run: `npx dotenv -- tsx scripts/seed-system-shipping.ts`
Expected: in `Seed 9 market từ cici …`, `Bảng hệ thống hiện có 0 zone` (chưa apply).

- [ ] **Step 3: Apply seed**

Run: `npx dotenv -- tsx scripts/seed-system-shipping.ts --apply`
Expected: `Bảng hệ thống hiện có ~25 zone`.

- [ ] **Step 4: Xoá script tạm + commit**
```bash
rm scripts/seed-system-shipping.ts
git add -A && git commit -m "chore: seed bảng giá ship hệ thống từ cici (đã chạy)"
```

- [ ] **Step 5: Dry-run push Mirer qua UI**

Vào trang functions/manual-shipping-rates → nút "Đẩy giá ship lên Shopify" → chọn **Mirer** + **Manual FedEx + Manual DHL** → **Dry-run**. Kỳ vọng: `xoá N zone (Zone A–Z cũ) / tạo ~25 zone / K rate > 0`. Kiểm số liệu hợp lý trước khi Apply.

---

## Tự kiểm (sau khi viết plan)

- **Spec coverage:** §4.1 bảng→Task 1; §4.2 seed/đọc/tree→Task 5,6; §4.3 normalize→Task 2; §4.4 clean-rebuild→Task 4; §4.5 push+lọc prefix→Task 3,7,8; §4.6 trang→Task 8; seed+Mirer→Task 9. ✅ phủ hết.
- **Type nhất quán:** `SystemShippingRow {marketHandle, shipping}` dùng đồng nhất Task 5/6; `buildCleanRebuildVariables(current, systemTree, lgId)` khớp Task 4↔7; `manualSourcePrefixes`/`filterTreeByRatePrefixes` khớp Task 3↔7↔8; `ProfilePushResult` tái dùng từ file sẵn có.
- **Placeholder:** không còn — mọi step có code/lệnh cụ thể.
