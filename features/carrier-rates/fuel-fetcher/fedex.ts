/**
 * FedEx fuel-surcharge fetcher
 * ============================
 *
 * Pulls the weekly Express fuel-surcharge percentage from FedEx's own AEM
 * (Adobe Experience Manager) service that backs the public surcharges page
 * at https://www.fedex.com/en-vn/shipping/surcharges.html.
 *
 * Why not the public PDF?
 * - The PDF table at /content/dam/.../fedex-fuel-table-<month>-<year>-apac.pdf
 *   is gated by Akamai WAF and returns a "System Down" failover for any
 *   server-side fetch, regardless of headers.
 *
 * Why this endpoint works:
 * - The fuel-surcharge component on the page calls a Sling servlet at
 *   /etc/services/dynamic.<serviceName>.<region>.<dateFormat>.<locale>
 *   .<enablePriceUpdateColumn>.<hidePriceColumn>.<numOfRecords>.jsonp
 *   which returns JSON like:
 *
 *   { "data": [ { "surcharge": "49.50%",
 *                 "week": "25 May, 2026 - 31 May, 2026",
 *                 "price": "$4.152" }, ... ] }
 *
 * - Akamai blocks direct calls to `/etc/services/*` from non-browser clients.
 * - The workaround: first fetch the HTML page so we collect the Akamai
 *   bot-manager cookies (`bm_sz`, `_abck`, `fdx_*`); then replay the AJAX
 *   call with those cookies + `X-Requested-With: XMLHttpRequest`. Akamai
 *   treats us as a real same-origin XHR.
 *
 * Pure helpers (parsePercent, parseWeekRange, parseFedExResponse) live below
 * the network call so they can be unit-tested without going over the wire.
 */

const PAGE_URL = 'https://www.fedex.com/en-vn/shipping/surcharges.html';

const DEFAULT_HEADERS_HTML: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
  'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

const DEFAULT_HEADERS_XHR: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
  Referer: PAGE_URL,
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

export interface FuelFetchOptions {
  /** Sling service name. APAC weekly Express is `express_weekly` (default). */
  serviceName?: string;
  /** Region key — `apac` for Vietnam/Asia. */
  region?: string;
  /** Locale slug — `en_vn` for Vietnam English. */
  locale?: string;
  /** Server-side date format string. Defaults to FedEx's own `dd MMMM, yyyy`. */
  dateFormat?: string;
  /** How many historical weeks to request (FedEx default is 13). */
  numOfRecords?: number;
  /** Optional override (mostly for tests). */
  fetchImpl?: typeof fetch;
}

export interface FuelRow {
  /** Numeric surcharge, e.g. 49.5 for "49.50%". */
  percent: number;
  /** Raw `week` field from the response. */
  weekRaw: string;
  /** Parsed start-of-week date (inclusive). */
  effectiveFrom: Date;
  /** Parsed end-of-week date (inclusive). */
  effectiveTo: Date;
  /** Raw `price` field, e.g. "$4.152". */
  priceRaw: string;
}

export interface FuelFetchResult {
  /** The most-recent week (data[0] in the response). */
  current: FuelRow;
  /** Every week in the response, in the order FedEx returned them. */
  rows: FuelRow[];
  /** When this fetcher ran. */
  fetchedAt: Date;
  /** The fully constructed endpoint URL we hit. */
  sourceUrl: string;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  // Three-letter abbreviations as a safety net.
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** "49.50%" → 49.5  |  "30%" → 30  |  "  12.25 %" → 12.25 */
export function parsePercent(raw: string): number {
  const trimmed = String(raw).trim().replace(/%$/, '').trim();
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(`parsePercent: cannot parse "${raw}"`);
  }
  return n;
}

/**
 * Parse FedEx's English week range, e.g. "25 May, 2026 - 31 May, 2026".
 * Returns midday-UTC anchored dates to avoid tz drift when serialized.
 */
export function parseWeekRange(raw: string): { from: Date; to: Date } {
  const cleaned = String(raw).replace(/–|—/g, '-').trim();
  const [left, right] = cleaned.split(/\s*-\s*/);
  if (!left || !right) {
    throw new Error(`parseWeekRange: missing range separator in "${raw}"`);
  }
  return { from: parseEnglishDate(left), to: parseEnglishDate(right) };
}

function parseEnglishDate(raw: string): Date {
  const match = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (!match) {
    throw new Error(`parseEnglishDate: cannot parse "${raw}"`);
  }
  const day = Number(match[1]);
  const monthKey = match[2].toLowerCase();
  const year = Number(match[3]);
  const month = MONTHS[monthKey];
  if (month === undefined) {
    throw new Error(`parseEnglishDate: unknown month "${match[2]}" in "${raw}"`);
  }
  return new Date(Date.UTC(year, month, day, 12, 0, 0));
}

interface RawFuelRow {
  surcharge: string;
  week: string;
  price: string;
}

interface RawFuelResponse {
  data: RawFuelRow[];
}

