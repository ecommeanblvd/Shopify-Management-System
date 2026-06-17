# Unified Push to Shopify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Gộp 3 nút push (engine / bật carrier / đẩy giá ship) → 1 nút "⚡ Đẩy giá ship lên Shopify": chọn nhiều store + 4 nguồn rate (FedEx/DHL engine, Manual FedEx/DHL), tự đồng bộ zone rồi đẩy rate, tự đăng ký engine.

**Architecture:** Một orchestrator action điều phối action có sẵn (`applyShippingToProfiles` mở rộng để lọc rate theo tên + additive, `pushCarrierRates` cho engine, tự `registerCarrierService`). Manual per-carrier dùng cách AN TOÀN: lọc effective tree còn rate được chọn + **bỏ mọi delete (additive)** → không xoá rate carrier kia. Phần mapping nguồn→kế hoạch là hàm thuần, test được.

**Tech:** Next.js, TypeScript, Drizzle, React, Vitest. **Spec:** `docs/superpowers/specs/2026-06-17-unified-push-to-shopify-design.md`.

**Quy ước nguồn:** `manual_fedex`↔rate "Standard shipping", `manual_dhl`↔"Express shipping", `fedex_engine`↔carrier 'fedex', `dhl_engine`↔'dhl'. KHÔNG đổi tên rate.

---

## File Structure
- Create `features/carrier-rates/push-plan.ts` (+ test): hàm thuần `planPush(sources)` + `filterTreeByRateNames(tree, names)`.
- Modify `features/settings-sync/domain/shipping.ts`: export `filterTreeByRateNames` HOẶC đặt ở push-plan (đặt ở push-plan, import type ShippingTree).
- Modify `features/settings-sync/shipping-profiles-actions.ts`: thêm tham số `opts?: { rateNames?: string[]; additive?: boolean }` cho preview/apply (lọc tree + bỏ delete).
- Create `features/carrier-rates/push-orchestrator.ts` (+ test cho phần thuần đã tách): action `pushShippingToStores`.
- Create `components/functions/PushToShopify.tsx`; modify `app/(dashboard)/f/functions/manual-shipping-rates/page.tsx` (thay 3 component).

---

## Task 1: Hàm thuần planPush + filterTreeByRateNames

**Files:** Create `features/carrier-rates/push-plan.ts` + `features/carrier-rates/push-plan.test.ts`.

- [ ] **Step 1: Test** `features/carrier-rates/push-plan.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { planPush, filterTreeByRateNames, type PushSource } from './push-plan';

describe('planPush', () => {
  it('map nguồn → rate name manual + carrier engine', () => {
    const p = planPush(['fedex_engine', 'manual_fedex'] as PushSource[]);
    expect(p.engineCarriers).toEqual(['fedex']);
    expect(p.manualRateNames).toEqual(['Standard shipping']);
    expect(p.needsZoneSync).toBe(true);
  });
  it('manual DHL → Express shipping; DHL engine → dhl', () => {
    const p = planPush(['dhl_engine', 'manual_dhl'] as PushSource[]);
    expect(p.engineCarriers).toEqual(['dhl']);
    expect(p.manualRateNames).toEqual(['Express shipping']);
  });
  it('chỉ engine (không manual) → manualRateNames rỗng, vẫn needsZoneSync (zone-only)', () => {
    const p = planPush(['fedex_engine'] as PushSource[]);
    expect(p.manualRateNames).toEqual([]);
    expect(p.engineCarriers).toEqual(['fedex']);
    expect(p.needsZoneSync).toBe(true);
  });
  it('rỗng → không cần gì', () => {
    const p = planPush([]);
    expect(p.needsZoneSync).toBe(false);
    expect(p.engineCarriers).toEqual([]);
  });
});

describe('filterTreeByRateNames', () => {
  const tree = {
    zones: {
      'Zone A': { countries: ['US'], rates: { 'Standard shipping': { type: 'flat', price: 10, currency: 'USD' }, 'Express shipping': { type: 'flat', price: 20, currency: 'USD' } } },
      'Zone B': { countries: ['SG'], rates: { 'Express shipping': { type: 'flat', price: 30, currency: 'USD' } } },
    },
  };
  it('giữ chỉ rate tên được chọn; zone không còn rate → bỏ', () => {
    const out = filterTreeByRateNames(tree as never, ['Standard shipping']);
    expect(Object.keys(out.zones)).toEqual(['Zone A']); // Zone B mất vì chỉ có Express
    expect(Object.keys(out.zones['Zone A'].rates)).toEqual(['Standard shipping']);
  });
  it('names rỗng → zone giữ nguyên countries nhưng rates rỗng (zone-only sync)', () => {
    const out = filterTreeByRateNames(tree as never, []);
    expect(Object.keys(out.zones).sort()).toEqual(['Zone A', 'Zone B']);
    expect(out.zones['Zone A'].rates).toEqual({});
  });
});
```

