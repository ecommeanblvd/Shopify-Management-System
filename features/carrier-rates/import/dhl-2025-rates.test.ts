import { describe, it, expect } from 'vitest';
import { parseDhlExport, extractDhlEffectiveFrom } from './dhl-2025-rates';

// A faithful slice of `pdftotext -layout` output for the DHL Express Vietnam
// 2025 card: the EXPORT page (with the decoy "Documents up to 2.0 KG" table
// that must be ignored), then the IMPORT page (which must NOT bleed in).
const FIXTURE = `
TIME DEFINITE
DHL Express Vietnam
DHL EXPRESS WORLDWIDE EXPORT
Documents up to 2.0 KG
    KG        Zone 1     Zone 2    Zone 3    Zone 4    Zone 5    Zone 6    Zone 7    Zone 8    Zone 9   Zone 10
    0.5       111,111    111,111   111,111   111,111   111,111   111,111   111,111   111,111   111,111  111,111
    2.0       111,111    111,111   111,111   111,111   111,111   111,111   111,111   111,111   111,111  111,111

Non-documents from 0.5 KG & Documents from 2.5 KG
    KG        Zone 1     Zone 2    Zone 3    Zone 4    Zone 5    Zone 6    Zone 7    Zone 8    Zone 9   Zone 10
    0.5       379,535    381,588   404,916   445,369   508,216   548,303   571,716   586,927   758,859  968,398
    2.5       710,476    745,702   848,776   924,517 1,036,923 1,083,814 1,144,973 1,189,336 1,479,856 1,889,704
   30.0     2,562,701  2,775,482 3,484,206 4,060,552 4,211,138 5,391,164 5,504,368 5,694,546 8,127,501 10,428,344

Multiplier rate per 1 KG from 30.1 KG
   From         To     Zone 1     Zone 2    Zone 3    Zone 4    Zone 5    Zone 6    Zone 7    Zone 8    Zone 9   Zone 10
   30.1         70    106,793    116,846   144,265   171,437   178,354   227,073   232,248   240,310   337,997  450,861
   70.1        300    146,893    160,316   200,718   236,011   247,320   310,387   318,572   330,169   463,368  617,551
  300.1     99,999    154,611    160,685   206,351   258,571   270,380   313,699   327,618   343,896   468,131  678,373

Premium 9:00: add 900,000 VND to the DHL EXPRESS WORLDWIDE EXPORT rate

DHL EXPRESS WORLDWIDE IMPORT
Non-documents from 0.5 KG & Documents from 2.5 KG
    KG        Zone 1     Zone 2    Zone 3    Zone 4    Zone 5    Zone 6    Zone 7    Zone 8    Zone 9   Zone 10
    0.5     1,126,510  1,231,300 1,322,230 1,329,860 1,514,590 1,515,360 1,526,280 1,529,220 1,838,970 2,571,520

PID code/name: VNC016KPB                                  Ratecard as of: 01-Jan-2025
`;

describe('parseDhlExport', () => {
  const parsed = parseDhlExport(FIXTURE);

  it('parses the non-doc grid (10 zones × the 3 light rows), ignoring the decoy doc table', () => {
    // 3 light rows × 10 zones = 30. The "Documents up to 2.0 KG" decoy and the
    // IMPORT grid must NOT contribute.
    expect(parsed.light).toHaveLength(30);
  });

  it('reads zone 1 light rates as labels "1".."10" with direct VND', () => {
    const z1_05 = parsed.light.find((r) => r.zone === '1' && r.weightKg === 0.5);
    expect(z1_05).toMatchObject({ packageType: 'package', rate: 379535 });
    const z10_30 = parsed.light.find((r) => r.zone === '10' && r.weightKg === 30.0);
    expect(z10_30?.rate).toBe(10428344);
    const z1_25 = parsed.light.find((r) => r.zone === '1' && r.weightKg === 2.5);
    expect(z1_25?.rate).toBe(710476);
  });

  it('does NOT pick up the decoy 111,111 documents-table values', () => {
    expect(parsed.light.some((r) => r.rate === 111111)).toBe(false);
  });

  it('does NOT bleed into the IMPORT grid (1,126,510)', () => {
    expect(parsed.light.some((r) => r.rate === 1126510)).toBe(false);
  });

  it('parses the 3 multiplier bands × 10 zones', () => {
    expect(parsed.heavy).toHaveLength(30);
    const b1z1 = parsed.heavy.find((b) => b.lo === 30.1 && b.zone === '1');
    expect(b1z1).toMatchObject({ hi: 70, perKg: 106793 });
    const b3z10 = parsed.heavy.find((b) => b.lo === 300.1 && b.zone === '10');
    expect(b3z10).toMatchObject({ hi: 99999, perKg: 678373 });
  });
});

describe('extractDhlEffectiveFrom', () => {
  it('reads "Ratecard as of: 01-Jan-2025" as 2025-01-01', () => {
    expect(extractDhlEffectiveFrom(FIXTURE)).toBe('2025-01-01');
  });

  it('returns null when absent', () => {
    expect(extractDhlEffectiveFrom('no date here')).toBeNull();
  });
});
