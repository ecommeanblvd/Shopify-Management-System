# Warehouse Registry + Transfer Log (Sub-project C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a warehouse registry (HN/SG) and an inter-warehouse transfer LOG (draft→in_transit→received/cancelled), with auto codes like `HN-SG-100001`, purely for logistics visibility — no inventory mutation.

**Architecture:** Three new tables (`warehouses`, `inventory_transfers`, `inventory_transfer_lines`) + a `transfer_code_seq` sequence. Pure logic owns the status state machine, code format, and validation. Server actions create/advance transfers (no `warehouse_inventory` writes). A new `warehouse.transfers` permission gates a `/f/transfers` page. Fully isolated from Phase 1 / receiving / packing.

**Tech Stack:** Next.js App Router (server components + actions), Drizzle + Postgres (incl. a raw sequence + seed inserts), Vitest, existing RBAC.

---

## File Structure

- `db/schema.ts` — `transfer_status` enum + `warehouses` + `inventory_transfers` + `inventory_transfer_lines` (MODIFY) + migration (CREATE; tables + `transfer_code_seq` + seed HN/SG).
- `lib/auth/{permissions.ts,rbac.ts,permission-map.ts}` — `warehouse.transfers` scope + `view_transfers`/`manage_transfers` (MODIFY).
- `lib/nav.ts` — "Chuyển kho" nav entry (MODIFY).
- `features/transfers/logic.ts` + `logic.test.ts` — pure state machine / code / validation (CREATE).
- `features/transfers/queries.ts` — `listWarehouses`, `listTransfers`, `getTransferLines` (CREATE).
- `features/transfers/actions.ts` — `createTransfer`, `markInTransit`, `markReceived`, `cancelTransfer` (CREATE).
- `app/(dashboard)/f/transfers/page.tsx` — list + create form + per-row status actions (CREATE).

---

## Task 1: Schema — warehouses + transfers + migration

**Files:**
- Modify: `db/schema.ts`

- [ ] **Step 1: Add enum + tables**

In `db/schema.ts`, add the enum near the other enums (after `shopifyPushStatusEnum`):
```ts
export const transferStatusEnum = pgEnum('transfer_status', ['draft', 'in_transit', 'received', 'cancelled']);
```

Then append these three tables after the shipments-related tables (anywhere after the `shipments` block; `user` is in scope):
```ts
export const warehouses = pgTable('warehouses', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const inventoryTransfers = pgTable('inventory_transfers', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  fromWarehouseId: uuid('from_warehouse_id').references(() => warehouses.id).notNull(),
  toWarehouseId: uuid('to_warehouse_id').references(() => warehouses.id).notNull(),
  status: transferStatusEnum('status').notNull().default('draft'),
  note: text('note'),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  sentAt: timestamp('sent_at'),
  receivedAt: timestamp('received_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [index('inventory_transfers_status_idx').on(t.status)]);

export const inventoryTransferLines = pgTable('inventory_transfer_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  transferId: uuid('transfer_id').references(() => inventoryTransfers.id, { onDelete: 'cascade' }).notNull(),
  sku: text('sku').notNull(),
  productTitle: text('product_title'),
  qty: integer('qty').notNull(),
}, (t) => [index('inventory_transfer_lines_transfer_idx').on(t.transferId)]);
```

`pgEnum`, `pgTable`, `uuid`, `text`, `boolean`, `timestamp`, `integer`, `index` are already imported; `user` is in scope. Verify.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` → PASS.

- [ ] **Step 3: Generate migration**

Run: `npm run db:generate` → a new `db/migrations/00XX_*.sql` (e.g. 0047) with `CREATE TYPE ... transfer_status` and `CREATE TABLE` for the 3 tables. Note the filename.

- [ ] **Step 4: Append sequence + seed to the migration**

Append to the END of the migration file from Step 3:
```sql
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "transfer_code_seq" START WITH 100000;--> statement-breakpoint
INSERT INTO "warehouses" ("code", "name") VALUES ('HN', 'Hà Nội') ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "warehouses" ("code", "name") VALUES ('SG', 'Sài Gòn') ON CONFLICT ("code") DO NOTHING;
```

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations
git commit -m "feat(transfers): warehouses + inventory_transfers schema + seed HN/SG"
```

