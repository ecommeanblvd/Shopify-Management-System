/**
 * Parser for the FedEx Vietnam Demand-Surcharge PDF text (as produced by
 * pdf-parse). DATE detection and TABLE style are decoupled: a date header and
 * a table layout vary independently across the PDFs FedEx has published.
 *
 * We only ever care about the **Export-from-Vietnam** value (our fleet ships
 * outbound from VN). The ImportOne column and the page-2+ Global Third-Party
 * (G3P) matrix are ignored.
 *
 * DATE headers seen (tried in order):
 *   - "Effective from <Month D, YYYY>"           → { from, to: null } (open).
 *   - "from <Month D, YYYY> to <Month D, YYYY>"  → { from, to: <to + 1 day> }.
 *     Matches BOTH "Demand Surcharge from X to Y" (OLD) AND the bare
 *     "From X to Y" of the RANGE-consolidated PDFs (sep-oct / oct-dec 2025).
 *
 * TABLE layouts seen:
 *   - CONSOLIDATED (NEW + RANGE): one page-1 table; each region row ends in two
 *     integers "<export> <importone>". Used by both "Effective from" and the
 *     "From X to Y" range PDFs.
 *   - OLD mini-table: rows like "Vietnam to Israel 11200 VND 11200 VND".
 *
 * The asserted ground-truth values come from the real PDFs:
 *   OLD 2025   (Jul 21 – Sep 21): Israel 11200.
 *   NEW 2026   (eff. Jun 18):     Israel 28400, Europe 28400, MEISA 39700.
 *   RANGE 2025 (Oct 20 – Dec 7):  USA 28400, Canada 28400, …, MEISA 28400.
 *
 * The text below is what pdf-parse actually emits — NOT a clean visual read.
 * Notable real-text quirks handled here:
 *   - OLD: the export row is a single line
 *       "Vietnam to Israel 11200 VND 11200 VND"
 *     i.e. region + Priority-VND + Economy-VND glued together; the first
 *     number is the one we want.
 *   - CONSOLIDATED: region names sometimes WRAP across lines and the numbers
 *     land on the continuation line, e.g.
 *       "United States of America (USA) and"
 *       "Puerto Rico 28400 8000"                  → usa 28400
 *       "Middle East/Indian Subcontinent/"
 *       "Africa3 (MEISA) 28400 7700"              → meisa 28400
 *     The "Puerto Rico" line carries NO region keyword, so we buffer preceding
 *     name text and match the keyword against the COMBINED name.
 *   - CONSOLIDATED: the G3P matrix on page 2+ also contains numbers, so we cut
 *     the export section off at the first page break ("-- 1 of").
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
  // Plain "Asia", optionally with a footnote digit ("Asia1"). Anchored on a
  // leading boundary so it won't match "Asia" buried inside another word, but
  // tolerant of the trailing superscript pdf-parse glues on.
  { key: 'asia', re: /\bAsia\d*\b/i },
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * DATE detection, decoupled from the table layout. Tried in order:
 *   1. "Effective from <date>"            → { from, to: null }.
 *   2. "from <date> to <date>" (ci)       → { from, to: <to + 1 day> }.
 *      Matches BOTH "Demand Surcharge from X to Y" AND a bare "From X to Y".
 * effectiveTo is EXCLUSIVE: the day AFTER the printed end date.
 */
function detectDates(text: string): { from: Date; to: Date | null } {
  const eff = text.match(/Effective from\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
  if (eff) {
    return { from: parseLongDate(eff[1]), to: null };
  }
  const range = text.match(
    /from\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})\s+to\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i,
  );
  if (range) {
    const printedTo = parseLongDate(range[2]);
    return {
      from: parseLongDate(range[1]),
      to: new Date(printedTo.getTime() + DAY_MS),
    };
  }
  throw new Error(
    'parseDemandPdfText: unrecognised PDF — no "Effective from" or "from … to …" date header',
  );
}

