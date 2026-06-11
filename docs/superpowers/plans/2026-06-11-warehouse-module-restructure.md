# Tách "Kho hàng" thành module riêng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Module "Kho hàng" độc lập trên sidebar (`/f/warehouse/*` với tab Tồn kho · Khu chờ · Nhập kho & QC), mục "Nhập kho & QC" rời sidebar, redirect vĩnh viễn từ URL cũ.

**Architecture:** Chỉ điều hướng + route: di chuyển 4 page dưới `app/(dashboard)/f/warehouse/`, thêm `layout.tsx` tab bar dùng chung, mở rộng `NavItem.requires` nhận mảng permission (OR), redirects khai báo trong `next.config.ts`. KHÔNG đổi logic nghiệp vụ/permission.

**Tech Stack:** Next.js 16 App Router, lucide-react, RBAC sẵn có (`lib/auth/rbac`).

**Spec:** `docs/superpowers/specs/2026-06-11-warehouse-module-restructure-design.md`

---

### Task 1: `lib/nav.ts` — requires dạng mảng (OR) + đổi item sidebar

**Files:**
- Modify: `lib/nav.ts`
- Modify: `components/shell/Sidebar.tsx`

- [ ] **Step 1.1: Sửa `lib/nav.ts`**

Đổi kiểu `NavItem.requires`, thêm helper `canSeeNavItem`, thay 2 item:

```ts
// interface NavItem — đổi 1 dòng:
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** null = ai cũng thấy; mảng = có MỘT trong các quyền là thấy (OR). */
  requires: Permission | Permission[] | null;
  description?: string;
}

// SettingsNavItem giữ Permission đơn — KHÔNG đổi:
export interface SettingsNavItem extends NavItem {
  requires: Permission;
  description: string;
  group: SettingsGroup;
}

// Helper mới (đặt cạnh canSeeSettings):
/** True khi role thấy được item (null = public, mảng = OR từng quyền). */
export function canSeeNavItem(role: string, requires: NavItem['requires']): boolean {
  if (requires === null) return true;
  const list = Array.isArray(requires) ? requires : [requires];
  return list.some((p) => hasPermission(role, p));
}
```

Trong mảng `NAV`: xoá dòng `Nhập kho & QC`, thay bằng item `Kho hàng` ngay SAU `Vận hành đơn`:

```ts
import { ..., Warehouse } from 'lucide-react'; // thêm Warehouse vào import sẵn có

export const NAV: NavItem[] = [
  { href: '/',                label: 'Dashboard',     icon: LayoutDashboard, requires: null },
  { href: '/f/orders',        label: 'Orders',        icon: ShoppingBag,     requires: 'view_orders' },
  { href: '/f/fulfillment',   label: 'Vận hành đơn', icon: ClipboardList,   requires: 'view_fulfillment' },
  { href: '/f/warehouse',     label: 'Kho hàng',      icon: Warehouse,       requires: ['view_fulfillment', 'view_receiving'] },
  { href: '/f/carrier-rates', label: 'Carrier rates', icon: Truck,           requires: 'view_carrier_rates' },
  { href: '/f/shipping-reconcile', label: 'Đối soát phí ship', icon: Receipt, requires: 'view_carrier_rates' },
  { href: '/f/mmp',           label: 'Products',      icon: Package,         requires: 'view_mmp_products' },
  { href: '/f/functions',     label: 'Functions',     icon: Sparkles,        requires: 'view_functions' },
  { href: '/settings',        label: 'Settings',      icon: Settings,        requires: null },
];
```

`PackageCheck` không còn dùng → bỏ khỏi import lucide (eslint sẽ nhắc nếu sót).

- [ ] **Step 1.2: Sửa filter trong `components/shell/Sidebar.tsx`**

```ts
import { NAV, canSeeSettings, canSeeNavItem } from '@/lib/nav';
// bỏ import hasPermission nếu không còn chỗ dùng

const visible = NAV.filter((item) => {
  if (item.href === '/settings') return canSeeSettings(role);
  return canSeeNavItem(role, item.requires);
});
```

Lưu ý active-state hiện tại dùng `currentPath.startsWith(item.href)`: `/f/warehouse/staging` sẽ sáng đúng mục "Kho hàng"; `/f/fulfillment/...` sáng "Vận hành đơn" — không cần sửa.

- [ ] **Step 1.3: Kiểm tra**

Run: `npx tsc --noEmit && npx eslint lib/nav.ts components/shell/Sidebar.tsx`
Expected: sạch. (`SETTINGS_ITEMS` vẫn type-check vì `Permission` ⊂ `Permission | Permission[] | null`.)