- [ ] **Step 2: Run** `npx vitest run features/carrier-rates/push-plan.test.ts` → FAIL.

- [ ] **Step 3: Create** `features/carrier-rates/push-plan.ts`:
```typescript
import type { ShippingTree } from '@/features/settings-sync/domain/shipping';

export type PushSource = 'fedex_engine' | 'dhl_engine' | 'manual_fedex' | 'manual_dhl';

const MANUAL_RATE_NAME: Record<string, string> = { manual_fedex: 'Standard shipping', manual_dhl: 'Express shipping' };

export interface PushPlan {
  engineCarriers: string[];   // ['fedex'] | ['dhl'] | both
  manualRateNames: string[];  // ['Standard shipping'] ...
  needsZoneSync: boolean;     // có đẩy gì → cần zone tồn tại
}

export function planPush(sources: PushSource[]): PushPlan {
  const engineCarriers: string[] = [];
  if (sources.includes('fedex_engine')) engineCarriers.push('fedex');
  if (sources.includes('dhl_engine')) engineCarriers.push('dhl');
  const manualRateNames: string[] = [];
  if (sources.includes('manual_fedex')) manualRateNames.push(MANUAL_RATE_NAME.manual_fedex);
  if (sources.includes('manual_dhl')) manualRateNames.push(MANUAL_RATE_NAME.manual_dhl);
  const needsZoneSync = engineCarriers.length > 0 || manualRateNames.length > 0;
  return { engineCarriers, manualRateNames, needsZoneSync };
}

/** Lọc tree còn rate có tên trong `names`. names rỗng → giữ zone nhưng rates rỗng
 *  (đồng bộ zone-only cho engine). Zone không còn rate (khi names≠rỗng) → bỏ. */
export function filterTreeByRateNames(tree: ShippingTree, names: string[]): ShippingTree {
  const keep = new Set(names);
  const zones: ShippingTree['zones'] = {};
  for (const [zoneName, zone] of Object.entries(tree.zones)) {
    if (names.length === 0) { zones[zoneName] = { countries: zone.countries, rates: {} }; continue; }
    const rates: typeof zone.rates = {};
    for (const [rn, r] of Object.entries(zone.rates)) if (keep.has(rn)) rates[rn] = r;
    if (Object.keys(rates).length > 0) zones[zoneName] = { countries: zone.countries, rates };
  }
  return { zones };
}
```

- [ ] **Step 4:** Run → 6 pass. `npx tsc --noEmit 2>&1 | grep -i push-plan` empty.
- [ ] **Step 5:** Commit `git add features/carrier-rates/push-plan.ts features/carrier-rates/push-plan.test.ts && git commit -m "feat(rates): hàm thuần planPush + filterTreeByRateNames"`

---

## Task 2: Manual push hỗ trợ lọc rate + additive

**Files:** Modify `features/settings-sync/shipping-profiles-actions.ts`.

Mục tiêu: `previewShippingToProfiles`/`applyShippingToProfiles` nhận `opts?: { rateNames?: string[]; additive?: boolean }`. Khi có `rateNames` → lọc effective tree bằng `filterTreeByRateNames`. Khi `additive` → diff bỏ `zonesToDelete` + `methodDefinitionsToDelete` (không xoá gì).

- [ ] **Step 1:** Import filter ở đầu file:
```typescript
import { filterTreeByRateNames } from '@/features/carrier-rates/push-plan';
```

- [ ] **Step 2:** Thêm helper (sau `buildStoreShippingTree`):
```typescript
type PushOpts = { rateNames?: string[]; additive?: boolean };

function effectiveFor(tree: ShippingTree, opts?: PushOpts): ShippingTree {
  return opts?.rateNames !== undefined ? filterTreeByRateNames(tree, opts.rateNames) : tree;
}
function stripDeletes<T extends { zonesToDelete: unknown[]; methodDefinitionsToDelete: unknown[] }>(diff: T, additive?: boolean): T {
  if (additive) { diff.zonesToDelete = []; diff.methodDefinitionsToDelete = []; }
  return diff;
}
```

