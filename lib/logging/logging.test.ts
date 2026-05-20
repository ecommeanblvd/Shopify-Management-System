import { describe, it, expect, vi } from 'vitest';
import { buildAccessEntry } from './access';
import { buildAuditEntry } from './audit';

describe('buildAccessEntry', () => {
  it('builds a feature-entry access record', () => {
    const entry = buildAccessEntry({ userId: 'u1', storeId: 's1', featureKey: 'settings-viewer' });
    expect(entry).toEqual({ userId: 'u1', storeId: 's1', featureKey: 'settings-viewer' });
  });
});

describe('buildAuditEntry', () => {
  it('builds a success audit record', () => {
    const entry = buildAuditEntry({
      userId: 'u1', storeId: 's1', featureKey: 'settings-viewer',
      action: 'connect_store', target: 'shop.myshopify.com', result: 'success',
    });
    expect(entry.result).toBe('success');
    expect(entry.errorDetail).toBeNull();
  });

  it('keeps the error detail for a failed record', () => {
    const entry = buildAuditEntry({
      userId: 'u1', action: 'connect_store', result: 'error', errorDetail: 'HMAC mismatch',
    });
    expect(entry.errorDetail).toBe('HMAC mismatch');
  });
});
