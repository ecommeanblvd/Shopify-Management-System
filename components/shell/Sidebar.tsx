'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV, navItemActive } from '@/lib/nav';

interface SidebarProps {
  /** Hrefs the current role may see — computed server-side (the permission
   *  cache is empty in the browser, so the client must NOT re-derive it). */
  visibleHrefs: string[];
}

export function Sidebar({ visibleHrefs }: SidebarProps) {
  // usePathname phản ứng theo client navigation — KHÔNG dùng prop server tĩnh,
  // nếu không highlight sẽ kẹt ở trang được render server lần đầu.
  const currentPath = usePathname() ?? '/';
  const allowed = new Set(visibleHrefs);
  const visible = NAV.filter((item) => allowed.has(item.href));
  return (
    <aside className="w-60 shrink-0 border-r overflow-y-auto bg-[var(--color-surface)]">
      <nav className="p-3 space-y-1">
        {visible.map((item) => {
          const Icon = item.icon;
          const active = navItemActive(currentPath, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ' +
                (active
                  ? 'bg-[var(--color-muted-surface)] text-[var(--color-text)] font-medium'
                  : 'text-[var(--color-text)]/80 hover:bg-[var(--color-muted-surface)] hover:text-[var(--color-text)]')
              }
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
