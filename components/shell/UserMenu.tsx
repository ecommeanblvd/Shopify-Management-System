'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { authClient } from '@/lib/auth/client';
import { buttonVariants } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface UserMenuProps { email: string; name: string | null; role: string }

export function UserMenu({ email, name, role }: UserMenuProps) {
  const router = useRouter();
  const initial = (name ?? email).charAt(0).toUpperCase();
  async function handleSignOut() {
    await authClient.signOut();
    router.push('/sign-in');
    router.refresh();
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants({ variant: 'ghost' }) + ' px-2 gap-2'}>
        <Avatar className="size-7"><AvatarFallback>{initial}</AvatarFallback></Avatar>
        <span className="text-sm">{name ?? email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="font-medium">{name ?? email}</div>
          <div className="text-xs text-muted-foreground">{email}</div>
          <div className="text-xs text-muted-foreground mt-1">Role: <span className="font-mono">{role}</span></div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}><LogOut className="size-4 mr-2" />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
