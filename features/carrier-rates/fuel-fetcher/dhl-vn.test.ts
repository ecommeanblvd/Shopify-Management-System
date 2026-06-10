import { describe, it, expect } from 'vitest';
import { parseDhlVnFuelPage, planWeeklyFuelActions, type VnFuelWeek } from './dhl-vn';

const SAMPLE = `
<table><tbody>
<tr class="x"><td><div><div class="v2-p">Tháng 6 15-21, 2026</div></div></td><td><div><div class="v2-p">47.00%</div></div></td></tr>
<tr class="x"><td><div><div class="v2-p">Tháng 6 8-14, 2026</div></div></td><td><div><div class="v2-p">48.75%</div></div></td></tr>
<tr class="x"><td><div><div class="v2-p">Tháng 5 25-31, 2026</div></div></td><td><div><div class="v2-p">47.75%</div></div></td></tr>
<tr class="x"><td><div><div class="v2-p">Tháng 4 27-Tháng 5 3, 2026</div></div></td><td><div><div class="v2-p">48.00%</div></div></td></tr>
<tr class="x"><td><div><div class="v2-p">$1.03</div></div></td><td><div><div class="v2-p">23.25%</div></div></td></tr>
</tbody></table>`;

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('parseDhlVnFuelPage', () => {
  it('parses week ranges and percents, skipping the price-index ($) table', () => {
    const weeks = parseDhlVnFuelPage(SAMPLE);
    expect(weeks).toHaveLength(4);
    // sorted oldest-first -> the newest published week is last
    expect(weeks[weeks.length - 1]).toMatchObject({
      startsAt: utc(2026, 6, 15),
      endsAtExclusive: utc(2026, 6, 22),
      percent: 47,
    });
  });

  it('handles cross-month ranges (Tháng 4 27-Tháng 5 3)', () => {
    const weeks = parseDhlVnFuelPage(SAMPLE);
    const cross = weeks.find((w) => w.percent === 48)!;
    expect(cross.startsAt).toEqual(utc(2026, 4, 27));
    expect(cross.endsAtExclusive).toEqual(utc(2026, 5, 4));
  });

  it('returns weeks sorted oldest first', () => {
    const weeks = parseDhlVnFuelPage(SAMPLE);
    const times = weeks.map((w) => w.startsAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('planWeeklyFuelActions', () => {
  const wk = (m: number, d: number, m2: number, d2: number, percent: number): VnFuelWeek => ({
    startsAt: utc(2026, m, d), endsAtExclusive: utc(2026, m2, d2), percent, raw: `${percent}%`,
  });

  it('no-ops when an existing row already covers the week at the same percent', () => {
    const actions = planWeeklyFuelActions(
      [{ id: 'a', value: 48.75, startsAt: utc(2026, 6, 1), endsAt: utc(2026, 6, 15) }],
      [wk(6, 8, 6, 15, 48.75)],
    );
    expect(actions).toEqual([]);
  });

  it('inserts a brand-new week, closing an open prior row at the week start', () => {
    const actions = planWeeklyFuelActions(
      [{ id: 'a', value: 48.75, startsAt: utc(2026, 6, 1), endsAt: null }],
      [wk(6, 15, 6, 22, 47)],
    );
    expect(actions).toEqual([
      { type: 'close', id: 'a', endsAt: utc(2026, 6, 15) },
      { type: 'insert', startsAt: utc(2026, 6, 15), endsAt: null, percent: 47, raw: '47%' },
    ]);
  });

  it('keeps newest inserted week open-ended only when nothing starts after it', () => {
    const actions = planWeeklyFuelActions(
      [
        { id: 'a', value: 48.75, startsAt: utc(2026, 6, 1), endsAt: utc(2026, 6, 15) },
        { id: 'b', value: 47, startsAt: utc(2026, 6, 15), endsAt: null },
      ],
      [wk(6, 8, 6, 15, 48.75), wk(6, 15, 6, 22, 47)],
    );
    expect(actions).toEqual([]); // both weeks already represented
  });

  it('updates an existing same-start row whose percent changed', () => {
    const actions = planWeeklyFuelActions(
      [{ id: 'a', value: 46, startsAt: utc(2026, 6, 15), endsAt: null }],
      [wk(6, 15, 6, 22, 47)],
    );
    expect(actions).toEqual([{ type: 'update', id: 'a', percent: 47, raw: '47%' }]);
  });

  it('splits a covering row with a DIFFERENT percent at the week boundary', () => {
    const actions = planWeeklyFuelActions(
      [{ id: 'a', value: 48.75, startsAt: utc(2026, 6, 1), endsAt: null }],
      [wk(6, 8, 6, 15, 50)],
    );
    expect(actions).toEqual([
      { type: 'close', id: 'a', endsAt: utc(2026, 6, 8) },
      { type: 'insert', startsAt: utc(2026, 6, 8), endsAt: null, percent: 50, raw: '50%' },
    ]);
  });

  it('inserts with explicit end when a later row already starts at the week end', () => {
    const actions = planWeeklyFuelActions(
      [{ id: 'b', value: 47, startsAt: utc(2026, 6, 15), endsAt: null }],
      [wk(6, 8, 6, 15, 48.75)],
    );
    expect(actions).toEqual([
      { type: 'insert', startsAt: utc(2026, 6, 8), endsAt: utc(2026, 6, 15), percent: 48.75, raw: '48.75%' },
    ]);
  });
});
