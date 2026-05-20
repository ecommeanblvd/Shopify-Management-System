import Link from 'next/link';
import { UserMenu } from './UserMenu';
import { ThemeToggle } from './ThemeToggle';
import type { Role } from '@/lib/auth/rbac';

interface TopbarProps { email: string; name: string | null; role: Role }

export function Topbar({ email, name, role }: TopbarProps) {
  return (
    <header className="h-14 border-b flex items-center justify-between px-6 bg-[var(--color-surface)]">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <span className="text-base">◆</span>
        <span>Shopify Mgmt</span>
      </Link>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserMenu email={email} name={name} role={role} />
      </div>
    </header>
  );
}
