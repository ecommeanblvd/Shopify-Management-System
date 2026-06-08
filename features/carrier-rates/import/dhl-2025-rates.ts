/**
 * Pure parser for the DHL Express Vietnam 2025 rate sheet — the
 * "DHL EXPRESS WORLDWIDE EXPORT" product, sub-table
 * "Non-documents from 0.5 KG & Documents from 2.5 KG".
 *
 * The PDF (extracted via `pdftotext -layout`) lays this out as a single
 * zone × weight grid (Zone 1 … Zone 10, rows 0.5 → 30.0 kg in 0.5 steps),
 * followed by a "Multiplier rate per 1 KG from 30.1 KG" table with three
 * per-kilogram bands (30.1–70, 70.1–300, 300.1–99,999).
 *
 * We emit the same `ParsedIpExport` shape the FedEx parser produces so the
 * shared `toCells` / `buildRateCardCells` pipeline can consume it unchanged:
 *   - every light tier row → a `package` LightRate (DHL has no Pak/Envelope
 *     split on this product; the doc-vs-non-doc distinction is handled by
 *     choosing this sub-table, not by package type).
 *   - each multiplier band → a HeavyBand (VND per kg).
 *
 * Storage convention mirrors FedEx:
 *   - light Package → cell cost = tabulated rate (direct VND)
 *   - heavy        → cell cost = perKg × tier.upperKg (engine reads a flat
 *     cell per tier; `toCells` fans the band out across in-range tiers).
 * Rates are NET VND, excluding taxes / fuel / surcharges.
 */

import type { ParsedIpExport, LightRate, HeavyBand } from './fedex-2025-rates';

function num(s: string): number {
  return Number(s.replace(/,/g, ''));
}

const ZONE_COUNT = 10;
const ZONES = Array.from({ length: ZONE_COUNT }, (_, i) => String(i + 1)); // "1".."10"

/**
 * Slice the WORLDWIDE EXPORT section (page 1) out of the full pdftotext
 * output, isolate the "Non-documents from 0.5 KG & Documents from 2.5 KG"
 * grid + the multiplier table, and parse them. The IMPORT product (page 2)
 * has identical headers, so we hard-stop at the IMPORT marker.
 */
export function parseDhlExport(fullText: string): ParsedIpExport {
  const lines = fullText.split('\n');

  const startRe = /DHL EXPRESS WORLDWIDE EXPORT/i;
  const importRe = /DHL EXPRESS WORLDWIDE IMPORT/i;
  const start = lines.findIndex((l) => startRe.test(l));
  if (start === -1) throw new Error('DHL WORLDWIDE EXPORT section not found in PDF text.');
  const importRel = lines.slice(start + 1).findIndex((l) => importRe.test(l));
  const end = importRel === -1 ? lines.length : start + 1 + importRel;
  const section = lines.slice(start, end);

  // The non-doc grid begins at its sub-header and runs until the multiplier
  // table; the multiplier table runs until the Premium add-on lines.
  const nonDocStart = section.findIndex((l) => /Non-documents from 0\.5 KG/i.test(l));
  if (nonDocStart === -1) throw new Error('DHL non-documents sub-table not found.');
  const multStart = section.findIndex((l) => /Multiplier rate per 1 KG/i.test(l));
  if (multStart === -1) throw new Error('DHL multiplier table not found.');

  const light: LightRate[] = [];
  const heavy: HeavyBand[] = [];

  // Light grid: rows like "0.5  379,535  381,588  …(10 cols)…  968,398"
  for (let i = nonDocStart + 1; i < multStart; i++) {
    const line = section[i].trim();
    const m = line.match(/^(\d+\.\d)\s+((?:[\d,]+\s+){9}[\d,]+)\s*$/);
    if (!m) continue;
    const weightKg = parseFloat(m[1]);
    const vals = m[2].trim().split(/\s+/).map(num);
    if (vals.length !== ZONE_COUNT) continue;
    vals.forEach((rate, idx) => {
      light.push({ packageType: 'package', zone: ZONES[idx], weightKg, rate });
    });
  }

  // Multiplier bands: rows like "30.1  70  106,793  …(10 cols)…  450,861"
  for (let i = multStart + 1; i < section.length; i++) {
    const line = section[i].trim();
    if (/^Premium/i.test(line)) break;
    const m = line.match(/^([\d,.]+)\s+([\d,.]+)\s+((?:[\d,]+\s+){9}[\d,]+)\s*$/);
    if (!m) continue;
    const lo = num(m[1]);
    const hi = num(m[2]);
    const vals = m[3].trim().split(/\s+/).map(num);
    if (vals.length !== ZONE_COUNT) continue;
    vals.forEach((perKg, idx) => {
      heavy.push({ zone: ZONES[idx], lo, hi, perKg });
    });
  }

  return { light, heavy };
}

/**
 * Pull the sheet's effective-from date. DHL prints "Ratecard as of:
 * 01-Jan-2025" in the page footer. Returns YYYY-MM-DD or null.
 */
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function extractDhlEffectiveFrom(text: string): string | null {
  const m = text.match(/Ratecard as of:\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})/i);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (!month) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