/**
 * TABLE-style detection, decoupled from the date header. The consolidated table
 * (NEW + RANGE) carries the "Export shipments" + "ImportOne" + "Region /
 * Country" markers and region rows with two trailing integers. Anything else is
 * the OLD "Vietnam to <region> <n> VND <n> VND" mini-table.
 */
function isConsolidated(text: string): boolean {
  if (!/Export shipments/i.test(text) || !/ImportOne/i.test(text)) {
    return false;
  }
  if (!/Region\s*\/\s*Country/i.test(text)) {
    return false;
  }
  // Discriminator vs the OLD mini-table: the consolidated table has region rows
  // ending in two bare trailing integers ("28400 8000"). The OLD table's rows
  // end in "<n> VND" instead, so this is false for OLD.
  return text.split('\n').some((line) => /(\d[\d,]*)\s+(\d[\d,]*)\s*$/.test(line));
}

export function parseDemandPdfText(text: string): DemandPeriod {
  if (!text || !text.trim()) {
    throw new Error('parseDemandPdfText: empty text');
  }

  const { from, to } = detectDates(text);
  const exportRates = isConsolidated(text)
    ? parseConsolidatedTable(text)
    : parseOldTable(text);

  return { effectiveFrom: from, effectiveTo: to, exportRates };
}

/**
 * OLD mini-table. Header e.g.
 *   "Demand Surcharge from July 21, 2025 to September 21, 2025 (Vietnam)"
 * Export rows live between "Export shipments from" and the second
 * "Service Region" / "ImportOne" block, each like:
 *   "Vietnam to Israel 11200 VND 11200 VND"
 * Returns region key → export VND/kg (rates > 0 only).
 */
function parseOldTable(text: string): Record<string, number> {
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
  return exportRates;
}

/**
 * CONSOLIDATED table (NEW "Effective from" + RANGE "From X to Y").
 * One table on page 1; each region row ends with two integers
 *   "<export-from-VN> <importone>"
 * We take the FIRST integer. The export section ends at the first page break
 * ("-- 1 of") / the start of the G3P matrix.
 *
 * Multi-line-region robust: a region name may wrap across lines with the
 * numbers landing on the continuation line that itself carries NO keyword
 * (e.g. "United States of America (USA) and" / "Puerto Rico 28400 8000"). We
 * buffer the leading non-numeric text of each line; when a line ends in two
 * integers we match the region keyword against (buffer + this line's leading
 * text) and reset the buffer.
 * Returns region key → export VND/kg (rates > 0 only).
 */
function parseConsolidatedTable(text: string): Record<string, number> {
  // Cut off everything from the first page break onward (G3P matrix etc.).
  const pageBreak = text.search(/--\s*1 of|Global Third-Party/i);
  const section = pageBreak >= 0 ? text.slice(0, pageBreak) : text;

  const exportRates: Record<string, number> = {};
  let nameBuffer = '';
  for (const line of section.split('\n')) {
    // Data rows end in "<int> <int>" — the export value then the ImportOne value.
    const nums = line.match(/(\d[\d,]*)\s+(\d[\d,]*)\s*$/);
    if (!nums) {
      // Not a number row: treat as (possibly wrapping) region-name text.
      const trimmed = line.trim();
      if (trimmed) nameBuffer = nameBuffer ? `${nameBuffer} ${trimmed}` : trimmed;
      continue;
    }
    // Region name = buffered preceding text + this line's leading non-numeric
    // part (everything before the trailing two integers).
    const leading = line.slice(0, line.length - nums[0].length);
    const combinedName = `${nameBuffer} ${leading}`.trim();
    nameBuffer = '';

    const key = regionKeyForLine(combinedName);
    if (!key) continue;
    const value = Number(nums[1].replace(/,/g, '')); // FIRST integer = export.
    if (value > 0) exportRates[key] = value;
  }
  return exportRates;
}
