import type { ParsedIpExport } from '../fedex-2025-rates';

export interface SpotCheck {
  zoneLabel: string;
  packageType: 'package' | 'pak';
  upperKg: number;
  cost: number;
}

/** A carrier rate-sheet parser, keyed by the carrier this sheet belongs to. */
export interface RateSheetParser {
  carrierKey: string; // matches carriers.key, e.g. 'fedex'
  label: string; // human label, e.g. 'FedEx International Priority'
  parse(text: string): ParsedIpExport;
  /** Pull the sheet's "effective from" date as YYYY-MM-DD, or null if absent. */
  extractEffectiveFrom(text: string): string | null;
  expectedPackageCells: number;
  expectedPakCells: number;
  spotChecks: SpotCheck[];
}
