import { describe, it, expect, beforeAll } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET as configGET, OPTIONS as configOPTIONS } from '@/app/api/customer-account/config/route';

beforeAll(() => { process.env.CUSTOMER_ACCOUNT_APP_SECRETS = 'test-secret'; });
const req = (headers: Record<string, string> = {}) =>
  new Request('https://x/api/customer-account/config', { headers }) as unknown as NextRequest;

describe('config route auth', () => {
  it('OPTIONS → 204 + CORS origin extensions.shopifycdn.com', async () => {
    const r = await configOPTIONS();
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://extensions.shopifycdn.com');
  });
  it('thiếu bearer → 401 (kèm CORS)', async () => {
    const r = await configGET(req());
    expect(r.status).toBe(401);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://extensions.shopifycdn.com');
  });
  it('token rác → 401 reason', async () => {
    const r = await configGET(req({ authorization: 'Bearer junk' }));
    expect(r.status).toBe(401);
    expect((await r.json()).reason).toBe('malformed');
  });
});
