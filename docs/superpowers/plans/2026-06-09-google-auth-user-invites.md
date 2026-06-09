# Google Sign-In + User Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace email/password auth with Google-only sign-in gated by a closed invite list, so only pre-invited emails (plus bootstrap admins) can join.

**Architecture:** better-auth `socialProviders.google` provides login. A new `user_invites` table is the allowlist. The `user.create.before` database hook rejects sign-ups whose email is neither a bootstrap admin nor a pending invite; `user.create.after` assigns the role and marks the invite accepted. Admins manage invites on the existing `/admin/users` page.

**Tech Stack:** Next.js (App Router), better-auth 1.6.11, Drizzle ORM + Postgres, Vitest, Tailwind/shadcn UI.

---

## File Structure

- `db/schema.ts` — add `inviteStatusEnum` + `userInvites` table (MODIFY).
- `db/migrations/00XX_*.sql` — generated migration (CREATE).
- `lib/auth/invites.ts` — invite domain logic: pure helpers + DB functions (CREATE).
- `lib/auth/invites.test.ts` — unit tests for the pure helpers (CREATE).
- `lib/auth/auth.ts` — Google provider + gate hooks; remove email/password + `assignFirstAdmin` (MODIFY).
- `app/(auth)/sign-in/page.tsx` — single Google button + `not_invited` error (MODIFY).
- `app/(auth)/sign-up/` — delete the directory (DELETE).
- `app/(dashboard)/admin/users/page.tsx` — invite form + pending-invite list with revoke (MODIFY).
- `.env.example` / docs — new env vars + Google Cloud setup steps (MODIFY/CREATE).

---

## Task 1: Add `user_invites` table to the schema

**Files:**
- Modify: `db/schema.ts`

- [ ] **Step 1: Add the enum and table**

In `db/schema.ts`, just after the existing `storeStatusEnum` definition (line 6), add the enum:

```ts
export const inviteStatusEnum = pgEnum('invite_status', ['pending', 'accepted', 'revoked']);
```

Then, immediately after the `roles` table definition (around line 28), add:

```ts
export const userInvites = pgTable('user_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  roleId: uuid('role_id').references(() => appRoles.id, { onDelete: 'set null' }),
  invitedByUserId: text('invited_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  status: inviteStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  acceptedAt: timestamp('accepted_at'),
  acceptedUserId: text('accepted_user_id').references(() => user.id, { onDelete: 'set null' }),
});
```

`pgEnum`, `pgTable`, `uuid`, `text`, `timestamp` are already imported at the top of the file; `user` and `appRoles` are already in scope.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `db/migrations/00XX_*.sql` is created containing `CREATE TYPE "public"."invite_status"` and `CREATE TABLE "user_invites"`. Verify the SQL mentions `user_invites` and the `email` unique constraint.

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts db/migrations
git commit -m "feat(invites): add user_invites table + invite_status enum"
```

---

## Task 2: Pure invite helpers + unit tests (no DB)

**Files:**
- Create: `lib/auth/invites.ts`
- Test: `lib/auth/invites.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/auth/invites.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeEmail,
  bootstrapAdminEmails,
  isBootstrapAdmin,
  shouldAllowSignup,
} from './invites';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});

describe('bootstrapAdminEmails', () => {
  const prev = process.env.BOOTSTRAP_ADMIN_EMAILS;
  afterEach(() => { process.env.BOOTSTRAP_ADMIN_EMAILS = prev; });

  it('returns [] when unset', () => {
    delete process.env.BOOTSTRAP_ADMIN_EMAILS;
    expect(bootstrapAdminEmails()).toEqual([]);
  });

  it('parses a normalized csv', () => {
    process.env.BOOTSTRAP_ADMIN_EMAILS = ' A@x.com , b@Y.com ,';
    expect(bootstrapAdminEmails()).toEqual(['a@x.com', 'b@y.com']);
  });
});

describe('isBootstrapAdmin', () => {
  beforeEach(() => { process.env.BOOTSTRAP_ADMIN_EMAILS = 'owner@x.com'; });
  afterEach(() => { delete process.env.BOOTSTRAP_ADMIN_EMAILS; });

  it('matches case-insensitively', () => {
    expect(isBootstrapAdmin('Owner@X.com')).toBe(true);
    expect(isBootstrapAdmin('someone@x.com')).toBe(false);
  });
});