---

## Task 2: Permissions + nav

**Files:**
- Modify: `lib/auth/permissions.ts`, `lib/auth/rbac.ts`, `lib/auth/permission-map.ts`, `lib/nav.ts`

- [ ] **Step 1: CATALOG scope**

In `lib/auth/permissions.ts` `CATALOG`, add after the `warehouse.qc` entry:
```ts
  { key: 'warehouse.transfers', label: 'Kho — Chuyển kho', actions: ['view', 'create', 'edit'] },
```

- [ ] **Step 2: Permission union**

In `lib/auth/rbac.ts` `Permission` union, add (after the existing warehouse/pack entries):
```ts
  | 'view_transfers'
  | 'manage_transfers'
```

- [ ] **Step 3: Map + operator grant**

In `lib/auth/permission-map.ts` `OLD_TO_NEW`, add:
```ts
  view_transfers: ['warehouse.transfers:view'],
  manage_transfers: ['warehouse.transfers:view', 'warehouse.transfers:create', 'warehouse.transfers:edit'],
```
Then add `'view_transfers', 'manage_transfers'` to the end of `OPERATOR_OLD`. (Admin gets all via `allPermissionKeys()`.)

- [ ] **Step 4: Nav entry**

In `lib/nav.ts`, add to `NAV` after the "Nhập kho & QC" entry:
```ts
  { href: '/f/transfers', label: 'Chuyển kho', icon: ArrowLeftRight, requires: 'view_transfers' },
```
Add `ArrowLeftRight` to the `lucide-react` import.

- [ ] **Step 5: Typecheck + tests**

Run: `npm run typecheck && npx vitest run lib/auth lib/nav.test.ts`
Expected: PASS (existing tests green; admin gets new keys via allPermissionKeys, operator via OPERATOR_OLD).

- [ ] **Step 6: Commit**

```bash
git add lib/auth/permissions.ts lib/auth/rbac.ts lib/auth/permission-map.ts lib/nav.ts
git commit -m "feat(transfers): warehouse.transfers permission + nav"
```

---

## Task 3: Pure logic + tests

**Files:**
- Create: `features/transfers/logic.ts`
- Test: `features/transfers/logic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `features/transfers/logic.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { canTransitionTransfer, nextTransferCode, validateTransfer } from './logic';

describe('canTransitionTransfer', () => {
  it('allows the valid forward + cancel transitions', () => {
    expect(canTransitionTransfer('draft', 'in_transit')).toBe(true);
    expect(canTransitionTransfer('in_transit', 'received')).toBe(true);
    expect(canTransitionTransfer('draft', 'cancelled')).toBe(true);
    expect(canTransitionTransfer('in_transit', 'cancelled')).toBe(true);
  });
  it('rejects invalid transitions', () => {
    expect(canTransitionTransfer('received', 'in_transit')).toBe(false);
    expect(canTransitionTransfer('draft', 'received')).toBe(false);
    expect(canTransitionTransfer('cancelled', 'in_transit')).toBe(false);
    expect(canTransitionTransfer('received', 'cancelled')).toBe(false);
  });
});

describe('nextTransferCode', () => {
  it('joins from/to/seq', () => {
    expect(nextTransferCode('HN', 'SG', 100001)).toBe('HN-SG-100001');
  });
});

