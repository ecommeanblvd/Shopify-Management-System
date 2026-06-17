import { describe, it, expect } from 'vitest';
import { computeOrderPnl, type PnlInput } from './pnl';

const base: PnlInput = {
  subtotalVnd: 35_812_080,
  shippingRevenueVnd: 2_987_920,
  discountVnd: 0,
  refundVnd: 0,
  skuCostVnd: 18_000_000,
  skuCostComplete: true,
  shipCostVnd: 3_674_855,
  shipCostSource: 'billed',
  transactionFeeVnd: 1_126_000,
};

describe('computeOrderPnl', () => {
  it('Revenue = GMV − (discount+refund+vốn+ship+txn); % theo GMV', () => {
    const r = computeOrderPnl(base);
    expect(r.gmvVnd).toBe(38_800_000);
    expect(r.thuThuanVnd).toBe(38_800_000);
    expect(r.tongChiVnd).toBe(22_800_855);
    expect(r.revenueVnd).toBe(15_999_145);
    expect(r.revenuePct).toBeCloseTo(41.24, 1);
    expect(r.complete).toBe(true);
  });

  it('Margin SP = bán − vốn (cờ ok khi ≥0)', () => {
    const r = computeOrderPnl(base);
    expect(r.marginSp).toEqual({ revenueVnd: 35_812_080, costVnd: 18_000_000, deltaVnd: 17_812_080, pct: expect.closeTo(49.74, 1), loss: false, missing: false });
  });

  it('Margin Ship lỗ khi thu < chi → loss=true', () => {
    const r = computeOrderPnl(base);
    expect(r.marginShip.deltaVnd).toBe(-686_935);
    expect(r.marginShip.loss).toBe(true);
    expect(r.marginShip.source).toBe('billed');
  });

  it('thiếu giá vốn → marginSp.missing, tongChi & revenue null + complete=false', () => {
    const r = computeOrderPnl({ ...base, skuCostVnd: null, skuCostComplete: false });
    expect(r.marginSp.missing).toBe(true);
    expect(r.marginSp.costVnd).toBe(0);
    expect(r.marginSp.pct).toBeNull();
    expect(r.tongChiVnd).toBeNull();
    expect(r.revenueVnd).toBeNull();
    expect(r.complete).toBe(false);
  });

  it('chưa có billed → dùng engine, source=engine (tạm tính)', () => {
    const r = computeOrderPnl({ ...base, shipCostVnd: 2_158_892, shipCostSource: 'engine' });
    expect(r.marginShip.source).toBe('engine');
    expect(r.marginShip.deltaVnd).toBe(2_987_920 - 2_158_892);
  });

  it('ship cost null (unknown) → marginShip.missing, revenue null', () => {
    const r = computeOrderPnl({ ...base, shipCostVnd: null, shipCostSource: 'unknown' });
    expect(r.marginShip.missing).toBe(true);
    expect(r.revenueVnd).toBeNull();
  });

  it('transactionFee null → loại khỏi tổng chi nhưng KHÔNG chặn revenue (chỉ cảnh báo)', () => {
    const r = computeOrderPnl({ ...base, transactionFeeVnd: null });
    expect(r.tongChiVnd).toBe(18_000_000 + 3_674_855);
    expect(r.feeMissing).toBe(true);
    expect(r.revenueVnd).toBe(38_800_000 - (18_000_000 + 3_674_855));
  });

  it('free-shipping (ship thu = 0) → pct null, vẫn loss khi có chi phí ship', () => {
    const r = computeOrderPnl({ ...base, shippingRevenueVnd: 0, shipCostVnd: 500_000, shipCostSource: 'billed' });
    expect(r.marginShip.pct).toBeNull();
    expect(r.marginShip.deltaVnd).toBe(-500_000);
    expect(r.marginShip.loss).toBe(true);
  });

  it('discount + refund trừ vào thu thuần', () => {
    const r = computeOrderPnl({ ...base, discountVnd: 1_000_000, refundVnd: 2_000_000 });
    expect(r.thuThuanVnd).toBe(38_800_000 - 1_000_000 - 2_000_000);
    expect(r.revenueVnd).toBe(35_800_000 - 22_800_855);
  });
});