function isRawFuelResponse(value: unknown): value is RawFuelResponse {
  if (typeof value !== 'object' || value === null) return false;
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) return false;
  return data.every(
    (r) =>
      typeof r === 'object' &&
      r !== null &&
      typeof (r as RawFuelRow).surcharge === 'string' &&
      typeof (r as RawFuelRow).week === 'string' &&
      typeof (r as RawFuelRow).price === 'string',
  );
}

/** Parse the raw FedEx payload into typed rows. */
export function parseFedExResponse(payload: unknown): FuelRow[] {
  if (!isRawFuelResponse(payload)) {
    throw new Error('parseFedExResponse: payload missing or malformed { data: [...] }');
  }
  return payload.data.map((r) => {
    const { from, to } = parseWeekRange(r.week);
    return {
      percent: parsePercent(r.surcharge),
      weekRaw: r.week,
      effectiveFrom: from,
      effectiveTo: to,
      priceRaw: r.price,
    };
  });
}

/** Build the Sling endpoint URL from config knobs. */
export function buildFuelEndpoint(opts: Required<Omit<FuelFetchOptions, 'fetchImpl'>>): string {
  const segments = [
    'dynamic',
    opts.serviceName,
    opts.region,
    opts.dateFormat,
    opts.locale,
    'false', // enablePriceUpdateColumn
    'false', // hidePriceColumn
    String(opts.numOfRecords),
    'jsonp',
  ].map(encodeURIComponent);
  return `https://www.fedex.com/etc/services/${segments.join('.')}`;
}

/**
 * Live fetch. Two HTTP requests:
 *   1. GET the page (HTML) → collect Akamai cookies.
 *   2. GET the Sling endpoint with those cookies + XHR headers → JSON rows.
 *
 * Both requests use node's native `fetch`; no third-party HTTP client.
 */
export async function fetchFedExFuelPercent(
  options: FuelFetchOptions = {},
): Promise<FuelFetchResult> {
  const cfg = {
    serviceName: options.serviceName ?? 'express_weekly',
    region: options.region ?? 'apac',
    locale: options.locale ?? 'en_vn',
    dateFormat: options.dateFormat ?? 'dd MMMM, yyyy',
    numOfRecords: options.numOfRecords ?? 13,
  };
  const fetcher = options.fetchImpl ?? fetch;

  // Step 1 — bootstrap session cookies.
  const pageRes = await fetcher(PAGE_URL, { headers: DEFAULT_HEADERS_HTML, redirect: 'follow' });
  if (!pageRes.ok) {
    throw new Error(`fetchFedExFuelPercent: page request failed (${pageRes.status})`);
  }
  const cookieHeader = collectCookies(pageRes);
  if (!cookieHeader) {
    throw new Error('fetchFedExFuelPercent: no cookies returned from page request');
  }

  // Step 2 — call the Sling servlet.
  const sourceUrl = buildFuelEndpoint(cfg);
  const apiRes = await fetcher(sourceUrl, {
    headers: { ...DEFAULT_HEADERS_XHR, Cookie: cookieHeader },
    redirect: 'follow',
  });
  if (!apiRes.ok) {
    throw new Error(`fetchFedExFuelPercent: service request failed (${apiRes.status})`);
  }
  const contentType = apiRes.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    throw new Error(
      `fetchFedExFuelPercent: expected JSON but got ${contentType || 'no content-type'}`,
    );
  }
  const payload = await apiRes.json();
  const rows = parseFedExResponse(payload);
  if (rows.length === 0) {
    throw new Error('fetchFedExFuelPercent: FedEx returned 0 rows');
  }

  return {
    current: rows[0],
    rows,
    fetchedAt: new Date(),
    sourceUrl,
  };
}

/**
 * Pull all Set-Cookie headers from a Response and flatten them into the
 * single semicolon-joined `Cookie` header the next request needs. We use
 * undici's getSetCookie() when available; otherwise fall back to a manual
 * split that handles the multi-value case Node's fetch returns.
 */
function collectCookies(res: Response): string {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  let raw: string[];
  if (typeof headers.getSetCookie === 'function') {
    raw = headers.getSetCookie();
  } else {
    const combined = res.headers.get('set-cookie') ?? '';
    raw = combined ? splitSetCookie(combined) : [];
  }
  const pairs = raw
    .map((line) => line.split(';')[0]?.trim())
    .filter((p): p is string => Boolean(p && p.includes('=')));
  return pairs.join('; ');
}

/**
 * Splits a comma-joined Set-Cookie value while leaving `Expires=Wed, 09 Jun ...`
 * intact (the standards-broken edge case Node's pre-v20 Headers helper trips on).
 */
function splitSetCookie(combined: string): string[] {
  const out: string[] = [];
  let buffer = '';
  for (const part of combined.split(',')) {
    if (/^\s*\w+\s*=/.test(part) && /;/.test(buffer)) {
      out.push(buffer.trim());
      buffer = part;
    } else {
      buffer = buffer ? `${buffer},${part}` : part;
    }
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out;
}