- [ ] **Step 1.4: Commit**

```bash
git add lib/nav.ts components/shell/Sidebar.tsx
git commit -m "feat(nav): mục Kho hàng (OR-permission), bỏ mục Nhập kho & QC khỏi sidebar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Di chuyển route + layout tab bar `/f/warehouse/*`

**Files:**
- Move (git mv): `app/(dashboard)/f/fulfillment/warehouse/page.tsx` → `app/(dashboard)/f/warehouse/page.tsx`
- Move: `app/(dashboard)/f/fulfillment/staging/page.tsx` → `app/(dashboard)/f/warehouse/staging/page.tsx`
- Move: `app/(dashboard)/f/fulfillment/receiving/page.tsx` → `app/(dashboard)/f/warehouse/receiving/page.tsx`
- Move: `app/(dashboard)/f/fulfillment/receiving/[id]/page.tsx` → `app/(dashboard)/f/warehouse/receiving/[id]/page.tsx`
- Create: `app/(dashboard)/f/warehouse/layout.tsx`
- Create: `components/fulfillment/WarehouseTabs.tsx`

- [ ] **Step 2.1: git mv 4 file**

```bash
mkdir -p "app/(dashboard)/f/warehouse/receiving/[id]" "app/(dashboard)/f/warehouse/staging"
git mv "app/(dashboard)/f/fulfillment/warehouse/page.tsx" "app/(dashboard)/f/warehouse/page.tsx"
git mv "app/(dashboard)/f/fulfillment/staging/page.tsx" "app/(dashboard)/f/warehouse/staging/page.tsx"
git mv "app/(dashboard)/f/fulfillment/receiving/page.tsx" "app/(dashboard)/f/warehouse/receiving/page.tsx"
git mv "app/(dashboard)/f/fulfillment/receiving/[id]/page.tsx" "app/(dashboard)/f/warehouse/receiving/[id]/page.tsx"
rmdir "app/(dashboard)/f/fulfillment/warehouse" "app/(dashboard)/f/fulfillment/staging" "app/(dashboard)/f/fulfillment/receiving/[id]" "app/(dashboard)/f/fulfillment/receiving"
```

Import trong các page đều là alias `@/...` nên không vỡ khi di chuyển.

- [ ] **Step 2.2: Tab bar client — `components/fulfillment/WarehouseTabs.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Tab { href: string; label: string }

/** Tab bar của module Kho hàng. Tab sáng theo prefix dài nhất khớp pathname
 *  (route con như /receiving/[id] sáng tab Nhập kho & QC). */
