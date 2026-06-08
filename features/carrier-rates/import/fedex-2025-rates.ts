/**
 * Pure parser for the FedEx Vietnam INECSO 2025 rate sheet
 * ("International Priority Export", IP — NOT IPE Express, NOT Economy).
 *
 * The PDF (extracted via `pdftotext -layout`) lays the IP Export rates
 * out in three zone groups (A–M, O–X, Y–Z), each with:
 *   - Envelope  (single rate, IGNORED — DB stores no envelope cells)
 *   - Pak       (light tiers 0.5–2.5 kg, direct VND per tier)
 *   - Package   (light tiers 0.5–20.5 kg, direct VND per tier)
 *   - Per-kilogram bands (21–44, 45–70, 71–99, 100–299, 300–499,
 *     500–999, 1000–99999) — "multiply by actual weight" → VND/kg.
 *
 * Tables wrap across page breaks, so we run a small state machine that
 * carries the current zone list + section mode across noise lines.
 *
 * Storage convention (verified against the 2026 card, invoice-checked):
 *   - light Package/Pak  → cell cost = tabulated rate (direct)
 *   - heavy Package      → cell cost = perKgRate × tier.upperKg
 *   - Pak only exists for tiers 0.5–2.5; heavy is Package only.
 * Tabulated rates are already NET (the 7% bonus discount is disclosure
 * only; the engine applies no discount surcharge).
 */

export type PackageType = 'package' | 'pak';

export interface LightRate {
  packageType: PackageType;
  zone: string; // single letter, e.g. "A"
  weightKg: number; // tier upper bound, 0.5 … 20.5
  rate: number; // VND, direct
}

export interface HeavyBand {
  zone: string; // single letter
  lo: number; // band lower kg (inclusive), e.g. 21
  hi: number; // band upper kg (inclusive), e.g. 44
  perKg: number; // VND per kg
}

export interface ParsedIpExport {
  light: LightRate[];
  heavy: HeavyBand[];
}

function num(s: string): number {
  return Number(s.replace(/,/g, ''));
}

/**
 * Slice the IP Export section out of the full pdftotext output and run
 * the state machine. Returns every light tier rate and heavy per-kg band
 * for all 22 zones.
 */
export function parseIpExport(fullText: string): ParsedIpExport {
  const lines = fullText.split('\n');

  // IP Export starts at the first "FedEx International Priority Export"
  // rate-table header (not "Express", not "Import"/"Third Party") and ends
  // where "FedEx International Economy Export" begins. Real table headers
  // carry "Currency: VND"; the dotted table-of-contents lines do not — so
  // we anchor on that to avoid matching the TOC.
  const startRe = /^FedEx International Priority Export\b.*Currency: VND/;
  const endRe = /^FedEx International Economy Export\b.*Currency: VND/;
  const start = lines.findIndex((l) => startRe.test(l.trim()));
  if (start === -1) throw new Error('IP Export section not found in PDF text.');
  const endRel = lines.slice(start + 1).findIndex((l) => endRe.test(l.trim()));
  const end = endRel === -1 ? lines.length : start + 1 + endRel;
  const section = lines.slice(start, end);

  let zones: string[] = [];
  let mode: 'envelope' | 'pak' | 'package' | 'perkg' | null = null;
  const light: LightRate[] = [];
  const heavy: HeavyBand[] = [];

  for (const raw of section) {
    const line = raw.trim();
    if (!line) continue;

    // Zone header: "Kgs   A   B   C …" (single capital letters)
    const hm = line.match(/^Kgs\s+([A-Z](?:\s+[A-Z])*)\s*$/);
    if (hm) {
      zones = hm[1].split(/\s+/);
      continue;
    }

    // Section mode labels (must be the WHOLE line — the bonus-discount
    // table has lines like "Package   7%   0.00%" which must NOT match).
    if (line === 'Envelope') { mode = 'envelope'; continue; }
    if (line === 'Pak') { mode = 'pak'; continue; }
    if (line === 'Package') { mode = 'package'; continue; }
    if (/^Per-kilogram rates\./.test(line)) { mode = 'perkg'; continue; }

    // Heavy per-kg band row: "21.0 - 44.0   112,600   204,516 …"
    if (mode === 'perkg') {
      const bm = line.match(/^([\d,]+\.\d)\s*-\s*([\d,]+\.\d)\s+(.+)$/);
      if (bm) {
        const lo = num(bm[1]);
        const hi = num(bm[2]);
        const vals = bm[3].trim().split(/\s+/).map(num);
        vals.forEach((v, i) => {
          if (zones[i]) heavy.push({ zone: zones[i], lo, hi, perKg: v });
        });
      }
      continue;
    }

    // Light tier row: "0.5   592,155   794,079 …"
    if (mode === 'pak' || mode === 'package') {
      const wm = line.match(/^(\d+\.\d)\s+(.+)$/);
      if (wm) {
        const weightKg = parseFloat(wm[1]);
        const vals = wm[2].trim().split(/\s+/).map(num);
        vals.forEach((v, i) => {
          if (zones[i]) {
            light.push({ packageType: mode as PackageType, zone: zones[i], weightKg, rate: v });
          }
        });
      }
      continue;
    }
    // Envelope value lines + page noise fall through (ignored).
  }

  return { light, heavy };
}

export interface RateCellInput {
  zoneLabel: string; // "Zone A"
  upperKg: number;
  packageType: PackageType;
  cost: number; // VND, ready to store
}

/**
 * Map parsed rates onto the carrier's existing weight-tier set.
 *
 * - Light rates map 1:1 to the tier whose upperKg equals the row weight.
 * - Heavy bands fan out to every tier whose upperKg falls inside [lo, hi];
 *   cost = perKg × upperKg (the engine reads a flat cell per tier).
 *
 * `tierUppers` is the full ordered list of tier upper bounds for the
 * account (e.g. [0.5 … 20.5, 25, 30, …, 1500]).
 */
export function toCells(parsed: ParsedIpExport, tierUppers: number[]): RateCellInput[] {
  const tierSet = new Set(tierUppers);
  const cells: RateCellInput[] = [];

  for (const r of parsed.light) {
    if (!tierSet.has(r.weightKg)) continue; // skip tiers the account doesn't model
    cells.push({
      zoneLabel: `Zone ${r.zone}`,
      upperKg: r.weightKg,
      packageType: r.packageType,
      cost: r.rate,
    });
  }

  for (const b of parsed.heavy) {
    for (const upper of tierUppers) {
      if (upper >= b.lo && upper <= b.hi) {
        cells.push({
          zoneLabel: `Zone ${b.zone}`,
          upperKg: upper,
          packageType: 'package',
          cost: b.perKg * upper,
        });
      }
    }
  }

  return cells;
}
