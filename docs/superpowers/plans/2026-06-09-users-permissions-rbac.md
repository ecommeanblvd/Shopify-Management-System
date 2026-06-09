# Users & Permissions (Role × Scope × Action) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat 3-role hardcoded RBAC with a hybrid Role × Scope × Action model — permission catalog in code, roles + their granted permission keys in the DB, editable via an admin matrix UI, with custom roles (e.g. Logistics) — without breaking any existing permission gate.

**Architecture:** A typed permission **catalog** (`lib/auth/permissions.ts`) defines scopes × actions → permission keys. Three DB tables (`app_roles`, `role_permissions`, and `roles` repurposed to user→role_id) store role definitions. An access layer resolves a user's permission key Set; new code uses `can(perms, key)`. A **backward-compat shim** (`hasPermission(roleKey, oldPerm)`) maps the 28 legacy permissions onto the new keys via a fixed table, so every existing page/action/nav gate keeps working unchanged. Seeds reproduce admin/operator/viewer exactly + add Logistics.

**Tech Stack:** Next.js (app router fork — read `node_modules/next/dist/docs/` before routes per AGENTS.md), Drizzle + Postgres, Better-Auth, Vitest, Tailwind.

**Spec:** [docs/superpowers/specs/2026-06-09-users-permissions-rbac-design.md](../specs/2026-06-09-users-permissions-rbac-design.md)

**Environment:** `npx` (no pnpm). DB commands prefixed `DATABASE_URL="postgres://macos@localhost:5432/staging"`. `drizzle-kit generate` works.

---

## File Structure
- `lib/auth/permissions.ts` — **create**: catalog (scopes × actions), `PermissionKey`, `allPermissionKeys`, `isValidKey`.
- `lib/auth/permissions.test.ts` — **create**.
- `lib/auth/permission-map.ts` — **create**: `OLD_TO_NEW` (legacy perm → key[]) + `SYSTEM_ROLE_SEEDS`.
- `lib/auth/permission-map.test.ts` — **create**.
- `db/schema.ts` — **modify**: `appRoles`, `rolePermissions`; repurpose `roles` to user→role_id.
- `db/migrations/` — **generate** + a seed step.
- `lib/auth/access.ts` — **create**: role-cache, `getUserPermissions`, `can`, `refreshRoleCache`.
- `lib/auth/role.ts` — **modify**: `getRole(userId)` resolves role_id→key + warms cache.
- `lib/auth/rbac.ts` — **modify**: keep `hasPermission(roleKey, oldPerm)` as the shim.
- `features/users/role-queries.ts` + `features/users/role-actions.ts` — **create**: roles CRUD + set permissions.
- `app/(dashboard)/admin/roles/page.tsx` + `components/admin/RoleMatrix.tsx` — **create**: matrix UI.
- `app/(dashboard)/admin/users/page.tsx` — **modify**: assign `app_roles` role_id.

---

## Task 1: Permission catalog (code) — TDD

**Files:** Create `lib/auth/permissions.ts` + `lib/auth/permissions.test.ts`.

- [ ] **Step 1: Write the failing test** — `lib/auth/permissions.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { CATALOG, ACTIONS, allPermissionKeys, isValidKey } from './permissions';

describe('permission catalog', () => {
  it('every scope key is unique', () => {
    const keys = CATALOG.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('every action used is in ACTIONS', () => {
    for (const s of CATALOG) for (const a of s.actions) expect(ACTIONS).toContain(a);
  });
  it('allPermissionKeys returns scope:action for each pair, unique', () => {
    const all = allPermissionKeys();
    expect(all).toContain('fulfillment.logistics:create');
    expect(all).toContain('carrier_rates:view');
    expect(new Set(all).size).toBe(all.length);
  });
  it('isValidKey accepts catalog keys and rejects others', () => {
    expect(isValidKey('carrier_rates.invoices:create')).toBe(true);
    expect(isValidKey('carrier_rates:teleport')).toBe(false);
    expect(isValidKey('nonsense')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — fails** (`npx vitest run lib/auth/permissions.test.ts`).

- [ ] **Step 3: Implement `lib/auth/permissions.ts`**:
```typescript
/**
 * Permission CATALOG — single source of truth for scopes (module / sub-module)
 * and the actions applicable to each. A permission key is `"<scope>:<action>"`.
 *
 * To add a new module/function: add a ScopeDef here, then gate its pages/actions
 * with `can(perms, '<scope>:<action>')`. The role-matrix UI picks it up
 * automatically — no DB migration needed (keys are validated strings, not enums).
 */
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'apply', 'push'] as const;
export type Action = (typeof ACTIONS)[number];

