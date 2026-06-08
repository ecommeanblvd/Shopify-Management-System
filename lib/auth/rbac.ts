export type Role = 'admin' | 'operator' | 'viewer';
export type Permission =
  | 'view'
  | 'run_feature'
  | 'manage_stores'
  | 'manage_settings_template'
  | 'apply_settings'
  | 'reconcile_store'
  | 'view_settings_history'
  | 'manage_users'
  | 'manage_markets_template'
  | 'apply_markets'
  | 'view_markets_history'
  | 'manage_carrier_rates'
  | 'view_carrier_rates'
  | 'view_orders'
  | 'manage_sku_costs'
  | 'manage_shipping_invoices'
  | 'manage_functions'
  | 'view_functions'
  // MMP catalog: read-only browse of products received from MEAN
  // Merchant Portal (viewer-level).
  | 'view_mmp_products'
  // MMP curation: approve / reject / trigger push-to-Shopify
  // (operator+ only).
  | 'manage_mmp_products'
  | 'view_fulfillment'
  | 'manage_fulfillment'
  | 'manage_warehouse';

const MATRIX: Record<Role, Permission[]> = {
  admin: [
    'view', 'run_feature', 'manage_stores',
    'manage_settings_template', 'apply_settings',
    'reconcile_store', 'view_settings_history',
    'manage_users',
    'manage_markets_template', 'apply_markets', 'view_markets_history',
    'manage_carrier_rates', 'view_carrier_rates',
    'view_orders', 'manage_sku_costs', 'manage_shipping_invoices',
    'manage_functions', 'view_functions',
    'view_mmp_products', 'manage_mmp_products',
    'view_fulfillment', 'manage_fulfillment', 'manage_warehouse',
  ],
  operator: [
    'view', 'run_feature',
    'apply_settings', 'reconcile_store', 'view_settings_history',
    'apply_markets', 'view_markets_history',
    'manage_carrier_rates', 'view_carrier_rates',
    'view_orders', 'manage_sku_costs', 'manage_shipping_invoices',
    'manage_functions', 'view_functions',
    'view_mmp_products', 'manage_mmp_products',
    'view_fulfillment', 'manage_fulfillment', 'manage_warehouse',
  ],
  viewer: [
    'view', 'view_settings_history', 'view_markets_history', 'view_carrier_rates',
    'view_orders', 'view_functions',
    'view_mmp_products',
    'view_fulfillment',
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export interface CanChangeRoleArgs {
  callerUserId: string;
  callerRole: Role;
  targetUserId: string;
  /** null = remove the target's role entirely. */
  newRole: Role | null;
}

/**
 * Returns true when the caller may apply the given role change.
 * Only admins can change roles. Admins must not demote or remove
 * themselves — that would lock everyone out of /admin/users.
 */
export function canChangeRole(args: CanChangeRoleArgs): boolean {
  if (args.callerRole !== 'admin') return false;
  if (args.callerUserId === args.targetUserId && args.newRole !== 'admin') {
    return false;
  }
  return true;
}
