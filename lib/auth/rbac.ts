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
  | 'view_markets_history';

const MATRIX: Record<Role, Permission[]> = {
  admin: [
    'view', 'run_feature', 'manage_stores',
    'manage_settings_template', 'apply_settings',
    'reconcile_store', 'view_settings_history',
    'manage_users',
    'manage_markets_template', 'apply_markets', 'view_markets_history',
  ],
  operator: [
    'view', 'run_feature',
    'apply_settings', 'reconcile_store', 'view_settings_history',
    'apply_markets', 'view_markets_history',
  ],
  viewer: ['view', 'view_settings_history', 'view_markets_history'],
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
