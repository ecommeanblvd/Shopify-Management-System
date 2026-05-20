# Shopify Management System — Spec #1.5: Onboarding bootstrap (sign-up + first-admin + user-roles admin)

- **Ngày:** 2026-05-20
- **Trạng thái:** Design — sẵn sàng cho writing-plans (user uỷ quyền review trực tiếp trên hệ thống)
- **Sub-project:** #1.5 (insert giữa spec #1 và spec #3; chạy độc lập với spec #2 đã merged)
- **Spec phụ thuộc:** spec #1 (Foundation) — đã merged.

## 1. Bối cảnh & mục tiêu

Sau spec #1 + #2, hệ thống hoạt động ở tầng code nhưng KHÔNG dùng được vì chưa có cách tạo user đầu (admin) qua UI. Hiện chỉ có `/sign-in`; muốn vào dashboard phải:
- Tạo user qua REST endpoint của Better-Auth (curl thủ công), rồi
- `INSERT INTO roles ...` qua psql để gán `role='admin'`.

Spec #1.5 giải quyết "first-mile" này bằng:
- Trang `/sign-up` để đăng ký user mới.
- User đầu tiên đăng ký = admin tự động (qua Better-Auth hook).
- Trang `/admin/users` cho admin gán/đổi role của user khác qua UI.

### Phạm vi spec #1.5

- `/sign-up` page (email + password + name).
- Better-Auth `databaseHooks.user.create.after` — gán admin cho user đầu.
- Permission mới `manage_users` (admin-only).
- `/admin/users` page với set/remove role.
- Anti-lockout: admin không hạ vai trò của chính mình.
- Cross-link giữa `/sign-in` và `/sign-up`.

### Ngoài phạm vi (để sau hoặc spec riêng)

- Invitation-based signup (token).
- Xoá user qua UI (chỉ có Better-Auth API — admin có thể dùng psql nếu cần).
- Password reset / email verification — Better-Auth hỗ trợ nhưng không bật ở spec #1.5.
- 2FA, SSO, OAuth providers.
- Audit log cho thao tác đổi role — append vào audit_log với action `change_role`, làm trong scope #1.5 (tránh thiếu trail cho operation nhạy cảm).

### Tiêu chí thành công

