import { describe, it, expect } from 'vitest';
import { parseCheckoutResult } from './queries';

describe('parseCheckoutResult', () => {
  it('returns available branding when present', () => {
    const result = parseCheckoutResult({ checkoutBranding: { designSystem: { colors: {} } } });
    expect(result.status).toBe('available');
  });

  it('degrades gracefully when the store is not migrated to Checkout Extensibility', () => {
    const result = parseCheckoutResult(null, [{ message: 'Checkout branding is not available' }]);
    expect(result.status).toBe('needs_migration');
  });
});
