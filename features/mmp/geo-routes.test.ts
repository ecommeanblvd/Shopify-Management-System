import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { GET as countriesGET } from '@/app/api/mmp/ship-ho/countries/route';
import { GET as citiesGET } from '@/app/api/mmp/ship-ho/cities/route';

const SECRET = 'test-secret-geo';

function signedReq(url: string): NextRequest {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac('sha256', SECRET).update(`${ts}.`).digest('hex');
  return new Request(url, {
    headers: { 'x-mean-signature': `sha256=${sig}`, 'x-mean-timestamp': ts },
  }) as unknown as NextRequest;
}

beforeAll(() => {
  process.env.MMP_WEBHOOK_SECRET = SECRET;
});

describe('GET /api/mmp/ship-ho/countries', () => {
  it('chữ ký hợp lệ → 200 + list nước {code,name,dialCode}', async () => {
    const res = await countriesGET(signedReq('https://x/api/mmp/ship-ho/countries'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.countries)).toBe(true);
    expect(body.countries.length).toBeGreaterThan(200);
    const sa = body.countries.find((c: { code: string }) => c.code === 'SA');
    expect(sa).toMatchObject({ code: 'SA', dialCode: '966' });
    expect(typeof sa.name).toBe('string');
  });

  it('chữ ký sai → 401', async () => {
    const req = new Request('https://x/api/mmp/ship-ho/countries', {
      headers: { 'x-mean-signature': 'sha256=deadbeef', 'x-mean-timestamp': String(Math.floor(Date.now() / 1000)) },
    }) as unknown as NextRequest;
    const res = await countriesGET(req);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/mmp/ship-ho/cities', () => {
  it('country=US → 200 + cities', async () => {
    const res = await citiesGET(signedReq('https://x/api/mmp/ship-ho/cities?country=US'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.country).toBe('US');
    expect(body.cities).toContain('New York');
  });

  it('country lowercase → chuẩn hoá hoa', async () => {
    const res = await citiesGET(signedReq('https://x/api/mmp/ship-ho/cities?country=us'));
    const body = await res.json();
    expect(body.country).toBe('US');
    expect(body.cities.length).toBeGreaterThan(0);
  });

  it('nước chưa curate → cities []', async () => {
    const res = await citiesGET(signedReq('https://x/api/mmp/ship-ho/cities?country=ZW'));
    const body = await res.json();
    expect(body).toEqual({ country: 'ZW', cities: [] });
  });

  it('thiếu country → 400', async () => {
    const res = await citiesGET(signedReq('https://x/api/mmp/ship-ho/cities'));
    expect(res.status).toBe(400);
  });

  it('chữ ký sai → 401 (không lộ dữ liệu)', async () => {
    const req = new Request('https://x/api/mmp/ship-ho/cities?country=US', {
      headers: { 'x-mean-signature': 'sha256=bad', 'x-mean-timestamp': String(Math.floor(Date.now() / 1000)) },
    }) as unknown as NextRequest;
    const res = await citiesGET(req);
    expect(res.status).toBe(401);
  });
});
