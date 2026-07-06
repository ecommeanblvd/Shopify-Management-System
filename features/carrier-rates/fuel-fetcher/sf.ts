/**
 * SF Express (ShunFeng) fuel-surcharge fetcher — Asia-Pacific column.
 * =====================================================================
 *
 * Source: the CHINA site's International Fuel Surcharge page, which — unlike
 * the Vietnam site (sf-international.com, a Nuxt SPA that renders the table as
 * an image/lazy component with no fetchable data) — server-renders the full
 * weekly table INTO the HTML payload:
 *
 *   https://www.sf-express.com/chn/en/support-more/international_fuel_surcharge_introduction
 *
 * The international table has three FSC columns per week:
 *   Effective date | Chinese Mainland | HK, Macau, Taiwan China, Asia … | Europe & America
 *
 * CEO chốt: SF chỉ dùng cho tuyến Á (mạnh VN→TQ) → lấy **cột 2** ("HK, Macau,
 * Taiwan China, Asia and so on"). Đã cross-check khớp TUYỆT ĐỐI 5/5 tuần với
 * cột "Asia-Pacific Regions" trên trang VN (nguồn CEO chụp): Jun29-Jul5=25.50,
 * Jun22-28=29.00, Jun15-21=31.25, Jun8-14=30.25, Jun1-7=40.50.
 *
 * ⚠ ĐỘ TRỄ: trang CHN đăng tuần mới CHẬM hơn trang VN — tại thời điểm build
 * CHN mới tới Jun29-Jul5 còn VN đã có Jul6-12. Nên giá auto có thể trễ tuần
 * hiện hành vài ngày. planWeeklyFuelActions chỉ động vào tuần CHN công bố, KHÔNG
 * đè dòng tuần mới hơn đã nhập tay (vd Jul6-12=25% seed từ VN vẫn giữ nguyên).
 *
 * The HTML embeds the table in a Nuxt SSR payload with unicode-escaped tags
 * (< = <). We unescape, anchor on the Asia column header, then read each
 * data row's date label + the 2nd percentage. Windowing follows ups.ts: parse
 * each row's START date, sort ascending, endsAtExclusive = next row's start
 * (newest → +7 days; planWeeklyFuelActions opens it only if nothing later).
 */

import type { VnFuelWeek } from './dhl-vn';

export const SF_FUEL_PAGE_URL =
  'https://www.sf-express.com/chn/en/support-more/international_fuel_surcharge_introduction';

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** Unescape the Nuxt SSR unicode-escaped tags so the table markup is parseable. */
function unescapeTags(html: string): string {
  return html
    .replace(/\\u003C/gi, '<')
    .replace(/\\u003E/gi, '>')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0022/gi, '"');
}

interface RawSfRow {
  startsAt: Date;
  percent: number;
  raw: string;
}

/**
 * Parse the "HK, Macau, Taiwan China, Asia" weekly FSC column into ascending
 * `VnFuelWeek`s. Pure — takes the raw page HTML, returns windows.
 */
export function parseSfChnFuel(rawHtml: string): VnFuelWeek[] {
  const html = unescapeTags(rawHtml);
  const anchor = html.indexOf('Hong Kong, Macau, Taiwan');
  if (anchor < 0) {
    throw new Error('parseSfChnFuel: Asia column header not found — page layout changed?');
  }
  // Scan the region after the header for data rows. A data row is a date-label
  // <td> immediately followed by 2-3 percentage <td>s; we take the 2nd (Asia).
  const region = html.slice(anchor, anchor + 40000);
  const rowRe = /<td[^>]*>(?:<span[^>]*>)?\s*([A-Z][a-z]+\s+\d{1,2}[a-z]{0,2}\s+to\s+[A-Z][a-z]+\s+\d{1,2}[a-z]{0,2},\s*\d{4})\s*(?:<\/span>)?\s*<\/td>((?:\s*<td[^>]*>(?:<span[^>]*>)?\s*[\d.]+%\s*(?:<\/span>)?\s*<\/td>){2,3})/g;
  const pctRe = /([\d.]+)%/g;

  const seen = new Set<number>();
  const rows: RawSfRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(region)) !== null) {
    const label = m[1].replace(/\s+/g, ' ').trim();
    const pcts = (m[2].match(pctRe) || []).map((p) => Number(p.replace('%', '')));
    if (pcts.length < 2) continue;
    const asia = pcts[1];
    if (!Number.isFinite(asia)) continue;
    const startsAt = parseSfRangeStart(label);
    const key = startsAt.getTime();
    if (seen.has(key)) continue; // SF's own table sometimes double-lists a week
    seen.add(key);
    rows.push({ startsAt, percent: asia, raw: `${label} = ${asia}% (Asia)` });
  }
  if (rows.length === 0) {
    throw new Error('parseSfChnFuel: parsed 0 weekly rows — table markup changed?');
  }

  rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return rows.map((r, i) => ({
    startsAt: r.startsAt,
    endsAtExclusive: i < rows.length - 1
      ? rows[i + 1].startsAt
      : new Date(r.startsAt.getTime() + 7 * MS_PER_DAY),
    percent: r.percent,
    raw: r.raw,
  }));
}

/**
 * Start date of a range label like "June 29th to July 5th, 2026". The trailing
 * year applies to the END date; when the range crosses New Year (start month
 * later than end month, e.g. "December 28th to January 3rd, 2027") the start is
 * in the previous year.
 */
export function parseSfRangeStart(label: string): Date {
  const m = /([A-Za-z]+)\s+(\d{1,2})[a-z]{0,2}\s+to\s+([A-Za-z]+)\s+(\d{1,2})[a-z]{0,2},\s*(\d{4})/.exec(label);
  if (!m) throw new Error(`parseSfRangeStart: cannot parse "${label}"`);
  const startMonth = MONTHS[m[1].toLowerCase()];
  const startDay = Number(m[2]);
  const endMonth = MONTHS[m[3].toLowerCase()];
  const year = Number(m[5]);
  if (startMonth === undefined || endMonth === undefined) {
    throw new Error(`parseSfRangeStart: unknown month in "${label}"`);
  }
  const startYear = endMonth < startMonth ? year - 1 : year;
  return new Date(Date.UTC(startYear, startMonth, startDay));
}

export interface SfFuelFetchResult {
  weeks: VnFuelWeek[];
  fetchedAt: Date;
  sourceUrl: string;
}

export async function fetchSfFuelWeeks(opts: {
  url?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<SfFuelFetchResult> {
  const url = opts.url ?? SF_FUEL_PAGE_URL;
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url, { headers: DEFAULT_HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`fetchSfFuelWeeks: SF page returned ${res.status}`);
  const weeks = parseSfChnFuel(await res.text());
  return { weeks, fetchedAt: new Date(), sourceUrl: url };
}