- [ ] **Step 3:** Sửa `previewShippingToProfiles(storeId, profileIds, opts?: PushOpts)`:
  - đổi `const effective = await buildStoreShippingTree(storeId);` → `const effective = effectiveFor(await buildStoreShippingTree(storeId), opts);`
  - Bỏ guard "throw khi zones rỗng" THÀNH: chỉ throw khi `opts?.rateNames === undefined && zones rỗng` (zone-only/filtered có thể rỗng hợp lệ → trả [] thay vì throw). Cụ thể: `if (!opts && Object.keys(effective.zones).length === 0) throw ...`.
  - sau `const diff = denormalizeToMutationInput(p.normalized, effective);` → `stripDeletes(diff, opts?.additive);` trước khi đọc số.

- [ ] **Step 4:** Sửa `applyShippingToProfiles(storeId, profileIds, opts?: PushOpts)` tương tự:
  - `const effective = effectiveFor(await buildStoreShippingTree(storeId), opts);`
  - guard throw chỉ khi `!opts && zones rỗng`.
  - trong vòng lặp: `const diff = stripDeletes(denormalizeToMutationInput(p.normalized, effective), opts?.additive);` rồi `buildProfileUpdateVariables` dùng `effective` (đã lọc). LƯU Ý: `buildProfileUpdateVariables(p.normalized, effective, ...)` cũng phải nhận `effective` ĐÃ LỌC để zone/rate khớp diff. Khi additive, đảm bảo `profile.zonesToDelete`/`methodDefinitionsToDelete` rỗng (vì diff đã bị strip) — kiểm `buildProfileUpdateVariables` có tự suy từ effective không; nếu nó tự tính delete từ so sánh, thì truyền thêm cờ hoặc lọc output. ĐỌC `buildProfileUpdateVariables` trong domain/shipping.ts để xác nhận nó dựng từ diff hay tự so sánh — nếu tự so sánh, thêm tham số `additive` để bỏ delete trong output của nó.

- [ ] **Step 5:** Verify `npx tsc --noEmit 2>&1 | grep -i shipping-profiles` empty. `npx vitest run features/settings-sync` pass (cập nhật test nếu chữ ký đổi — opts optional nên không vỡ).

- [ ] **Step 6:** Commit `git add features/settings-sync/shipping-profiles-actions.ts && git commit -m "feat(shipping): push profile hỗ trợ lọc rate theo tên + additive (không xoá carrier kia)"`

---

## Task 3: Orchestrator pushShippingToStores

**Files:** Create `features/carrier-rates/push-orchestrator.ts`.

- [ ] **Step 1:** Create `features/carrier-rates/push-orchestrator.ts`:
```typescript
'use server';

import { planPush, type PushSource } from './push-plan';
import { previewShippingToProfiles, applyShippingToProfiles, listShippingProfiles } from '@/features/settings-sync/shipping-profiles-actions';
import { pushCarrierRates } from './push-engine/actions';

export interface PushStoreResult {
  storeId: string;
  zoneCreated: number;
  rateOps: number;
  engineZones: number;
  errors: string[];
}

export async function pushShippingToStores(
  input: { storeIds: string[]; sources: PushSource[]; dryRun: boolean },
): Promise<PushStoreResult[]> {
  const plan = planPush(input.sources);
  const out: PushStoreResult[] = [];
  for (const storeId of input.storeIds) {
    const res: PushStoreResult = { storeId, zoneCreated: 0, rateOps: 0, engineZones: 0, errors: [] };
    try {
      // 1) Zone + manual (additive, lọc theo nguồn). Cần khi có manual HOẶC engine
      //    (engine cần zone tồn tại → đẩy zone-only rateNames=[]).
      if (plan.needsZoneSync) {
        const profiles = await listShippingProfiles(storeId);
        const ids = profiles.map((p) => p.profileId);
        const opts = { rateNames: plan.manualRateNames, additive: true };
        const rows = input.dryRun
          ? await previewShippingToProfiles(storeId, ids, opts)
          : await applyShippingToProfiles(storeId, ids, opts);
        for (const r of rows) {
          res.zoneCreated += r.zonesToCreate;
          res.rateOps += r.rateOps;
          if (r.error) res.errors.push(`${r.name}: ${r.error}`);
        }
      }
      // 2) Engine (tự đăng ký CarrierService khi apply)
      if (plan.engineCarriers.length) {
        const r = await pushCarrierRates({ storeId, carriers: plan.engineCarriers, withBackup: false, dryRun: input.dryRun });
        res.engineZones = r.zonesTargeted;
      }
    } catch (e) {
      res.errors.push((e as Error).message);
    }
    out.push(res);
  }
  return out;
}
```
(ĐỌC chữ ký `pushCarrierRates`/`PushCarrierResult` để khớp tên field `zonesTargeted`. ĐỌC `listShippingProfiles` trả `ProfileInfo[]` — đúng.)

