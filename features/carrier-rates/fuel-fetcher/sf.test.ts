import { describe, it, expect } from 'vitest';
import { parseSfChnFuel, parseSfRangeStart } from './sf';
import { planWeeklyFuelActions } from './dhl-vn';

// Trích đoạn HTML thật từ trang CHN (Nuxt SSR, tag escaped <). Header cột
// Asia + vài data row. Cột: date | Mainland% | Asia% | EU-America%.
const E = (s: string) => s.replace(/</g, '\\u003C').replace(/>/g, '\\u003E').replace(/\//g, '\\u002F');
const FIXTURE = E(`
<table>
<tr><td rowspan="2">Effective date</td><td colspan="2">except Europe and America</td><td rowspan="2">in Europe and America</td><td rowspan="2">Applicable Products</td></tr>
<tr><td>Import and export business where payment is made in Chinese Mainland</td><td>Import and export business where payment is made in Hong Kong, Macau, Taiwan China , Asia and so on</td></tr>
<tr><td><span>June 29th to July 5th, 2026</span></td><td><span>30.50%</span></td><td><span>25.50%</span></td><td><span>13.75%</span></td><td>Global Express +</td></tr>
<tr><td><span>June 22nd to June 28th, 2026</span></td><td><span>33.50%</span></td><td><span>29.00%</span></td><td><span>15.25%</span></td></tr>
<tr><td><span>June 15th to June 21st, 2026</span></td><td><span>35.00%</span></td><td><span>31.25%</span></td><td><span>16.00%</span></td></tr>
<tr><td><span>June 8th to June 14th, 2026</span></td><td><span>35.00%</span></td><td><span>30.25%</span></td><td><span>15.75%</span></td></tr>
<tr><td><span>June 1st to June 7th, 2026</span></td><td><span>40.50%</span></td><td><span>40.50%</span></td><td><span>19.00%</span></td></tr>
</table>
`);

describe('parseSfRangeStart', () => {
  it('parses ordinal date range start', () => {
    expect(parseSfRangeStart('June 29th to July 5th, 2026').toISOString()).toBe('2026-06-29T00:00:00.000Z');
    expect(parseSfRangeStart('June 1st to June 7th, 2026').toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });
  it('handles cross-year range (start in previous year)', () => {
    expect(parseSfRangeStart('December 28th to January 3rd, 2027').toISOString()).toBe('2026-12-28T00:00:00.000Z');
  });
  it('throws on unparseable label', () => {
    expect(() => parseSfRangeStart('sometime in 2026')).toThrow(/cannot parse/);
  });
});

describe('parseSfChnFuel', () => {
  it('extracts the Asia (2nd) column into ascending weekly windows', () => {
    const weeks = parseSfChnFuel(FIXTURE);
    expect(weeks).toHaveLength(5);
    // ascending
    expect(weeks[0].startsAt.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(weeks[0].percent).toBe(40.5);
    // Asia column, NOT Mainland (35) or EU/Am
    const jun8 = weeks.find((w) => w.startsAt.toISOString() === '2026-06-08T00:00:00.000Z')!;
    expect(jun8.percent).toBe(30.25);
    // windows tile: endsAtExclusive = next start
    expect(weeks[0].endsAtExclusive.toISOString()).toBe('2026-06-08T00:00:00.000Z');
    // newest → +7 days default (planWeeklyFuelActions opens it if nothing later)
    const newest = weeks[weeks.length - 1];
    expect(newest.startsAt.toISOString()).toBe('2026-06-29T00:00:00.000Z');
    expect(newest.percent).toBe(25.5);
    expect(newest.endsAtExclusive.toISOString()).toBe('2026-07-06T00:00:00.000Z');
  });

  it('cross-checks against the VN Asia-Pacific values CEO confirmed', () => {
    const weeks = parseSfChnFuel(FIXTURE);
    const byStart = Object.fromEntries(weeks.map((w) => [w.startsAt.toISOString().slice(0, 10), w.percent]));
    expect(byStart['2026-06-29']).toBe(25.5);
    expect(byStart['2026-06-22']).toBe(29.0);
    expect(byStart['2026-06-15']).toBe(31.25);
    expect(byStart['2026-06-08']).toBe(30.25);
    expect(byStart['2026-06-01']).toBe(40.5);
  });

  it('does NOT clobber a newer manually-seeded open week (Jul 6-12 = 25%)', () => {
    // Manual state: 6 rows incl. the current open Jul 6-12 = 25% (from VN page).
    const manual = [
      { id: 'w1', value: 40.5, startsAt: new Date('2026-06-01T00:00:00Z'), endsAt: new Date('2026-06-08T00:00:00Z') },
      { id: 'w2', value: 30.25, startsAt: new Date('2026-06-08T00:00:00Z'), endsAt: new Date('2026-06-15T00:00:00Z') },
      { id: 'w3', value: 31.25, startsAt: new Date('2026-06-15T00:00:00Z'), endsAt: new Date('2026-06-22T00:00:00Z') },
      { id: 'w4', value: 29.0, startsAt: new Date('2026-06-22T00:00:00Z'), endsAt: new Date('2026-06-29T00:00:00Z') },
      { id: 'w5', value: 25.5, startsAt: new Date('2026-06-29T00:00:00Z'), endsAt: new Date('2026-07-06T00:00:00Z') },
      { id: 'w6', value: 25.0, startsAt: new Date('2026-07-06T00:00:00Z'), endsAt: null },
    ];
    const weeks = parseSfChnFuel(FIXTURE); // CHN latest = Jun 29 (25.5), no Jul 6-12
    const actions = planWeeklyFuelActions(manual, weeks);
    // Every CHN week already matches an existing manual row → no close/update/insert
    // touching w6. Assert no action targets the open current-week row.
    expect(actions.some((a) => 'id' in a && a.id === 'w6')).toBe(false);
    // And no insert overlaps [Jul 6, ∞).
    const jul6 = new Date('2026-07-06T00:00:00Z').getTime();
    expect(actions.some((a) => a.type === 'insert' && a.startsAt.getTime() >= jul6)).toBe(false);
  });
});
