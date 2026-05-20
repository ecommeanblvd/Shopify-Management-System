import { describe, it, expect } from 'vitest';
import { hasPermission } from './rbac';

describe('hasPermission', () => {
  it('admin has every permission', () => {
    expect(hasPermission('admin', 'manage_stores')).toBe(true);
    expect(hasPermission('admin', 'manage_settings_template')).toBe(true);
    expect(hasPermission('admin', 'apply_settings')).toBe(true);
    expect(hasPermission('admin', 'reconcile_store')).toBe(true);
    expect(hasPermission('admin', 'view_settings_history')).toBe(true);
  });

  it('operator can apply and reconcile but not edit templates or stores', () => {
    expect(hasPermission('operator', 'apply_settings')).toBe(true);
    expect(hasPermission('operator', 'reconcile_store')).toBe(true);
    expect(hasPermission('operator', 'view_settings_history')).toBe(true);
    expect(hasPermission('operator', 'manage_settings_template')).toBe(false);
    expect(hasPermission('operator', 'manage_stores')).toBe(false);
  });

  it('viewer can view but not act', () => {
    expect(hasPermission('viewer', 'view')).toBe(true);
    expect(hasPermission('viewer', 'view_settings_history')).toBe(true);
    expect(hasPermission('viewer', 'apply_settings')).toBe(false);
    expect(hasPermission('viewer', 'reconcile_store')).toBe(false);
    expect(hasPermission('viewer', 'manage_settings_template')).toBe(false);
  });
});
