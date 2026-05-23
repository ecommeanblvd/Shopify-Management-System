import Link from 'next/link';
import { NAV } from '@/lib/nav';
import { hasPermission, type Role } from '@/lib/auth/rbac';

interface SidebarProps { role: Role; currentPath: string }

export function Sidebar({ role, currentPath }: SidebarProps) {
  const visible = NAV.filter((item) => item.requires === null || hasPermission(role, item.requires));
  return (
    <aside className="w-60 shrink-0 border-r h-full bg-[var(--color-surface)]">
      <nav className="p-3 space-y-1">
        {visible.map((item) => {
          const Icon = item.icon;
          const active = currentPath === item.href || (item.href !== '/' && currentPath.startsWith(item.href));
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
