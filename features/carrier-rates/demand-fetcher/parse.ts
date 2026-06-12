/**
 * Parser for the FedEx Vietnam Demand-Surcharge PDF text (as produced by
 * pdf-parse). Two layouts exist; we detect and handle both.
 *
 * We only ever care about the **Export-from-Vietnam** value (our fleet ships
 * outbound from VN). The ImportOne column and the page-2+ Global Third-Party
 * (G3P) matrix are ignored.
 *
 * The asserted ground-truth values come from the real PDFs:
 *   OLD 2025 (Jul 21 – Sep 21): Israel 11200.
 *   NEW 2026 (eff. Jun 18):     Israel 28400, Europe 28400, MEISA 39700.
 *
 * The text below is what pdf-parse actually emits — NOT a clean visual read.
 * Notable real-text quirks handled here:
 *   - OLD: the export row is a single line
 *       "Vietnam to Israel 11200 VND 11200 VND"
 *     i.e. region + Priority-VND + Economy-VND glued together; the first
 *     number is the one we want.
 *   - NEW: each region row ends in two integers "<export> <importone>".
 *     Region names sometimes wrap across lines, e.g.
 *       "Middle East/Indian Subcontinent/"
 *       "Africa3 (MEISA) 39700 28400"
 *     but the MEISA keyword still lands on the number-bearing line, so a
 *     per-line keyword match against the line carrying the numbers suffices.
 *   - NEW: the G3P matrix on page 2+ also contains numbers, so we cut the
 *     export section off at the first page break ("-- 1 of").
 */

export interface DemandPeriod {
  /** Inclusive start of the period (UTC midnight). */
  effectiveFrom: Date;
  /** Exclusive end of the period (printed end date + 1 day), or null if open-ended. */
  effectiveTo: Date | null;
  /** region key → export-from-VN surcharge (VND/kg). Only rates > 0 are kept. */
  exportRates: Record<string, number>;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** Region keyword matchers, ordered so more-specific patterns win. */
const REGION_MATCHERS: Array<{ key: string; re: RegExp }> = [
  { key: 'israel', re: /israel/i },
  { key: 'meisa', re: /MEISA|Middle East/i },
  { key: 'lac', re: /\bLAC\b|Latin America/i },
  { key: 'europe', re: /europe/i },
  { key: 'canada', re: /canada/i },
  { key: 'mexico', re: /mexico/i },
  { key: 'usa', re: /\bUSA\b|United States/i },
  { key: 'australia_nz', re: /Australia/i },
  { key: 'india', re: /\bIndia\b/i },
  // Plain "Asia" but not when it is part of another word (e.g. inside a URL).
  { key: 'asia', re: /\bAsia\b/i },
];

/** "June 18, 2026" / "July 21, 2025" → UTC-midnight Date. */
function parseLongDate(raw: string): Date {
  const m = raw.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) {
    throw new Error(`parseDemandPdfText: cannot parse date "${raw}"`);
  }
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) {
    throw new Error(`parseDemandPdfText: unknown month in date "${raw}"`);
  }
  return new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
}

/** Find the first region key whose keyword appears in the given line. */
function regionKeyForLine(line: string): string | null {
  for (const { key, re } of REGION_MATCHERS) {
    if (re.test(line)) return key;
  }
  return null;
}

export function parseDemandPdfText(text: string): DemandPeriod {
  if (!text || !text.trim()) {
    throw new Error('parseDemandPdfText: empty text');
  }

  if (/Effective from/i.test(text)) {
    return parseNew(text);
  }
  if (/Demand Surcharge from/i.test(text)) {
    return parseOld(text);
  }
  throw new Error(
    'parseDemandPdfText: unrecognised PDF — no "Effective from" or "Demand Surcharge from" header',
  );
}

/**
 * OLD 2025 layout. Header:
 *   "Demand Surcharge from July 21, 2025 to September 21, 2025 (Vietnam)"
 * Export rows live between "Export shipments from" and the second
 * "Service Region" / "ImportOne" block, each like:
 *   "Vietnam to Israel 11200 VND 11200 VND"
 */
function parseOld(text: string): DemandPeriod {
  const header = text.match(
    /Demand Surcharge from\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})\s+to\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i,
  );
  if (!header) {
    throw new Error('parseDemandPdfText: OLD format missing "from ... to ..." dates');
  }
  const effectiveFrom = parseLongDate(header[1]);
  const printedTo = parseLongDate(header[2]);
  // effectiveTo is exclusive: the day AFTER the printed end date.
  const effectiveTo = new Date(printedTo.getTime() + 24 * 60 * 60 * 1000);

  const lines = text.split('\n');
  const exportRates: Record<string, number> = {};
  let inExport = false;
  for (const line of lines) {
    if (/Export shipments/i.test(line)) {
      inExport = true;
      continue;
    }
    // The ImportOne block ends the export section.
    if (/ImportOne/i.test(line)) {
      inExport = false;
    }
    if (!inExport) continue;

    // A data row carries at least one "<number> VND". Take the FIRST number.
    const numMatch = line.match(/(\d[\d,]*)\s*VND/i);
    if (!numMatch) continue;
    const key = regionKeyForLine(line);
    if (!key) continue;
    const value = Number(numMatch[1].replace(/,/g, ''));
    if (value > 0) exportRates[key] = value;
  }

  return { effectiveFrom, effectiveTo, exportRates };
}

/**
 * NEW 2026 layout. Header:
 *   "Demand Surcharge (Vietnam)" + "Effective from June 18, 2026"
 * One table on page 1; each region row ends with two integers
 *   "<export-from-VN> <importone>"
 * We take the FIRST integer. The export section ends at the first page
 * break ("-- 1 of") / the start of the G3P matrix.
 */
function parseNew(text: string): DemandPeriod {
  const dateMatch = text.match(/Effective from\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
  if (!dateMatch) {
    throw new Error('parseDemandPdfText: NEW format missing "Effective from <date>"');
  }
  const effectiveFrom = parseLongDate(dateMatch[1]);

  // Cut off everything from the first page break onward (G3P matrix etc.).
  const pageBreak = text.search(/--\s*1 of|Global Third-Party/i);
  const section = pageBreak >= 0 ? text.slice(0, pageBreak) : text;

  const exportRates: Record<string, number> = {};
  for (const line of section.split('\n')) {
    // Data rows end in "<int> <int>" — the export value then the ImportOne value.
    const nums = line.match(/(\d[\d,]*)\s+(\d[\d,]*)\s*$/);
    if (!nums) continue;
    const key = regionKeyForLine(line);
    if (!key) continue;
    const value = Number(nums[1].replace(/,/g, ''));
    if (value > 0) exportRates[key] = value;
  }

  return { effectiveFrom, effectiveTo: null, exportRates };
}
