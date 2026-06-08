import { toCells, type RateCellInput } from './fedex-2025-rates';
import type { RateSheetParser } from './parsers/types';

export interface HeavyRow {
  band: string; // "21-44"
  rates: { zone: string; perKg: number }[];
}

export interface RateCardPreview {
  parserLabel: string;
  effectiveFromGuess: string | null;
  packageCells: number;
  pakCells: number;
  zonesCovered: number;
  spotChecks: { label: string; ok: boolean }[];
  heavy: HeavyRow[];
  selfCheckOk: boolean;
}

export interface BuiltRateCard {
  cells: RateCellInput[];
  preview: RateCardPreview;
  problems: string[];
}

/**
 * Parse a rate-sheet text with the given parser, map to cells against the
 * account's tier set, and produce a review-ready preview + a problem list.
 * Used by both the CLI importer and the server commit action so the
 * self-check is identical in both paths.
 */
export function buildRateCardCells(
  parser: RateSheetParser,
  text: string,
  tierUppers: number[],
  zoneLabels: string[],
): BuiltRateCard {
  const parsed = parser.parse(text);
  const cells = toCells(parsed, tierUppers);
  const tierSet = new Set(tierUppers);
  const zoneSet = new Set(zoneLabels);
  const problems: string[] = [];

  const packageCells = cells.filter((c) => c.packageType === 'package').length;
  const pakCells = cells.filter((c) => c.packageType === 'pak').length;
  if (packageCells !== parser.expectedPackageCells) problems.push(`package count ${packageCells} ≠ ${parser.expectedPackageCells}`);
  if (pakCells !== parser.expectedPakCells) problems.push(`pak count ${pakCells} ≠ ${parser.expectedPakCells}`);
  for (const c of cells) {
    if (!zoneSet.has(c.zoneLabel)) problems.push(`unknown zone ${c.zoneLabel}`);
    if (!tierSet.has(c.upperKg)) problems.push(`unknown tier ${c.upperKg}`);
  }

  const spotChecks = parser.spotChecks.map((s) => {
    const hit = cells.find((c) => c.zoneLabel === s.zoneLabel && c.packageType === s.packageType && c.upperKg === s.upperKg);
    const ok = !!hit && hit.cost === s.cost;
    if (!ok) problems.push(`spot-check ${s.zoneLabel} ${s.packageType} ${s.upperKg}kg`);
    return { label: `${s.zoneLabel} ${s.packageType} ${s.upperKg}kg`, ok };
  });

  const bandKeys = Array.from(new Set(parsed.heavy.map((b) => `${b.lo}-${b.hi}`)));
  const heavy: HeavyRow[] = bandKeys.map((bk) => {
    const [lo, hi] = bk.split('-').map(Number);
    return {
      band: bk,
      rates: parsed.heavy.filter((b) => b.lo === lo && b.hi === hi).map((b) => ({ zone: b.zone, perKg: b.perKg })),
    };
  });

  const zonesCovered = new Set(cells.map((c) => c.zoneLabel)).size;

  return {
    cells,
    problems,
    preview: {
      parserLabel: parser.label,
      effectiveFromGuess: parser.extractEffectiveFrom(text),
      packageCells, pakCells, zonesCovered,
      spotChecks, heavy,
      selfCheckOk: problems.length === 0,
    },
  };
}
