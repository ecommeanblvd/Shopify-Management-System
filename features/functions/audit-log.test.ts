import { describe, expect, test, vi, beforeEach } from 'vitest';

const insertMock = vi.fn();

vi.mock('@/db/client', () => ({
  db: {
    insert: () => ({ values: insertMock }),
    execute: vi.fn(),
  },
  schema: {
    functionAuditLog: 'function_audit_log',
  },
}));

import { logFunctionAudit } from './audit-log';

describe('logFunctionAudit', () => {
  beforeEach(() => insertMock.mockReset());

  test('writes the row with all fields normalised', async () => {
    await logFunctionAudit({
      functionKey: 'wishlist',
      storeId: 'store-1',
      actorUserId: 'user-1',
      action: 'toggle',
      payload: { from: false, to: true },
    });
    expect(insertMock).toHaveBeenCalledWith({
      functionKey: 'wishlist',
      storeId: 'store-1',
      actorUserId: 'user-1',
      action: 'toggle',
      payload: { from: false, to: true },
    });
  });

  test('coalesces undefined payload to null so JSONB stays consistent', async () => {
    await logFunctionAudit({
      functionKey: 'recently-viewed',
      storeId: 'store-2',
      actorUserId: 'user-1',
      action: 'toggle',
    });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ payload: null }),
    );
  });

  test('accepts free-text action strings for future event types', async () => {
    await logFunctionAudit({
      functionKey: 'wishlist',
      storeId: null,
      actorUserId: null,
      action: 'cron_run',
      payload: { ran: 'snapshot_refresh', rows: 1024 },
    });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cron_run', storeId: null, actorUserId: null }),
    );
  });
});
