# GoGreen DHL stepFloor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps dùng checkbox (`- [ ]`).

**Goal:** Engine hỗ trợ `stepFloorKg` cho per_step_fixed (dưới ngưỡng → phẳng 1 bước; từ ngưỡng → ceil-step); set DHL GoGreen 2 giai đoạn (trước 29/9/2025 phẳng <2kg, sau nhảy hết).

**Architecture:** Thêm cột `step_floor_kg`; SurchargeSnap + loader; sửa công thức perStep; TDD qua `quote()`. Rồi script tách dòng config 2025.

**Tech Stack:** TypeScript, Drizzle/Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-dhl-gogreen-step-floor-design.md`

---

### Task 1: Schema cột + migration + engine stepFloor + TDD

**Files:**
- Modify: `db/schema.ts` (carrierSurcharges)
- Create: `scripts/migrate-surcharge-step-floor.ts`
- Modify: `features/carrier-rates/engine/quote.ts` (SurchargeSnap + perStep)
- Modify: `features/carrier-rates/engine/load.ts` (map stepFloorKg)
- Test: `features/carrier-rates/engine/quote.test.ts`

- [ ] **Step 1: Schema** — trong `carrierSurcharges` (cạnh `stepKg`, dòng ~449) thêm:
```ts
  // Ngưỡng cân (kg) cho per_step_fixed: cân < step_floor_kg → tính 1 bước phẳng
  // (value); cân ≥ ngưỡng → ceil(cân/step_kg)×value. NULL = luôn nhảy bước.
  // Dùng cho DHL GoGreen trước 29/9/2025 (0–1.5kg phẳng 1.900, từ 2kg nhảy).
  stepFloorKg: numeric('step_floor_kg', { precision: 10, scale: 3 }),
