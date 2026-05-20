export type Role = 'admin' | 'operator' | 'viewer';
export type Permission = 'view' | 'run_feature' | 'manage_stores';

const MATRIX: Record<Role, Permission[]> = {
  admin: ['view', 'run_feature', 'manage_stores'],
  operator: ['view', 'run_feature'],
  viewer: ['view'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}
