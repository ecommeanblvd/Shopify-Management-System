/**
 * DHL Air fuel-surcharge fetcher
 * ==============================
 *
 * Source page:
 *   https://www.dhl.de/en/geschaeftskunden/express/produkte-und-services/zuschlaege/treibstoffzuschlag-air.html
 *
 * Unlike FedEx VN, DHL's page is plain server-rendered HTML — no Akamai
 * bot challenge, no Sling/AEM API. A single GET returns a table whose
 * rows look like:
 *
 *   <tr>
 *     <td>CW 18</td>
 *     <td>48.00 %</td>
 *   </tr>
 *
 * The page only publishes the most recent ~8 calendar weeks of data.
 * For the cron path that's fine — we pick the row matching today's ISO
 * week (or the newest available row if the page is lagging).
 *
 * Pure helpers (parseDhlPage, pickCurrentWeek, isoWeek) live below the
 * network call so they can be unit-tested without going over the wire.
 */

const PAGE_URL =
  'https://www.dhl.de/en/geschaeftskunden/express/produkte-und-services/zuschlaege/treibstoffzuschlag-air.html';

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface DhlFuelRow {
  /** ISO calendar week number, e.g. 18 for week of 27/04 - 03/05/2026. */
  weekNumber: number;
  /** ISO week year — defaults to current year unless the caller overrides. */
  year: number;
  /** Numeric surcharge, e.g. 48 for "48.00 %". */
  percent: number;
  /** Original "48.00%" string for the audit trail. */
  raw: string;
}

export interface DhlFuelFetchOptions {
  /** Override the page URL (mostly for tests). */
  url?: string;
  /** Override the year all parsed rows are stamped with. Defaults to today's UTC year. */
  year?: number;
  /** Override "today" when picking the current week (mostly for tests). */
  now?: Date;
  /** Override fetch implementation (mostly for tests). */
  fetchImpl?: typeof fetch;
}

export interface DhlFuelFetchResult {
  /** Row matching today's ISO week, or the newest row when the page lags. */
  current: DhlFuelRow;
  /** Every row parsed from the page, in source order. */
  rows: DhlFuelRow[];
  /** When this fetcher ran. */
  fetchedAt: Date;
  /** The URL we hit (for audit logging). */
  sourceUrl: string;
}

/** "48.00%" → 48 | "30%" → 30 | "12,25 %" → 12.25 (handles comma decimal) */
export function parsePercent(raw: string): number {
  const trimmed = String(raw).trim().replace(/%$/, '').replace(',', '.').trim();
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(`parsePercent: cannot parse "${raw}"`);
  }
  return n;
}

/**
 * Pulls every `<tr><td>CW N</td><td>X.XX %</td></tr>` pattern out of the
 * page HTML. Whitespace-tolerant — DHL's source has nested spans / extra
 * classes the regex doesn't care about because we squash whitespace
 * before matching.
 */
export function parseDhlPage(
  html: string,
  year: number = new Date().getUTCFullYear(),
): DhlFuelRow[] {
  const flat = html.replace(/\s+/g, ' ');
  const re = /<tr[^>]*>\s*<td[^>]*>\s*CW\s+(\d+)\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*%/gi;
  const rows: DhlFuelRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) {
    const weekNumber = Number(m[1]);
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 53) continue;
    let percent: number;
    try {
      percent = parsePercent(m[2]);
    } catch {
      continue;
    }
    rows.push({ weekNumber, year, percent, raw: `${m[2]}%` });
  }
  return rows;
}

/** ISO 8601 week number — JavaScript has no built-in. Returns the
 *  Thursday-week-based year too, which matters in early Jan / late Dec. */
export function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // ISO weeks count Thursdays — snap to the Thursday of the input week.
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

/** Returns the row matching today's ISO week, falling back to the
 *  highest-numbered row when the page hasn't published it yet. Throws
 *  when the page returned no rows at all. */
export function pickCurrentWeek(rows: DhlFuelRow[], now: Date = new Date()): DhlFuelRow {
  if (rows.length === 0) {
    throw new Error('pickCurrentWeek: no rows to pick from');
  }
  const { year, week } = isoWeek(now);
  const exact = rows.find((r) => r.year === year && r.weekNumber === week);
  if (exact) return exact;
  // Fall back to the newest row — page is lagging this week.
  const sorted = [...rows].sort((a, b) =>
    a.year !== b.year ? b.year - a.year : b.weekNumber - a.weekNumber,
  );
  return sorted[0]!;
}

/** Live fetch — single GET, no cookie dance. Throws when the page
 *  returned 0 rows (likely a markup change). */
export async function fetchDhlFuelPercent(
  options: DhlFuelFetchOptions = {},
): Promise<DhlFuelFetchResult> {
  const fetcher = options.fetchImpl ?? fetch;
  const sourceUrl = options.url ?? PAGE_URL;
  const res = await fetcher(sourceUrl, { headers: DEFAULT_HEADERS, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`fetchDhlFuelPercent: HTTP ${res.status}`);
  }
  const html = await res.text();
  const year = options.year ?? new Date().getUTCFullYear();
  const rows = parseDhlPage(html, year);
  if (rows.length === 0) {
    throw new Error('fetchDhlFuelPercent: no CW rows found on the page');
  }
  const current = pickCurrentWeek(rows, options.now ?? new Date());
  return { current, rows, fetchedAt: new Date(), sourceUrl };
}
