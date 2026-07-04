# Quản lí đơn P1 — gom nav + tab bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gom "Vận hành đơn" + "Vòng đời đơn" thành 1 nav entry "Quản lí đơn" + tab bar chung (Việc cần làm / Vòng đời / Thống kê) đầu 3 trang. Giữ nguyên logic + 2 trang chi tiết.

**Architecture:** `lib/nav.ts` thay 2 entry bằng 1 (thêm `match` để Sidebar highlight route con); helper thuần `navItemActive`; component client `OrderTabs` render đầu 3 trang. Không đổi query/detail/logic.

**Tech Stack:** Next.js App Router, React 19, Tailwind, lucide-react, Vitest.

## Global Constraints

- KHÔNG đổi RBAC (`view_fulfillment` giữ nguyên cho cả 3 tab, gate ở từng page như hiện tại).
- KHÔNG đụng query/detail/logic worklist/lifecycle — chỉ nav + tab UI.
- KHÔNG migration.
- lucide-react: import icon đã có (`ClipboardList`); bản này dùng tên chuẩn lucide.
- Tiếng Việt, sentence case.

---

### Task 1: `lib/nav.ts` — gom entry + helper `navItemActive` + Sidebar highlight

**Files:**
- Modify: `lib/nav.ts`
- Modify: `components/shell/Sidebar.tsx`
- Test: `lib/nav.test.ts`

**Interfaces:**
- Produces: `NavItem.match?: string[]`; `navItemActive(currentPath, item): boolean`.

- [ ] **Step 1: Test (FAIL trước)**

```ts
// lib/nav.test.ts
import { describe, it, expect } from 'vitest';
import { navItemActive } from './nav';

describe('navItemActive', () => {
  const item = { href: '/f/fulfillment', match: ['/f/lifecycle'] };
  it('exact href → active', () => { expect(navItemActive('/f/fulfillment', item)).toBe(true); });
  it('route con của href → active', () => { expect(navItemActive('/f/fulfillment/brand-requests', item)).toBe(true); });
  it('route trong match (lifecycle) → active', () => {
    expect(navItemActive('/f/lifecycle', item)).toBe(true);
    expect(navItemActive('/f/lifecycle/stats', item)).toBe(true);
  });
  it('route khác → không active', () => { expect(navItemActive('/f/ship-ho', item)).toBe(false); });
  it('không match "/" như prefix', () => {
    expect(navItemActive('/f/orders', { href: '/' })).toBe(false);
    expect(navItemActive('/', { href: '/' })).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy — FAIL**

Run: `npx vitest run lib/nav.test.ts`
Expected: FAIL (`navItemActive` chưa export).

- [ ] **Step 3: Implement `lib/nav.ts`**

1. Thêm `match?` vào interface:
```ts
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** null = ai cũng thấy; mảng = có MỘT trong các quyền là thấy (OR). */
  requires: Permission | Permission[] | null;
  description?: string;
  /** Prefix path phụ để Sidebar highlight khi ở route con của module (vd tab khác route). */
  match?: string[];
}
```

2. Thay 2 dòng `/f/fulfillment` + `/f/lifecycle` trong `NAV` bằng 1:
```ts
  { href: '/f/fulfillment',   label: 'Quản lí đơn',   icon: ClipboardList,   requires: 'view_fulfillment', match: ['/f/lifecycle'] },
```
(Xoá dòng `Activity`/`/f/lifecycle` cũ. Có thể bỏ import `Activity` nếu không còn dùng — kiểm trước khi xoá.)

3. Thêm helper thuần cuối file:
```ts
/** Nav item active khi path trùng href, là route con của href, hoặc thuộc match[]. */
export function navItemActive(currentPath: string, item: Pick<NavItem, 'href' | 'match'>): boolean {
  if (currentPath === item.href) return true;
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some((p) => p !== '/' && currentPath.startsWith(p));
}
```

- [ ] **Step 4: Chạy — PASS**

Run: `npx vitest run lib/nav.test.ts` → PASS.

- [ ] **Step 5: Sidebar dùng helper**

Trong `components/shell/Sidebar.tsx`, đổi dòng tính `active`:
```tsx
import { NAV, navItemActive } from '@/lib/nav';
```
```tsx
          const active = navItemActive(currentPath, item);