export interface ScopeDef {
  key: string;
  label: string;
  actions: Action[];
}

export const CATALOG: ScopeDef[] = [
  { key: 'orders', label: 'Đơn hàng', actions: ['view', 'edit'] },
  { key: 'fulfillment.operations', label: 'Vận hành — thao tác (pick/pack/ship)', actions: ['view', 'edit'] },
  { key: 'fulfillment.logistics', label: 'Vận hành — logistics (tracking)', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'fulfillment.warehouse', label: 'Kho MEAN', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'fulfillment.brand_requests', label: 'Yêu cầu brand', actions: ['view', 'edit'] },
  { key: 'carrier_rates', label: 'Carrier rates', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'carrier_rates.invoices', label: 'Hoá đơn nhà cung cấp', actions: ['view', 'create', 'edit'] },
  { key: 'shipping_reconcile', label: 'Đối soát phí ship', actions: ['view', 'edit'] },
  { key: 'mmp_products', label: 'Sản phẩm MMP', actions: ['view', 'create', 'edit', 'delete', 'push'] },
  { key: 'functions', label: 'Functions', actions: ['view', 'edit'] },
  { key: 'markets', label: 'Markets', actions: ['view', 'edit', 'apply'] },
  { key: 'settings_sync', label: 'Settings Sync', actions: ['view', 'edit', 'apply'] },
  { key: 'stores', label: 'Stores', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'users_roles', label: 'Users & Roles', actions: ['view', 'create', 'edit', 'delete'] },
];

export type PermissionKey = string; // `${scope}:${action}`

export function allPermissionKeys(): PermissionKey[] {
  return CATALOG.flatMap((s) => s.actions.map((a) => `${s.key}:${a}`));
}

const VALID = new Set(allPermissionKeys());
export function isValidKey(key: string): boolean {
  return VALID.has(key);
}
```

- [ ] **Step 4: Run — pass.** **Step 5: Commit** `git add lib/auth/permissions.ts lib/auth/permissions.test.ts && git commit -m "feat(rbac): permission catalog (scopes × actions)"`

---

## Task 2: Legacy mapping + role seeds — TDD

**Files:** Create `lib/auth/permission-map.ts` + `lib/auth/permission-map.test.ts`.

- [ ] **Step 1: Write the failing test** — `lib/auth/permission-map.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { OLD_TO_NEW, SYSTEM_ROLE_SEEDS } from './permission-map';
import { isValidKey, allPermissionKeys } from './permissions';

describe('OLD_TO_NEW', () => {
  it('every mapped key is a valid catalog key', () => {
    for (const keys of Object.values(OLD_TO_NEW)) for (const k of keys) expect(isValidKey(k)).toBe(true);
  });
  it('maps representative legacy perms', () => {
    expect(OLD_TO_NEW['view_orders']).toEqual(['orders:view']);
    expect(OLD_TO_NEW['manage_warehouse']).toContain('fulfillment.warehouse:edit');
  });
});

