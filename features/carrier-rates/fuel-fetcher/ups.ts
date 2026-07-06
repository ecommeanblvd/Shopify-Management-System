/**
 * UPS weekly fuel-surcharge fetcher (Vietnam, International Export/Import Air)
 * ============================================================================
 *
 * Public page: https://www.ups.com/vn/en/support/shipping-support/shipping-costs-rates/fuel-surcharges
 *
 * The page itself sits behind Akamai bot-manager — server-side fetches are
 * dropped at the TLS layer and even headless browsers get
 * ERR_HTTP2_PROTOCOL_ERROR. BUT the page's numbers come from an Adobe AEM
 * asset on `assets.ups.com`, which is a plain public CDN with NO bot wall:
 *
 *   https://assets.ups.com/adobe/assets/urn:aaid:aem:<id>/original/as/vn.json
 *
 *   { "FuelSurchargeResponse": {
 *       "FuelSurchargeRates_en": { "USGCJetFuel": [ ...price→% index... ] },
 *       "SurchargeHistory_en": { "RevenueSurchargeHistory": [
 *         { "Field1": "2026/07/06", "Field2": "39.00%" }, ...newest first...
 *       ]}, ... _vi mirrors ... } }
 *
 * `RevenueSurchargeHistory` is exactly the "90-Day Fuel Surcharge History"
 * table: weekly effective START dates + the surcharge % in force from that
 * date. We convert them to the same `VnFuelWeek` window shape the DHL VN
 * fetcher uses, so `planWeeklyFuelActions` (close/update/insert with the
 * no-overlap invariant) is reused as-is.
 *
 * Fragility note: the AEM urn is pinned to the published asset. If UPS
 * re-publishes under a new urn this fetcher throws (404/parse) and the cron
 * exits non-zero — same failure surface as the FedEx/DHL scrapers. The urn
 * cannot be re-discovered server-side (the referring page is Akamai-gated),
 * so on failure an operator re-opens the page in a real browser and updates
 * `UPS_FUEL_JSON_URL`.
 */

import type { VnFuelWeek } from './dhl-vn';

export const UPS_FUEL_PAGE_URL =
  'https://www.ups.com/vn/en/support/shipping-support/shipping-costs-rates/fuel-surcharges';

export const UPS_FUEL_JSON_URL =
  'https://assets.ups.com/adobe/assets/urn:aaid:aem:54da6dff-c6a7-4943-8462-fb9327844005/original/as/vn.json';

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SMS-fuel-cron',
  Accept: 'application/json,*/*;q=0.8',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface RawHistoryRow {
  /** Effective start date, "YYYY/MM/DD". */
  Field1: string;
  /** Surcharge, "39.00%". */
  Field2: string;
}

/** "2026/07/06" → 2026-07-06T00:00:00Z. Strict — anything else throws. */
function parseUpsDate(raw: string): Date {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(String(raw).trim());
  if (!m) throw new Error(`parseUpsFuelJson: cannot parse date "${raw}"`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) throw new Error(`parseUpsFuelJson: invalid date "${raw}"`);
  return d;
}

/** "39.00%" → 39. */
function parseUpsPercent(raw: string): number {
  const m = /^([\d.]+)\s*%$/.exec(String(raw).trim());
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(n)) throw new Error(`parseUpsFuelJson: cannot parse percent "${raw}"`);
  return n;
}

/**
 * Parse the AEM payload's 90-day history into ascending `VnFuelWeek`s.
 * Each week's `endsAtExclusive` is the NEXT entry's start date (handles
 * gaps/holiday skips correctly); the newest week defaults to +7 days —
 * `planWeeklyFuelActions` turns it into the open-ended row when nothing
 * later exists.
 */
export function parseUpsFuelJson(payload: unknown): VnFuelWeek[] {
  const history = (payload as {
    FuelSurchargeResponse?: {
      SurchargeHistory_en?: { RevenueSurchargeHistory?: unknown };
    };
  })?.FuelSurchargeResponse?.SurchargeHistory_en?.RevenueSurchargeHistory;
  if (!Array.isArray(history) || history.length === 0) {
    throw new Error('parseUpsFuelJson: SurchargeHistory_en.RevenueSurchargeHistory missing or empty');
  }

  const entries = (history as RawHistoryRow[])
    .map((r) => ({
      startsAt: parseUpsDate(r.Field1),
      percent: parseUpsPercent(r.Field2),
      raw: `${String(r.Field1).trim()} = ${String(r.Field2).trim()}`,
    }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  return entries.map((e, i) => ({
    startsAt: e.startsAt,
    endsAtExclusive: i < entries.length - 1
      ? entries[i + 1].startsAt
      : new Date(e.startsAt.getTime() + 7 * MS_PER_DAY),
    percent: e.percent,
    raw: e.raw,
  }));
}

export interface UpsFuelFetchResult {
  weeks: VnFuelWeek[];
  fetchedAt: Date;
  sourceUrl: string;
}

export async function fetchUpsFuelWeeks(opts: {
  url?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<UpsFuelFetchResult> {
  const url = opts.url ?? UPS_FUEL_JSON_URL;
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url, { headers: DEFAULT_HEADERS, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`fetchUpsFuelWeeks: assets.ups.com returned ${res.status} — asset urn may have changed; re-check ${UPS_FUEL_PAGE_URL} in a real browser`);
  }
  const weeks = parseUpsFuelJson(await res.json());
  return { weeks, fetchedAt: new Date(), sourceUrl: url };
}
