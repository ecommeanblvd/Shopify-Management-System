# Onboarding Bootstrap — Spec #1.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/sign-up`, auto-assign admin to the first registered user via a Better-Auth database hook, and an `/admin/users` page where admins can set/remove other users' roles — with anti-lockout protection and audit logging.

**Architecture:** Reuses existing `users`/`roles` schema. Adds `manage_users` permission + pure `canChangeRole` helper to `lib/auth/rbac.ts`. The first-admin assignment runs in a Better-Auth `databaseHooks.user.create.after` hook with a single SQL statement (atomic check + insert). The `/admin/users` UI uses the established module-scope server-action + `.bind()` pattern.

**Tech Stack:** Same as spec #1/#2 — Next.js 16 (App Router) · TypeScript · Drizzle ORM + Postgres · Better-Auth · Vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-05-20-spec-1-5-onboarding-design.md`

---

## File Structure

```
lib/auth/rbac.ts             modify — add manage_users permission + canChangeRole helper
lib/auth/rbac.test.ts        modify — add tests for both
lib/auth/auth.ts             modify — add databaseHooks.user.create.after + assignFirstAdmin helper
app/sign-up/page.tsx         new — client component, mirrors /sign-in
app/sign-in/page.tsx         modify — add cross-link to /sign-up
app/admin/users/page.tsx     new — server component + module-scope server actions
tests/e2e/onboarding.spec.ts new — smoke specs
```

---

## Task 1: RBAC — add `manage_users` permission + `canChangeRole` helper

**Files:**
- Modify: `lib/auth/rbac.ts`, `lib/auth/rbac.test.ts`

- [ ] **Step 1: Extend `lib/auth/rbac.test.ts`**

Add the following blocks after the existing `describe('hasPermission', ...)` block. Keep the existing tests untouched.

```typescript
import { canChangeRole } from './rbac';

describe('hasPermission — manage_users', () => {
  it('admin has manage_users', () => {
    expect(hasPermission('admin', 'manage_users')).toBe(true);
  });
  it('operator and viewer do not have manage_users', () => {
    expect(hasPermission('operator', 'manage_users')).toBe(false);
    expect(hasPermission('viewer', 'manage_users')).toBe(false);
  });
});

describe('canChangeRole', () => {
  it('admin can change another user role', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'other-id', newRole: 'operator',
    })).toBe(true);
  });
  it('admin can remove another user role', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'other-id', newRole: null,
    })).toBe(true);
  });
  it('admin cannot demote themselves', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'admin-id', newRole: 'operator',
    })).toBe(false);
  });
  it('admin cannot remove their own role', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'admin-id', newRole: null,
    })).toBe(false);
  });
  it('admin can re-assert themselves as admin (no-op self change)', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'admin-id', newRole: 'admin',
    })).toBe(true);
  });
  it('non-admin cannot change any role', () => {
    expect(canChangeRole({
      callerUserId: 'op-id', callerRole: 'operator',
      targetUserId: 'other-id', newRole: 'viewer',
    })).toBe(false);
    expect(canChangeRole({
      callerUserId: 'v-id', callerRole: 'viewer',
      targetUserId: 'other-id', newRole: 'viewer',
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npm run test -- lib/auth/rbac`
Expected: FAIL — `manage_users` not in the `Permission` union; `canChangeRole` not exported.

- [ ] **Step 3: Update `lib/auth/rbac.ts`**

Replace the entire file with:

```typescript
export type Role = 'admin' | 'operator' | 'viewer';
export type Permission =
  | 'view'
  | 'run_feature'
  | 'manage_stores'
  | 'manage_settings_template'
  | 'apply_settings'
  | 'reconcile_store'
  | 'view_settings_history'
  | 'manage_users';

const MATRIX: Record<Role, Permission[]> = {
  admin: [
    'view', 'run_feature', 'manage_stores',
    'manage_settings_template', 'apply_settings',
    'reconcile_store', 'view_settings_history',
    'manage_users',
  ],
  operator: [
    'view', 'run_feature',
    'apply_settings', 'reconcile_store', 'view_settings_history',
  ],
  viewer: ['view', 'view_settings_history'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export interface CanChangeRoleArgs {
  callerUserId: string;
  callerRole: Role;
  targetUserId: string;
  /** null = remove the target's role entirely. */
  newRole: Role | null;
}

/**
 * Returns true when the caller may apply the given role change.
 * Only admins can change roles. Admins must not demote or remove
 * themselves — that would lock everyone out of `/admin/users`.
 */
export function canChangeRole(args: CanChangeRoleArgs): boolean {
  if (args.callerRole !== 'admin') return false;
  if (args.callerUserId === args.targetUserId && args.newRole !== 'admin') {
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm run test -- lib/auth/rbac`
Expected: all tests pass (existing + 7 new).