describe('SYSTEM_ROLE_SEEDS', () => {
  it('admin gets every permission key', () => {
    expect(new Set(SYSTEM_ROLE_SEEDS.admin.keys)).toEqual(new Set(allPermissionKeys()));
  });
  it('every seeded key is valid', () => {
    for (const r of Object.values(SYSTEM_ROLE_SEEDS)) for (const k of r.keys) expect(isValidKey(k)).toBe(true);
  });
  it('logistics has the expected scoped keys and NOT operations:edit/warehouse', () => {
    const l = new Set(SYSTEM_ROLE_SEEDS.logistics.keys);
    expect(l.has('fulfillment.operations:view')).toBe(true);
    expect(l.has('fulfillment.logistics:create')).toBe(true);
    expect(l.has('fulfillment.logistics:delete')).toBe(true);
    expect(l.has('carrier_rates:view')).toBe(true);
    expect(l.has('carrier_rates:create')).toBe(true);
    expect(l.has('carrier_rates.invoices:create')).toBe(true);
    expect(l.has('fulfillment.operations:edit')).toBe(false);
    expect(l.has('fulfillment.warehouse:edit')).toBe(false);
  });
  it('viewer is read-only (no create/edit/delete/apply/push)', () => {
    for (const k of SYSTEM_ROLE_SEEDS.viewer.keys) expect(k.endsWith(':view')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `lib/auth/permission-map.ts`**:
```typescript
import { allPermissionKeys, type PermissionKey } from './permissions';

/** Legacy permission → new permission keys. Used by the compat shim and to
 *  derive system-role seeds so admin/operator/viewer behave exactly as before. */
export const OLD_TO_NEW: Record<string, PermissionKey[]> = {
  view: [],
  run_feature: ['settings_sync:view', 'settings_sync:edit'],
  manage_stores: ['stores:view', 'stores:create', 'stores:edit', 'stores:delete'],
  manage_settings_template: ['settings_sync:edit'],
  apply_settings: ['settings_sync:apply'],
  reconcile_store: ['settings_sync:apply'],
  view_settings_history: ['settings_sync:view'],
  manage_users: ['users_roles:view', 'users_roles:create', 'users_roles:edit', 'users_roles:delete'],
  manage_markets_template: ['markets:edit'],
  apply_markets: ['markets:apply'],
  view_markets_history: ['markets:view'],
  manage_carrier_rates: ['carrier_rates:create', 'carrier_rates:edit', 'carrier_rates:delete'],
  view_carrier_rates: ['carrier_rates:view'],
  view_orders: ['orders:view'],
  manage_sku_costs: ['orders:edit'],
  manage_shipping_invoices: ['carrier_rates.invoices:view', 'carrier_rates.invoices:create', 'carrier_rates.invoices:edit'],
  manage_functions: ['functions:edit'],
  view_functions: ['functions:view'],
  view_mmp_products: ['mmp_products:view'],
  manage_mmp_products: ['mmp_products:create', 'mmp_products:edit', 'mmp_products:delete', 'mmp_products:push'],
  view_fulfillment: ['fulfillment.operations:view'],
  manage_fulfillment: ['fulfillment.operations:edit', 'fulfillment.brand_requests:edit'],
  manage_warehouse: ['fulfillment.warehouse:view', 'fulfillment.warehouse:create', 'fulfillment.warehouse:edit', 'fulfillment.warehouse:delete'],
};

/** Legacy per-role permission sets (mirror of the old MATRIX) — used to derive seeds. */
const OPERATOR_OLD = [
  'view', 'run_feature', 'apply_settings', 'reconcile_store', 'view_settings_history',
  'apply_markets', 'view_markets_history', 'manage_carrier_rates', 'view_carrier_rates',
  'view_orders', 'manage_sku_costs', 'manage_shipping_invoices', 'view_functions',
  'view_mmp_products', 'manage_mmp_products', 'view_fulfillment', 'manage_fulfillment', 'manage_warehouse',
];
const VIEWER_OLD = [
  'view', 'view_settings_history', 'view_markets_history', 'view_carrier_rates',
  'view_orders', 'view_functions', 'view_mmp_products', 'view_fulfillment',
];

function expand(oldPerms: string[]): PermissionKey[] {
  return [...new Set(oldPerms.flatMap((p) => OLD_TO_NEW[p] ?? []))];
}

export interface RoleSeed { name: string; description: string; isSystem: boolean; keys: PermissionKey[]; }

export const SYSTEM_ROLE_SEEDS: Record<string, RoleSeed> = {
  admin: { name: 'Admin', description: 'Toàn quyền', isSystem: true, keys: allPermissionKeys() },
  operator: { name: 'Operator', description: 'Vận hành chung', isSystem: true, keys: expand(OPERATOR_OLD) },
  viewer: { name: 'Viewer', description: 'Chỉ xem', isSystem: true, keys: expand(VIEWER_OLD) },
  logistics: {
    name: 'Logistics staff', description: 'Vận hành logistics + carrier rate/invoice', isSystem: false,
    keys: [
      'fulfillment.operations:view',
      'fulfillment.logistics:view', 'fulfillment.logistics:create', 'fulfillment.logistics:edit', 'fulfillment.logistics:delete',
      'carrier_rates:view', 'carrier_rates:create',
      'carrier_rates.invoices:view', 'carrier_rates.invoices:create',
    ],
  },
};
```

- [ ] **Step 4: Run — pass.** **Step 5: Commit** `git add lib/auth/permission-map.ts lib/auth/permission-map.test.ts && git commit -m "feat(rbac): legacy mapping + system role seeds"`

---

## Task 3: Schema + migration + seed

**Files:** Modify `db/schema.ts`; generate migration; add a seed runner `db/seed-roles.ts`.

- [ ] **Step 1: Read the current `roles` table + `roleEnum`** in `db/schema.ts` and the `user` table import. Note the exact current definition of `roles` (user_id pk, role enum).

- [ ] **Step 2: Add `appRoles` + `rolePermissions`; add `roleId` to `roles`** (keep the old `role` column for now — drop later). In `db/schema.ts`:
```typescript
export const appRoles = pgTable('app_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  roleId: uuid('role_id').references(() => appRoles.id, { onDelete: 'cascade' }).notNull(),
  permissionKey: text('permission_key').notNull(),
}, (t) => [uniqueIndex('role_permissions_role_key_idx').on(t.roleId, t.permissionKey)]);
```
In the existing `roles` table, add (do NOT remove the old `role` column yet):
```typescript
  roleId: uuid('role_id').references(() => appRoles.id),
```
(`boolean`, `uniqueIndex` are imported in db/schema.ts — verify.)

- [ ] **Step 3: Generate migration** `DATABASE_URL=... npx drizzle-kit generate` → `0042_*.sql` (2 CREATE TABLE + ALTER roles ADD role_id + index). Read it. Apply with `... migrate` (fallback to manual apply + journal register if it hangs, as documented in prior plans). Verify `select count(*) from app_roles;` → 0.

- [ ] **Step 4: Seed runner `db/seed-roles.ts`** (idempotent — upsert roles by key, replace their permission keys):
```typescript
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { SYSTEM_ROLE_SEEDS } from '@/lib/auth/permission-map';

/** Idempotently create/update the seeded roles + their permission keys, and
 *  backfill roles.role_id from the legacy roles.role enum column. */
export async function seedRoles(): Promise<void> {
  for (const [key, seed] of Object.entries(SYSTEM_ROLE_SEEDS)) {
    const [existing] = await db.select({ id: schema.appRoles.id }).from(schema.appRoles)
      .where(eq(schema.appRoles.key, key)).limit(1);
    const id = existing?.id ?? (
      await db.insert(schema.appRoles)
        .values({ key, name: seed.name, description: seed.description, isSystem: seed.isSystem })
        .returning({ id: schema.appRoles.id })
    )[0].id;
    if (existing) {
      await db.update(schema.appRoles)
        .set({ name: seed.name, description: seed.description, isSystem: seed.isSystem })
        .where(eq(schema.appRoles.id, id));
    }
    // Replace permission set
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, id));
    if (seed.keys.length) {
      await db.insert(schema.rolePermissions).values(seed.keys.map((permissionKey) => ({ roleId: id, permissionKey })));
    }
  }
  // Backfill roles.role_id from the legacy role enum (admin/operator/viewer).
  const roleIdByKey = new Map<string, string>();
  for (const r of await db.select().from(schema.appRoles)) roleIdByKey.set(r.key, r.id);
  for (const ur of await db.select().from(schema.roles)) {
    if (!ur.roleId && ur.role && roleIdByKey.has(ur.role)) {
      await db.update(schema.roles).set({ roleId: roleIdByKey.get(ur.role)! })
        .where(eq(schema.roles.userId, ur.userId));
    }
  }
}
```

- [ ] **Step 5: Run the seed** against staging:
`DATABASE_URL="postgres://macos@localhost:5432/staging" npx tsx -r tsconfig-paths/register -e "import('@/db/seed-roles').then(m=>m.seedRoles()).then(()=>{console.log('seeded');process.exit(0)})"`
Verify: `select key, is_system from app_roles;` shows admin/operator/viewer/logistics; `select count(*) from role_permissions;` > 0; existing users' `role_id` backfilled.

- [ ] **Step 6: Typecheck + commit** `npx tsc --noEmit && git add db/schema.ts db/migrations/ db/seed-roles.ts && git commit -m "feat(rbac): app_roles + role_permissions schema + seed runner"`

> The seed step is also how new modules push default grants later: extend SYSTEM_ROLE_SEEDS and re-run `seedRoles()` (it replaces each role's key set). Document this in the seed file header.

---

## Task 4: Access layer + getRole + compat shim

**Files:** Create `lib/auth/access.ts`; modify `lib/auth/role.ts`, `lib/auth/rbac.ts`.

- [ ] **Step 1: Create `lib/auth/access.ts`**:
```typescript
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { PermissionKey } from './permissions';

// Process-level cache of roleKey -> permission keys. Warmed by getRole (async)
// so the sync shim `hasPermission` can read it. 30s TTL picks up role edits.
let cache: Map<string, Set<PermissionKey>> | null = null;
let cacheAt = 0;
const TTL_MS = 30_000;

export async function refreshRoleCache(): Promise<void> {
  const rows = await db.select({
    key: schema.appRoles.key, permissionKey: schema.rolePermissions.permissionKey,
  }).from(schema.appRoles)
    .leftJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.appRoles.id));
  const next = new Map<string, Set<PermissionKey>>();
  for (const r of rows) {
    if (!next.has(r.key)) next.set(r.key, new Set());
    if (r.permissionKey) next.get(r.key)!.add(r.permissionKey);
  }
  cache = next; cacheAt = Date.now();
}

export async function ensureRoleCache(): Promise<void> {
  if (!cache || Date.now() - cacheAt > TTL_MS) await refreshRoleCache();
}

/** Permission key Set for a role key (cache must be warm — call ensureRoleCache first). */
export function permissionsForRoleKey(roleKey: string): Set<PermissionKey> {
  return cache?.get(roleKey) ?? new Set();
}

/** Resolve the permission Set for a user (warms cache). */
export async function getUserPermissions(userId: string): Promise<Set<PermissionKey>> {
  const { getRole } = await import('./role');
  const roleKey = await getRole(userId); // warms cache
  return permissionsForRoleKey(roleKey);
}

export function can(perms: Set<PermissionKey>, key: PermissionKey): boolean {
  return perms.has(key);
}
```

- [ ] **Step 2: Modify `lib/auth/role.ts`** so `getRole(userId)` resolves the role KEY via `app_roles` (falling back to the legacy `role` column, then `'viewer'`) and warms the cache:
```typescript
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { ensureRoleCache } from './access';

/** Returns the user's role KEY (e.g. 'admin', 'logistics'). Defaults to 'viewer'. */
export async function getRole(userId: string): Promise<string> {
  const [row] = await db.select({
    legacy: schema.roles.role,
    key: schema.appRoles.key,
  })
    .from(schema.roles)
    .leftJoin(schema.appRoles, eq(schema.appRoles.id, schema.roles.roleId))
    .where(eq(schema.roles.userId, userId))
    .limit(1);
  await ensureRoleCache();
  return row?.key ?? row?.legacy ?? 'viewer';
}
```
> Note: `getRole` return type widens from the old `Role` union to `string`. Existing call sites pass it to `hasPermission` (Step 3) which now accepts `string` — they still compile.

- [ ] **Step 3: Make `lib/auth/rbac.ts`'s `hasPermission` the shim.** Keep the `Permission` type export (still used as the arg type at call sites). Replace the body of `hasPermission`:
```typescript
import { OLD_TO_NEW } from './permission-map';
import { permissionsForRoleKey } from './access';

// ...keep `export type Role`, `export type Permission`, and the MATRIX (the MATRIX
// is now unused for resolution but harmless; you may delete it after migration).

/** Compat shim: a role "has" a legacy permission iff it holds ALL the new keys
 *  that permission maps to. Reads the role cache (warmed by getRole). */
export function hasPermission(roleKey: string, permission: Permission): boolean {
  const perms = permissionsForRoleKey(roleKey);
  const mapped = OLD_TO_NEW[permission];
  if (!mapped) return false;
  return mapped.every((k) => perms.has(k)); // empty mapping (e.g. 'view') => true
}
```
(`OLD_TO_NEW['view'] = []` → `[].every(...)` is `true`, so every authenticated user keeps the base `view` — preserves old behavior.)

- [ ] **Step 4: Typecheck** `npx tsc --noEmit`. Fix any call site that imported `Role` as the type of a `getRole` result by widening to `string` (most pass it straight into `hasPermission`, which now takes `string`). Run existing RBAC-adjacent tests: `npx vitest run lib/nav.test.ts lib/auth`.

- [ ] **Step 5: Add a shim test** `lib/auth/rbac.test.ts`:
```typescript
import { describe, expect, it, beforeAll } from 'vitest';
import { refreshRoleCache } from './access';
import { hasPermission } from './rbac';

// Requires the seed to have run against the test DB.
describe('hasPermission shim (DB-backed)', () => {
  beforeAll(async () => { await refreshRoleCache(); });
  it('admin has manage_carrier_rates', () => expect(hasPermission('admin', 'manage_carrier_rates')).toBe(true));
  it('viewer lacks manage_carrier_rates', () => expect(hasPermission('viewer', 'manage_carrier_rates')).toBe(false));
  it('viewer has view_orders', () => expect(hasPermission('viewer', 'view_orders')).toBe(true));
  it('logistics has view_fulfillment but not manage_fulfillment', () => {
    expect(hasPermission('logistics', 'view_fulfillment')).toBe(true);
    expect(hasPermission('logistics', 'manage_fulfillment')).toBe(false);
  });
  it('everyone has base view', () => expect(hasPermission('viewer', 'view')).toBe(true));
});
```
Run: `DATABASE_URL="postgres://macos@localhost:5432/staging" npx vitest run lib/auth/rbac.test.ts` → pass (seed from Task 3 present).

- [ ] **Step 6: Commit** `git add lib/auth/access.ts lib/auth/role.ts lib/auth/rbac.ts lib/auth/rbac.test.ts && git commit -m "feat(rbac): DB-backed access layer + getRole + compat shim"`

> After this task, ALL existing gates work unchanged, now DB-driven, and custom roles (logistics) are honored.

---

## Task 5: Role queries + actions

**Files:** Create `features/users/role-queries.ts`, `features/users/role-actions.ts`.

- [ ] **Step 1: `role-queries.ts`**:
```typescript
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export async function listRoles() {
  const roles = await db.select().from(schema.appRoles).orderBy(schema.appRoles.name);
  const perms = await db.select().from(schema.rolePermissions);
  const byRole = new Map<string, string[]>();
  for (const p of perms) {
    if (!byRole.has(p.roleId)) byRole.set(p.roleId, []);
    byRole.get(p.roleId)!.push(p.permissionKey);
  }
  return roles.map((r) => ({ ...r, permissionKeys: byRole.get(r.id) ?? [] }));
}
```

- [ ] **Step 2: `role-actions.ts`** (`'use server'`, gate `users_roles:*` via `getUserPermissions`/`can`; validate keys via `isValidKey`):
```typescript
'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getUserPermissions, can, refreshRoleCache } from '@/lib/auth/access';
import { isValidKey } from '@/lib/auth/permissions';

async function requireKey(key: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const perms = await getUserPermissions(session.user.id);
  if (!can(perms, key)) throw new Error('Forbidden');
}

export async function createRole(input: { key: string; name: string; description?: string }): Promise<void> {
  await requireKey('users_roles:create');
  await db.insert(schema.appRoles).values({ key: input.key.trim(), name: input.name.trim(), description: input.description ?? null, isSystem: false });
  await refreshRoleCache();
  revalidatePath('/admin/roles');
}

export async function setRolePermissions(roleId: string, keys: string[]): Promise<void> {
  await requireKey('users_roles:edit');
  const valid = keys.filter((k) => isValidKey(k));
  const [role] = await db.select().from(schema.appRoles).where(eq(schema.appRoles.id, roleId)).limit(1);
  if (!role) throw new Error('Role not found');
  // Guard: never strip the last admin's ability to manage users (anti-lockout).
  if (role.key === 'admin' && !valid.includes('users_roles:edit')) {
    throw new Error('Không thể bỏ quyền quản lý user của Admin');
  }
  await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
  if (valid.length) await db.insert(schema.rolePermissions).values(valid.map((permissionKey) => ({ roleId, permissionKey })));
  await refreshRoleCache();
  revalidatePath('/admin/roles');
}

export async function deleteRole(roleId: string): Promise<void> {
  await requireKey('users_roles:delete');
  const [role] = await db.select().from(schema.appRoles).where(eq(schema.appRoles.id, roleId)).limit(1);
  if (!role) return;
  if (role.isSystem) throw new Error('Không thể xoá role hệ thống');
  const [assigned] = await db.select({ uid: schema.roles.userId }).from(schema.roles).where(eq(schema.roles.roleId, roleId)).limit(1);
  if (assigned) throw new Error('Còn user đang gán role này — gỡ trước khi xoá');
  await db.delete(schema.appRoles).where(eq(schema.appRoles.id, roleId)); // role_permissions cascade
  await refreshRoleCache();
  revalidatePath('/admin/roles');
}
```

- [ ] **Step 3: Typecheck + commit** `npx tsc --noEmit && git add features/users/role-queries.ts features/users/role-actions.ts && git commit -m "feat(rbac): role queries + management actions"`

---

## Task 6: `/admin/roles` matrix UI

**Files:** Create `app/(dashboard)/admin/roles/page.tsx` + `components/admin/RoleMatrix.tsx`.

- [ ] **Step 1: Server page** (mirror `/admin/users` auth pattern; gate `users_roles:view` via `getUserPermissions`/`can`; redirect `/` if missing). Fetch `listRoles()` + `CATALOG`. Render `<RoleMatrix roles={roles} catalog={CATALOG} canEdit={can(perms,'users_roles:edit')} canCreate={...} canDelete={...} />`.

- [ ] **Step 2: `RoleMatrix.tsx`** (client): for each role, a section showing the CATALOG as a grid of scope rows × action checkboxes; checked = role has that `scope:action` key. On change, build the new key list and call `setRolePermissions(roleId, keys)` in `useTransition`. A "Tạo role" form (key+name) → `createRole`. System roles (`isSystem`) show a lock; admin's `users_roles:edit` checkbox disabled (anti-lockout). Delete button for non-system roles → `deleteRole`. Vietnamese labels; mirror existing table styling; escape JSX quotes.

- [ ] **Step 3: Add nav link** to `/admin/roles` near the Users settings item in `lib/nav.ts` (SETTINGS_ITEMS), `requires: 'manage_users'` (works via shim).

- [ ] **Step 4: Typecheck + lint + commit** `npx tsc --noEmit && npm run lint && git add "app/(dashboard)/admin/roles/page.tsx" components/admin/RoleMatrix.tsx lib/nav.ts && git commit -m "feat(rbac): /admin/roles permission matrix UI"`

---

## Task 7: `/admin/users` → assign app_roles

**Files:** Modify `app/(dashboard)/admin/users/page.tsx` (+ its role-set action — likely `features/users/*` or inline). 

- [ ] **Step 1: Read the current users page + its `setRoleAction`/`canChangeRole`.** It currently sets the legacy `roles.role` enum.

- [ ] **Step 2: Change role assignment to write `roles.role_id`** (FK to `app_roles`), with a `<select>` populated from `listRoles()` (show every role incl. custom). Keep the existing anti-self-lockout guard (admin can't demote self). Write BOTH `role_id` (new) and `role` (legacy column, set to the role key when it's one of admin/operator/viewer, else leave as-is) during the transition so nothing depending on the legacy column breaks. Resolve role via `getRole` (already prefers `role_id`).

- [ ] **Step 3: Typecheck + commit** `npx tsc --noEmit && git add "app/(dashboard)/admin/users/page.tsx" && git commit -m "feat(rbac): assign DB roles (app_roles) in users admin"`

---

## Task 8: Full verification

- [ ] **Step 1: Typecheck** `npx tsc --noEmit` (0).
- [ ] **Step 2: Lint** `npm run lint` (0 errors).
- [ ] **Step 3: Tests** `DATABASE_URL="postgres://macos@localhost:5432/staging" npx vitest run lib/auth lib/nav.test.ts` (all pass — includes catalog, mapping, shim).
- [ ] **Step 4: Migration sanity** `DATABASE_URL=... npx drizzle-kit generate` → "No schema changes". `... migrate` → clean.
- [ ] **Step 5: Manual smoke (dev server)** — log in as admin; open `/admin/roles`; confirm the matrix shows admin (all ticked), operator, viewer, logistics with the expected ticks; toggle a permission on a custom role and save; assign the Logistics role to a test user at `/admin/users`; confirm that user sees fulfillment (view) + carrier-rates but not warehouse/pick-pack actions. Verify existing admin/operator/viewer behavior unchanged.
- [ ] **Step 6: Final commit** `git add -A && git commit -m "chore(rbac): verification" || echo "nothing to commit"`

> Legacy cleanup (separate future task, not in this plan): once all gates are confirmed working DB-driven, drop the legacy `roles.role` enum column and the unused `MATRIX` in `rbac.ts`.
