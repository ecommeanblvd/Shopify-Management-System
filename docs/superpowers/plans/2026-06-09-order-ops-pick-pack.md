# Pick/Pack Enhanced (Sub-project D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the blind pack/ship status flips into a real packing workflow — group `picked` lines into packs (reusing the `shipments` table; PK code via a DB sequence), a separate mandatory Check-Packed step, then ship each pack by tracking number.

**Architecture:** A "pack" is a `shipments` row (`logUniqueCode` = `PK-<seq>`), with order lines assigned via `orderFulfillmentLines.shipmentId`. New server actions (`createPack`, `markCheckPacked`, `shipPack`) drive the `picked → packed → shipped` line transitions inside transactions, reusing Phase 1's `rollupOrderStatus`. A new `fulfillment.pack_check` permission gates the check step. Pack data (carrier/dims/weight) feeds the existing carrier-rate + reconcile pipeline.

**Tech Stack:** Next.js App Router (server components + actions), Drizzle ORM + Postgres (incl. a raw sequence), Vitest, existing RBAC.

---

## File Structure

- `db/schema.ts` — add `checkPackedBy` + `checkPackedAt` to `shipments` (MODIFY) + migration (CREATE; adds the 2 columns and a `pack_code_seq` sequence).
- `lib/auth/{permissions.ts,rbac.ts,permission-map.ts}` — `fulfillment.pack_check` scope + `view_pack_check`/`check_packed` legacy perms (MODIFY).
- `features/packing/logic.ts` + `logic.test.ts` — pure `canShipPack` + `validatePackDims` (CREATE).
- `features/packing/queries.ts` — `listPacksForOrder`, `pickedUnassignedLines` (CREATE).
- `features/packing/actions.ts` — `createPack`, `markCheckPacked`, `shipPack` (CREATE).
- `components/fulfillment/PackPanel.tsx` — pack-building + per-pack check/ship UI (CREATE).
- `app/(dashboard)/f/fulfillment/[orderId]/page.tsx` — load packs + render PackPanel (MODIFY).
- `components/fulfillment/OrderDetailPanel.tsx` — drop the blind packed/shipped buttons; keep pick (MODIFY).

---

## Task 1: Schema — check-packed columns + pack code sequence

**Files:**
- Modify: `db/schema.ts`

- [ ] **Step 1: Add the two columns to `shipments`**

In `db/schema.ts`, in the `shipments` table definition, add these two columns just before `createdAt` (after the `note` column):

```ts
  checkPackedBy: text('check_packed_by').references(() => user.id, { onDelete: 'set null' }),
  checkPackedAt: timestamp('check_packed_at'),
```

`text`, `timestamp`, `user` are already imported/in scope. Verify.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new `db/migrations/00XX_*.sql` (e.g. 0045) with `ALTER TABLE "shipments" ADD COLUMN "check_packed_by" ...` and `... "check_packed_at" ...` plus the FK.

- [ ] **Step 4: Append the pack-code sequence to that migration**

Open the migration file generated in Step 3 and append at the end (drizzle does not model standalone sequences; this raw statement is applied by `drizzle-kit migrate` and ignored by future `db:generate` diffs):

```sql
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "pack_code_seq" START WITH 100000;
```

(Start at 100000 — above the legacy `PK-…` range (~20k) in `logUniqueCode` — so app-generated pack codes never collide with imported ones.)

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations
git commit -m "feat(packing): shipments check-packed columns + pack_code_seq"
```

---

## Task 2: Permissions — fulfillment.pack_check

**Files:**
- Modify: `lib/auth/permissions.ts`, `lib/auth/rbac.ts`, `lib/auth/permission-map.ts`

- [ ] **Step 1: Add the scope to CATALOG**

In `lib/auth/permissions.ts`, in `CATALOG`, add after the `fulfillment.warehouse` entry:

```ts
  { key: 'fulfillment.pack_check', label: 'Vận hành — kiểm tra đóng gói', actions: ['view', 'create'] },
