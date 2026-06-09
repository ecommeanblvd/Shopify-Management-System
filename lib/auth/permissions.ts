/**
 * Permission CATALOG — single source of truth for scopes (module / sub-module)
 * and the actions applicable to each. A permission key is `"<scope>:<action>"`.
 *
 * To add a new module/function: add a ScopeDef here, then gate its pages/actions
 * with `can(perms, '<scope>:<action>')`. The role-matrix UI picks it up
 * automatically — no DB migration needed (keys are validated strings, not enums).
 */
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'apply', 'push'] as const;
export type Action = (typeof ACTIONS)[number];

export interface ScopeDef {
  key: string;
  label: string;
  actions: Action[];
}

export const CATALOG: ScopeDef[] = [
  { key: 'orders', label: 'Đơn hàng', actions: ['view', 'edit'] },
  { key: 'fulfillment.operations', label: 'Vận hành — thao tác (pick/pack/ship)', actions: ['view', 'edit'] },
  { key: 'fulfillment.logistics', label: 'Vận hành — logistics (tracking)', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'fulfillment.warehouse', label: 'Kho MEAN', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'fulfillment.brand_requests', label: 'Yêu cầu brand', actions: ['view', 'edit'] },
  { key: 'carrier_rates', label: 'Carrier rates', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'carrier_rates.invoices', label: 'Hoá đơn nhà cung cấp', actions: ['view', 'create', 'edit'] },
  { key: 'shipping_reconcile', label: 'Đối soát phí ship', actions: ['view', 'edit'] },
  { key: 'mmp_products', label: 'Sản phẩm MMP', actions: ['view', 'create', 'edit', 'delete', 'push'] },
  { key: 'functions', label: 'Functions', actions: ['view', 'edit'] },
  { key: 'markets', label: 'Markets', actions: ['view', 'edit', 'apply'] },
  { key: 'settings_sync', label: 'Settings Sync', actions: ['view', 'edit', 'apply'] },
  { key: 'stores', label: 'Stores', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'users_roles', label: 'Users & Roles', actions: ['view', 'create', 'edit', 'delete'] },
];

export type PermissionKey = string; // `${scope}:${action}`

export function allPermissionKeys(): PermissionKey[] {
  return CATALOG.flatMap((s) => s.actions.map((a) => `${s.key}:${a}`));
}

const VALID = new Set(allPermissionKeys());
export function isValidKey(key: string): boolean {
  return VALID.has(key);
}
