import { describe, expect, it } from 'vitest';
import { parseIpExport, toCells } from './fedex-2025-rates';

// Structurally faithful slice of the pdftotext -layout output: two zone
// groups, the bonus-discount table (must be ignored), an Envelope row
// (ignored), Pak + Package light tiers, a page-break continuation that
// carries mode across noise, and per-kilogram heavy bands. Values are
// invented but laid out exactly like the real sheet.
const FIXTURE = `
FedEx International Priority Express Export (IPE)                       Currency: VND
 Kgs        A
Package
     0.5     111,111
FedEx International Priority Export                                     Currency: VND

Net rates are effective as of 28 October 2025.

 Package Type          Bonus                  Earned
                       Discounts (%)          Discount
 Envelope              0%                     0.00%
 Package               7%                     0.00%
 Pak                   7%                     0.00%
 Weight                                       Zone(s)
  Kgs            A                B
Envelope
                 500,000          600,000
Pak
     0.5         574,857          602,923
     2.5         805,392        1,041,538
Package
     0.5         592,155          794,079
     1.0         706,080          937,550
     2.0         854,976        1,208,450

FedEx International Priority Export                                     Currency: VND
 Weight        Zone(s)
  Kgs            A                B
    2.5         929,424        1,343,900

Per-kilogram rates. Multiply by actual shipment weight in kilogram to get the net rate.
    Weight                                    Zone(s)
      Kgs               A          B
       21.0 - 44.0      112,600    204,516
       45.0 - 70.0      100,360    181,792
1,000.0 - 99,999.0       86,681    168,413

FedEx International Economy Export                                      Currency: VND
 Kgs            A
Package
     0.5         999,999
`;

describe('parseIpExport', () => {
  const parsed = parseIpExport(FIXTURE);

  it('ignores the IPE section before IP Export', () => {
    // 111,111 (IPE) and 999,999 (Economy) must never appear.
    expect(parsed.light.some((r) => r.rate === 111111)).toBe(false);
    expect(parsed.light.some((r) => r.rate === 999999)).toBe(false);
  });

  it('ignores the bonus-discount table and Envelope rows', () => {
    expect(parsed.light.some((r) => r.rate === 500000)).toBe(false); // envelope
    // No light row should have a fractional %-style value; discount rows
    // never produce numeric cells.
    expect(parsed.light.every((r) => r.rate > 1000)).toBe(true);
  });

  it('parses light Pak tiers direct', () => {
    const pakA05 = parsed.light.find(
      (r) => r.packageType === 'pak' && r.zone === 'A' && r.weightKg === 0.5,
    );
    expect(pakA05?.rate).toBe(574857);
    const pakB25 = parsed.light.find(
      (r) => r.packageType === 'pak' && r.zone === 'B' && r.weightKg === 2.5,
    );
    expect(pakB25?.rate).toBe(1041538);
  });

  it('parses light Package tiers direct', () => {
    const pkgA05 = parsed.light.find(
      (r) => r.packageType === 'package' && r.zone === 'A' && r.weightKg === 0.5,
    );
    expect(pkgA05?.rate).toBe(592155);
  });

  it('carries Package mode across a page-break continuation', () => {
    // 2.5 / Zone A = 929,424 appears AFTER a page-break header with no
    // "Package" label — mode must persist.
    const pkgA25 = parsed.light.find(
      (r) => r.packageType === 'package' && r.zone === 'A' && r.weightKg === 2.5,
    );
    expect(pkgA25?.rate).toBe(929424);
  });

  it('parses heavy per-kg bands for every zone', () => {
    const a2144 = parsed.heavy.find((b) => b.zone === 'A' && b.lo === 21 && b.hi === 44);
    expect(a2144?.perKg).toBe(112600);
    const bTop = parsed.heavy.find((b) => b.zone === 'B' && b.lo === 1000);
    expect(bTop?.perKg).toBe(168413);
  });
});

describe('toCells', () => {
  const parsed = parseIpExport(FIXTURE);
  const tierUppers = [0.5, 1.0, 2.0, 2.5, 25, 30, 44, 50, 60, 70, 1500];
  const cells = toCells(parsed, tierUppers);

  it('maps light rates 1:1 by tier upperKg with Zone-label prefix', () => {
    const c = cells.find(
      (x) => x.zoneLabel === 'Zone A' && x.packageType === 'package' && x.upperKg === 0.5,
    );
    expect(c?.cost).toBe(592155);
  });

  it('skips light tiers the account does not model', () => {
    // weightKg 1.5 never appears in tierUppers → no cell.
    expect(cells.some((c) => c.upperKg === 1.5)).toBe(false);
  });

  it('fans a heavy band to every tier in [lo,hi] as perKg × upperKg', () => {
    const t25 = cells.find((c) => c.zoneLabel === 'Zone A' && c.upperKg === 25);
    expect(t25?.cost).toBe(112600 * 25);
    const t44 = cells.find((c) => c.zoneLabel === 'Zone A' && c.upperKg === 44);
    expect(t44?.cost).toBe(112600 * 44);
    const t50 = cells.find((c) => c.zoneLabel === 'Zone A' && c.upperKg === 50);
    expect(t50?.cost).toBe(100360 * 50); // band 45-70
    const t1500 = cells.find((c) => c.zoneLabel === 'Zone A' && c.upperKg === 1500);
    expect(t1500?.cost).toBe(86681 * 1500); // band 1000+
  });

  it('emits heavy cells as Package only', () => {
    expect(cells.filter((c) => c.upperKg >= 25).every((c) => c.packageType === 'package')).toBe(true);
  });
});