```

- [ ] **Step 2: Add Permission union members**

In `lib/auth/rbac.ts`, in the `Permission` union, add after `'manage_warehouse'`:

```ts
  | 'view_pack_check'
  | 'check_packed'
```

- [ ] **Step 3: Map legacy → new + grant operator**

In `lib/auth/permission-map.ts`, add to `OLD_TO_NEW` (after the `manage_warehouse` line):

```ts
  view_pack_check: ['fulfillment.pack_check:view'],
  check_packed: ['fulfillment.pack_check:view', 'fulfillment.pack_check:create'],
```

Then add `'view_pack_check', 'check_packed'` to the end of `OPERATOR_OLD`. (Admin gets all via `allPermissionKeys()`.)

- [ ] **Step 4: Typecheck + RBAC tests**

Run: `npm run typecheck && npx vitest run lib/auth lib/nav.test.ts`
Expected: PASS (existing tests green; admin gets the new keys via `allPermissionKeys()`, operator via expanded `OPERATOR_OLD`).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/permissions.ts lib/auth/rbac.ts lib/auth/permission-map.ts
git commit -m "feat(packing): fulfillment.pack_check permission"
```

---

## Task 3: Pure packing logic + tests

**Files:**
- Create: `features/packing/logic.ts`
- Test: `features/packing/logic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `features/packing/logic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canShipPack, validatePackDims } from './logic';

describe('canShipPack', () => {
  it('blocks when not check-packed', () => {
    const r = canShipPack({ checkPackedAt: null, lineCount: 2 });
    expect(r.ok).toBe(false);
  });
  it('blocks when no lines', () => {
    const r = canShipPack({ checkPackedAt: new Date('2026-01-01'), lineCount: 0 });
    expect(r.ok).toBe(false);
  });
  it('allows when check-packed and has lines', () => {
    expect(canShipPack({ checkPackedAt: new Date('2026-01-01'), lineCount: 1 })).toEqual({ ok: true });
  });
});

