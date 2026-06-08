import { describe, expect, it } from 'vitest';
import { buildRateCardCells } from './preview';
import { fedexIpParser } from './parsers/fedex-ip';

// Minimal IP Export fixture (same shape as fedex-2025-rates.test.ts) so the
// builder runs end-to-end without the real PDF.
const FIXTURE = `
FedEx International Priority Export                                     Currency: VND
Net rates are effective as of 28 October 2025.
 Weight                                       Zone(s)
  Kgs            A                B
Pak
     0.5         574,857          602,923
Package
     0.5         592,155          794,079
Per-kilogram rates. Multiply by actual shipment weight in kilogram to get the net rate.
    Weight                                    Zone(s)
      Kgs               A          B
       21.0 - 44.0      112,600    204,516
FedEx International Economy Export                                      Currency: VND
`;

describe('buildRateCardCells', () => {
  const tierUppers = [0.5, 25];
  const zoneLabels = ['Zone A', 'Zone B'];

  it('returns cells + a preview with counts and effectiveFromGuess', () => {
    const r = buildRateCardCells(fedexIpParser, FIXTURE, tierUppers, zoneLabels);
    expect(r.preview.effectiveFromGuess).toBe('2025-10-28');
    expect(r.cells.find((c) => c.zoneLabel === 'Zone A' && c.upperKg === 0.5 && c.packageType === 'package')?.cost).toBe(592155);
    expect(r.cells.find((c) => c.zoneLabel === 'Zone A' && c.upperKg === 25)?.cost).toBe(112600 * 25);
  });

  it('flags an unknown zone as a problem', () => {
    const r = buildRateCardCells(fedexIpParser, FIXTURE, tierUppers, ['Zone A']); // Zone B missing
    expect(r.problems.some((p) => p.includes('Zone B'))).toBe(true);
  });
});