- [ ] **Step 5: Typecheck + lint + commit**

Run: `npm run typecheck` — clean.
Run: `npm run lint` — no errors.

```bash
git add lib/auth/rbac.ts lib/auth/rbac.test.ts
git commit -m "feat(rbac): add manage_users permission and canChangeRole helper"
```

---

## Task 2: First-admin database hook in `lib/auth/auth.ts`

**Files:**
- Modify: `lib/auth/auth.ts`

This task has no unit test (requires DB); the behavior is exercised by E2E and manual verification at deploy time. The single SQL statement makes the check + insert atomic so two concurrent signups cannot both become admin.

- [ ] **Step 1: Read the current `lib/auth/auth.ts`**

Note the existing `betterAuth({...})` config call. You will:
1. Add an import for `sql` from `drizzle-orm` and `db, schema` from `@/db/client`.
2. Define `assignFirstAdmin` near the bottom of the file.
3. Insert a `databaseHooks` block into the `betterAuth({...})` config.

- [ ] **Step 2: Apply the modifications**

Add these imports at the top (next to existing imports):

```typescript
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
```

Just BELOW the existing `betterAuth({...})` config (or above if you prefer), define:

```typescript
/**
 * On user creation, atomically assign admin role to the first registered
 * user. The single SQL statement guards against the race where two signups
 * land simultaneously: only the transaction that wins the unique-row check
 * (NOT EXISTS) actually inserts.
 */
export async function assignFirstAdmin(userId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO roles (user_id, role)
    SELECT ${userId}, 'admin'::role
    WHERE (SELECT COUNT(*) FROM "user") = 1
      AND NOT EXISTS (SELECT 1 FROM roles WHERE role = 'admin')
  `);
}
```

In the `betterAuth({...})` config object, add a `databaseHooks` property. The 1.6.x API for Better-Auth's user-create-after hook is `databaseHooks.user.create.after`, receiving the newly created user object. Verify the exact signature against `node_modules/better-auth/dist/...` types if unsure.

```typescript
export const auth = betterAuth({
  // ... existing config preserved ...
  databaseHooks: {
    user: {
      create: {
        after: async (newUser) => {
          await assignFirstAdmin(newUser.id);
        },
      },
    },
  },
});
```

If TypeScript complains that the hook signature differs (e.g., the callback receives `(user, context)` or a different shape), adapt minimally — the goal is "call `assignFirstAdmin(newUser.id)` once per successful user creation, after the user row is committed."

- [ ] **Step 3: Verify typecheck + build**

Run: `npm run typecheck` — clean. Resolve any signature mismatches per Better-Auth's installed types.
Run: `npm run build` — succeed (module-import-safe).

- [ ] **Step 4: Run full test suite — existing tests must still pass**

Run: `npm run test`
Expected: 65 (or more) existing tests still pass; no new tests added by this task.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/auth.ts
git commit -m "feat(auth): assign admin role to the first registered user via database hook"
```

---

## Task 3: Sign-up page

**Files:**
- Create: `app/sign-up/page.tsx`

- [ ] **Step 1: Read `app/sign-in/page.tsx`** to match its style and the auth client wiring.

- [ ] **Step 2: Create `app/sign-up/page.tsx`**

```typescript
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: signUpError } = await authClient.signUp.email({ email, password, name });
      if (signUpError) {
        setError(signUpError.message ?? 'Sign-up failed');
        return;
      }
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 420 }}>
      <h1>Create account</h1>
      <form onSubmit={handleSubmit}>
        <label style={{ display: 'block', marginBottom: 12 }}>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 12 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 12 }}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </label>
        {error && <p style={{ color: '#b00' }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ padding: '8px 16px' }}>
          {loading ? 'Creating…' : 'Sign up'}
        </button>
      </form>
      <p style={{ marginTop: 24 }}>
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build` — succeed; `/sign-up` appears as a static route.

