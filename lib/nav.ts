import { LayoutDashboard, Store, Eye, Settings, History, Users } from 'lucide-react';
import type { Permission } from '@/lib/auth/rbac';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  requires: Permission | null;
}

export const NAV: NavItem[] = [
  { href: '/',                        label: 'Dashboard',       icon: LayoutDashboard, requires: null },
  { href: '/stores/connect',          label: 'Stores',          icon: Store,           requires: 'manage_stores' },
  { href: '/f/settings-viewer',       label: 'Settings Viewer', icon: Eye,             requires: 'run_feature' },
  { href: '/f/settings-sync',         label: 'Settings Sync',   icon: Settings,        requires: 'run_feature' },
  { href: '/f/settings-sync/history', label: 'History',         icon: History,         requires: 'view_settings_history' },
  { href: '/admin/users',             label: 'Users',           icon: Users,           requires: 'manage_users' },
];
