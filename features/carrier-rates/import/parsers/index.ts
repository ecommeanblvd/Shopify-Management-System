import { fedexIpParser } from './fedex-ip';
import { dhlExportParser } from './dhl-export';
import type { RateSheetParser } from './types';

const PARSERS: RateSheetParser[] = [fedexIpParser, dhlExportParser];

/** Resolve a parser by carrier key (carriers.key). Null = no auto-parser. */
export function resolveParser(carrierKey: string | null): RateSheetParser | null {
  if (!carrierKey) return null;
  return PARSERS.find((p) => p.carrierKey === carrierKey) ?? null;
}

export type { RateSheetParser } from './types';