- [ ] **Step 4: Commit**

```bash
git add app/sign-up/page.tsx
git commit -m "feat(auth): add sign-up page"
```

---

## Task 4: Cross-link `/sign-in` → `/sign-up`

**Files:**
- Modify: `app/sign-in/page.tsx`

- [ ] **Step 1: Read `app/sign-in/page.tsx`** to locate where to add the link (typically at the bottom of the form, before the closing `</main>`).

- [ ] **Step 2: Add the cross-link**

If not already imported, add at the top:

```typescript
import Link from 'next/link';
```

Before the closing `</main>` tag in the JSX, add:

```typescript
<p style={{ marginTop: 24 }}>
  Need an account? <Link href="/sign-up">Sign up</Link>
</p>
```

If the page already has a `<p>` with another link (e.g., a forgot-password link), append the sign-up link as a sibling — do NOT remove existing content.

- [ ] **Step 3: Verify build + lint**

Run: `npm run build` — succeed.
Run: `npm run lint` — no errors.

- [ ] **Step 4: Commit**

```bash
git add app/sign-in/page.tsx
git commit -m "feat(auth): cross-link sign-in to sign-up page"
```

---

## Task 5: `/admin/users` page + role-set/remove server actions

**Files:**
- Create: `app/admin/users/page.tsx`

Single file; both server actions at module scope per the established `.bind()` pattern.

- [ ] **Step 1: Create `app/admin/users/page.tsx`**

```typescript
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { canChangeRole, hasPermission, type Role } from '@/lib/auth/rbac';
import { recordAudit } from '@/lib/logging/audit';

export const dynamic = 'force-dynamic';

type RoleOrNone = Role | 'none';

async function setRoleAction(callerUserId: string, formData: FormData) {
  'use server';
  const targetUserId = String(formData.get('userId') ?? '');
  const submitted = String(formData.get('role') ?? '') as RoleOrNone;
  if (!targetUserId || !['admin', 'operator', 'viewer', 'none'].includes(submitted)) return;

  const [callerRoleRow] = await db.select().from(schema.roles)
    .where(eq(schema.roles.userId, callerUserId)).limit(1);
  const callerRole = callerRoleRow?.role as Role | undefined;
  if (!callerRole || !hasPermission(callerRole, 'manage_users')) return;

  const newRole: Role | null = submitted === 'none' ? null : submitted as Role;

  if (!canChangeRole({ callerUserId, callerRole, targetUserId, newRole })) return;

  if (newRole === null) {
    await db.delete(schema.roles).where(eq(schema.roles.userId, targetUserId));
  } else {
    const existing = await db.select().from(schema.roles)
      .where(eq(schema.roles.userId, targetUserId)).limit(1);
    if (existing[0]) {
      await db.update(schema.roles).set({ role: newRole })
        .where(eq(schema.roles.userId, targetUserId));
    } else {
      await db.insert(schema.roles).values({ userId: targetUserId, role: newRole });
    }
  }

  await recordAudit({
    userId: callerUserId,
    action: 'change_role',
    target: targetUserId,
    requestSummary: `role=${submitted}`,
    result: 'success',
  });
}

export default async function AdminUsersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const [callerRoleRow] = await db.select().from(schema.roles)
    .where(eq(schema.roles.userId, session.user.id)).limit(1);
  const callerRole = callerRoleRow?.role as Role | undefined;
  if (!callerRole || !hasPermission(callerRole, 'manage_users')) {
    return <p>Forbidden.</p>;
  }

  const rows = await db
    .select({
      userId: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      role: schema.roles.role,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .leftJoin(schema.roles, eq(schema.roles.userId, schema.user.id))
    .orderBy(asc(schema.user.createdAt));

  const setBound = setRoleAction.bind(null, session.user.id);

  return (
    <main style={{ padding: 24 }}>
      <h1>Users</h1>
      <p style={{ color: '#666' }}>
        Assign a role to grant access. Removing a role blocks the user from every page.
      </p>
      <table>
        <thead>
          <tr>
            <th align="left">Email</th>
            <th align="left">Name</th>
            <th align="left">Current role</th>
            <th align="left">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelf = r.userId === session.user.id;
            return (
              <tr key={r.userId}>
                <td>{r.email}</td>
                <td>{r.name ?? '—'}</td>
                <td>{r.role ?? <em style={{ color: '#999' }}>none</em>}</td>
                <td>
                  <form action={setBound} style={{ display: 'inline-flex', gap: 8 }}>
                    <input type="hidden" name="userId" value={r.userId} />
                    <select name="role" defaultValue={r.role ?? 'none'}>
                      <option value="admin" disabled={isSelf ? false : undefined}>admin</option>
                      <option value="operator" disabled={isSelf}>operator</option>
                      <option value="viewer" disabled={isSelf}>viewer</option>
                      <option value="none" disabled={isSelf}>none</option>
                    </select>
                    <button type="submit">Save</button>
                    {isSelf && <span style={{ color: '#999', marginLeft: 8 }}>(self — locked)</span>}
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Verify typecheck + build**

Run: `npm run typecheck` — clean.
Run: `npm run build` — succeed; `/admin/users` appears as a dynamic route.

- [ ] **Step 3: Commit**

```bash
git add app/admin/users/page.tsx
git commit -m "feat(auth): add /admin/users page for role management"
```

---

## Task 6: E2E smoke specs

**Files:**
- Create: `tests/e2e/onboarding.spec.ts`

These specs are tolerant of an unconfigured environment (no DB / no auth). They document the critical paths and PASS on a real environment.

- [ ] **Step 1: Create `tests/e2e/onboarding.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