- Đăng ký được user đầu qua `/sign-up`; user đó tự động có role admin và vào được mọi trang admin.
- User thứ 2+ đăng ký được nhưng chưa có role → bị chặn (gặp "no role assigned" — đã có ở spec #1).
- Admin vào `/admin/users` thấy danh sách user + role hiện tại; gán/xoá role hoạt động đúng.
- Admin KHÔNG hạ được vai trò của chính mình (chống lock-out).
- Mỗi thao tác đổi role ghi `audit_log` (action `change_role`).
- Coverage 80% cho pure-logic mới (canChangeRole + RBAC).

## 2. Architecture

```
┌─ User flow ─────────────────────────────────────────────┐
│                                                          │
│  /sign-up (client component)                            │
│    └─ authClient.signUp.email({ email, password, name }) │
│         └─ Better-Auth INSERT user                       │
│              └─ databaseHooks.user.create.after fires:   │
│                   if (SELECT COUNT(*) FROM "user") === 1 │
│                     AND no admin row in roles            │
│                     → INSERT roles (userId, 'admin')     │
│         └─ session created                               │
│    └─ redirect /                                         │
│                                                          │
│  /admin/users (server component, manage_users perm)     │
│    LEFT JOIN user × roles → render table                 │
│    per row: <select> [admin|operator|viewer|—] + Save   │
│    actions (module scope, .bind(callerUserId)):          │
│      setRoleAction(userId, newRole)                      │
│        re-validate perm + anti-lockout                   │
│        upsert roles row, record audit                    │
│      removeRoleAction(userId)                            │
│        re-validate perm + anti-lockout                   │
│        DELETE roles row, record audit                    │
└──────────────────────────────────────────────────────────┘
```

### File structure

```
app/sign-up/page.tsx                      # client component, mirrors /sign-in
app/admin/users/page.tsx                  # server component + module-scope actions
app/sign-in/page.tsx                      # modify — add link to /sign-up
lib/auth/auth.ts                          # modify — add databaseHooks
lib/auth/rbac.ts                          # modify — add manage_users perm + canChangeRole helper
lib/auth/rbac.test.ts                     # modify — add tests for both
tests/e2e/onboarding.spec.ts              # new — smoke specs
```

## 3. Components

### 3.1 `/sign-up` (`app/sign-up/page.tsx`)
Client component. Mirror style của `/sign-in`:
- Inputs: name, email, password (min 8 char client-side validation).
- Submit calls `authClient.signUp.email({ email, password, name })`. On success: `router.push('/')`. On error: inline error message.
- Footer link: "Already have an account? Sign in" → `/sign-in`.

### 3.2 First-admin hook (`lib/auth/auth.ts`)
Extend the existing `betterAuth({...})` config with `databaseHooks`:

```typescript
databaseHooks: {
  user: {
    create: {
      after: async (newUser) => {
        // Run as a single SQL idempotent operation to avoid race conditions:
        // INSERT into roles only if (a) total user count === 1, AND
        // (b) no existing admin role row exists.
        await assignFirstAdmin(newUser.id);
      },
    },
  },
},
```

`assignFirstAdmin(userId)` lives in `lib/auth/auth.ts` (next to the betterAuth instance):

```typescript
async function assignFirstAdmin(userId: string): Promise<void> {
  // Use a single SQL statement so the "first" check + insert are evaluated
  // atomically. Race condition: if two signups land simultaneously, both
  // hooks see count === 1; the NOT EXISTS clause guarantees only the first
  // to commit wins. The losing transaction inserts nothing.
  await db.execute(sql`
    INSERT INTO roles (user_id, role)
    SELECT ${userId}, 'admin'
    WHERE (SELECT COUNT(*) FROM "user") = 1
      AND NOT EXISTS (SELECT 1 FROM roles WHERE role = 'admin')
  `);
}
```

(Implementer chooses between drizzle's `sql` template + `db.execute` or a transactional pattern; the constraint is "atomic check + insert.")

### 3.3 `manage_users` permission + `canChangeRole` helper (`lib/auth/rbac.ts`)
Add `'manage_users'` to the `Permission` union and to the `admin` row of `MATRIX` only.

Add a pure helper:

```typescript
export function canChangeRole(args: {
  callerUserId: string;
  callerRole: Role;
  targetUserId: string;
  newRole: Role | null; // null = remove role
}): boolean {
  // Only admins can change roles at all.
  if (args.callerRole !== 'admin') return false;
  // Admin must not demote or remove themselves (lock-out prevention).
  if (args.callerUserId === args.targetUserId && args.newRole !== 'admin') {
    return false;
  }
  return true;
}
```

### 3.4 `/admin/users` (`app/admin/users/page.tsx`)
Server component (`dynamic = 'force-dynamic'`). Steps:
1. Get session; redirect `/sign-in` if absent.
2. Look up caller's role; return Forbidden unless `hasPermission(role, 'manage_users')`.
3. Query: list all users with their role joined.
   ```sql
   SELECT u.id, u.email, u.name, r.role
   FROM "user" u LEFT JOIN roles r ON r.user_id = u.id
   ORDER BY u.created_at ASC
   ```
4. Render a table: email | name | current role | dropdown to change | actions.
5. Two module-scope server actions, `.bind(callerUserId)` from the page:
   - `setRoleAction(callerUserId, formData)` — reads target userId + new role; re-validates with `canChangeRole`; upserts `roles` row; records audit.
   - `removeRoleAction(callerUserId, formData)` — reads target userId; re-validates; deletes `roles` row; records audit.

Audit calls use `recordAudit({ userId: callerUserId, action: 'change_role', target: targetUserId, requestSummary: `role=${newRole}`, result: 'success' })`.

### 3.5 `/sign-in` cross-link
Add one line at the bottom of `app/sign-in/page.tsx`: `Need an account? <Link href="/sign-up">Sign up</Link>`.

## 4. RBAC matrix update

| Permission                | viewer | operator | admin |
|---------------------------|--------|----------|-------|
| view                      | ✓      | ✓        | ✓     |
| run_feature               | ✗      | ✓        | ✓     |
| manage_stores             | ✗      | ✗        | ✓     |
| manage_settings_template  | ✗      | ✗        | ✓     |
| apply_settings            | ✗      | ✓        | ✓     |
| reconcile_store           | ✗      | ✓        | ✓     |
| view_settings_history     | ✓      | ✓        | ✓     |
| **manage_users**          | ✗      | ✗        | ✓     |

## 5. Data model

No new tables. Uses existing:
- Better-Auth `user` (via `auth-schema.ts`).
- `roles` table (existing, with `userId`, `role`).
- `audit_log` (existing, for role-change audit trail).

## 6. Error handling

| Lỗi | Xử lý |
|---|---|
| Sign-up với email đã tồn tại | Better-Auth trả error; UI hiển thị "Email already in use". |
| Sign-up password yếu | Client-side check (`min 8`); server validates via Better-Auth config. |
| `assignFirstAdmin` chạy nhưng có sẵn admin (race lose) | SQL `WHERE NOT EXISTS` skip; không lỗi. |
| `setRoleAction` bị admin tự gọi để hạ mình | `canChangeRole` từ chối → action return không làm gì; UI page reload cho thấy không đổi. |
| Caller không phải admin nhưng cố submit form | Re-check `manage_users` trong action → return không làm gì. |
| Target user không tồn tại | Drizzle constraint từ chối (FK to user.id); ghi audit error. |

## 7. Testing

**Unit (≥80% coverage cho pure-logic mới):**
- `lib/auth/rbac.test.ts` mở rộng:
  - Admin có `manage_users`; operator/viewer không có.
  - `canChangeRole` — admin có thể đổi role người khác.
  - `canChangeRole` — admin KHÔNG hạ được vai trò của chính mình (`callerUserId === targetUserId && newRole !== 'admin'` → false).
  - `canChangeRole` — non-admin không đổi được role nào.
  - `canChangeRole` — admin remove role người khác được (newRole = null).
  - `canChangeRole` — admin KHÔNG self-remove được (newRole = null khi caller = target → false).

**Integration:** không thêm; trang `/sign-up` và `/admin/users` covered bởi E2E.

**E2E (`tests/e2e/onboarding.spec.ts`):** smoke (tolerant — không cần DB live):
- `/sign-up` route renders với form (heading + email/password/name inputs).
- `/sign-in` page chứa link tới `/sign-up`.
- `/admin/users` redirects unauthenticated → `/sign-in` (hoặc shows fallback message).

## 8. Migration & deploy considerations

- KHÔNG cần migration mới — schema đã có sẵn `roles` và Better-Auth `user`.
- Sau deploy đầu tiên: tay đầu vào `/sign-up`, tạo account → tự động admin → vào `/admin/users` mời thêm collaborator.
- Lưu ý production: nên đặt URL của repo private hoặc bật cảnh báo trước khi public `/sign-up` (hiện sign-up open, bất cứ ai vào URL đều đăng ký được — nhưng họ sẽ kẹt ở "no role" cho tới khi admin gán). An toàn nhưng noisy nếu URL leak.

## 9. Câu hỏi mở (giải quyết khi implement)

- Better-Auth `databaseHooks` API chính xác của phiên bản đang dùng (1.6.11) — verify chữ ký của `user.create.after` (có thể là `before/after` callback nhận `{ user, context }` thay vì just user). Cite từ Better-Auth docs khi implement.
- Có cần thêm rate-limit cho `/sign-up` (chống spam)? Better-Auth có config rate limit tích hợp — bật nếu đơn giản, hoãn nếu phức tạp. Note as follow-up.
