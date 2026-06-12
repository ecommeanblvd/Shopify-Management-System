/**
 * FedEx Vietnam Demand-Surcharge PDF fetcher
 * ==========================================
 *
 * FedEx publishes the Vietnam Demand Surcharge as a per-period PDF linked from
 *   https://www.fedex.com/en-vn/shipping/surcharges/demand-surcharge.html
 *
 * The PDFs live under
 *   https://www.fedex.com/content/dam/fedex/international/rates/fedex-ds-*.pdf
 *
 * Unlike the *fuel* table (Akamai-gated JSON servlet), these demand PDFs are
 * served fine to a plain server-side GET as long as we send browser-shaped
 * headers — the same headers the fuel-fetcher uses for its HTML bootstrap.
 *
 * Two pure-ish functions:
 *   - fetchDemandPdfUrls  → scrape the landing page for the PDF links.
 *   - fetchDemandPdfText  → download one PDF and run it through pdf-parse.
 *
 * pdf-parse v2 is class-based: `new PDFParse({ data }).getText()`.
 */

import { PDFParse } from 'pdf-parse';

export const DEMAND_PAGE =
  'https://www.fedex.com/en-vn/shipping/surcharges/demand-surcharge.html';

const SITE_ORIGIN = 'https://www.fedex.com';

/** Browser-shaped headers copied from the fuel-fetcher (verified to work). */
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

/** Headers for the PDF download itself. */
const DEFAULT_HEADERS_PDF: Record<string, string> = {
  'User-Agent': DEFAULT_HEADERS_HTML['User-Agent'],
  Accept: 'application/pdf,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
  Referer: DEMAND_PAGE,
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
};

/** Matches the dam path of a demand-surcharge PDF, e.g.
 *  /content/dam/fedex/international/rates/fedex-ds-2026-jun-638-en-vn.pdf */
const PDF_PATH_RE =
  /\/content\/dam\/fedex\/international\/rates\/fedex-ds-[^"'\s)]+\.pdf/g;

/**
 * GET the landing page and scrape every demand-surcharge PDF link.
 * Returns absolute URLs, de-duplicated, in first-seen order.
 */
export async function fetchDemandPdfUrls(
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const res = await fetchImpl(DEMAND_PAGE, {
    headers: DEFAULT_HEADERS_HTML,
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`fetchDemandPdfUrls: page request failed (${res.status})`);
  }
  const html = await res.text();
  return extractDemandPdfUrls(html);
}

/**
 * Pure helper: pull demand PDF links out of an HTML blob.
 * Exported so the scraping regex can be unit-tested without the network.
 */
export function extractDemandPdfUrls(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of html.matchAll(PDF_PATH_RE)) {
    const path = match[0];
    const url = SITE_ORIGIN + path;
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/**
 * Download one demand PDF and extract its text via pdf-parse.
 */
export async function fetchDemandPdfText(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(url, {
    headers: DEFAULT_HEADERS_PDF,
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`fetchDemandPdfText: PDF request failed (${res.status}) for ${url}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}
