import { describe, it, expect } from 'vitest';
import { parseUpsFuelJson } from './ups';
import { planWeeklyFuelActions } from './dhl-vn';

/** Trimmed real payload from assets.ups.com .../as/vn.json (2026-07-06). */
const REAL_PAYLOAD = {
  FuelSurchargeResponse: {
    FuelSurchargeRates_en: {
      USGCJetFuel: [
        { Field1: 'USD 2.58', Field2: 'USD 2.61', Field3: '37.25%' },
        { Field1: 'USD 2.79', Field2: 'USD 2.82', Field3: '39.00%' },
      ],
    },
    SurchargeHistory_en: {
      RevenueSurchargeHistory: [
        { Field1: '2026/07/06', Field2: '39.00%' },
        { Field1: '2026/06/29', Field2: '39.25%' },
        { Field1: '2026/06/22', Field2: '42.25%' },
      ],
    },
  },
};

describe('parseUpsFuelJson', () => {
  it('parses history rows into ascending VnFuelWeek windows', () => {
    const weeks = parseUpsFuelJson(REAL_PAYLOAD);
    expect(weeks).toHaveLength(3);
    expect(weeks[0]).toMatchObject({ percent: 42.25 });
    expect(weeks[0].startsAt.toISOString()).toBe('2026-06-22T00:00:00.000Z');
    // endsAtExclusive của mỗi tuần = startsAt tuần kế tiếp.
    expect(weeks[0].endsAtExclusive.toISOString()).toBe('2026-06-29T00:00:00.000Z');
    expect(weeks[1].endsAtExclusive.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    // Tuần mới nhất: mặc định +7 ngày (planWeeklyFuelActions sẽ mở endsAt=null nếu không có row sau).
    expect(weeks[2].percent).toBe(39);
    expect(weeks[2].startsAt.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    expect(weeks[2].endsAtExclusive.toISOString()).toBe('2026-07-13T00:00:00.000Z');
    expect(weeks[2].raw).toBe('2026/07/06 = 39.00%');
  });

  it('handles a gap between effective dates (endsAtExclusive follows next start, not +7d)', () => {
    const weeks = parseUpsFuelJson({
      FuelSurchargeResponse: {
        SurchargeHistory_en: {
          RevenueSurchargeHistory: [
            { Field1: '2026/07/13', Field2: '40.00%' },
            { Field1: '2026/06/29', Field2: '39.25%' }, // 2 tuần trước đó — gap
          ],
        },
      },
    });
    expect(weeks[0].endsAtExclusive.toISOString()).toBe('2026-07-13T00:00:00.000Z');
  });

  it('throws on missing history section', () => {
    expect(() => parseUpsFuelJson({ FuelSurchargeResponse: {} })).toThrow(/SurchargeHistory/);
  });

  it('throws on malformed date or percent', () => {
    const bad = (Field1: string, Field2: string) => ({
      FuelSurchargeResponse: {
        SurchargeHistory_en: { RevenueSurchargeHistory: [{ Field1, Field2 }] },
      },
    });
    expect(() => parseUpsFuelJson(bad('07/06/2026', '39.00%'))).toThrow(/date/i);
    expect(() => parseUpsFuelJson(bad('2026/07/06', 'n/a'))).toThrow(/percent/i);
  });

  it('composes with planWeeklyFuelActions: no-op when DB already mirrors the feed', () => {
    const weeks = parseUpsFuelJson(REAL_PAYLOAD);
    const existing = weeks.map((w, i) => ({
      id: `row-${i}`,
      value: w.percent,
      startsAt: w.startsAt,
      endsAt: i < weeks.length - 1 ? w.endsAtExclusive : null, // tuần mới nhất mở
    }));
    expect(planWeeklyFuelActions(existing, weeks)).toEqual([]);
  });

  it('composes with planWeeklyFuelActions: new week closes the open row and inserts', () => {
    const weeks = parseUpsFuelJson(REAL_PAYLOAD);
    const existing = [
      { id: 'open', value: 39.25, startsAt: new Date('2026-06-29T00:00:00.000Z'), endsAt: null },
    ];
    const actions = planWeeklyFuelActions(existing, weeks);
    expect(actions).toContainEqual({ type: 'close', id: 'open', endsAt: new Date('2026-07-06T00:00:00.000Z') });
    expect(actions).toContainEqual(expect.objectContaining({ type: 'insert', percent: 39 }));
  });
});
