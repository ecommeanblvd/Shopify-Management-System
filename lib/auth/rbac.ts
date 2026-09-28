import { OLD_TO_NEW } from './permission-map';
import { permissionsForRoleKey } from './role-cache';

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
  /** Chọn line ship cho kiện đã đóng (màn Đóng hàng) — đội logistics. */
  | 'chon_line_ship'
  | 'manage_warehouse'
  | 'view_receiving'
  | 'manage_receiving'
  | 'view_qc'
  | 'manage_qc'
  | 'view_pack_check'
  | 'check_packed'
  | 'view_ship_ho'
  | 'manage_ship_ho'
  | 'view_kol'
  | 'manage_kol'
  | 'view_cogs'
  | 'manage_cogs'
  /** Xem bảng điểm KPI của vị trí logistics (chính nhân sự đó xem được kết quả của mình). */
  | 'view_kpi_logistics'
  /** Xem ticket CX. */
  | 'view_cx_ticket'
  /** Tạo/sửa ticket CX — gồm quyền GHI HỘ phần việc của bộ phận khác. */
  | 'manage_cx_ticket'
  /** Xem tranh chấp thanh toán. */
  | 'view_cx_dispute'
  /** Nhập/sửa tranh chấp và chạy đồng bộ từ Shopify. */
  | 'manage_cx_dispute'
  /** Xem sự cố và thiệt hại. */
  | 'view_cx_incident'
  /** Ghi/sửa sự cố và các dòng chi phí. */
  | 'manage_cx_incident'
  /** Xem đánh giá Trustpilot / Judge.me. */
  | 'view_cx_review'
  /** Ghi/sửa đánh giá. */
  | 'manage_cx_review';

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
    'view_fulfillment', 'manage_fulfillment', 'chon_line_ship', 'manage_warehouse',
    'view_ship_ho', 'manage_ship_ho',
    'view_kol', 'manage_kol',
    'view_cogs', 'manage_cogs', 'view_kpi_logistics',
    'view_cx_ticket', 'manage_cx_ticket',
    'view_cx_dispute', 'manage_cx_dispute',
    'view_cx_incident', 'manage_cx_incident',
    'view_cx_review', 'manage_cx_review',
  ],
  operator: [
    'view', 'run_feature',
    'apply_settings', 'reconcile_store', 'view_settings_history',
    'apply_markets', 'view_markets_history',
    'manage_carrier_rates', 'view_carrier_rates',
    'view_orders', 'manage_sku_costs', 'manage_shipping_invoices',
    'manage_functions', 'view_functions',
    'view_mmp_products', 'manage_mmp_products',
    'view_fulfillment', 'manage_fulfillment', 'chon_line_ship', 'manage_warehouse',
    'view_ship_ho', 'manage_ship_ho',
    'view_kol', 'manage_kol',
    'view_cx_ticket', 'manage_cx_ticket',
    'view_cx_dispute', 'manage_cx_dispute',
    'view_cx_incident', 'manage_cx_incident',
    'view_cx_review', 'manage_cx_review',
  ],
  viewer: [
    'view', 'view_settings_history', 'view_markets_history', 'view_carrier_rates',
    'view_orders', 'view_functions',
    'view_mmp_products',
    'view_fulfillment',
    'view_cx_ticket', 'view_cx_dispute', 'view_cx_incident', 'view_cx_review',
  ],
};

/** Compat shim: a role "has" a legacy permission iff it holds ALL the new keys
 *  that permission maps to. Reads the role cache (warmed by getRole). */
export function hasPermission(roleKey: string, permission: Permission): boolean {
  const perms = permissionsForRoleKey(roleKey);
  const mapped = OLD_TO_NEW[permission];
  if (!mapped) return false;
  return mapped.every((k) => perms.has(k)); // empty mapping (e.g. 'view') => true
}

export interface CanChangeRoleArgs {
  callerUserId: string;
  callerRole: string;
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