```

- [ ] **Step 2: Migration `scripts/migrate-surcharge-step-floor.ts`**
```ts
/** Thêm cột step_floor_kg cho carrier_surcharges. Chạy: dotenv -- tsx scripts/migrate-surcharge-step-floor.ts */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
async function main() {
  await db.execute(sql`ALTER TABLE carrier_surcharges ADD COLUMN IF NOT EXISTS step_floor_kg numeric(10,3)`);
  console.log('OK: carrier_surcharges thêm step_floor_kg.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
(KHÔNG chạy ở task này.)

- [ ] **Step 3: Test (fail trước)** — READ `quote.test.ts` quanh `describe('per_step_fixed surcharge'` (~696) để khớp cách dựng snapshot + input. Thêm describe mới (dùng đúng helper dựng snapshot của file, chỉ minh hoạ surcharge + weight):
```ts
  describe('per_step_fixed stepFloorKg (DHL GoGreen 2 giai đoạn)', () => {
    const gg = (extra: Record<string, unknown>) =>
      ({ kind: 'per_step_fixed', value: 1_900, stepKg: 0.5, active: true, ...extra });

    it('stepFloorKg=2.0 (CŨ): <2kg phẳng 1.900, ≥2kg nhảy', () => {
      const at = (w: number) => quoteWith([gg({ stepFloorKg: 2.0 })], w).breakdown.perStep;
      expect(at(0.5)).toBe(1_900);
      expect(at(1.0)).toBe(1_900);
      expect(at(1.5)).toBe(1_900);
      expect(at(2.0)).toBe(7_600);
      expect(at(2.5)).toBe(9_500);
    });
    it('stepFloorKg=null (MỚI): nhảy hết', () => {
      const at = (w: number) => quoteWith([gg({ stepFloorKg: null })], w).breakdown.perStep;
      expect(at(0.5)).toBe(1_900);
      expect(at(1.0)).toBe(3_800);
      expect(at(1.5)).toBe(5_700);
      expect(at(2.0)).toBe(7_600);
    });
    it('không có stepFloorKg → như null (nhảy)', () => {
      expect(quoteWith([gg({})], 1.0).breakdown.perStep).toBe(3_800);
    });
  });
```
**LƯU Ý:** `quoteWith(surcharges, weightKg)` là helper minh hoạ — thay bằng đúng cách file test gọi `quote()` (dựng `snap` với weightTiers/zones tối thiểu + `quote(snap, { destinationCountry, weightKg, ... })`). Bảo đảm weight truyền vào cho ra chargeable = chính nó (đã là bội 0.5). Đọc test 697-732 để copy khung.
Run `npx vitest run features/carrier-rates/engine/quote.test.ts` → 2 case mới FAIL (stepFloorKg chưa xử lý → CŨ trả 3.800 thay vì 1.900).

- [ ] **Step 4: SurchargeSnap** (quote.ts, cạnh `stepKg?`):
```ts
  /** Ngưỡng cân cho per_step_fixed: cân < stepFloorKg → 1 bước phẳng; ≥ → ceil-step. */
  stepFloorKg?: number | null;
```

- [ ] **Step 5: Loader** (`load.ts`, trong `surcharges.map`, cạnh `stepKg:` dòng ~131):
```ts
      stepFloorKg: s.stepFloorKg !== null ? Number(s.stepFloorKg) : null,
```

- [ ] **Step 6: Engine perStep** (quote.ts ~660) — đổi reduce:
```ts
  const perStep = snap.surcharges
    .filter((s) => isApplicable(s, effectiveDate) && s.kind === 'per_step_fixed')
    .filter((s) => s.stepKg && s.stepKg > 0)
    .reduce((sum, s) => {
      const steps = (s.stepFloorKg != null && chargeableWeightKg < s.stepFloorKg)
        ? 1
        : Math.ceil(chargeableWeightKg / s.stepKg!);
      return sum + steps * s.value;
    }, 0);
```

- [ ] **Step 7:** `npx vitest run features/carrier-rates/engine/quote.test.ts` → PASS (cả test cũ). `npx tsc --noEmit` sạch.

- [ ] **Step 8: Commit**
```bash
git add db/schema.ts scripts/migrate-surcharge-step-floor.ts features/carrier-rates/engine/quote.ts features/carrier-rates/engine/load.ts features/carrier-rates/engine/quote.test.ts
git commit -m "feat(carrier-rates): per_step_fixed stepFloorKg (DHL GoGreen <ngưỡng phẳng, ≥ nhảy bước) + TDD"
```

---

### Task 2: Migration cột + tách config 2025 + apply + verify + push

**Files:**
- Create: `scripts/migrate-dhl-gogreen-stepfloor-2025.ts`
- Run: `scripts/migrate-surcharge-step-floor.ts`, script tách config

- [ ] **Step 1: Script tách `scripts/migrate-dhl-gogreen-stepfloor-2025.ts`**
```ts
/**
 * Tách dòng GoGreen DHL 2025 thành 2 giai đoạn:
 *   2025-01-01 → 2025-09-29 : stepFloorKg=2.0 (CŨ — <2kg phẳng 1.900)
 *   2025-09-29 → 2026-01-01 : stepFloorKg=null (MỚI — nhảy hết)
 * Dòng 2026 giữ nguyên. Idempotent.
 * Chạy: dotenv -- tsx scripts/migrate-dhl-gogreen-stepfloor-2025.ts [--apply]
 */
import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const SPLIT = new Date(Date.UTC(2025, 8, 29)); // 2025-09-29

async function main() {
  const apply = process.argv.includes('--apply');
  const acct = await db.select({ id: schema.carrierAccounts.id, key: schema.carriers.key })
    .from(schema.carrierAccounts).leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true));
  const dhl = acct.find((a) => a.key === 'dhl');
  if (!dhl) throw new Error('Không tìm thấy DHL account.');

  // Dòng GoGreen 2025 gốc: per_step_fixed, starts 2025-01-01, ends 2026-01-01.
  const rows = await db.select().from(schema.carrierSurcharges).where(and(
    eq(schema.carrierSurcharges.carrierAccountId, dhl.id),
    eq(schema.carrierSurcharges.kind, 'per_step_fixed'),
  ));
  const orig = rows.find((r) => r.startsAt && r.startsAt.getUTCFullYear() === 2025
    && r.endsAt && r.endsAt.getUTCFullYear() === 2026 && r.endsAt.getUTCMonth() === 0);
  if (!orig) { console.log('Không thấy dòng GoGreen 2025 (2025-01-01→2026-01-01) — có thể đã tách. Bỏ qua.'); process.exit(0); }

  // Idempotent: đã có dòng ends 2025-09-29 ?
  const already = rows.some((r) => r.endsAt && r.endsAt.getTime() === SPLIT.getTime());
  if (already) { console.log('ĐÃ tách (có dòng ends 2025-09-29). Bỏ qua.'); process.exit(0); }

  console.log('Dòng gốc 2025:', orig.id, '| value', orig.value, '| stepKg', orig.stepKg);
  console.log('SẼ: rút ngắn dòng gốc về ends 2025-09-29 + set stepFloorKg=2.0; thêm dòng 2025-09-29→2026-01-01 stepFloorKg=null.');

  if (!apply) { console.log('\n⚠ DRY RUN — chưa ghi.'); process.exit(0); }

  await db.transaction(async (tx) => {
    // CŨ: dòng gốc → ends 2025-09-29, stepFloorKg=2.0
    await tx.update(schema.carrierSurcharges)
      .set({ endsAt: SPLIT, stepFloorKg: '2.000', note: 'GoGreen Plus (SAF) 1.900/0.5kg — CŨ: 0–1.5kg phẳng, từ 2kg nhảy (stepFloor 2.0). Đến 29/9/2025.' })
      .where(eq(schema.carrierSurcharges.id, orig.id));
    // MỚI: 2025-09-29 → 2026-01-01, stepFloorKg=null
    await tx.insert(schema.carrierSurcharges).values({
      carrierAccountId: dhl.id, kind: 'per_step_fixed', value: orig.value, stepKg: orig.stepKg,
      stepFloorKg: null, active: true, startsAt: SPLIT, endsAt: new Date(Date.UTC(2026, 0, 1)),
      applyMode: 'always', note: 'GoGreen Plus (SAF) 1.900/0.5kg — MỚI: nhảy bước mọi cân từ 29/9/2025.',
    });
  });
  console.log('✅ ĐÃ tách config GoGreen DHL 2025.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Chạy migration cột (prod)**
```bash
dotenv -- npx tsx scripts/migrate-surcharge-step-floor.ts
```
Kỳ vọng "OK: carrier_surcharges thêm step_floor_kg."

- [ ] **Step 3: Dry-run rồi apply config split**
```bash
dotenv -- npx tsx scripts/migrate-dhl-gogreen-stepfloor-2025.ts
dotenv -- npx tsx scripts/migrate-dhl-gogreen-stepfloor-2025.ts --apply
```

- [ ] **Step 4: Verify engine theo ngày** — quote pack DHL 1.0kg:
```bash
dotenv -- npx tsx -e "import {loadAccountSnapshot} from '@/features/carrier-rates/engine/load'; import {quote} from '@/features/carrier-rates/engine/quote'; (async()=>{const a='<DHL_ACCT>'; for(const ds of ['2025-08-01','2025-10-01']){const d=new Date(ds+'T00:00:00Z'); const s=await loadAccountSnapshot(a,d); const q=quote(s!,{destinationCountry:'SA',weightKg:1.0,effectiveDate:d} as any); console.log(ds,'GoGreen perStep:',(q.breakdown as any).perStep);} process.exit(0)})()"
```
Kỳ vọng: 2025-08-01 → 1.900 (CŨ phẳng); 2025-10-01 → 3.800 (MỚI nhảy). (Lấy DHL account id qua query.)

- [ ] **Step 5: Tổng kiểm** `npx tsc --noEmit && npx vitest run && npx eslint . && npx next build` xanh.

- [ ] **Step 6: Commit + push**
```bash
git add scripts/migrate-dhl-gogreen-stepfloor-2025.ts
git commit -m "feat(carrier-rates): tách config GoGreen DHL 2025 (CŨ stepFloor 2.0 → 29/9, MỚI nhảy hết)"
git push origin main
```

---

## Self-Review
- **Spec coverage:** §1 schema→T1; §2 engine→T1; §3 config→T2; §4 test→T1; §5 verify→T2. Đủ.
- **Type consistency:** `stepFloorKg` (schema/SurchargeSnap/loader/perStep), split dates nhất quán.
- **Placeholder scan:** `quoteWith`/`<DHL_ACCT>` là chỗ implementer thay bằng pattern thật của file test / account id thật — đã ghi rõ.
