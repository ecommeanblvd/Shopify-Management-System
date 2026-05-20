# Shopify Management System — Spec #1.7: UI/UX foundation + redesign all pages

- **Ngày:** 2026-05-20
- **Trạng thái:** Design — sẵn sàng cho writing-plans (user uỷ quyền review trực tiếp trên hệ thống)
- **Sub-project:** #1.7
- **Spec phụ thuộc:** spec #1, #1.5, #2 — đã merged.

## 1. Bối cảnh & mục tiêu

Sau khi backend hoạt động end-to-end (spec #1/#2/#1.5), giao diện vẫn là HTML thô + inline styles. Cần một design system thực thụ + redesign toàn bộ page hiện có để dashboard dùng được hằng ngày một cách dễ chịu.

### Phạm vi spec #1.7

- Cài Tailwind CSS v4 + shadcn/ui + next-themes + lucide-react + sonner.
- Design tokens hai theme: **light (Stripe-inspired)** mặc định, **dark (Vercel-inspired)**.
- AppShell: sidebar + topbar + user menu với Sign out + theme toggle.
- Redesign mọi page hiện có (sign-in, sign-up, home, stores/connect, admin/users, settings-viewer, settings-sync 7 trang) dùng shell + shadcn primitives.
- E2E smoke cập nhật cho shell mới.

### Ngoài phạm vi (làm sau hoặc không bao giờ)

- Tính năng/page mới (đã đủ qua các spec trước).
- Thay đổi business logic, server actions, RBAC, DB schema, audit log — UI-only refactor.
- i18n, RTL, a11y advanced (chỉ giữ a11y baseline qua shadcn defaults).
- Storybook (tách spec nếu muốn).
- Polish ảnh/illustration/empty-state minh hoạ — chỉ text + icon từ lucide.

### Tiêu chí thành công

- Mỗi page tồn tại sau spec #1.5 render được dưới AppShell mới với theme light/dark.
- Theme toggle hoạt động + persist qua localStorage; default `system`.
- Sidebar filter đúng theo role (admin thấy Users, operator không thấy).
- User menu hiện email + role + nút Sign out hoạt động.
- Không regression: tất cả test hiện có pass (73+), build sạch, lint sạch.
- E2E smoke pass cho shell + key pages.

## 2. Quyết định công nghệ

| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| CSS engine | Tailwind CSS v4 | Latest stable, no config file needed (CSS-first), shadcn v3 hỗ trợ |
| Component primitives | shadcn/ui (copy-into-repo) | Components nằm trong repo, tuỳ biến trực tiếp, không lock framework |
| Theme switching | `next-themes` | Chuẩn de facto cho Next.js, SSR-safe, hỗ trợ system preference |
| Icons | `lucide-react` | Default của shadcn, ~1500 icon, tree-shakable |
| Toast/notification | `sonner` | shadcn maintainer khuyến nghị; nhẹ; SSR-safe |
| Form | shadcn Form + `react-hook-form` + `zod` | Type-safe, validation tích hợp; zod đã có sẵn trong repo |

## 3. Design tokens

CSS variables ở `app/globals.css` theo cú pháp shadcn (cùng tên biến cho cả 2 mode):

```css
@import "tailwindcss";

@theme {
  --color-bg: oklch(98% 0 0);
  --color-surface: oklch(100% 0 0);
  --color-border: oklch(94% 0 0);
  --color-text: oklch(15% 0.03 270);
  --color-muted: oklch(50% 0.02 270);
  --color-primary: oklch(58% 0.22 280);
  --color-primary-foreground: oklch(100% 0 0);
  --color-success: oklch(60% 0.16 145);
  --color-danger: oklch(60% 0.22 25);
  --color-warning: oklch(70% 0.18 75);

  --radius-sm: 0.25rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;

  --font-sans: "Geist Sans", system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
}

[data-theme="dark"] {
  --color-bg: oklch(8% 0 0);
  --color-surface: oklch(11% 0 0);
  --color-border: oklch(20% 0 0);
  --color-text: oklch(95% 0 0);
  --color-muted: oklch(60% 0 0);
  --color-primary: oklch(100% 0 0);
  --color-primary-foreground: oklch(8% 0 0);
  --color-success: oklch(70% 0.18 145);
  --color-danger: oklch(65% 0.22 25);
  --color-warning: oklch(80% 0.18 75);
}
```

(Implementer chỉnh chi tiết khi gặp; values trên là khởi điểm chuẩn shadcn-like.)

### Typography

Geist Sans + Geist Mono (cài qua `next/font/google` hoặc `geist` npm package). Sans cho body/UI; Mono cho store domain, ID, hash, path.

### Spacing & radii

Theo Tailwind default scale. Page padding: `p-6` (24px). Card padding: `p-4` (16px). Radii cho input/badge `rounded-sm` (4px); button/card `rounded-md` (6px); dialog `rounded-lg` (8px).

## 4. Architecture

### Route groups (Next.js, không đổi URL)

```
app/
  (auth)/
    layout.tsx           # Minimal centered card layout
    sign-in/page.tsx     # MOVED here
    sign-up/page.tsx     # MOVED here
  (dashboard)/
    layout.tsx           # AppShell: sidebar + topbar + main
    page.tsx             # MOVED here (home dashboard)
    stores/connect/page.tsx
    admin/users/page.tsx
    f/settings-viewer/page.tsx
    f/settings-sync/...
  layout.tsx             # Root: theme provider, font, html lang
  globals.css            # Tailwind + tokens
```

Tất cả các page hiện có MOVE vào route group tương ứng. URL của user không đổi (route groups dùng dấu ngoặc đơn nên bị strip khỏi URL).

### Components

```
components/
  shell/
    AppShell.tsx         # Composes Sidebar + Topbar + main
    Sidebar.tsx          # Server component, takes role + currentPath
    Topbar.tsx           # Client (interactive: theme toggle, user menu)
    UserMenu.tsx         # Client, Avatar + DropdownMenu + Sign out
    ThemeToggle.tsx      # Client, next-themes setTheme
    PendingReconciliationBadge.tsx  # Server, count in sidebar nav
  ui/                    # shadcn primitives (installed via CLI)
    button.tsx
    input.tsx
    label.tsx
    card.tsx
    table.tsx
    select.tsx
    dialog.tsx
    dropdown-menu.tsx
    tabs.tsx
    badge.tsx
    textarea.tsx
    form.tsx
    avatar.tsx
    separator.tsx
    sheet.tsx            # Mobile sidebar drawer
    alert.tsx
    sonner.tsx           # Toast
lib/
  nav.ts                 # Nav items + permission gating
  theme/provider.tsx     # ThemeProvider wrapper
```

### Sidebar nav model (`lib/nav.ts`)

```typescript
interface NavItem { href: string; label: string; icon: LucideIcon; requires: Permission | null; }
export const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, requires: null },
  { href: '/stores/connect', label: 'Stores', icon: Store, requires: 'manage_stores' },
  { href: '/f/settings-viewer', label: 'Settings Viewer', icon: Eye, requires: 'run_feature' },
  { href: '/f/settings-sync', label: 'Settings Sync', icon: Settings, requires: 'run_feature' },
  { href: '/f/settings-sync/history', label: 'History', icon: History, requires: 'view_settings_history' },
  { href: '/admin/users', label: 'Users', icon: Users, requires: 'manage_users' },
];
```

`Sidebar.tsx` (server) nhận `role` và filter NAV theo `hasPermission`. Highlight item active dựa trên `pathname` prefix.

### Topbar

Layout: `[logo] ────── [breadcrumb] ────── [theme toggle] [user menu]`.

User menu (shadcn DropdownMenu):
- Header: email + role badge
- Theme: 3 nút (Light / Dark / System)
- Separator
- Sign out → POST `/api/auth/sign-out/email` của Better-Auth → reload

### Theme provider

Root layout wrap với `<ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>`. Toggle viết `data-theme="dark"` lên `<html>`. Persist localStorage qua next-themes.

## 5. Per-page redesigns (briefs)

Tất cả: giữ nguyên server-side logic, RBAC check, server actions; chỉ thay JSX presentational + inline styles bằng shadcn primitives.

### Auth pages — `app/(auth)/layout.tsx`

Centered single-column, full-height, vài branding minimal ở header (chỉ logo + tên app).

**Sign-in** (`/sign-in`):
- Card (max-w 400px), CardHeader "Sign in", CardContent Form (email + password) + Submit Button + Link "Need an account? Sign up".

**Sign-up** (`/sign-up`):
- Same shape. Card "Create account", Form (name + email + password) + Submit + Link to sign-in.

### Dashboard pages — `app/(dashboard)/layout.tsx`

**Home `/`**:
- Toolbar: page title "Dashboard", primary Button "+ Connect a store" (admin only).
- 4 KPI cards in `grid grid-cols-4 gap-4`: Stores total · Active · Pending reconciliation · Recent applies (last 7d). Each card: number + label + subtle icon.
- "Connected stores" Card containing Table: Name, Domain (mono), Status Badge, Test Connection action.

**Stores connect `/stores/connect`**:
- Card "Connect a store". Form: shop domain Input (placeholder `your-shop.myshopify.com`), Submit Button "Connect via Shopify OAuth".
- Hint Alert with format requirements + scope re-OAuth note.

**Admin users `/admin/users`**:
- Toolbar: title "Users". Description below.
- Table: Email | Name | Role Badge | Created | Action.
- Action column: Select (role/none) + Save Button per row.
- Self-row: Select disabled for non-admin options; helper text "(self — locked)".
- Toast on save success/failure via sonner.

**Settings Viewer `/f/settings-viewer`**:
- Title "Settings Viewer".
- For each store: Card with CardHeader (store name + status Badge), Tabs "Shipping" / "Checkout":
  - Shipping tab: pretty-printed JSON in monospace Card or simple list rendering.
  - Checkout tab: "Available" or "Needs migration" state with appropriate Alert.

**Settings Sync home `/f/settings-sync`**:
- Pending-reconciliation Alert at top if any.
- 3 cards: Templates · Apply · History — each is a clickable card with icon + count + description.

**Templates list `/f/settings-sync/templates`**:
- 2 Cards (shipping, checkout-buyer-experience). Each: domain title, latest version + timestamp, Edit Button (admin).

**Template edit `/f/settings-sync/templates/[domain]/edit`**:
- Title "Edit {domain} template". Textarea monospace (rows=24, full width), Submit Button "Save new version".
- Show current latest version number + author + timestamp above textarea.

**Apply `/f/settings-sync/apply`**:
- 3-step stepper-ish flow in one page:
  1. **Choose**: 3 Selects (domain, store, version) + "Preview" submit (GET form).
  2. **Preview**: collapsible diff cards (creates/updates/deletes count + JSON detail).
  3. **Apply**: target stores checklist + "Apply to selected stores" Button.
- Visual separation between steps.

**History list `/f/settings-sync/history`**:
- Table: When, Domain, Stores count, Status Badge, Detail link.

**Run detail `/f/settings-sync/history/[runId]`**:
- Card "Status: {status}". Summary Card (pretty JSON). Snapshots Card (list). Rollback Button (yellow/warning, with clear "manual restore required" Alert above).

**Reconcile wizard `/f/settings-sync/reconcile/[storeId]/[domain]`**:
- Card with intro text. Table: Path (mono) | Radio "Keep as override" | Radio "Discard on next apply". Submit Button.
- Empty state ("no unreconciled paths") → simple "Mark reconciled" button.

**Per-store overrides `/f/settings-sync/stores/[id]/overrides/[domain]`**:
- Table: Path (mono) | Value (JSON pretty) | Remove Button. Inline Add Form below: Input path + Input value + Add/Update Button.

## 6. Theme switching

`next-themes`:
- `<ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>` ở root.
- `ThemeToggle.tsx` calls `setTheme(mode)`. Modes: `light` | `dark` | `system`.
- localStorage key: `theme` (default của next-themes).
- Persist across reloads; no flicker (next-themes inserts a script in head to prevent FOUC).

## 7. Sign-out

`UserMenu.tsx` triggers a POST to Better-Auth sign-out endpoint then redirect to `/sign-in`. Use Better-Auth's react client:

```typescript
const handleSignOut = async () => {
  await authClient.signOut();
  router.push('/sign-in');
};
```

## 8. Testing

**Unit:** không thêm (UI). RBAC + canChangeRole đã có tests.

**E2E smoke (`tests/e2e/shell.spec.ts`)**:
- Home `/` redirects to `/sign-in` if no session (unchanged logic).
- Sign-in page renders Card with form.
- Sign-up page renders + cross-link.
- After mock-signed-in (skip in CI without DB): AppShell renders Sidebar + Topbar; theme toggle changes data-theme attr; user menu shows email; sign-out redirects.

E2E specs sử dụng `getByRole`/`getByLabel` để không phụ thuộc class names — robust qua redesign.

## 9. Migration plan

1. Cài deps + Tailwind + shadcn → globals.css.
2. Move existing pages vào route groups.
3. Build shell components.
4. Redesign từng page (1 commit/page hoặc gom small ones).
5. Cleanup inline styles còn sót.
6. Update E2E specs.
7. Verify build + manual sweep.

## 10. Risks & open questions

- **Tailwind v4 + Next.js 16 + Turbopack** — sự kết hợp này tương đối mới; verify Tailwind hot reload + tree-shaking khi implement. Có fallback v3 nếu v4 không stable.
- **shadcn CLI cần `components.json` config** — chuẩn shadcn. Implementer chạy `npx shadcn@latest init` để sinh ra.
- **Font Geist** — license OK cho production (Vercel cấp miễn phí). Cài qua `geist` package: `npm install geist`.
- **Branding/logo** — hiện chưa có. Dùng emoji ◆ + text "Shopify Mgmt" hoặc text mark "▲ shopify-mgmt" cho đến khi user cấp asset.
- **Mobile responsiveness** — sidebar collapsible qua Sheet ở md breakpoint trở xuống. Acceptable. Mobile-first chi tiết không phải primary use case (admin tool desktop).

## 11. Câu hỏi mở (giải quyết khi implement)

- Logo/branding cuối cùng — placeholder bằng text mark.
- Animation/motion — tối thiểu (shadcn defaults). Polish thêm ở spec sau nếu muốn.
- Storybook/component playground — defer.