describe('shouldAllowSignup', () => {
  beforeEach(() => { process.env.BOOTSTRAP_ADMIN_EMAILS = 'owner@x.com'; });
  afterEach(() => { delete process.env.BOOTSTRAP_ADMIN_EMAILS; });

  it('allows bootstrap admin even without an invite', () => {
    expect(shouldAllowSignup({ email: 'owner@x.com', hasPendingInvite: false })).toBe(true);
  });
  it('allows an invited non-admin', () => {
    expect(shouldAllowSignup({ email: 'guest@x.com', hasPendingInvite: true })).toBe(true);
  });
  it('rejects an uninvited non-admin', () => {
    expect(shouldAllowSignup({ email: 'stranger@x.com', hasPendingInvite: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/auth/invites.test.ts`
Expected: FAIL — cannot resolve `./invites` (module not found).

- [ ] **Step 3: Write the pure helpers**

Create `lib/auth/invites.ts` with ONLY the pure helpers for now:

```ts
/** Trim + lowercase an email for consistent comparison and storage. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Parse BOOTSTRAP_ADMIN_EMAILS (csv) into a normalized list. Read directly
 *  from process.env so this module is build-safe even when the var is unset. */
export function bootstrapAdminEmails(): string[] {
  const raw = process.env.BOOTSTRAP_ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((e) => normalizeEmail(e))
    .filter((e) => e.length > 0);
}

export function isBootstrapAdmin(email: string): boolean {
  return bootstrapAdminEmails().includes(normalizeEmail(email));
}

/** Closed-model gate decision (pure). The caller supplies the DB lookup result. */
export function shouldAllowSignup(args: { email: string; hasPendingInvite: boolean }): boolean {
  return isBootstrapAdmin(args.email) || args.hasPendingInvite;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/auth/invites.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/invites.ts lib/auth/invites.test.ts
git commit -m "feat(invites): pure invite-gate helpers with unit tests"
```

---

## Task 3: DB-backed invite functions

**Files:**
- Modify: `lib/auth/invites.ts`

These touch Postgres so they are not unit-tested here (the repo's auth tests run without a DB); they are verified end-to-end in Task 7. Keep them thin.

- [ ] **Step 1: Add imports and DB functions**

At the TOP of `lib/auth/invites.ts`, add imports:

```ts
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
```

Then append these functions to the file:

```ts
/** Legacy enum values writable to roles.role. */
const LEGACY_ROLE_KEYS = new Set(['admin', 'operator', 'viewer']);

/** Look up an app_role's id by its key (e.g. 'admin'). */
export async function appRoleIdByKey(key: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.appRoles.id })
    .from(schema.appRoles)
    .where(eq(schema.appRoles.key, key))
    .limit(1);
  return row?.id ?? null;
}

/** Assign (or replace) a user's role given an app_role id. Mirrors the legacy
 *  enum sync used by /admin/users. */
export async function assignUserRole(userId: string, appRoleId: string): Promise<void> {
  const [appRole] = await db
    .select()
    .from(schema.appRoles)
    .where(eq(schema.appRoles.id, appRoleId))
    .limit(1);
  if (!appRole) return;
  const legacy = LEGACY_ROLE_KEYS.has(appRole.key)
    ? (appRole.key as 'admin' | 'operator' | 'viewer')
    : 'viewer';
  await db
    .insert(schema.roles)
    .values({ userId, roleId: appRole.id, role: legacy })
    .onConflictDoUpdate({
      target: schema.roles.userId,
      set: { roleId: appRole.id, role: legacy },
    });
}

/** The single pending invite for an email, or null. */
export async function findPendingInvite(email: string) {
  const [row] = await db
    .select()
    .from(schema.userInvites)
    .where(and(
      eq(schema.userInvites.email, normalizeEmail(email)),
      eq(schema.userInvites.status, 'pending'),
    ))
    .limit(1);
  return row ?? null;
}

/** Create or re-open a pending invite for an email (idempotent on email). */
export async function createInvite(args: {
  email: string;
  roleId: string | null;
  invitedByUserId: string;
}): Promise<void> {
  const email = normalizeEmail(args.email);
  await db
    .insert(schema.userInvites)
    .values({
      email,
      roleId: args.roleId,
      invitedByUserId: args.invitedByUserId,
      status: 'pending',
    })
    .onConflictDoUpdate({
      target: schema.userInvites.email,
      set: {
        roleId: args.roleId,
        invitedByUserId: args.invitedByUserId,
        status: 'pending',
        acceptedAt: null,
        acceptedUserId: null,
      },
    });
}

/** Pending invites with role + inviter for display. */
export async function listPendingInvites() {
  return db
    .select({
      id: schema.userInvites.id,
      email: schema.userInvites.email,
      roleId: schema.userInvites.roleId,
      roleName: schema.appRoles.name,
      createdAt: schema.userInvites.createdAt,
      invitedByEmail: schema.user.email,
    })
    .from(schema.userInvites)
    .leftJoin(schema.appRoles, eq(schema.appRoles.id, schema.userInvites.roleId))
    .leftJoin(schema.user, eq(schema.user.id, schema.userInvites.invitedByUserId))
    .where(eq(schema.userInvites.status, 'pending'))
    .orderBy(schema.userInvites.createdAt);
}

export async function revokeInvite(id: string): Promise<void> {
  await db
    .update(schema.userInvites)
    .set({ status: 'revoked' })
    .where(eq(schema.userInvites.id, id));
}

/** Mark an email's pending invite accepted and return its roleId (or null). */
export async function acceptInvite(args: { email: string; userId: string }): Promise<string | null> {
  const invite = await findPendingInvite(args.email);
  if (!invite) return null;
  await db
    .update(schema.userInvites)
    .set({ status: 'accepted', acceptedAt: new Date(), acceptedUserId: args.userId })
    .where(eq(schema.userInvites.id, invite.id));
  return invite.roleId ?? null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run the unit tests (regression)**

Run: `npx vitest run lib/auth/invites.test.ts`
Expected: PASS (the pure helpers still pass; DB functions aren't exercised).

- [ ] **Step 4: Commit**

```bash
git add lib/auth/invites.ts
git commit -m "feat(invites): DB functions (create/list/revoke/accept/assign-role)"
```

---

## Task 4: Google provider + gate hooks in auth.ts

**Files:**
- Modify: `lib/auth/auth.ts`

- [ ] **Step 1: Replace the file contents**

Replace the ENTIRE contents of `lib/auth/auth.ts` with:

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@/db/client';
import {
  normalizeEmail,
  isBootstrapAdmin,
  findPendingInvite,
  acceptInvite,
  assignUserRole,
  appRoleIdByKey,
} from './invites';

// Read directly from process.env — NOT via getEnv() — so this module is
// safe to import at build time even when the env vars are unset.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Closed-model gate: only bootstrap admins or pending-invited emails
        // may create an account. Returning false aborts user creation.
        before: async (newUser) => {
          const email = normalizeEmail(newUser.email);
          if (isBootstrapAdmin(email)) return;
          const invite = await findPendingInvite(email);
          if (invite) return;
          return false;
        },
        // On first successful sign-in, assign the role: bootstrap admins get
        // 'admin'; invited users get their invite's role (if any).
        after: async (newUser) => {
          const email = normalizeEmail(newUser.email);
          if (isBootstrapAdmin(email)) {
            const adminRoleId = await appRoleIdByKey('admin');
            if (adminRoleId) await assignUserRole(newUser.id, adminRoleId);
            return;
          }
          const roleId = await acceptInvite({ email, userId: newUser.id });
          if (roleId) await assignUserRole(newUser.id, roleId);
        },
      },
    },
  },
});
```

This removes `emailAndPassword`, the exported `assignFirstAdmin` (it had no other consumers — verified by grep), and the `sql`/`drizzle-orm` import.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (If TS complains about the `before` hook return type, ensure it returns `undefined` on the allow paths and `false` on reject — the union `boolean | void` is satisfied.)

- [ ] **Step 3: Run the full auth test suite (regression)**

Run: `npx vitest run lib/auth/`
Expected: PASS (rbac/permission tests unaffected; invites unit tests pass).

- [ ] **Step 4: Commit**

```bash
git add lib/auth/auth.ts
git commit -m "feat(auth): Google-only sign-in gated by invite allowlist"
```

---

## Task 5: Sign-in page (Google button) + delete sign-up

**Files:**
- Modify: `app/(auth)/sign-in/page.tsx`
- Delete: `app/(auth)/sign-up/page.tsx` (and the empty dir)

- [ ] **Step 1: Replace the sign-in page**

Replace the ENTIRE contents of `app/(auth)/sign-in/page.tsx` with:

```tsx
'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { authClient } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';

export default function SignInPage() {
  const params = useSearchParams();
  const [loading, setLoading] = useState(false);
  const rejected = params.get('error') === 'not_invited';

  async function signInWithGoogle() {
    setLoading(true);
    await authClient.signIn.social({ provider: 'google', callbackURL: '/' });
    // On success the browser is redirected by better-auth; no further code runs.
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Đăng nhập để tiếp tục quản lý các store.</p>
      </div>

      {rejected && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 text-sm flex items-start gap-2">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>Email của bạn chưa được mời vào hệ thống. Liên hệ quản trị viên để được cấp quyền.</span>
        </div>
      )}

      <Button type="button" size="lg" className="w-full gap-2" disabled={loading} onClick={signInWithGoogle}>
        <GoogleIcon />
        {loading ? 'Đang chuyển hướng…' : 'Đăng nhập với Google'}
      </Button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}
```

- [ ] **Step 2: Delete the sign-up route**

Run:

```bash
git rm app/(auth)/sign-up/page.tsx
rmdir "app/(auth)/sign-up" 2>/dev/null || true
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (No remaining references to `signIn.email` / `signUp`; verify with `grep -rn "signIn.email\|signUp" app lib`.)

- [ ] **Step 4: Commit**

```bash
git add "app/(auth)/sign-in/page.tsx"
git commit -m "feat(auth): Google sign-in UI; remove email/password + sign-up page"
```

---

## Task 6: Invite management on /admin/users

**Files:**
- Modify: `app/(dashboard)/admin/users/page.tsx`

- [ ] **Step 1: Add invite imports**

In `app/(dashboard)/admin/users/page.tsx`, add a new import near the other feature imports (after line 10). `revalidatePath`, `recordAudit`, `getRole`, and `hasPermission` are already imported in this file:

```ts
import { createInvite, listPendingInvites, revokeInvite } from '@/lib/auth/invites';
```

- [ ] **Step 2: Add the invite + revoke server actions**

After the existing `setRoleAction` function (ends ~line 87), add two new actions:

```ts
async function inviteUserAction(callerUserId: string, formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').trim();
  const submitted = String(formData.get('appRoleId') ?? 'none');
  if (!email) return;

  const callerRoleKey = await getRole(callerUserId);
  if (!hasPermission(callerRoleKey, 'manage_users')) return;

  const roleId = submitted === 'none' ? null : submitted;
  await createInvite({ email, roleId, invitedByUserId: callerUserId });

  await recordAudit({
    userId: callerUserId, action: 'invite_user', target: email,
    requestSummary: `appRoleId=${submitted}`, result: 'success',
  });
  revalidatePath('/admin/users');
}

async function revokeInviteAction(callerUserId: string, formData: FormData) {
  'use server';
  const inviteId = String(formData.get('inviteId') ?? '');
  if (!inviteId) return;

  const callerRoleKey = await getRole(callerUserId);
  if (!hasPermission(callerRoleKey, 'manage_users')) return;

  await revokeInvite(inviteId);
  await recordAudit({
    userId: callerUserId, action: 'revoke_invite', target: inviteId, result: 'success',
  });
  revalidatePath('/admin/users');
}
```

- [ ] **Step 3: Load pending invites + bind actions in the page component**

In `AdminUsersPage`, extend the `Promise.all` (currently `[rows, appRoles]`, ~line 114) to also load invites, and bind the new actions after `setBound` (~line 133):

```ts
  const [rows, appRoles, invites] = await Promise.all([
    db
      .select({
        userId: schema.user.id,
        email: schema.user.email,
        name: schema.user.name,
        role: schema.roles.role,
        roleId: schema.roles.roleId,
        appRoleKey: schema.appRoles.key,
        appRoleName: schema.appRoles.name,
        createdAt: schema.user.createdAt,
      })
      .from(schema.user)
      .leftJoin(schema.roles, eq(schema.roles.userId, schema.user.id))
      .leftJoin(schema.appRoles, eq(schema.appRoles.id, schema.roles.roleId))
      .orderBy(asc(schema.user.createdAt)),
    listRoles(),
    listPendingInvites(),
  ]);

  const setBound = setRoleAction.bind(null, session.user.id);
  const inviteBound = inviteUserAction.bind(null, session.user.id);
  const revokeBound = revokeInviteAction.bind(null, session.user.id);
```

- [ ] **Step 4: Render the invite form + pending list**

Insert this block in the returned JSX, right after the stat-tiles `<div ...grid grid-cols-2...>` closes and BEFORE the `<Card>` that lists users (~line 165):

```tsx
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Mời người dùng</h2>
          </div>
          <form action={inviteBound} className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label htmlFor="invite-email" className="text-xs uppercase tracking-wider text-muted-foreground">Email</label>
              <input
                id="invite-email"
                name="email"
                type="email"
                required
                placeholder="nguoi-moi@example.com"
                className="w-full border border-input bg-input/30 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="invite-role" className="text-xs uppercase tracking-wider text-muted-foreground">Role</label>
              <select
                id="invite-role"
                name="appRoleId"
                defaultValue="none"
                className="border border-input bg-input/30 rounded-md px-2 py-2 text-sm"
              >
                <option value="none">— chưa gán role —</option>
                {appRoles.map((ar) => (
                  <option key={ar.id} value={ar.id}>{ar.name}</option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" className="h-9">Gửi lời mời</Button>
          </form>

          {invites.length > 0 && (
            <ul className="divide-y divide-border border-t border-border pt-2">
              {invites.map((inv) => (
                <li key={inv.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{inv.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {inv.roleName ?? 'chưa gán role'} · mời bởi {inv.invitedByEmail ?? '—'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">pending</Badge>
                    <form action={revokeBound}>
                      <input type="hidden" name="inviteId" value={inv.id} />
                      <Button type="submit" size="sm" variant="outline" className="h-7 px-3 text-xs">Thu hồi</Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/admin/users/page.tsx"
git commit -m "feat(admin): invite users + pending-invite list with revoke"
```

---

## Task 7: Env vars, docs, and end-to-end verification

**Files:**
- Modify: `.env.example` (create if absent)
- Modify: `docs/superpowers/specs/2026-06-09-google-auth-user-invites-design.md` already documents Google Cloud setup — no change needed.

- [ ] **Step 1: Document the new env vars**

If `.env.example` exists, append; otherwise create `.env.example` with at least:

```bash
# Google OAuth (better-auth socialProviders.google)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Comma-separated emails always allowed in + auto-admin on first sign-in
BOOTSTRAP_ADMIN_EMAILS=lmtiep@gmail.com
```

- [ ] **Step 2: Commit the env docs**

```bash
git add .env.example
git commit -m "docs(auth): document Google OAuth + BOOTSTRAP_ADMIN_EMAILS env vars"
```

- [ ] **Step 3: Owner sets up Google OAuth credentials**

Follow the "Google Cloud setup" section in the design spec:
- Create OAuth client (Web application).
- Authorized redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/google` (prod) and `http://localhost:3000/api/auth/callback/google` (local).
- Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BOOTSTRAP_ADMIN_EMAILS` into the runtime env (Railway + local `.env`).

- [ ] **Step 4: Apply the migration locally**

Run: `npm run db:migrate`
Expected: the `user_invites` migration applies cleanly.

- [ ] **Step 5: Manual end-to-end verification**

Run: `npm run dev` and verify:
1. Visit `/sign-in` → only the "Đăng nhập với Google" button shows (no email/password).
2. Sign in with the `BOOTSTRAP_ADMIN_EMAILS` Google account → lands on `/` and is `admin` (visible on `/admin/users`).
3. On `/admin/users`, invite a second email (pick a role) → it appears in the pending list.
4. Sign out; sign in with a DIFFERENT, uninvited Google account → redirected to `/sign-in?error=not_invited` with the rejection message; no account created (not in `/admin/users`).
5. Sign in with the invited email → succeeds and shows up with the assigned role.
6. Invite a third email, then "Thu hồi" → it leaves the pending list; signing in with it is rejected.

- [ ] **Step 6: Final regression**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: PASS.

---

## Notes

- The `before` hook fires only at account creation (first sign-in). Removing access for an existing user = change/remove their role on `/admin/users`; the account remains but sees nothing.
- `BOOTSTRAP_ADMIN_EMAILS` is the bootstrap path; keep at least the owner's email there until another admin exists.
- Deploy order on Railway is unchanged (`db:migrate` → `db:seed-roles` → start); the new migration runs in the existing migrate step.
