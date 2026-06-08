import { LayoutDashboard, Store, Eye, Settings, History, Users, Globe, ToggleRight, Truck, ShoppingBag, Sparkles, Package } from 'lucide-react';
import { hasPermission, type Permission, type Role } from '@/lib/auth/rbac';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  requires: Permission | null;
  description?: string;
}

export type SettingsGroup = 'Stores' | 'Settings Sync' | 'Markets' | 'Admin';

export interface SettingsNavItem extends NavItem {
  requires: Permission;       // every settings item is permission-gated
  description: string;
  group: SettingsGroup;
}

/** Top-level sidebar: the frequently-used modules + a Settings hub entry. */
export const NAV: NavItem[] = [
  { href: '/',                label: 'Dashboard',     icon: LayoutDashboard, requires: null },
  { href: '/f/orders',        label: 'Orders',        icon: ShoppingBag,     requires: 'view_orders' },
  { href: '/f/carrier-rates', label: 'Carrier rates', icon: Truck,           requires: 'view_carrier_rates' },
  { href: '/f/mmp',           label: 'Products',      icon: Package,         requires: 'view_mmp_products' },
  { href: '/f/functions',     label: 'Functions',     icon: Sparkles,        requires: 'view_functions' },
  { href: '/settings',        label: 'Settings',      icon: Settings,        requires: null },
];

/** Rarely-used "set up once / check occasionally" modules, shown on /settings. */
export const SETTINGS_ITEMS: SettingsNavItem[] = [
  { href: '/stores/connect',          label: 'Stores',          icon: Store,       requires: 'manage_stores',         group: 'Stores',        description: 'Connect a Shopify store and grant the scopes Settings Sync & Markets need.' },
  { href: '/f/settings-viewer',       label: 'Settings Viewer', icon: Eye,         requires: 'run_feature',           group: 'Settings Sync', description: "Read-only view of a store's current settings and templates." },
  { href: '/f/settings-sync',         label: 'Settings Sync',   icon: Settings,    requires: 'run_feature',           group: 'Settings Sync', description: 'Push settings and templates out to connected stores.' },
  { href: '/f/settings-sync/history', label: 'History',         icon: History,     requires: 'view_settings_history', group: 'Settings Sync', description: 'Past Settings Sync runs.' },
  { href: '/f/markets',               label: 'Markets',         icon: Globe,       requires: 'view_markets_history',  group: 'Markets',       description: 'Per-market shipping configuration.' },
  { href: '/f/markets/history',       label: 'Markets history', icon: History,     requires: 'view_markets_history',  group: 'Markets',       description: 'Changes to market configuration over time.' },
  { href: '/admin/users',             label: 'Users',           icon: Users,       requires: 'manage_users',          group: 'Admin',         description: 'Manage users and their roles.' },
  { href: '/admin/feature-flags',     label: 'Feature flags',   icon: ToggleRight, requires: 'manage_users',          group: 'Admin',         description: 'Toggle features on or off.' },
];

/** Display order of the hub sub-sections. */
export const SETTINGS_GROUPS: SettingsGroup[] = ['Stores', 'Settings Sync', 'Markets', 'Admin'];

/** True when the role can access at least one Settings sub-module. */
export function canSeeSettings(role: Role): boolean {
  return SETTINGS_ITEMS.some((item) => hasPermission(role, item.requires));
}