- [ ] **Step 2:** Verify `npx tsc --noEmit 2>&1 | grep -i push-orchestrator` empty.

- [ ] **Step 3:** Smoke dry-run (read-only) qua script tạm 1 store với sources=['manual_fedex','fedex_engine'] → in PushStoreResult; xoá script. (Không bắt buộc nếu tsc sạch + Task 4 verify trên UI.)

- [ ] **Step 4:** Commit `git add features/carrier-rates/push-orchestrator.ts && git commit -m "feat(rates): orchestrator pushShippingToStores (zone→manual→engine, multi-store)"`

---

## Task 4: UI PushToShopify + thay 3 nút

**Files:** Create `components/functions/PushToShopify.tsx`; Modify `app/(dashboard)/f/functions/manual-shipping-rates/page.tsx`.

- [ ] **Step 1:** Create `components/functions/PushToShopify.tsx` (client). Props: `stores: {id,name}[]`, `onPush: (input) => Promise<PushStoreResult[]>`. State: `selectedStores: Set<string>`, `sources: Set<PushSource>`, `preview/applied: PushStoreResult[]|null`, `busy`. Dialog:
  - Mục 1: list store với checkbox (tick nhiều).
  - Mục 2: 4 checkbox nguồn (FedEx engine / DHL engine / Manual FedEx / Manual DHL) — ghi chú tên "Standard/Express shipping".
  - Nút **Dry-run** (gọi onPush dryRun:true → set preview) và **Apply** (dryRun:false → set applied), disabled khi `selectedStores.size===0 || sources.size===0 || busy`.
  - Hiện kết quả per-store: `store: +N zone · M rate · engine K zone · [lỗi nếu có]`.
  Dùng `@/components/ui/dialog` như `ShippingProfilePush`/`PushCarrierRates` (đọc 1 file để theo style).

- [ ] **Step 2:** `page.tsx`: bỏ import + render `PushCarrierRates`, `CarrierServiceRegister`, `ShippingProfilePush`; thêm:
```tsx
import { PushToShopify } from '@/components/functions/PushToShopify';
import { pushShippingToStores } from '@/features/carrier-rates/push-orchestrator';
// trong header actions (canApply && stores.length>0):
<PushToShopify stores={stores.map((s) => ({ id: s.id, name: s.name }))} onPush={pushShippingToStores} />
```
Xoá các import/biến không còn dùng (listShippingProfiles/previewShippingToProfiles/applyShippingToProfiles/registerCarrierService/pushCarrierRates imports ở page nếu không còn tham chiếu). Giữ ZoneReferenceTable. KHÔNG xoá file component cũ (PushCarrierRates… có thể dùng nơi khác — kiểm `grep -rl` trước khi xoá; nếu không nơi nào dùng, xoá file + để gọn).

- [ ] **Step 3:** Verify `npx tsc --noEmit 2>&1 | grep -iE "PushToShopify|manual-shipping"` empty; `npx eslint` 2 file → 0 error; `npm run build` chạy hết.

- [ ] **Step 4:** Commit `git add components/functions/PushToShopify.tsx "app/(dashboard)/f/functions/manual-shipping-rates/page.tsx" && git commit -m "feat(rates): 1 nút 'Đẩy giá ship lên Shopify' thay 3 nút, multi-store + 4 nguồn rate"`

---

## Self-Review
- Spec §3 (1 nút, multi-store, 4 nguồn, zone tự sync, engine tự đăng ký, giữ tên) ↔ Task 1 (plan/filter) + Task 2 (lọc+additive) + Task 3 (orchestrator) + Task 4 (UI). ✓
- Spec §4 (manual theo tên Standard/Express) ↔ Task 1 MANUAL_RATE_NAME + Task 2 filter. ✓
- Spec §7 edge (1 store lỗi không chặn) ↔ Task 3 per-store try/catch. ✓
- Rủi ro xoá carrier kia ↔ additive (stripDeletes) trong Task 2. ✓
- KHÔNG đổi tên rate (chỉ filter theo tên, không rename). ✓
