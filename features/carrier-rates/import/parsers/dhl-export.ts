import { parseDhlExport, extractDhlEffectiveFrom } from '../dhl-2025-rates';
import type { RateSheetParser, SpotCheck } from './types';

// Spot checks pulled straight from the PDF (ground truth):
//   light Package cells store the tabulated VND directly;
//   heavy cells store perKg × tier.upperKg (the multiplier-band rule).
const SPOT_CHECKS: SpotCheck[] = [
  { zoneLabel: 'Zone 1', packageType: 'package', upperKg: 0.5, cost: 379535 },
  { zoneLabel: 'Zone 10', packageType: 'package', upperKg: 0.5, cost: 968398 },
  { zoneLabel: 'Zone 1', packageType: 'package', upperKg: 2.5, cost: 710476 },
  { zoneLabel: 'Zone 10', packageType: 'package', upperKg: 30, cost: 10428344 },
  // heavy band 30.1–70: perKg 106,793 → tier 35 = 106,793 × 35
  { zoneLabel: 'Zone 1', packageType: 'package', upperKg: 35, cost: 106793 * 35 },
  // heavy band 70.1–300: perKg 146,893 → tier 300 = 146,893 × 300
  { zoneLabel: 'Zone 1', packageType: 'package', upperKg: 300, cost: 146893 * 300 },
];

/**
 * DHL Express Vietnam 2025 — "WORLDWIDE EXPORT", sub-table
 * "Non-documents from 0.5 KG & Documents from 2.5 KG".
 *
 * Cell expectations assume the account uses the canonical DHL tier set
 * (`dhl2025TierUppers()`): 0.5–30 kg (0.5 step, 60 tiers) + 12 heavy points
 * (35,40,45,50,60,70,100,150,200,300,500,1000). Light grid = 60 × 10 = 600;
 * heavy = 12 × 10 = 120. Total Package cells = 720. No Pak cells (DHL has no
 * Pak on this product).
 */
export const dhlExportParser: RateSheetParser = {
  carrierKey: 'dhl',
  label: 'DHL Express Worldwide Export (Non-doc)',
  parse: parseDhlExport,
  extractEffectiveFrom: extractDhlEffectiveFrom,
  expectedPackageCells: 720,
  expectedPakCells: 0,
  spotChecks: SPOT_CHECKS,
};