describe('validatePackDims', () => {
  it('allows all-empty (dims optional)', () => {
    expect(validatePackDims({}).ok).toBe(true);
  });
  it('allows positive values', () => {
    expect(validatePackDims({ lengthCm: 10, widthCm: 5, heightCm: 3, weightKg: 1.2 }).ok).toBe(true);
  });
  it('rejects a non-positive provided value', () => {
    expect(validatePackDims({ weightKg: 0 }).ok).toBe(false);
    expect(validatePackDims({ lengthCm: -1 }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/packing/logic.test.ts`
Expected: FAIL — cannot resolve `./logic`.

- [ ] **Step 3: Implement the pure logic**

Create `features/packing/logic.ts`:

```ts
/** Pure packing logic — no DB. Ship gate + dimension validation. */

export interface ShipGateInput { checkPackedAt: Date | null; lineCount: number; }

/** A pack may ship only after it is check-packed and has at least one line. */
export function canShipPack(input: ShipGateInput): { ok: true } | { ok: false; error: string } {
  if (input.lineCount <= 0) return { ok: false, error: 'Kiện chưa có dòng nào' };
  if (input.checkPackedAt == null) return { ok: false, error: 'Kiện chưa được check-packed' };
  return { ok: true };
}

export interface PackDimsInput { lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null; weightKg?: number | null; }

/** Dimensions/weight are optional, but any provided value must be > 0. */
export function validatePackDims(input: PackDimsInput): { ok: true } | { ok: false; error: string } {
  const fields: [string, number | null | undefined][] = [
    ['Dài', input.lengthCm], ['Rộng', input.widthCm], ['Cao', input.heightCm], ['Cân nặng', input.weightKg],
  ];
  for (const [label, v] of fields) {
    if (v != null && !(v > 0)) return { ok: false, error: `${label} phải lớn hơn 0` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/packing/logic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/packing/logic.ts features/packing/logic.test.ts
git commit -m "feat(packing): pure ship-gate + dims validation with tests"
```

---

## Task 4: Queries

**Files:**
- Create: `features/packing/queries.ts`

- [ ] **Step 1: Implement**

Create `features/packing/queries.ts`:

```ts
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/** Picked lines of an order not yet assigned to any pack. */
export async function pickedUnassignedLines(orderId: string) {
  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) return [];
  return db.select({
    id: schema.orderFulfillmentLines.id,
    sku: schema.orderFulfillmentLines.sku,
    qty: schema.orderFulfillmentLines.qty,
    productTitle: schema.shopifyOrderLines.productTitle,
    variantTitle: schema.shopifyOrderLines.variantTitle,
  })
    .from(schema.orderFulfillmentLines)
    .leftJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId))
    .where(and(
      eq(schema.orderFulfillmentLines.fulfillmentId, ful.id),
      eq(schema.orderFulfillmentLines.status, 'picked'),
      isNull(schema.orderFulfillmentLines.shipmentId),
    ));
}

/** Packs (shipments) for an order, each with its assigned lines. */
export async function listPacksForOrder(orderId: string) {
  const packs = await db.select({
    id: schema.shipments.id,
    code: schema.shipments.logUniqueCode,
    carrierKey: schema.shipments.carrierKey,
    packagingType: schema.shipments.packagingType,
    dimLengthCm: schema.shipments.dimLengthCm,
    dimWidthCm: schema.shipments.dimWidthCm,
    dimHeightCm: schema.shipments.dimHeightCm,
    actualWeightKg: schema.shipments.actualWeightKg,
    originHub: schema.shipments.originHub,
    trackingNumber: schema.shipments.trackingNumber,
    checkPackedAt: schema.shipments.checkPackedAt,
    labelCreatedAt: schema.shipments.labelCreatedAt,
  })
    .from(schema.shipments)
    .where(eq(schema.shipments.orderId, orderId))
    .orderBy(schema.shipments.createdAt);

  if (packs.length === 0) return [];

  const lines = await db.select({
    id: schema.orderFulfillmentLines.id,
    shipmentId: schema.orderFulfillmentLines.shipmentId,
    sku: schema.orderFulfillmentLines.sku,
    qty: schema.orderFulfillmentLines.qty,
    status: schema.orderFulfillmentLines.status,
    productTitle: schema.shopifyOrderLines.productTitle,
  })
    .from(schema.orderFulfillmentLines)
    .leftJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId))
    .where(inArray(schema.orderFulfillmentLines.shipmentId, packs.map((p) => p.id)));

  return packs.map((p) => ({ ...p, lines: lines.filter((l) => l.shipmentId === p.id) }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Verify field names against `db/schema.ts`: `shipments.{logUniqueCode,carrierKey,packagingType,dimLengthCm,dimWidthCm,dimHeightCm,actualWeightKg,originHub,trackingNumber,labelCreatedAt,checkPackedAt,createdAt}`, `orderFulfillmentLines.{shipmentId,status,sku,qty}`.)

- [ ] **Step 3: Commit**

```bash
git add features/packing/queries.ts
git commit -m "feat(packing): picked-unassigned + packs-for-order queries"
```

---

## Task 5: Server actions

**Files:**
- Create: `features/packing/actions.ts`

- [ ] **Step 1: Implement**

Create `features/packing/actions.ts`:

```ts
'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { rollupOrderStatus, type LineStatus } from '@/features/fulfillment/logic';
import { recordAudit } from '@/lib/logging/audit';
import { canShipPack, validatePackDims } from './logic';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function requirePerm(perm: Permission): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}

async function recomputeRollup(tx: Tx, fulfillmentId: string): Promise<void> {
  const lines = await tx.select({ status: schema.orderFulfillmentLines.status })
    .from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, fulfillmentId));
  const status = rollupOrderStatus(lines.map((l) => l.status as LineStatus));
  await tx.update(schema.orderFulfillment).set({ status, updatedAt: sql`now()` })
    .where(eq(schema.orderFulfillment.id, fulfillmentId));
}

const num = (v: number | null | undefined) => (v == null ? null : String(v));

export interface CreatePackInput {
  orderId: string;
  lineIds: string[];
  carrierKey?: string | null;
  packagingType?: 'bag' | 'box' | null;
  lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null; weightKg?: number | null;
  originHub?: string | null;
}

/** Create a pack (shipment) from picked lines of an order; assigns them and
 *  moves each to 'packed'. Returns the pack id. */
export async function createPack(input: CreatePackInput): Promise<string> {
  const userId = await requirePerm('manage_fulfillment');
  const dims = validatePackDims(input);
  if (!dims.ok) throw new Error(dims.error);
  if (input.lineIds.length === 0) throw new Error('Chưa chọn dòng nào');

  const packId = await db.transaction(async (tx) => {
    const [ful] = await tx.select({ id: schema.orderFulfillment.id })
      .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, input.orderId)).limit(1);
    if (!ful) throw new Error('No fulfillment record');

    // Only this order's picked, unassigned lines may be packed.
    const lines = await tx.select().from(schema.orderFulfillmentLines)
      .where(and(
        eq(schema.orderFulfillmentLines.fulfillmentId, ful.id),
        inArray(schema.orderFulfillmentLines.id, input.lineIds),
      ));
    const packable = lines.filter((l) => l.status === 'picked' && l.shipmentId == null);
    if (packable.length === 0) throw new Error('Không có dòng picked hợp lệ để đóng kiện');

    // drizzle node-postgres returns a pg QueryResult ({ rows }); some adapters
    // return the array directly. Handle both shapes.
    const seqRes = await tx.execute(sql`SELECT nextval('pack_code_seq')::bigint AS seq`);
    const seqRows = ((seqRes as { rows?: Array<{ seq: string }> }).rows ?? (seqRes as unknown as Array<{ seq: string }>));
    const code = `PK-${seqRows[0].seq}`;

    const [pack] = await tx.insert(schema.shipments).values({
      orderId: input.orderId,
      logUniqueCode: code,
      carrierKey: input.carrierKey?.trim() || null,
      packagingType: input.packagingType ?? null,
      dimLengthCm: num(input.lengthCm), dimWidthCm: num(input.widthCm), dimHeightCm: num(input.heightCm),
      actualWeightKg: num(input.weightKg),
      originHub: input.originHub?.trim() || null,
    }).returning({ id: schema.shipments.id });

    for (const l of packable) {
      await tx.update(schema.orderFulfillmentLines)
        .set({ status: 'packed', packedAt: sql`now()`, shipmentId: pack.id, updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, l.id));
      await tx.insert(schema.orderFulfillmentEvents).values({
        fulfillmentId: ful.id, lineId: l.id, fromStatus: l.status, toStatus: 'packed', actor: userId, note: `Đóng kiện ${code}`,
      });
    }
    await recomputeRollup(tx, ful.id);
    return pack.id;
  });

  try { await recordAudit({ userId, action: 'pack_create', target: packId, requestSummary: `lines=${input.lineIds.length}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath(`/f/fulfillment/${input.orderId}`);
  return packId;
}

/** Mark a pack check-packed (separate gated step, required before shipping). */
export async function markCheckPacked(packId: string): Promise<void> {
  const userId = await requirePerm('check_packed');
  await db.update(schema.shipments)
    .set({ checkPackedBy: userId, checkPackedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(schema.shipments.id, packId));
  try { await recordAudit({ userId, action: 'pack_check', target: packId, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  const [s] = await db.select({ orderId: schema.shipments.orderId }).from(schema.shipments).where(eq(schema.shipments.id, packId)).limit(1);
  if (s) revalidatePath(`/f/fulfillment/${s.orderId}`);
}

/** Ship a pack: requires check-packed + lines; sets tracking and moves lines to shipped. */
export async function shipPack(packId: string, trackingNumber: string): Promise<void> {
  const userId = await requirePerm('manage_fulfillment');
  const tn = trackingNumber.trim();
  if (!tn) throw new Error('Cần nhập tracking number');

  await db.transaction(async (tx) => {
    const [pack] = await tx.select().from(schema.shipments).where(eq(schema.shipments.id, packId)).limit(1);
    if (!pack) throw new Error('Pack not found');
    const lines = await tx.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.shipmentId, packId));
    const gate = canShipPack({ checkPackedAt: pack.checkPackedAt, lineCount: lines.length });
    if (!gate.ok) throw new Error(gate.error);

    await tx.update(schema.shipments)
      .set({ trackingNumber: tn, labelCreatedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(schema.shipments.id, packId));

    for (const l of lines) {
      if (l.status === 'shipped') continue;
      await tx.update(schema.orderFulfillmentLines)
        .set({ status: 'shipped', shippedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, l.id));
      await tx.insert(schema.orderFulfillmentEvents).values({
        fulfillmentId: l.fulfillmentId, lineId: l.id, fromStatus: l.status, toStatus: 'shipped', actor: userId, note: `Ship kiện ${pack.logUniqueCode}`,
      });
    }
    await recomputeRollup(tx, lines[0].fulfillmentId);
  });

  try { await recordAudit({ userId, action: 'pack_ship', target: packId, requestSummary: `tracking=${tn}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  const [s] = await db.select({ orderId: schema.shipments.orderId }).from(schema.shipments).where(eq(schema.shipments.id, packId)).limit(1);
  if (s) revalidatePath(`/f/fulfillment/${s.orderId}`);
}
```

- [ ] **Step 2: Typecheck + regression**

Run: `npm run typecheck && npx vitest run features/packing lib/auth`
Expected: PASS. (If the `tx.execute(... nextval ...)` result typing is awkward, the cast shown handles it; if drizzle's `execute` returns `{ rows }` in this setup, adapt to `const res = await tx.execute(...); const seq = (res.rows ?? res)[0].seq;` — verify against an existing raw-sql usage, e.g. `lib/auth/auth.ts` used `db.execute(sql\`...\`)`.)

- [ ] **Step 3: Commit**

```bash
git add features/packing/actions.ts
git commit -m "feat(packing): createPack + markCheckPacked + shipPack actions"
```

---

## Task 6: UI — PackPanel + wire into order detail

**Files:**
- Create: `components/fulfillment/PackPanel.tsx`
- Modify: `app/(dashboard)/f/fulfillment/[orderId]/page.tsx`
- Modify: `components/fulfillment/OrderDetailPanel.tsx`

- [ ] **Step 1: Create the PackPanel client component**

Create `components/fulfillment/PackPanel.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { createPack, markCheckPacked, shipPack } from '@/features/packing/actions';

type PickedLine = { id: string; sku: string | null; qty: number; productTitle: string | null };
type PackLine = { id: string; sku: string | null; qty: number; status: string; productTitle: string | null };
type Pack = {
  id: string; code: string | null; carrierKey: string | null;
  trackingNumber: string | null; checkPackedAt: string | Date | null;
  actualWeightKg: string | null; lines: PackLine[];
};

interface Props {
  orderId: string;
  picked: PickedLine[];
  packs: Pack[];
  canManage: boolean;
  canCheckPacked: boolean;
}

export function PackPanel({ orderId, picked, packs, canManage, canCheckPacked }: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [carrier, setCarrier] = useState('');
  const [weight, setWeight] = useState('');
  const [packaging, setPackaging] = useState('');
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const chosen = picked.filter((l) => selected[l.id]).map((l) => l.id);

  const handleCreate = () => startTransition(async () => {
    await createPack({
      orderId, lineIds: chosen,
      carrierKey: carrier || null,
      packagingType: packaging === 'bag' || packaging === 'box' ? packaging : null,
      weightKg: weight ? Number(weight) : null,
    });
    setSelected({}); setCarrier(''); setWeight(''); setPackaging('');
  });

  return (
    <div className="space-y-6">
      {canManage && picked.length > 0 && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold">Đóng kiện ({picked.length} dòng đã lấy)</h3>
          <ul className="space-y-1">
            {picked.map((l) => (
              <li key={l.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!selected[l.id]}
                  onChange={(e) => setSelected((s) => ({ ...s, [l.id]: e.target.checked }))} />
                <span className="font-mono text-xs">{l.sku ?? '—'}</span>
                <span className="text-muted-foreground">{l.productTitle ?? ''} ×{l.qty}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Carrier (vd fedex)"
              className="border border-input bg-input/30 rounded-md px-2 py-1 text-sm" />
            <select value={packaging} onChange={(e) => setPackaging(e.target.value)}
              className="border border-input bg-input/30 rounded-md px-2 py-1 text-sm">
              <option value="">Loại đóng gói</option>
              <option value="bag">Bag</option>
              <option value="box">Box</option>
            </select>
            <input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Cân nặng (kg)" inputMode="decimal"
              className="border border-input bg-input/30 rounded-md px-2 py-1 text-sm w-32" />
            <button disabled={isPending || chosen.length === 0} onClick={handleCreate}
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
              Tạo kiện ({chosen.length})
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Kiện ({packs.length})</h3>
        {packs.map((p) => {
          const checked = p.checkPackedAt != null;
          const shipped = p.trackingNumber != null;
          return (
            <div key={p.id} className="rounded-lg border border-border p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-sm font-medium">{p.code ?? '—'}</div>
                <div className="flex items-center gap-2 text-xs">
                  {p.carrierKey && <span className="rounded bg-muted px-2 py-0.5">{p.carrierKey}</span>}
                  {p.actualWeightKg && <span className="text-muted-foreground">{p.actualWeightKg} kg</span>}
                  <span className={`rounded px-2 py-0.5 ${checked ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                    {checked ? 'Đã check-packed' : 'Chưa check'}
                  </span>
                  {shipped && <span className="rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5">Đã ship</span>}
                </div>
              </div>
              <ul className="text-sm text-muted-foreground">
                {p.lines.map((l) => (
                  <li key={l.id} className="font-mono text-xs">{l.sku ?? '—'} ×{l.qty} · {l.status}</li>
                ))}
              </ul>
              {canManage && !shipped && (
                <div className="flex flex-wrap items-center gap-2">
                  {canCheckPacked && !checked && (
                    <button disabled={isPending} onClick={() => startTransition(async () => { await markCheckPacked(p.id); })}
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                      Check packed
                    </button>
                  )}
                  <input value={tracking[p.id] ?? ''} onChange={(e) => setTracking((t) => ({ ...t, [p.id]: e.target.value }))}
                    placeholder="Tracking number" disabled={!checked}
                    className="border border-input bg-input/30 rounded-md px-2 py-1 text-xs disabled:opacity-50" />
                  <button disabled={isPending || !checked || !(tracking[p.id] ?? '').trim()}
                    onClick={() => startTransition(async () => { await shipPack(p.id, tracking[p.id] ?? ''); })}
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                    Ship
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {packs.length === 0 && <p className="text-sm text-muted-foreground">Chưa có kiện nào.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into the order detail page**

In `app/(dashboard)/f/fulfillment/[orderId]/page.tsx`, add imports and render the panel. Replace the file body's data-loading + render with:

```tsx
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getFulfillmentDetail } from '@/features/fulfillment/queries';
import { listPacksForOrder, pickedUnassignedLines } from '@/features/packing/queries';
import { OrderDetailPanel } from '@/components/fulfillment/OrderDetailPanel';
import { PackPanel } from '@/components/fulfillment/PackPanel';

export const dynamic = 'force-dynamic';

export default async function FulfillmentDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) redirect('/');

  const detail = await getFulfillmentDetail(orderId);
  if (!detail) notFound();
  const [picked, packs] = await Promise.all([pickedUnassignedLines(orderId), listPacksForOrder(orderId)]);

  const canManage = hasPermission(role, 'manage_fulfillment');
  return (
    <div className="space-y-6 p-6">
      <OrderDetailPanel orderId={orderId} status={detail.fulfillment.status} lines={detail.lines} canManage={canManage} />
      <PackPanel
        orderId={orderId}
        picked={picked}
        packs={packs.map((p) => ({
          id: p.id, code: p.code, carrierKey: p.carrierKey, trackingNumber: p.trackingNumber,
          checkPackedAt: p.checkPackedAt as Date | null, actualWeightKg: p.actualWeightKg,
          lines: p.lines.map((l) => ({ id: l.id, sku: l.sku, qty: l.qty, status: l.status, productTitle: l.productTitle })),
        }))}
        canManage={canManage}
        canCheckPacked={hasPermission(role, 'check_packed')}
      />
    </div>
  );
}
```

- [ ] **Step 3: Remove the blind packed/shipped buttons from OrderDetailPanel**

In `components/fulfillment/OrderDetailPanel.tsx`:
- In `LineActionButton`, DELETE the `if (line.status === 'picked')` block (the "Đóng gói" button) and the `if (line.status === 'packed')` block (the "Giao carrier" button). Keep the `in_stock` → "Đã lấy" block. (Pack/ship now happen in PackPanel.)
- In the header actions, DELETE the two buttons `Đóng gói cả đơn` (`handleMarkOrder('packed')`) and `Giao cả đơn` (`handleMarkOrder('shipped')`). Keep `Check lại tồn` and `Lấy cả đơn`.
- `handleMarkOrder` is now only called with `'picked'`; narrow its type to `(next: 'picked') => void` or leave as-is. `markOrder`/`markLine` imports stay (still used for pick).

- [ ] **Step 4: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS; `/f/fulfillment/[orderId]` still builds.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/f/fulfillment/[orderId]/page.tsx" components/fulfillment/PackPanel.tsx components/fulfillment/OrderDetailPanel.tsx
git commit -m "feat(packing): pack-building + check-packed + ship UI on order detail"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full regression**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: PASS (incl. `features/packing/logic.test.ts`).

- [ ] **Step 2: Manual verification (after deploy + migrate)**

Apply migration (`npm run db:migrate`) and verify:
1. An order with ≥2 `picked` lines shows them under "Đóng kiện".
2. Select 2 lines → "Tạo kiện" → a pack `PK-100000` appears with those lines `packed`; lines leave the "đã lấy" pool.
3. "Ship" is disabled until "Check packed" is clicked (requires `check_packed` permission).
4. Click "Check packed" → enter tracking → "Ship" → both lines `shipped`; order rollup → `shipped`.
5. Split a second order into two packs and ship each independently.

- [ ] **Step 3: Commit (if any verification fixups)**

```bash
git add -A && git commit -m "chore(packing): verification fixups"
```
(Skip if nothing changed.)

---

## Notes

- **Pack code generation uses a DB sequence** (`pack_code_seq`), not the spec's `nextSeqCode`/`parseSeq` helpers — the shared `logUniqueCode` column already holds legacy unpadded/compound `PK-…` codes, so a `max()+1` scheme would collide or misorder. The sequence (start 100000, above the legacy range) guarantees unique, monotonic codes with no race.
- Line statuses are unchanged; only the trigger for `packed`/`shipped` moved into pack actions. `markLine`/`markOrder` remain for pick.
- Pack carrier/dims/weight feed the existing carrier-rate engine + shipping-reconcile (both read `shipments`).
- Out of scope (later sub-projects): splitting one line's qty across packs (B), materials/gifts + CX coordination, multi-warehouse transfers (C), finance (E), Shopify status sync + returns (F).
```
