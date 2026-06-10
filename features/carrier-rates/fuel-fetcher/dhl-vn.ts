/**
 * DHL Express VIETNAM weekly fuel-surcharge fetcher
 * =================================================
 *
 * Source page (operator's billing follows THIS, not dhl.de):
 *   https://mydhl.express.dhl/vn/vi/ship/surcharges.html#/fuel_surcharge
 *
 * The weekly table is server-rendered inside `dhl-tables-component` rows:
 *
 *   <tr><td><div class="v2-p">Tháng 6 8-14, 2026</div></td>
 *       <td><div class="v2-p">48.75%</div></td></tr>
 *
 * Two table families share that markup: the WEEKLY table (date-range
 * label) and the jet-fuel price→% index table ($-prefixed label). We
 * keep only rows whose label parses as a Vietnamese date range:
 *
 *   "Tháng 6 8-14, 2026"            → 2026-06-08 .. 2026-06-14
 *   "Tháng 4 27-Tháng 5 3, 2026"    → 2026-04-27 .. 2026-05-03  (cross-month)
 *
 * The page publishes ~5 weeks INCLUDING the upcoming one — so the cron
 * picks up next week's rate ahead of time, something dhl.de never gave us.
 *
 * Pure helpers (parseDhlVnFuelPage, planWeeklyFuelActions) are separated
 * from the network call for unit testing.
 */

export const DHL_VN_PAGE_URL = 'https://mydhl.express.dhl/vn/vi/ship/surcharges.html';

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
};

export interface VnFuelWeek {
  /** Monday 00:00 UTC of the published range. */
  startsAt: Date;
  /** Day AFTER the range end, 00:00 UTC — matches the engine's exclusive
   *  `ends_at <= t` semantics so consecutive weeks tile without overlap. */
  endsAtExclusive: Date;
  percent: number;
  /** Original label + percent for the audit trail. */
  raw: string;
}

/** "Tháng 6 8-14, 2026" | "Tháng 4 27-Tháng 5 3, 2026" → {m1,d1,m2,d2,y} */
const RANGE_RE =
  /Tháng\s*(\d{1,2})\s+(\d{1,2})\s*[-–]\s*(?:Tháng\s*(\d{1,2})\s+)?(\d{1,2}),\s*(\d{4})/;

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

export function parseDhlVnFuelPage(html: string): VnFuelWeek[] {
  const weeks: VnFuelWeek[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = [...m[1].matchAll(/<div class="v2-p">([^<]+)<\/div>/g)].map((c) => c[1].trim());
    if (cells.length < 2) continue;
    const label = cells[0];
    const pctRaw = cells[cells.length - 1];
    const range = RANGE_RE.exec(label);
    if (!range) continue; // $-index table or unrelated row
    const pct = /^([\d.,]+)\s*%$/.exec(pctRaw);
    if (!pct) continue;
    const [, m1s, d1s, m2s, d2s, ys] = range;
    const y = Number(ys);
    const m1 = Number(m1s);
    const d1 = Number(d1s);
    const m2 = m2s ? Number(m2s) : m1;
    const d2 = Number(d2s);
    const startsAt = utc(y, m1, d1);
    // End day is inclusive on the page → exclusive boundary is +1 day.
    // Cross-YEAR ranges (Dec→Jan) don't occur in the label format (the year
    // is single); if DHL ever prints one we'd rather skip than misfile it.
    const endInclusive = utc(y, m2, d2);
    if (endInclusive < startsAt) continue;
    const endsAtExclusive = new Date(endInclusive.getTime() + 24 * 60 * 60 * 1000);
    weeks.push({
      startsAt,
      endsAtExclusive,
      percent: Number(pct[1].replace(',', '.')),
      raw: `${label} = ${pctRaw}`,
    });
  }
  weeks.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return weeks;
}

export interface ExistingFuelRow {
  id: string;
  value: number;
  startsAt: Date | null;
  endsAt: Date | null;
}

export type WeeklyFuelAction =
  | { type: 'close'; id: string; endsAt: Date }
  | { type: 'update'; id: string; percent: number; raw: string }
  | { type: 'insert'; startsAt: Date; endsAt: Date | null; percent: number; raw: string };

/**
 * Diff parsed weeks against existing fuel_percent rows into a minimal
 * action list. CRITICAL INVARIANT: the engine SUMS every applicable
 * fuel_percent row, so the plan must never leave two rows covering the
 * same date. Weeks are processed oldest→newest.
 */
export function planWeeklyFuelActions(
  existing: ExistingFuelRow[],
  weeks: VnFuelWeek[],
): WeeklyFuelAction[] {
  const actions: WeeklyFuelAction[] = [];
  // Work on a mutable copy so later weeks see earlier weeks' effects.
  const rows = existing.map((r) => ({ ...r }));

  for (const w of weeks) {
    const t = w.startsAt.getTime();
    const sameStart = rows.find((r) => r.startsAt !== null && r.startsAt.getTime() === t);
    if (sameStart) {
      if (sameStart.value !== w.percent) {
        actions.push({ type: 'update', id: sameStart.id, percent: w.percent, raw: w.raw });
        sameStart.value = w.percent;
      }
      continue;
    }
    // A row covering the week start?
    const covering = rows.find((r) =>
      r.startsAt !== null && r.startsAt.getTime() < t &&
      (r.endsAt === null || r.endsAt.getTime() > t));
    if (covering && covering.value === w.percent) continue; // same % already in force
    if (covering) {
      actions.push({ type: 'close', id: covering.id, endsAt: w.startsAt });
      covering.endsAt = w.startsAt;
    }
    // Open-ended insert ONLY when no later row would overlap it.
    const hasLater = rows.some((r) => r.startsAt !== null && r.startsAt.getTime() >= w.endsAtExclusive.getTime())
      || weeks.some((o) => o.startsAt.getTime() >= w.endsAtExclusive.getTime());
    const endsAt = hasLater ? w.endsAtExclusive : null;
    actions.push({ type: 'insert', startsAt: w.startsAt, endsAt, percent: w.percent, raw: w.raw });
    rows.push({ id: `new-${t}`, value: w.percent, startsAt: w.startsAt, endsAt });
  }
  return actions;
}

export interface DhlVnFuelFetchResult {
  weeks: VnFuelWeek[];
  fetchedAt: Date;
  sourceUrl: string;
}

export async function fetchDhlVnFuelWeeks(opts: {
  url?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<DhlVnFuelFetchResult> {
  const url = opts.url ?? DHL_VN_PAGE_URL;
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url, { headers: DEFAULT_HEADERS });
  if (!res.ok) throw new Error(`DHL VN surcharges page returned ${res.status}`);
  const html = await res.text();
  const weeks = parseDhlVnFuelPage(html);
  if (weeks.length === 0) {
    throw new Error('DHL VN surcharges page parsed to zero weekly rows — markup changed?');
  }
  return { weeks, fetchedAt: new Date(), sourceUrl: url };
}
