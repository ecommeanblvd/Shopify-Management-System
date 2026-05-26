import { describe, it, expect } from 'vitest';
import {
  parsePercent,
  parseWeekRange,
  parseFedExResponse,
  buildFuelEndpoint,
  fetchFedExFuelPercent,
} from './fedex';

describe('parsePercent', () => {
  it('parses a standard "49.50%" value', () => {
    expect(parsePercent('49.50%')).toBe(49.5);
  });

  it('parses an integer "30%" value', () => {
    expect(parsePercent('30%')).toBe(30);
  });

  it('tolerates whitespace and a missing % sign', () => {
    expect(parsePercent('  12.25 ')).toBe(12.25);
  });

  it('throws on garbage input', () => {
    expect(() => parsePercent('not a number')).toThrow(/cannot parse/);
  });
});

describe('parseWeekRange', () => {
  it('parses the canonical FedEx range "25 May, 2026 - 31 May, 2026"', () => {
    const r = parseWeekRange('25 May, 2026 - 31 May, 2026');
    expect(r.from.toISOString().slice(0, 10)).toBe('2026-05-25');
    expect(r.to.toISOString().slice(0, 10)).toBe('2026-05-31');
  });

  it('handles month abbreviations and en/em-dashes', () => {
    const r = parseWeekRange('02 Mar, 2026 – 08 Mar, 2026');
    expect(r.from.toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(r.to.toISOString().slice(0, 10)).toBe('2026-03-08');
  });

  it('throws when the separator is missing', () => {
    expect(() => parseWeekRange('25 May, 2026')).toThrow(/missing range separator/);
  });

  it('throws on an unknown month', () => {
    expect(() => parseWeekRange('25 Smarch, 2026 - 31 Smarch, 2026')).toThrow(/unknown month/);
  });
});

describe('parseFedExResponse', () => {
  const sample = {
    data: [
      { surcharge: '49.50%', week: '25 May, 2026 - 31 May, 2026', price: '$4.152' },
      { surcharge: '48.75%', week: '18 May, 2026 - 24 May, 2026', price: '$4.049' },
    ],
  };

  it('extracts numeric percent + parsed dates', () => {
    const rows = parseFedExResponse(sample);
    expect(rows).toHaveLength(2);
    expect(rows[0].percent).toBe(49.5);
    expect(rows[0].weekRaw).toBe('25 May, 2026 - 31 May, 2026');
    expect(rows[0].effectiveFrom.toISOString().slice(0, 10)).toBe('2026-05-25');
    expect(rows[0].effectiveTo.toISOString().slice(0, 10)).toBe('2026-05-31');
    expect(rows[0].priceRaw).toBe('$4.152');
  });

  it('throws on missing data array', () => {
    expect(() => parseFedExResponse({})).toThrow(/malformed/);
  });

  it('throws on a row missing required fields', () => {
    expect(() =>
      parseFedExResponse({ data: [{ surcharge: '30%', week: '...' }] }),
    ).toThrow(/malformed/);
  });
});

describe('buildFuelEndpoint', () => {
  it('produces the Vietnam APAC weekly URL', () => {
    const url = buildFuelEndpoint({
      serviceName: 'express_weekly',
      region: 'apac',
      locale: 'en_vn',
      dateFormat: 'dd MMMM, yyyy',
      numOfRecords: 13,
    });
    expect(url).toBe(
      'https://www.fedex.com/etc/services/dynamic.express_weekly.apac.dd%20MMMM%2C%20yyyy.en_vn.false.false.13.jsonp',
    );
  });

  it('encodes locale separators safely', () => {
    const url = buildFuelEndpoint({
      serviceName: 'express_weekly',
      region: 'apac',
      locale: 'en_us',
      dateFormat: 'MM/dd/yyyy',
      numOfRecords: 4,
    });
    expect(url).toContain('en_us');
    expect(url).toContain('MM%2Fdd%2Fyyyy');
  });
});

describe('fetchFedExFuelPercent (mocked)', () => {
  it('bootstraps cookies from the page and calls the service with them', async () => {
    const calls: Array<{ url: string; cookieHeader: string | undefined }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url, cookieHeader: headers?.Cookie });
      if (url.includes('surcharges.html')) {
        const h = new Headers({ 'content-type': 'text/html' });
        h.append('set-cookie', 'bm_sz=abc; Path=/; Max-Age=3600');
        h.append('set-cookie', '_abck=xyz; Path=/; Max-Age=3600');
        return new Response('<html>ok</html>', { status: 200, headers: h });
      }
      return new Response(
        JSON.stringify({
          data: [
            { surcharge: '49.50%', week: '25 May, 2026 - 31 May, 2026', price: '$4.152' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } },
      );
    };

    const result = await fetchFedExFuelPercent({ fetchImpl: fakeFetch });
    expect(result.current.percent).toBe(49.5);
    expect(result.rows).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('surcharges.html');
    expect(calls[1].url).toContain('/etc/services/dynamic.express_weekly.apac');
    expect(calls[1].cookieHeader).toContain('bm_sz=abc');
    expect(calls[1].cookieHeader).toContain('_abck=xyz');
  });

  it('throws when the service returns HTML (WAF failover)', async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.includes('surcharges.html')) {
        const h = new Headers({ 'content-type': 'text/html' });
        h.append('set-cookie', 'bm_sz=abc');
        return new Response('<html>ok</html>', { status: 200, headers: h });
      }
      return new Response('<html>System Down</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };

    await expect(fetchFedExFuelPercent({ fetchImpl: fakeFetch })).rejects.toThrow(
      /expected JSON/,
    );
  });

  it('throws when the page returns no Set-Cookie at all', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('<html>ok</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    await expect(fetchFedExFuelPercent({ fetchImpl: fakeFetch })).rejects.toThrow(
      /no cookies/,
    );
  });
});
