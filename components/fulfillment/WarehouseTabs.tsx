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
