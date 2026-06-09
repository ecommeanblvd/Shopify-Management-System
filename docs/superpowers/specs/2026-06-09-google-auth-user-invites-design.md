# Google Sign-In + User Invites (closed model)

**Date:** 2026-06-09
**Status:** Approved (design)

## Problem

The system currently authenticates with email + password (better-auth) and has
no way to invite users — people self-register via a sign-up page, then an admin
assigns a role on `/admin/users`. The owner wants:

1. Sign in with Google only (no passwords to create or remember).
2. An invite mechanism so only invited people can join.

## Decisions

- **Closed model:** only pre-invited emails (or bootstrap admins) can sign in.
  An uninvited Google account is rejected at first sign-in.
- **Google-only:** remove email/password entirely; delete the sign-up page.
- **Bootstrap admin via env:** `BOOTSTRAP_ADMIN_EMAILS` (csv) — these emails are
  always allowed and become `admin` on first sign-in. This lets the owner in
  before any invite exists, with no race risk.
- **Invite role optional:** admin may pick a role when inviting or leave it
  empty (assign later on `/admin/users`).
- **No invite expiry** (YAGNI). Revoke is manual.

## Flow

1. Admin on `/admin/users` enters an **email + optional role** → creates an
   `invite` row (status `pending`).
2. Invitee opens the app → clicks **"Đăng nhập với Google"** → picks a Google
   account.
3. better-auth attempts to create the user; the `user.create.before` hook checks
   whether the (normalized) email is a **bootstrap admin** OR has a **pending
   invite**:
   - No → return `false` → user not created → redirect to
     `/sign-in?error=not_invited` showing "Email chưa được mời".
   - Yes → allow → `user.create.after` assigns the role (bootstrap → `admin`;
     otherwise `invite.roleId` if set) and marks the invite `accepted`.
4. Subsequent sign-ins: user already exists → create hooks don't fire → signs in
   normally with their current role.

## Components

### 1. Table `user_invites` (`db/schema.ts` + migration)

| column            | type                                   | notes                               |
|-------------------|----------------------------------------|-------------------------------------|
| `id`              | uuid pk (defaultRandom)                |                                     |
| `email`          | text, unique                            | stored lowercased/trimmed           |
| `roleId`         | uuid → `app_roles.id` (nullable)        | null = invite without a role yet    |
| `invitedByUserId`| text → `user.id`                        | who created the invite              |
| `status`         | text                                    | `pending` / `accepted` / `revoked`  |
| `createdAt`      | timestamp defaultNow                     |                                     |
| `acceptedAt`     | timestamp (nullable)                     |                                     |
| `acceptedUserId` | text → `user.id` (nullable)             | the user created on accept          |

Unique index on `email`.

### 2. `lib/auth/invites.ts` — domain logic (DB-thin, unit-testable)

Pure (no DB, testable without Postgres):
- `normalizeEmail(email): string` — trim + lowercase.
- `bootstrapAdminEmails(): string[]` — parse `process.env.BOOTSTRAP_ADMIN_EMAILS`
  (csv, normalized).
- `isBootstrapAdmin(email): boolean`.
- `shouldAllowSignup({ email, hasPendingInvite }): boolean` — bootstrap OR
  pending invite. (Pure decision function — the hook supplies the DB lookup.)

DB-backed:
- `createInvite({ email, roleId, invitedByUserId })`
- `listPendingInvites()`
- `revokeInvite(id)`
- `findPendingInvite(email)`
- `acceptInvite({ email, userId })` — set status `accepted`, `acceptedAt`,
  `acceptedUserId`; returns the invite's `roleId` (or null).

### 3. `lib/auth/auth.ts`

- Remove `emailAndPassword`.
- Add `socialProviders.google` reading `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
  directly from `process.env` (matches the existing build-safe pattern — not via
  the zod `getEnv()` so build/tests don't require them).
- `databaseHooks.user.create.before`: normalize email; allow if
  `isBootstrapAdmin(email)` OR `findPendingInvite(email)` exists; else return
  `false`.
- `databaseHooks.user.create.after`: if bootstrap admin → assign `admin` app
  role; else `acceptInvite()` and, if it returned a `roleId`, assign that role.
  Replaces the old `assignFirstAdmin`.
- Set social `errorCallbackURL: '/sign-in?error=not_invited'` (or equivalent) so
  rejected sign-ins land with a friendly message.

### 4. Auth pages

- `app/(auth)/sign-in/page.tsx`: a single "Đăng nhập với Google" button
  (`authClient.signIn.social({ provider: 'google', callbackURL: '/' })`); render
  the `not_invited` error from the query string. Remove email/password fields.
- Delete `app/(auth)/sign-up/`.

### 5. `/admin/users` (`app/(dashboard)/admin/users/page.tsx`)

Under the existing `manage_users` gate:
- **Invite form:** email input + role dropdown (`listRoles()`, plus a "no role
  yet" option) → server action `createInvite` (audited).
- **Pending invites list:** email, role, invited-by, with a **Revoke** button →
  `revokeInvite`.

### 6. Environment (Railway)

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `BOOTSTRAP_ADMIN_EMAILS=lmtiep@gmail.com`

### 7. Google Cloud setup (for the owner)

1. Google Cloud Console → create/select a project.
2. **APIs & Services → OAuth consent screen** → External → fill app name,
   support email; add yourself as a test user (or publish).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   Application type **Web application**.
4. **Authorized redirect URI:** `<BETTER_AUTH_URL>/api/auth/callback/google`
   (e.g. `https://<app>.up.railway.app/api/auth/callback/google`). For local dev
   add `http://localhost:3000/api/auth/callback/google`.
5. Copy the **Client ID** and **Client secret** into the Railway env vars above.

## Testing

- Unit (no DB): `normalizeEmail`, `bootstrapAdminEmails`/`isBootstrapAdmin`,
  `shouldAllowSignup` decision table.
- Admin page: invite form calls `createInvite`; `manage_users` gate enforced;
  revoke calls `revokeInvite`.

## Notes / out of scope

- Create hooks fire only on first sign-in. Revoking access for an existing user =
  change/remove their role on `/admin/users` (account remains, sees nothing) —
  not invite revocation.
- Revoking an invite only matters before that person's first sign-in.
- No invite expiry, no email delivery of invites (the owner shares access
  out-of-band); both can be added later if needed.