test('sign-up page renders the form', async ({ page }) => {
  await page.goto('/sign-up');
  await expect(page.getByRole('heading', { name: /Create account/i })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
});

test('sign-in page links to sign-up', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('link', { name: /Sign up/i })).toBeVisible();
});

test('admin users page is protected', async ({ page }) => {
  const response = await page.goto('/admin/users');
  // Unauthenticated: either a redirect to /sign-in, or a Forbidden message renders.
  await expect(page).toHaveURL(/\/sign-in|\/admin\/users/);
  if (page.url().endsWith('/admin/users')) {
    await expect(page.getByText(/Forbidden|Please sign in/i)).toBeVisible();
  }
});
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck` — clean. (E2E suite is NOT executed here; it requires a real DB.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/onboarding.spec.ts
git commit -m "test(e2e): add onboarding smoke specs"
```

---

## Self-Review

**Spec coverage:**
- `/sign-up` page → Task 3 ✓
- First-user-is-admin hook → Task 2 ✓
- `manage_users` permission + `canChangeRole` → Task 1 ✓
- `/admin/users` page with set/remove + anti-lockout + audit → Task 5 ✓
- Cross-link sign-in ↔ sign-up → Tasks 3 (signup→signin) + 4 (signin→signup) ✓
- RBAC matrix update → Task 1 ✓
- Audit on role change → Task 5 ✓
- E2E smoke → Task 6 ✓

**Placeholder scan:** No "TBD"/"TODO" in implementation steps. Task 2 has one explicit verification note about Better-Auth's hook signature; that is real engineering guidance with a clear fallback ("adapt minimally"), not a placeholder for a missing decision.

**Type consistency:**
- `Permission` union (Task 1) is the single source; `manage_users` added once, used consistently in Task 5.
- `canChangeRole` signature (Task 1) — `{ callerUserId, callerRole, targetUserId, newRole: Role | null }` — used unchanged in Task 5.
- `Role` type re-used across all tasks.
- `setRoleAction(callerUserId, formData)` shape (Task 5) matches the established server-action + `.bind()` pattern from prior specs.

**Risks acknowledged in the spec, not addressed here:**
- Better-Auth's exact `databaseHooks.user.create.after` signature — Task 2 says "adapt minimally if the installed version differs." Acceptable; the implementer can verify by reading `node_modules/better-auth` types in 30 seconds.
- `'admin'::role` SQL cast assumes the Postgres enum type is named `role` (matches the Drizzle `pgEnum('role', ...)` definition in `db/schema.ts`). Confirmed correct.
- Sign-up rate-limiting deferred (acknowledged in spec section 9).
