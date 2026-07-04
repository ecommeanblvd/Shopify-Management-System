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
