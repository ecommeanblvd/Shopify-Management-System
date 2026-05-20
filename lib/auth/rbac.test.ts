import { describe, it, expect } from 'vitest';
import { hasPermission } from './rbac';

describe('hasPermission', () => {
  it('admin can manage stores', () => {
    expect(hasPermission('admin', 'manage_stores')).toBe(true);
  });
  it('operator cannot manage stores but can run features', () => {
    expect(hasPermission('operator', 'manage_stores')).toBe(false);
    expect(hasPermission('operator', 'run_feature')).toBe(true);
  });
  it('viewer can only view', () => {
    expect(hasPermission('viewer', 'view')).toBe(true);
    expect(hasPermission('viewer', 'run_feature')).toBe(false);
  });
});