export function WarehouseTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  // prefix dài nhất khớp: "/f/warehouse" khớp mọi path nên phải so sánh độ dài
  const active = tabs.reduce<Tab | null>((best, t) => {
    const hit = pathname === t.href || pathname.startsWith(t.href + '/');
    if (!hit) return best;
    return !best || t.href.length > best.href.length ? t : best;
  }, null);
  return (
    <div className="flex gap-1 border-b border-border px-6">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={
            'border-b-2 px-3 py-2 text-sm transition-colors ' +
            (active?.href === t.href
              ? 'border-foreground font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground')
          }
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2.3: Layout server — `app/(dashboard)/f/warehouse/layout.tsx`**

```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { WarehouseTabs } from '@/components/fulfillment/WarehouseTabs';

/** Khung module Kho hàng: tab Tồn kho · Khu chờ · Nhập kho & QC.
 *  Layout chỉ lo tab theo quyền XEM; từng page giữ nguyên guard riêng. */
export default async function WarehouseLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || (!hasPermission(role, 'view_fulfillment') && !hasPermission(role, 'view_receiving'))) {
    redirect('/');
  }
  const tabs = [
    ...(hasPermission(role, 'view_fulfillment')
      ? [{ href: '/f/warehouse', label: 'Tồn kho' },
         { href: '/f/warehouse/staging', label: 'Khu chờ' }]
      : []),
    ...(hasPermission(role, 'view_receiving')
      ? [{ href: '/f/warehouse/receiving', label: 'Nhập kho & QC' }]
      : []),
  ];
  return (
    <div>
      <WarehouseTabs tabs={tabs} />
      {children}
    </div>
  );
}
```

Lưu ý: user CHỈ có `view_receiving` vào `/f/warehouse` sẽ bị guard của page Tồn kho
(`view_fulfillment`) redirect về `/` — đúng spec §6 ("chỉ vào được tab Nhập & QC").

- [ ] **Step 2.4: Kiểm tra**

Run: `npx tsc --noEmit && npx eslint "app/(dashboard)/f/warehouse/**" components/fulfillment/WarehouseTabs.tsx`
Expected: sạch.

- [ ] **Step 2.5: Commit**

```bash
git add -A "app/(dashboard)/f" components/fulfillment/WarehouseTabs.tsx
git commit -m "feat(warehouse): module /f/warehouse — chuyển 4 route, layout tab bar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Redirect URL cũ trong `next.config.ts`

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 3.1: Thêm `redirects()`**

```ts
const nextConfig: NextConfig = {
  images: { /* giữ nguyên phần hiện có */ },
  // URL cũ của 3 trang kho (trước 2026-06-11 nằm dưới /f/fulfillment) —
  // redirect vĩnh viễn để bookmark/link nội bộ cũ không chết.
  async redirects() {
    return [
      { source: '/f/fulfillment/warehouse', destination: '/f/warehouse', permanent: true },
      { source: '/f/fulfillment/staging', destination: '/f/warehouse/staging', permanent: true },
      { source: '/f/fulfillment/receiving', destination: '/f/warehouse/receiving', permanent: true },
      { source: '/f/fulfillment/receiving/:id', destination: '/f/warehouse/receiving/:id', permanent: true },
    ];
  },
};
```

- [ ] **Step 3.2: Commit**

```bash
git add next.config.ts
git commit -m "feat(warehouse): redirect vĩnh viễn URL kho cũ sang /f/warehouse/*

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Dọn tham chiếu nội bộ (link + revalidatePath)

**Files:**
- Modify: `app/(dashboard)/f/fulfillment/page.tsx`
- Modify: `app/(dashboard)/f/warehouse/receiving/page.tsx` (đã move ở Task 2)
- Modify: `features/fulfillment/warehouse-actions.ts:61,100,150`
- Modify: `features/receiving/actions.ts:73,103,230`

- [ ] **Step 4.1: `app/(dashboard)/f/fulfillment/page.tsx` — bỏ 2 nút, giữ Yêu cầu brand**

Xoá nguyên 2 block `<Link href="/f/fulfillment/warehouse">…Kho MEAN…</Link>` và
`<Link href="/f/fulfillment/staging">…Khu chờ…</Link>` (dòng 40-51). Giữ
BackfillButton + link "Yêu cầu brand".

- [ ] **Step 4.2: Trang receiving — link sang chi tiết phiếu + redirect sau tạo phiếu**

Trong `app/(dashboard)/f/warehouse/receiving/page.tsx`, thay MỌI chuỗi
`/f/fulfillment/receiving` → `/f/warehouse/receiving` (link dòng ~116 và 2 chỗ
`redirect(\`/f/fulfillment/receiving/${id}\`)` trong server action đầu file).

- [ ] **Step 4.3: revalidatePath**

`features/fulfillment/warehouse-actions.ts`: 3 chỗ
`revalidatePath('/f/fulfillment/warehouse')` → `revalidatePath('/f/warehouse')`.

`features/receiving/actions.ts`:
- dòng 73, 230: `revalidatePath('/f/fulfillment/receiving')` → `'/f/warehouse/receiving'`
- dòng 103: `` revalidatePath(`/f/fulfillment/receiving/${input.receiptId}`) `` → `` `/f/warehouse/receiving/${input.receiptId}` ``
- dòng 231 `revalidatePath('/f/fulfillment')` GIỮ NGUYÊN (worklist vẫn ở đó).
- Nếu actions có chỗ `revalidatePath('/f/fulfillment/staging')` (grep) → `'/f/warehouse/staging'`.

- [ ] **Step 4.4: Grep sạch toàn repo**

Run: `grep -rn "/f/fulfillment/\(warehouse\|staging\|receiving\)" --include="*.ts" --include="*.tsx" app components features lib`
Expected: 0 kết quả (next.config.ts không nằm trong các thư mục này nên redirect không bị grep dính).

- [ ] **Step 4.5: Commit**

```bash
git add app components features
git commit -m "refactor(warehouse): trỏ link + revalidatePath sang /f/warehouse/*

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Tổng kiểm + build + push

- [ ] **Step 5.1:** `npx tsc --noEmit` — Expected: sạch.
- [ ] **Step 5.2:** `npx vitest run` — Expected: 822+ pass / 14 skipped (không đụng logic).
- [ ] **Step 5.3:** `npx eslint .` — Expected: 0 errors.
- [ ] **Step 5.4:** `npx next build` — Expected: pass; route list có `/f/warehouse`, `/f/warehouse/staging`, `/f/warehouse/receiving`, `/f/warehouse/receiving/[id]` và KHÔNG còn `/f/fulfillment/warehouse|staging|receiving`.
- [ ] **Step 5.5:** Push

```bash
git push origin main
```
