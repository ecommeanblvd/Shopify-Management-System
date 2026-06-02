import { describe, it, expect } from 'vitest';
import {
  parsePercent, parseDhlPage, isoWeek, pickCurrentWeek,
  fetchDhlFuelPercent, type DhlFuelRow,
} from './dhl';

describe('parsePercent', () => {
  it('handles "48.00%"', () => expect(parsePercent('48.00%')).toBe(48));
  it('handles trailing space', () => expect(parsePercent('48.00 %')).toBe(48));
  it('handles comma decimals', () => expect(parsePercent('12,25 %')).toBe(12.25));
  it('handles bare numbers', () => expect(parsePercent('30')).toBe(30));
  it('throws on garbage', () => expect(() => parsePercent('garbage')).toThrow());
});

describe('parseDhlPage', () => {
  const SAMPLE_HTML = `
    <html><body>
      <table>
        <tr><th>Week</th><th>Surcharge</th></tr>
        <tr><td>CW 24</td><td>48.75 %</td></tr>
        <tr class="row"><td>CW 23</td><td>48.75 %</td></tr>
        <tr><td>CW 22</td><td>47.75%</td></tr>
        <tr><td>CW 21</td><td>47.25 %</td></tr>
        <tr><td>CW 20</td><td>46.75 %</td></tr>
        <tr><td>CW 19</td><td>47.00 %</td></tr>
        <tr><td>CW 18</td><td>48.00 %</td></tr>
        <tr><td>CW 17</td><td>47.75 %</td></tr>
        <!-- This row should NOT match — it's the kerosene price table -->
        <tr><td>USD 4.36</td><td>55.00 %</td></tr>
      </table>
    </body></html>
  `;

  it('extracts CW rows and ignores non-CW rows', () => {
    const rows = parseDhlPage(SAMPLE_HTML, 2026);
    const weeks = rows.map((r) => r.weekNumber);
    expect(weeks).toEqual([24, 23, 22, 21, 20, 19, 18, 17]);
  });

  it('stamps the supplied year on every row', () => {
    const rows = parseDhlPage(SAMPLE_HTML, 2026);
    expect(rows.every((r) => r.year === 2026)).toBe(true);
  });

  it('parses percents correctly including week 18 (the MBLVD28558 invoice week)', () => {
    const rows = parseDhlPage(SAMPLE_HTML, 2026);
    const week18 = rows.find((r) => r.weekNumber === 18);
    expect(week18?.percent).toBe(48);
    expect(week18?.raw).toBe('48.00%');
  });

  it('tolerates extra whitespace and class attributes', () => {
    const messy = `<tr  class="x"  >
      <td  class="a"  >  CW  18  </td>
      <td>  48.00   %  </td></tr>`;
    const rows = parseDhlPage(messy, 2026);
    expect(rows).toHaveLength(1);
    expect(rows[0].weekNumber).toBe(18);
    expect(rows[0].percent).toBe(48);
  });

  it('returns empty list when no CW rows', () => {
    expect(parseDhlPage('<p>nothing here</p>', 2026)).toEqual([]);
  });

  it('skips rows with bogus week numbers', () => {
    const bogus = '<tr><td>CW 99</td><td>48 %</td></tr><tr><td>CW 0</td><td>48 %</td></tr>';
    const rows = parseDhlPage(bogus, 2026);
    expect(rows).toEqual([]);
  });
});

describe('isoWeek', () => {
  it('week 18 for Wed 29/04/2026', () => {
    // 29 April 2026 is a Wednesday → ISO week 18 of 2026
    expect(isoWeek(new Date('2026-04-29T12:00:00Z'))).toEqual({ year: 2026, week: 18 });
  });

  it('week 1 for Thu 01/01/2026', () => {
    // 1 Jan 2026 = Thursday → ISO week 1 of 2026
    expect(isoWeek(new Date('2026-01-01T12:00:00Z'))).toEqual({ year: 2026, week: 1 });
  });

  it('week 53 of previous year for early Jan when Mon was last year', () => {
    // 1 Jan 2021 = Friday → still in ISO week 53 of 2020
    expect(isoWeek(new Date('2021-01-01T12:00:00Z'))).toEqual({ year: 2020, week: 53 });
  });
});

describe('pickCurrentWeek', () => {
  const rows: DhlFuelRow[] = [
    { weekNumber: 24, year: 2026, percent: 48.75, raw: '48.75%' },
    { weekNumber: 23, year: 2026, percent: 48.75, raw: '48.75%' },
    { weekNumber: 22, year: 2026, percent: 47.75, raw: '47.75%' },
    { weekNumber: 18, year: 2026, percent: 48,    raw: '48.00%' },
  ];

  it('picks the exact matching ISO week', () => {
    // Wed 29/04/2026 → ISO week 18
    const r = pickCurrentWeek(rows, new Date('2026-04-29T12:00:00Z'));
    expect(r.weekNumber).toBe(18);
    expect(r.percent).toBe(48);
  });

  it('falls back to the newest row when the current week is unpublished', () => {
    // Today is hypothetically week 30 — but the table only goes up to week 24.
    const r = pickCurrentWeek(rows, new Date('2026-07-22T12:00:00Z'));
    expect(r.weekNumber).toBe(24);
  });

  it('throws on empty input', () => {
    expect(() => pickCurrentWeek([], new Date())).toThrow();
  });
});

describe('fetchDhlFuelPercent (mocked)', () => {
  const RESPONSE_HTML = `
    <html><body>
      <table>
        <tr><td>CW 24</td><td>48.75 %</td></tr>
        <tr><td>CW 18</td><td>48.00 %</td></tr>
      </table>
    </body></html>
  `;

  function makeFakeFetch(htmlBody: string, status = 200): typeof fetch {
    return (async () => new Response(htmlBody, {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })) as typeof fetch;
  }

  it('returns the week-18 row for a 29/04/2026 clock', async () => {
    const result = await fetchDhlFuelPercent({
      fetchImpl: makeFakeFetch(RESPONSE_HTML),
      year: 2026,
      now: new Date('2026-04-29T12:00:00Z'),
    });
    expect(result.current.weekNumber).toBe(18);
    expect(result.current.percent).toBe(48);
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('throws when the page returns non-200', async () => {
    await expect(fetchDhlFuelPercent({
      fetchImpl: makeFakeFetch('', 503),
    })).rejects.toThrow(/503/);
  });

  it('throws when the page parses to zero rows (markup change)', async () => {
    await expect(fetchDhlFuelPercent({
      fetchImpl: makeFakeFetch('<html><body><p>no table</p></body></html>'),
    })).rejects.toThrow(/no CW rows/);
  });
});
