import { describe, it, expect } from 'vitest';
import { hashOrderPayload, shouldPushOrder } from './order-push-state';

describe('hashOrderPayload', () => {
  it('cùng input → cùng hash; khác → khác', () => {
    expect(hashOrderPayload('{"a":1}')).toBe(hashOrderPayload('{"a":1}'));
    expect(hashOrderPayload('{"a":1}')).not.toBe(hashOrderPayload('{"a":2}'));
    expect(hashOrderPayload('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('shouldPushOrder', () => {
  it('chưa có state → push', () => { expect(shouldPushOrder(null, 'h1')).toBe(true); });
  it('sent + hash trùng → KHÔNG push', () => {
    expect(shouldPushOrder({ status: 'sent', attempts: 1, payloadHash: 'h1' }, 'h1')).toBe(false);
  });
  it('sent + hash khác (nội dung đổi) → push', () => {
    expect(shouldPushOrder({ status: 'sent', attempts: 1, payloadHash: 'h1' }, 'h2')).toBe(true);
  });
  it('failed/pending → push', () => {
    expect(shouldPushOrder({ status: 'failed', attempts: 2, payloadHash: 'h1' }, 'h1')).toBe(true);
    expect(shouldPushOrder({ status: 'pending', attempts: 0, payloadHash: null }, 'h1')).toBe(true);
  });
});
