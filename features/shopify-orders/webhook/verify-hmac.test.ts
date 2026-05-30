import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyShopifyHmac } from './verify-hmac';

const secret = 'shhh';
function sign(body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

describe('verifyShopifyHmac', () => {
  it('returns true on valid signature', () => {
    const body = '{"id":1}';
    expect(verifyShopifyHmac(body, sign(body), secret)).toBe(true);
  });
  it('returns false on tampered body', () => {
    const body = '{"id":1}';
    const sig = sign(body);
    expect(verifyShopifyHmac('{"id":2}', sig, secret)).toBe(false);
  });
  it('returns false on wrong secret', () => {
    const body = '{"id":1}';
    expect(verifyShopifyHmac(body, sign(body), 'other')).toBe(false);
  });
  it('returns false when header is empty', () => {
    expect(verifyShopifyHmac('{}', '', secret)).toBe(false);
  });
});
