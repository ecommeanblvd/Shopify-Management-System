import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifySessionToken, shopDomainFromDest, customerIdFromSub } from './session-token';

const b64u = (o: object | Buffer) =>
  (Buffer.isBuffer(o) ? o : Buffer.from(JSON.stringify(o))).toString('base64url');
function sign(payload: object, secret: string, header: object = { alg: 'HS256', typ: 'JWT' }): string {
  const h = b64u(header); const p = b64u(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}
const NOW = 1_800_000_000;
const base = { dest: 'https://demo.myshopify.com', aud: 'client-1', sub: 'gid://shopify/Customer/777', exp: NOW + 300 };

describe('verifySessionToken', () => {
  it('token hợp lệ → ok + shopDomain + customerId', () => {
    const r = verifySessionToken(sign(base, 's1'), ['s1'], { nowSeconds: NOW });
    expect(r).toMatchObject({ ok: true, shopDomain: 'demo.myshopify.com', customerId: '777' });
  });
  it('đúng 1 trong nhiều secret → ok', () => {
    expect(verifySessionToken(sign(base, 's2'), ['s1', 's2'], { nowSeconds: NOW }).ok).toBe(true);
  });
  it('sai secret → bad_signature', () => {
    expect(verifySessionToken(sign(base, 'x'), ['s1'], { nowSeconds: NOW })).toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('hết hạn → expired', () => {
    expect(verifySessionToken(sign({ ...base, exp: NOW - 1 }, 's1'), ['s1'], { nowSeconds: NOW })).toEqual({ ok: false, reason: 'expired' });
  });
  it('aud không thuộc allowedClientIds → bad_aud; allowedClientIds rỗng → bỏ check', () => {
    expect(verifySessionToken(sign(base, 's1'), ['s1'], { nowSeconds: NOW, allowedClientIds: ['other'] })).toEqual({ ok: false, reason: 'bad_aud' });
    expect(verifySessionToken(sign(base, 's1'), ['s1'], { nowSeconds: NOW, allowedClientIds: [] }).ok).toBe(true);
  });
  it('alg khác HS256 / thiếu phần / json hỏng → malformed', () => {
    expect(verifySessionToken(sign(base, 's1', { alg: 'none' }), ['s1'], { nowSeconds: NOW })).toEqual({ ok: false, reason: 'malformed' });
    expect(verifySessionToken('a.b', ['s1'], { nowSeconds: NOW })).toEqual({ ok: false, reason: 'malformed' });
  });
  it('thiếu dest → no_dest', () => {
    const { dest: _d, ...noDest } = base;
    expect(verifySessionToken(sign({ ...noDest, exp: NOW + 300 }, 's1'), ['s1'], { nowSeconds: NOW })).toEqual({ ok: false, reason: 'no_dest' });
  });
  it('sub thiếu → customerId null (vẫn ok)', () => {
    const { sub: _s, ...noSub } = base;
    const r = verifySessionToken(sign({ ...noSub, exp: NOW + 300 }, 's1'), ['s1'], { nowSeconds: NOW });
    expect(r).toMatchObject({ ok: true, customerId: null });
  });
});

describe('helpers', () => {
  it('shopDomainFromDest strip protocol + slash', () => {
    expect(shopDomainFromDest('https://a.myshopify.com/')).toBe('a.myshopify.com');
    expect(shopDomainFromDest('a.myshopify.com')).toBe('a.myshopify.com');
  });
  it('customerIdFromSub gid/numeric/undefined', () => {
    expect(customerIdFromSub('gid://shopify/Customer/42')).toBe('42');
    expect(customerIdFromSub('42')).toBe('42');
    expect(customerIdFromSub(undefined)).toBeNull();
  });
});
