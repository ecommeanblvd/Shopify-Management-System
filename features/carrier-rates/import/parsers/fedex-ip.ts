import { parseIpExport } from '../fedex-2025-rates';
import type { RateSheetParser, SpotCheck } from './types';

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function extractEffectiveFrom(text: string): string | null {
  // e.g. "Net rates are effective as of 28 October 2025."
  const m = text.match(/effective as of\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (!month) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const SPOT_CHECKS: SpotCheck[] = [
  { zoneLabel: 'Zone A', packageType: 'package', upperKg: 0.5, cost: 592155 },
  { zoneLabel: 'Zone A', packageType: 'pak', upperKg: 0.5, cost: 574857 },
  { zoneLabel: 'Zone O', packageType: 'package', upperKg: 0.5, cost: 588448 },
  { zoneLabel: 'Zone Y', packageType: 'package', upperKg: 0.5, cost: 413587 },
  { zoneLabel: 'Zone Y', packageType: 'package', upperKg: 1.0, cost: 414822 },
  { zoneLabel: 'Zone Z', packageType: 'package', upperKg: 20.5, cost: 1680768 },
  { zoneLabel: 'Zone A', packageType: 'package', upperKg: 25, cost: 112600 * 25 },
  { zoneLabel: 'Zone A', packageType: 'package', upperKg: 1500, cost: 86681 * 1500 },
  { zoneLabel: 'Zone Y', packageType: 'package', upperKg: 25, cost: 90981 * 25 },
];

export const fedexIpParser: RateSheetParser = {
  carrierKey: 'fedex',
  label: 'FedEx International Priority',
  parse: parseIpExport,
  extractEffectiveFrom,
  expectedPackageCells: 1298,
  expectedPakCells: 110,
  spotChecks: SPOT_CHECKS,
};
