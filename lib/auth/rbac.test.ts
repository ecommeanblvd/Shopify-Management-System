import { describe, it, expect } from 'vitest';
import { hasPermission, canChangeRole } from './rbac';

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

describe('hasPermission — manage_users', () => {
  it('admin has manage_users', () => {
    expect(hasPermission('admin', 'manage_users')).toBe(true);
  });
  it('operator and viewer do not have manage_users', () => {
    expect(hasPermission('operator', 'manage_users')).toBe(false);
    expect(hasPermission('viewer', 'manage_users')).toBe(false);
  });
});

describe('markets permissions', () => {
  it('grants admin manage_markets_template, apply_markets, view_markets_history', () => {
    expect(hasPermission('admin', 'manage_markets_template')).toBe(true);
    expect(hasPermission('admin', 'apply_markets')).toBe(true);
    expect(hasPermission('admin', 'view_markets_history')).toBe(true);
  });

  it('grants operator apply_markets and view_markets_history (no template edit)', () => {
    expect(hasPermission('operator', 'manage_markets_template')).toBe(false);
    expect(hasPermission('operator', 'apply_markets')).toBe(true);
    expect(hasPermission('operator', 'view_markets_history')).toBe(true);
  });

  it('grants viewer view_markets_history only', () => {
    expect(hasPermission('viewer', 'manage_markets_template')).toBe(false);
    expect(hasPermission('viewer', 'apply_markets')).toBe(false);
    expect(hasPermission('viewer', 'view_markets_history')).toBe(true);
  });
});

describe('canChangeRole', () => {
  it('admin can change another user role', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'other-id', newRole: 'operator',
    })).toBe(true);
  });
  it('admin can remove another user role', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'other-id', newRole: null,
    })).toBe(true);
  });
  it('admin cannot demote themselves', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'admin-id', newRole: 'operator',
    })).toBe(false);
  });
  it('admin cannot remove their own role', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'admin-id', newRole: null,
    })).toBe(false);
  });
  it('admin can re-assert themselves as admin (no-op self change)', () => {
    expect(canChangeRole({
      callerUserId: 'admin-id', callerRole: 'admin',
      targetUserId: 'admin-id', newRole: 'admin',
    })).toBe(true);
  });
  it('non-admin cannot change any role', () => {
    expect(canChangeRole({
      callerUserId: 'op-id', callerRole: 'operator',
      targetUserId: 'other-id', newRole: 'viewer',
    })).toBe(false);
    expect(canChangeRole({
      callerUserId: 'v-id', callerRole: 'viewer',
      targetUserId: 'other-id', newRole: 'viewer',
    })).toBe(false);
  });
});

