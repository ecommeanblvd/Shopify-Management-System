export type Role = 'admin' | 'operator' | 'viewer';
export type Permission =
  | 'view'
  | 'run_feature'
  | 'manage_stores'
  | 'manage_settings_template'
  | 'apply_settings'
  | 'reconcile_store'
  | 'view_settings_history';

const MATRIX: Record<Role, Permission[]> = {
  admin: [
    'view', 'run_feature', 'manage_stores',
    'manage_settings_template', 'apply_settings',
    'reconcile_store', 'view_settings_history',
  ],
  operator: [
    'view', 'run_feature',
    'apply_settings', 'reconcile_store', 'view_settings_history',
  ],
  viewer: ['view', 'view_settings_history'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}