```

- [ ] **Step 6: tsc + commit**

Run: `npx tsc --noEmit` → 0.
```bash
git add lib/nav.ts lib/nav.test.ts components/shell/Sidebar.tsx
git commit -m "feat(orders): gom nav 'Quản lí đơn' + navItemActive highlight route con"
```

---

### Task 2: `OrderTabs` + gắn đầu 3 trang

**Files:**
- Create: `components/orders/OrderTabs.tsx`
- Modify: `app/(dashboard)/f/fulfillment/page.tsx`
- Modify: `app/(dashboard)/f/lifecycle/page.tsx`
- Modify: `app/(dashboard)/f/lifecycle/stats/page.tsx`

**Interfaces:**
- Consumes: `usePathname` (next/navigation).
- Produces: `<OrderTabs />` — tab bar 3 mục, active theo pathname.

- [ ] **Step 1: Component**

```tsx
// components/orders/OrderTabs.tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: Array<{ href: string; label: string }> = [
  { href: '/f/fulfillment', label: 'Việc cần làm' },
  { href: '/f/lifecycle', label: 'Vòng đời' },
  { href: '/f/lifecycle/stats', label: 'Thống kê' },
];

function activeHref(path: string): string {
  if (path.startsWith('/f/lifecycle/stats')) return '/f/lifecycle/stats';
  if (path.startsWith('/f/lifecycle')) return '/f/lifecycle';
  return '/f/fulfillment';
}

export function OrderTabs() {
  const path = usePathname() ?? '/f/fulfillment';
  const active = activeHref(path);
  return (
    <div className="flex gap-1 border-b mb-6">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={
            'px-3 py-2 text-sm -mb-px border-b-2 transition-colors ' +
            (active === t.href
              ? 'border-foreground text-foreground font-medium'
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

- [ ] **Step 2: Gắn vào 3 trang**

Ở mỗi trang, import và render `<OrderTabs />` ngay đầu khối JSX trả về (sau `<div>` ngoài cùng, trước tiêu đề). Cụ thể:

- `app/(dashboard)/f/fulfillment/page.tsx`: `import { OrderTabs } from '@/components/orders/OrderTabs';` rồi đặt `<OrderTabs />` đầu container.
- `app/(dashboard)/f/lifecycle/page.tsx`: chèn `<OrderTabs />` ngay sau `<div className="px-6 md:px-10 py-8 md:py-12 space-y-6">`, trước khối header.
- `app/(dashboard)/f/lifecycle/stats/page.tsx`: chèn `<OrderTabs />` ngay sau `<div className="px-6 md:px-10 py-8 md:py-12 space-y-6">`, trước header.

> Lưu ý cấu trúc từng trang khác nhau — đọc file, đặt `<OrderTabs />` là phần tử con đầu tiên của container ngoài cùng để tab bar nằm trên cùng nội dung. Không đổi phần còn lại.

- [ ] **Step 3: tsc + eslint + commit**

Run: `npx tsc --noEmit` → 0.
Run: `npx eslint components/orders/OrderTabs.tsx "app/(dashboard)/f/fulfillment/page.tsx" "app/(dashboard)/f/lifecycle/page.tsx" "app/(dashboard)/f/lifecycle/stats/page.tsx"` → 0.
```bash
git add components/orders/OrderTabs.tsx "app/(dashboard)/f/fulfillment/page.tsx" "app/(dashboard)/f/lifecycle/page.tsx" "app/(dashboard)/f/lifecycle/stats/page.tsx"
git commit -m "feat(orders): tab bar chung (Việc cần làm/Vòng đời/Thống kê) đầu 3 trang"
```

---

## Self-Review (đã chạy)

- **Spec coverage:** nav gom 1 entry (T1) ✓ · Sidebar highlight route con (T1) ✓ · tab bar 3 tab đầu 3 trang (T2) ✓ · giữ detail/logic (không đụng) ✓ · không migration ✓.
- **Placeholder scan:** không TODO; code đầy đủ (trừ vị trí chèn OrderTabs mô tả rõ theo cấu trúc từng trang — implementer đọc file đặt đúng).
- **Type consistency:** `navItemActive` nhận `Pick<NavItem,'href'|'match'>`; `match?` thêm ở interface; Sidebar dùng đúng. `activeHref` xử lý stats-là-con-của-lifecycle đúng (check stats trước).
- **Rủi ro:** bỏ import `Activity` nếu thành unused (eslint) — implementer kiểm; RBAC không đổi (page-level gate còn nguyên); tab bar chỉ là Link, không gate (page tự gate).
