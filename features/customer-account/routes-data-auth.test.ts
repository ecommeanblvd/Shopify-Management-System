import { describe, it, expect, beforeAll } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET as ordersGET, OPTIONS as ordersOPTIONS } from '@/app/api/customer-account/orders/route';
import { GET as timelineGET, OPTIONS as timelineOPTIONS } from '@/app/api/customer-account/orders/[orderId]/timeline/route';
import { GET as loyaltyGET, OPTIONS as loyaltyOPTIONS } from '@/app/api/customer-account/loyalty/route';
import { GET as returnsGET, POST as returnsPOST, OPTIONS as returnsOPTIONS } from '@/app/api/customer-account/returns/route';

beforeAll(() => { process.env.CUSTOMER_ACCOUNT_APP_SECRETS = 'test-secret'; });

const CORS = 'https://extensions.shopifycdn.com';
const req = (path: string, init: RequestInit = {}) =>
  new Request(`https://x/api/customer-account/${path}`, init) as unknown as NextRequest;

const cases = [
  { name: 'orders', OPTIONS: ordersOPTIONS, GET: () => ordersGET(req('orders')), noAuth: () => ordersGET(req('orders')) },
  { name: 'loyalty', OPTIONS: loyaltyOPTIONS, GET: () => loyaltyGET(req('loyalty')), noAuth: () => loyaltyGET(req('loyalty')) },
  { name: 'returns GET', OPTIONS: returnsOPTIONS, GET: () => returnsGET(req('returns')), noAuth: () => returnsGET(req('returns')) },
];

describe.each(cases)('$name route auth', (c) => {
  it('OPTIONS → 204 + CORS', async () => {
    const r = await c.OPTIONS();
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe(CORS);
  });
  it('thiếu bearer → 401 + CORS', async () => {
    const r = await c.noAuth();
    expect(r.status).toBe(401);
    expect(r.headers.get('access-control-allow-origin')).toBe(CORS);
  });
});

describe('timeline route auth', () => {
  const ctx = { params: Promise.resolve({ orderId: 'x' }) };
  it('OPTIONS → 204 + CORS', async () => {
    const r = await timelineOPTIONS();
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe(CORS);
  });
  it('thiếu bearer → 401 + CORS', async () => {
    const r = await timelineGET(req('orders/x/timeline'), ctx);
    expect(r.status).toBe(401);
    expect(r.headers.get('access-control-allow-origin')).toBe(CORS);
  });
});

describe('returns POST auth', () => {
  it('OPTIONS → 204 + CORS', async () => {
    const r = await returnsOPTIONS();
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe(CORS);
  });
  it('thiếu bearer → 401 + CORS', async () => {
    const r = await returnsPOST(req('returns', { method: 'POST' }));
    expect(r.status).toBe(401);
    expect(r.headers.get('access-control-allow-origin')).toBe(CORS);
  });
});
