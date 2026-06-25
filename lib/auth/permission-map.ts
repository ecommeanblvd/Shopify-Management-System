import { allPermissionKeys, type PermissionKey } from './permissions';

/** Legacy permission → new permission keys. Used by the compat shim and to
 *  derive system-role seeds so admin/operator/viewer behave exactly as before. */
export const OLD_TO_NEW: Record<string, PermissionKey[]> = {
  view: [],
  // The 3 legacy settings perms map to 3 DISTINCT settings_sync keys (see
  // permissions.ts) so the shim's .every() distinguishes them — exact parity:
  //   run_feature (use/run sync) → edit · manage_settings_template → create ·
  //   view_settings_history → view · apply_settings/reconcile_store → apply.
  run_feature: ['settings_sync:edit'],
  manage_stores: ['stores:view', 'stores:create', 'stores:edit', 'stores:delete'],
  manage_settings_template: ['settings_sync:create'],
  apply_settings: ['settings_sync:apply'],
  reconcile_store: ['settings_sync:apply'],
  view_settings_history: ['settings_sync:view'],
  manage_users: ['users_roles:view', 'users_roles:create', 'users_roles:edit', 'users_roles:delete'],
  manage_markets_template: ['markets:edit'],
  apply_markets: ['markets:apply'],
  view_markets_history: ['markets:view'],
  manage_carrier_rates: ['carrier_rates:create', 'carrier_rates:edit', 'carrier_rates:delete'],
  view_carrier_rates: ['carrier_rates:view'],
  view_orders: ['orders:view'],
  manage_sku_costs: ['orders:edit'],
  manage_shipping_invoices: ['carrier_rates.invoices:view', 'carrier_rates.invoices:create', 'carrier_rates.invoices:edit'],
  manage_functions: ['functions:edit'],
  view_functions: ['functions:view'],
  view_mmp_products: ['mmp_products:view'],
  manage_mmp_products: ['mmp_products:create', 'mmp_products:edit', 'mmp_products:delete', 'mmp_products:push'],
  view_fulfillment: ['fulfillment.operations:view'],
  manage_fulfillment: ['fulfillment.operations:edit', 'fulfillment.brand_requests:edit'],
  manage_warehouse: ['fulfillment.warehouse:view', 'fulfillment.warehouse:create', 'fulfillment.warehouse:edit', 'fulfillment.warehouse:delete'],
  view_receiving: ['warehouse.receiving:view'],
  manage_receiving: ['warehouse.receiving:view', 'warehouse.receiving:create', 'warehouse.receiving:edit'],
  view_qc: ['warehouse.qc:view'],
  manage_qc: ['warehouse.qc:view', 'warehouse.qc:create', 'warehouse.qc:edit'],
  view_pack_check: ['fulfillment.pack_check:view'],
  check_packed: ['fulfillment.pack_check:view', 'fulfillment.pack_check:create'],
};

const OPERATOR_OLD = [
  'view', 'run_feature', 'apply_settings', 'reconcile_store', 'view_settings_history',
  'apply_markets', 'view_markets_history', 'manage_carrier_rates', 'view_carrier_rates',
  'view_orders', 'manage_sku_costs', 'manage_shipping_invoices', 'view_functions',
  'view_mmp_products', 'manage_mmp_products', 'view_fulfillment', 'manage_fulfillment', 'manage_warehouse',
  'view_receiving', 'manage_receiving', 'view_qc', 'manage_qc',
  'view_pack_check', 'check_packed',
];
const VIEWER_OLD = [
  'view', 'view_settings_history', 'view_markets_history', 'view_carrier_rates',
  'view_orders', 'view_functions', 'view_mmp_products', 'view_fulfillment',
];

function expand(oldPerms: string[]): PermissionKey[] {
  return [...new Set(oldPerms.flatMap((p) => OLD_TO_NEW[p] ?? []))];
}

export interface RoleSeed { name: string; description: string; isSystem: boolean; keys: PermissionKey[]; }

export const SYSTEM_ROLE_SEEDS: Record<string, RoleSeed> = {
  admin: { name: 'Admin', description: 'Toàn quyền', isSystem: true, keys: allPermissionKeys() },
  operator: { name: 'Operator', description: 'Vận hành chung', isSystem: true, keys: expand(OPERATOR_OLD) },
  viewer: { name: 'Viewer', description: 'Chỉ xem', isSystem: true, keys: expand(VIEWER_OLD) },
  logistics: {
    name: 'Logistics staff', description: 'Vận hành logistics + carrier rate/invoice', isSystem: false,
    keys: [
      'fulfillment.operations:view',
      'fulfillment.logistics:view', 'fulfillment.logistics:create', 'fulfillment.logistics:edit', 'fulfillment.logistics:delete',
      'carrier_rates:view', 'carrier_rates:create',
      'carrier_rates.invoices:view', 'carrier_rates.invoices:create', 'carrier_rates.invoices:edit',
      // Xem view tổng module Orders (landing + bảng đơn per-store). Chi tiết đơn
      // (modal) vẫn cần manage_sku_costs nên logistics chỉ xem, không mở chi tiết.
      'orders:view',
    ],
  },
};