describe('validateTransfer', () => {
  const ok = { fromWarehouseId: 'a', toWarehouseId: 'b', lines: [{ sku: 'X', qty: 2 }] };
  it('accepts valid input', () => {
    expect(validateTransfer(ok).ok).toBe(true);
  });
  it('rejects same from/to', () => {
    expect(validateTransfer({ ...ok, toWarehouseId: 'a' }).ok).toBe(false);
  });
  it('rejects empty lines', () => {
    expect(validateTransfer({ ...ok, lines: [] }).ok).toBe(false);
  });
  it('rejects a non-positive qty or blank sku', () => {
    expect(validateTransfer({ ...ok, lines: [{ sku: 'X', qty: 0 }] }).ok).toBe(false);
    expect(validateTransfer({ ...ok, lines: [{ sku: '  ', qty: 1 }] }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/transfers/logic.test.ts`
Expected: FAIL — cannot resolve `./logic`.

- [ ] **Step 3: Implement**

Create `features/transfers/logic.ts`:
```ts
/** Pure transfer logic — no DB. Status state machine, code format, validation. */

export type TransferStatus = 'draft' | 'in_transit' | 'received' | 'cancelled';

const ALLOWED: Record<TransferStatus, TransferStatus[]> = {
  draft: ['in_transit', 'cancelled'],
  in_transit: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

export function canTransitionTransfer(from: TransferStatus, to: TransferStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function nextTransferCode(fromCode: string, toCode: string, seq: number): string {
  return `${fromCode}-${toCode}-${seq}`;
}

export interface TransferLineInput { sku: string; qty: number; }
export interface ValidateTransferInput { fromWarehouseId: string; toWarehouseId: string; lines: TransferLineInput[]; }

export function validateTransfer(input: ValidateTransferInput): { ok: true } | { ok: false; error: string } {
  if (!input.fromWarehouseId || !input.toWarehouseId) return { ok: false, error: 'Thiếu kho gửi/nhận' };
  if (input.fromWarehouseId === input.toWarehouseId) return { ok: false, error: 'Kho gửi và nhận phải khác nhau' };
  if (input.lines.length === 0) return { ok: false, error: 'Cần ít nhất một dòng hàng' };
  for (const l of input.lines) {
    if (!l.sku || l.sku.trim() === '') return { ok: false, error: 'SKU không được trống' };
    if (!(l.qty > 0)) return { ok: false, error: 'Số lượng phải lớn hơn 0' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/transfers/logic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/transfers/logic.ts features/transfers/logic.test.ts
git commit -m "feat(transfers): pure status machine + code + validation with tests"
```

---

## Task 4: Queries

**Files:**
- Create: `features/transfers/queries.ts`

- [ ] **Step 1: Implement**

Create `features/transfers/queries.ts`:
```ts
import { eq, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '@/db/client';

/** Active warehouses for the from/to selectors. */
export async function listWarehouses() {
  return db.select({ id: schema.warehouses.id, code: schema.warehouses.code, name: schema.warehouses.name })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.isActive, true))
    .orderBy(schema.warehouses.code);
}

/** Transfers newest first, with from/to codes and a line count. */
export async function listTransfers() {
  const fromWh = alias(schema.warehouses, 'from_wh');
  const toWh = alias(schema.warehouses, 'to_wh');
  const rows = await db.select({
    id: schema.inventoryTransfers.id,
    code: schema.inventoryTransfers.code,
    status: schema.inventoryTransfers.status,
    fromCode: fromWh.code,
    toCode: toWh.code,
    note: schema.inventoryTransfers.note,
    sentAt: schema.inventoryTransfers.sentAt,
    receivedAt: schema.inventoryTransfers.receivedAt,
    createdAt: schema.inventoryTransfers.createdAt,
  })
    .from(schema.inventoryTransfers)
    .innerJoin(fromWh, eq(fromWh.id, schema.inventoryTransfers.fromWarehouseId))
    .innerJoin(toWh, eq(toWh.id, schema.inventoryTransfers.toWarehouseId))
    .orderBy(desc(schema.inventoryTransfers.createdAt));

  const lines = await db.select({
    transferId: schema.inventoryTransferLines.transferId,
    sku: schema.inventoryTransferLines.sku,
    productTitle: schema.inventoryTransferLines.productTitle,
    qty: schema.inventoryTransferLines.qty,
  }).from(schema.inventoryTransferLines);

  return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.transferId === r.id) }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` → PASS. (Verify `alias` is importable from `drizzle-orm/pg-core`; it is used to self-join `warehouses` twice. If the project already has a self-join example, follow it.)

- [ ] **Step 3: Commit**

```bash
git add features/transfers/queries.ts
git commit -m "feat(transfers): warehouses + transfers-with-lines queries"
```

---

## Task 5: Server actions

**Files:**
- Create: `features/transfers/actions.ts`

- [ ] **Step 1: Implement**

Create `features/transfers/actions.ts`:
```ts
'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { recordAudit } from '@/lib/logging/audit';
import { canTransitionTransfer, nextTransferCode, validateTransfer, type TransferStatus } from './logic';

async function requirePerm(perm: Permission): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}

export interface CreateTransferInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  note?: string | null;
  lines: { sku: string; qty: number; productTitle?: string | null }[];
}

/** Create a draft transfer with an auto code. Pure log — no inventory change. */
export async function createTransfer(input: CreateTransferInput): Promise<string> {
  const userId = await requirePerm('manage_transfers');
  const v = validateTransfer(input);
  if (!v.ok) throw new Error(v.error);

  const id = await db.transaction(async (tx) => {
    const whs = await tx.select({ id: schema.warehouses.id, code: schema.warehouses.code })
      .from(schema.warehouses);
    const from = whs.find((w) => w.id === input.fromWarehouseId);
    const to = whs.find((w) => w.id === input.toWarehouseId);
    if (!from || !to) throw new Error('Kho không hợp lệ');

    const seqRes = await tx.execute(sql`SELECT nextval('transfer_code_seq')::bigint AS seq`);
    const seqRows = ((seqRes as unknown as { rows?: Array<{ seq: string }> }).rows ?? (seqRes as unknown as Array<{ seq: string }>));
    if (!seqRows[0]) throw new Error('transfer_code_seq trả về rỗng');
    const code = nextTransferCode(from.code, to.code, Number(seqRows[0].seq));

    const [t] = await tx.insert(schema.inventoryTransfers).values({
      code, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId,
      note: input.note ?? null, createdBy: userId,
    }).returning({ id: schema.inventoryTransfers.id });

    await tx.insert(schema.inventoryTransferLines).values(
      input.lines.map((l) => ({ transferId: t.id, sku: l.sku.trim(), productTitle: l.productTitle ?? null, qty: l.qty })),
    );
    return t.id;
  });

  try { await recordAudit({ userId, action: 'transfer_create', target: id, requestSummary: `lines=${input.lines.length}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath('/f/transfers');
  return id;
}

/** Advance a transfer's status with state-machine validation + timestamp stamping. */
async function transition(transferId: string, to: TransferStatus): Promise<void> {
  const userId = await requirePerm('manage_transfers');
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(schema.inventoryTransfers)
      .where(eq(schema.inventoryTransfers.id, transferId)).limit(1);
    if (!t) throw new Error('Phiếu không tồn tại');
    if (!canTransitionTransfer(t.status as TransferStatus, to)) {
      throw new Error(`Không thể chuyển ${t.status} → ${to}`);
    }
    const stamp = to === 'in_transit' ? { sentAt: sql`now()` } : to === 'received' ? { receivedAt: sql`now()` } : {};
    await tx.update(schema.inventoryTransfers)
      .set({ status: to, updatedAt: sql`now()`, ...stamp })
      .where(eq(schema.inventoryTransfers.id, transferId));
  });
  try { await recordAudit({ userId, action: 'transfer_transition', target: transferId, requestSummary: `to=${to}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath('/f/transfers');
}

export async function markInTransit(transferId: string): Promise<void> { await transition(transferId, 'in_transit'); }
export async function markReceived(transferId: string): Promise<void> { await transition(transferId, 'received'); }
export async function cancelTransfer(transferId: string): Promise<void> { await transition(transferId, 'cancelled'); }
```

- [ ] **Step 2: Typecheck + regression**

Run: `npm run typecheck && npx vitest run features/transfers lib/auth`
Expected: PASS. (The `tx.execute` nextval shape handling mirrors `features/packing/actions.ts`.)

- [ ] **Step 3: Commit**

```bash
git add features/transfers/actions.ts
git commit -m "feat(transfers): create + status-transition actions (pure log)"
```

---

## Task 6: UI page

**Files:**
- Create: `app/(dashboard)/f/transfers/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/(dashboard)/f/transfers/page.tsx`:
```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowLeftRight } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listWarehouses, listTransfers } from '@/features/transfers/queries';
import { TransfersPanel } from '@/components/transfers/TransfersPanel';

export const dynamic = 'force-dynamic';

export default async function TransfersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_transfers')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Bạn không có quyền xem Chuyển kho.</div>;
  }
  const [warehouses, transfers] = await Promise.all([listWarehouses(), listTransfers()]);
  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ArrowLeftRight className="size-3.5" /> Vận hành đơn
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">Chuyển kho</h1>
      </header>
      <TransfersPanel
        warehouses={warehouses}
        transfers={transfers.map((t) => ({
          id: t.id, code: t.code, status: t.status, fromCode: t.fromCode, toCode: t.toCode,
          note: t.note, sentAt: t.sentAt as Date | null, receivedAt: t.receivedAt as Date | null,
          lines: t.lines.map((l) => ({ sku: l.sku, qty: l.qty, productTitle: l.productTitle })),
        }))}
        canManage={hasPermission(role, 'manage_transfers')}
      />
    </div>
  );
}
```

- [ ] **Step 2: Implement the client panel**

Create `components/transfers/TransfersPanel.tsx`:
```tsx
'use client';

import { useState, useTransition } from 'react';
import { createTransfer, markInTransit, markReceived, cancelTransfer } from '@/features/transfers/actions';

type Warehouse = { id: string; code: string; name: string };
type Line = { sku: string; qty: number; productTitle: string | null };
type Transfer = {
  id: string; code: string; status: string; fromCode: string; toCode: string;
  note: string | null; sentAt: Date | null; receivedAt: Date | null; lines: Line[];
};

interface Props { warehouses: Warehouse[]; transfers: Transfer[]; canManage: boolean; }

const STATUS_LABEL: Record<string, string> = { draft: 'Nháp', in_transit: 'Đang chuyển', received: 'Đã nhận', cancelled: 'Đã hủy' };

export function TransfersPanel({ warehouses, transfers, canManage }: Props) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<{ sku: string; qty: string }[]>([{ sku: '', qty: '' }]);
  const [isPending, startTransition] = useTransition();

  const setRow = (i: number, patch: Partial<{ sku: string; qty: string }>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const handleCreate = () => startTransition(async () => {
    await createTransfer({
      fromWarehouseId: fromId, toWarehouseId: toId, note: note || null,
      lines: rows.filter((r) => r.sku.trim() && Number(r.qty) > 0).map((r) => ({ sku: r.sku.trim(), qty: Number(r.qty) })),
    });
    setFromId(''); setToId(''); setNote(''); setRows([{ sku: '', qty: '' }]);
  });

  return (
    <div className="space-y-8">
      {canManage && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <h2 className="text-sm font-semibold">Phiếu chuyển kho mới</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-xs uppercase tracking-wider text-muted-foreground">Từ kho</span>
              <select value={fromId} onChange={(e) => setFromId(e.target.value)} className="border border-input bg-input/30 rounded-md px-2 py-1.5 text-sm">
                <option value="">—</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-xs uppercase tracking-wider text-muted-foreground">Đến kho</span>
              <select value={toId} onChange={(e) => setToId(e.target.value)} className="border border-input bg-input/30 rounded-md px-2 py-1.5 text-sm">
                <option value="">—</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
            </label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú" className="flex-1 border border-input bg-input/30 rounded-md px-3 py-1.5 text-sm" />
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={r.sku} onChange={(e) => setRow(i, { sku: e.target.value })} placeholder="SKU" className="flex-1 border border-input bg-input/30 rounded-md px-2 py-1 text-sm" />
                <input value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} placeholder="SL" inputMode="numeric" className="w-24 border border-input bg-input/30 rounded-md px-2 py-1 text-sm" />
                {i === rows.length - 1 && (
                  <button onClick={() => setRows((rs) => [...rs, { sku: '', qty: '' }])} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">+ dòng</button>
                )}
              </div>
            ))}
          </div>
          <button disabled={isPending || !fromId || !toId} onClick={handleCreate} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            Tạo phiếu
          </button>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Phiếu ({transfers.length})</h2>
        {transfers.map((t) => (
          <div key={t.id} className="rounded-lg border border-border p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-mono text-sm font-medium">{t.code} · {t.fromCode} → {t.toCode}</div>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{STATUS_LABEL[t.status] ?? t.status}</span>
            </div>
            <ul className="text-xs text-muted-foreground">
              {t.lines.map((l, i) => <li key={i} className="font-mono">{l.sku} ×{l.qty}</li>)}
            </ul>
            {canManage && (t.status === 'draft' || t.status === 'in_transit') && (
              <div className="flex flex-wrap items-center gap-2">
                {t.status === 'draft' && (
                  <button disabled={isPending} onClick={() => startTransition(async () => { await markInTransit(t.id); })} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">Đánh dấu đã gửi</button>
                )}
                {t.status === 'in_transit' && (
                  <button disabled={isPending} onClick={() => startTransition(async () => { await markReceived(t.id); })} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">Đánh dấu đã nhận</button>
                )}
                <button disabled={isPending} onClick={() => startTransition(async () => { await cancelTransfer(t.id); })} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">Hủy</button>
              </div>
            )}
          </div>
        ))}
        {transfers.length === 0 && <p className="text-sm text-muted-foreground">Chưa có phiếu chuyển kho.</p>}
      </div>
    </div>
  );
}
```

Note: the plan's File Structure lists the page; this task adds `components/transfers/TransfersPanel.tsx` as its client component (a focused unit). Create the `components/transfers/` directory.

- [ ] **Step 3: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS; `/f/transfers` appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/f/transfers/page.tsx" components/transfers/TransfersPanel.tsx
git commit -m "feat(transfers): /f/transfers page + create/status UI"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full regression**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: PASS (incl. `features/transfers/logic.test.ts`).

- [ ] **Step 2: Manual verification (after deploy + migrate)**

1. `/f/transfers` shows under nav for admin/operator; HN & SG appear in the from/to selectors.
2. Create a transfer HN→SG with 2 SKU lines → a row `HN-SG-100001` appears as "Nháp".
3. "Đánh dấu đã gửi" → status "Đang chuyển" (sent timestamp set); "Đánh dấu đã nhận" → "Đã nhận".
4. Create another and "Hủy" → "Đã hủy".
5. Confirm `warehouse_inventory` is unchanged by any of the above (pure log).

- [ ] **Step 3: Commit (if any fixups)**

```bash
git add -A && git commit -m "chore(transfers): verification fixups"
```
(Skip if nothing changed.)

---

## Notes

- C1 is a pure logistics LOG: transfers never touch `warehouse_inventory` (single pool). Per-warehouse balances + warehouse-aware check/reserve/pick are C2, to be done together with sub-project B (unit-level) as one inventory refactor.
- Transfer codes come from `transfer_code_seq` (unique, no race) and encode the route (`HN-SG-<seq>`).
- New permission keys reach roles via `seedRoles()` on deploy (db:seed-roles in the start command).
```
