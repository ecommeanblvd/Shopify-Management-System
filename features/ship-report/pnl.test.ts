import { describe, it, expect } from 'vitest';
import { pnlByMonth, pnlBreakdown, type ShipPnlItem } from './pnl';
import { surchargeSummary, surchargeTopRoutes, type SurchargeItem } from './surcharges';

const item = (o: Partial<ShipPnlItem>): ShipPnlItem => ({
  month: '2026-07', segment: 'shopify', carrierKey: 'fedex', country: 'US',
  revenueVnd: 1_000_000, costVnd: 700_000, billed: true, ...o,
});

describe('pnlByMonth', () => {
  it('gộp theo tháng: total + từng segment, margin = thu − chi', () => {
    const rows = pnlByMonth([
      item({}),
      item({ segment: 'ship_ho', revenueVnd: 2_000_000, costVnd: 1_500_000 }),
      item({ month: '2026-06', revenueVnd: 500_000, costVnd: 600_000 }),
    ]);
    // Tháng mới trước; mỗi tháng: total → shopify → ship_ho
    expect(rows.map((r) => `${r.month}:${r.segment}`)).toEqual([
      '2026-07:total', '2026-07:shopify', '2026-07:ship_ho',
      '2026-06:total', '2026-06:shopify',
    ]);
    const jul = rows[0];
    expect(jul.orders).toBe(2);
    expect(jul.revenueVnd).toBe(3_000_000);
    expect(jul.costVnd).toBe(2_200_000);
    expect(jul.marginVnd).toBe(800_000);
    expect(jul.marginPct).toBe(26.7);
    // Tháng 6 lỗ → margin âm
    expect(rows[3].marginVnd).toBe(-100_000);
  });

  it('billedPct = % đơn có bill; revenue null tính 0 nhưng vẫn đếm đơn', () => {
    const rows = pnlByMonth([item({}), item({ billed: false, costVnd: null, revenueVnd: null })]);
    expect(rows[0].orders).toBe(2);
    expect(rows[0].billedPct).toBe(50);
    expect(rows[0].revenueVnd).toBe(1_000_000);
  });
});

describe('pnlBreakdown', () => {
  it('carrier × quốc gia trong tháng chọn, sort theo số đơn', () => {
    const rows = pnlBreakdown([
      item({}), item({}), item({ country: 'FR', carrierKey: 'dhl' }),
      item({ month: '2026-06', country: 'SA' }),
    ], '2026-07');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ carrierKey: 'fedex', country: 'US', orders: 2, marginVnd: 600_000 });
    expect(rows[1]).toMatchObject({ carrierKey: 'dhl', country: 'FR', orders: 1 });
  });
});

const sur = (o: Partial<SurchargeItem>): SurchargeItem => ({
  month: '2026-07', carrierKey: 'fedex', country: 'US', type: 'residential', amountVnd: 84_400, ...o,
});

describe('surchargeSummary', () => {
  it('tổng/số đơn/TB/% đơn theo loại, sort tổng giảm dần', () => {
    const rows = surchargeSummary([
      sur({}), sur({ amountVnd: 84_400 }),
      sur({ type: 'importHandling', amountVnd: 500_000 }),
      sur({ type: 'demand', amountVnd: 0 }), // 0 → bỏ
    ], 10);
    expect(rows.map((r) => r.type)).toEqual(['importHandling', 'residential']);
    expect(rows[1]).toMatchObject({ totalVnd: 168_800, shipments: 2, avgVnd: 84_400, pctOfShipments: 20 });
  });
});

describe('surchargeTopRoutes', () => {
  it('top tuyến theo 1 loại phụ phí', () => {
    const rows = surchargeTopRoutes([
      sur({}), sur({}), sur({ country: 'CA', amountVnd: 90_000 }),
      sur({ type: 'remote', country: 'NO', amountVnd: 700_000 }),
    ], 'residential');
    expect(rows[0]).toMatchObject({ country: 'US', shipments: 2, totalVnd: 168_800 });
    expect(rows).toHaveLength(2);
  });
});
