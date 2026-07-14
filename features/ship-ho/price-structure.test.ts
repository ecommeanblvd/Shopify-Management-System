import { describe, it, expect } from 'vitest';
import { shipHoPriceStructure } from './price-structure';
import { computeBrandCharge } from './brand-pricing';

// Breakdown giả lập (cost currency = VND, factor 1): base+phụ phí+fuel+vat = carrierCost.
const breakdown = {
  base: 1_000_000, remote: 50_000, perKg: 0, demand: 0, countryFixed: 0, perStep: 0, peak: 0,
  residential: 0, addons: 0, fuel: 300_000, fuelPercent: 30, vat: 184_236, vatPercent: 8,
  carrierCost: 1_534_236, chargeableWeightKg: 2,
};

function expectedCharged(markup: number) {
  return computeBrandCharge({
    carrierCostVnd: 1_534_236, baseVnd: 1_000_000, fuelPercent: 30, vatPercent: 8, markupPercent: markup,
    parts: { surchargesVnd: 50_000, residentialVnd: 0, directSignatureVnd: 0, fuelRealVnd: 300_000, vatRealVnd: 184_236 },
    serviceLabel: 'Express Delivery',
  }).chargedVnd;
}

describe('shipHoPriceStructure', () => {
  it('cột chi phí carrier cộng lại đúng bằng carrierCostVnd', () => {
    const charged = expectedCharged(25);
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: charged, markupPercent: 25 })!;
    const costSum = s.rows.reduce((t, r) => t + (r.costVnd ?? 0), 0);
    expect(costSum).toBe(s.costTotal);
    expect(s.costTotal).toBe(1_534_236);
  });

  it('cột giá thu khách cộng lại đúng bằng chargedVnd', () => {
    const charged = expectedCharged(25);
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: charged, markupPercent: 25 })!;
    const chargeSum = s.rows.reduce((t, r) => t + (r.chargeVnd ?? 0), 0);
    expect(chargeSum).toBe(s.chargeTotal);
    expect(s.chargeTotal).toBe(charged);
  });

  it('có đủ dòng base/phụ phí/fuel/xử lý/VAT; fuel & VAT kèm %', () => {
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25 })!;
    expect(s.rows.map((r) => r.label)).toEqual([
      'Cước cơ bản', 'Phụ phí vùng xa', 'Phụ phí xăng dầu', 'Phí xử lý đơn hàng', 'VAT',
    ]);
    expect(s.rows.find((r) => r.label === 'Phụ phí xăng dầu')?.percent).toBe(30);
    expect(s.rows.find((r) => r.label === 'VAT')?.percent).toBe(8);
    // Phí xử lý chỉ có bên giá thu, không có bên chi phí.
    expect(s.rows.find((r) => r.label === 'Phí xử lý đơn hàng')?.costVnd).toBeNull();
    // Cước cơ bản thu > chi (đã markup).
    const baseRow = s.rows.find((r) => r.label === 'Cước cơ bản')!;
    expect(baseRow.chargeVnd!).toBeGreaterThan(baseRow.costVnd!);
  });

  it('quy đổi cost-currency USD → VND theo factor', () => {
    const usd = { ...breakdown, base: 30, remote: 2, fuel: 9, vat: 4, carrierCost: 45 };
    const s = shipHoPriceStructure({ breakdown: usd, carrierCostVnd: 1_170_000, chargedVnd: 1_500_000, markupPercent: 20 })!;
    expect(s.factor).toBe(26_000); // 1.170.000 / 45
    expect(s.rows.find((r) => r.label === 'Cước cơ bản')?.costVnd).toBe(780_000); // 30 × 26.000
  });

  it('thêm dòng điều chỉnh khi carrierCost có giảm giá ngoài base+phụ phí+fuel+vat', () => {
    // carrierCost = base+sur+fuel+vat − 100k (discount) → residual = −100k.
    const withDiscount = { ...breakdown, discount: -100_000, carrierCost: 1_434_236 };
    const s = shipHoPriceStructure({ breakdown: withDiscount, carrierCostVnd: 1_434_236, chargedVnd: expectedCharged(25), markupPercent: 25 })!;
    const adj = s.rows.find((r) => r.label === 'Giảm giá / điều chỉnh');
    expect(adj?.costVnd).toBe(-100_000);
    const costSum = s.rows.reduce((t, r) => t + (r.costVnd ?? 0), 0);
    expect(costSum).toBe(1_434_236);
  });

  it('đơn backfill: chargedVnd gốc lệch breakdown → dòng điều chỉnh giữ cột thu khớp', () => {
    const charged = expectedCharged(25) + 138_411; // chargedVnd gốc cao hơn recompute
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: charged, markupPercent: 25 })!;
    const adj = s.rows.find((r) => r.label === 'Giảm giá / điều chỉnh');
    expect(adj?.chargeVnd).toBe(138_411);
    const chargeSum = s.rows.reduce((t, r) => t + (r.chargeVnd ?? 0), 0);
    expect(chargeSum).toBe(charged);
    expect(s.chargeTotal).toBe(charged);
  });

  it('tách phụ phí thành từng khoản (charge = cost pass-through), tổng phụ phí bảo toàn', () => {
    const bd = {
      ...breakdown, remote: 40_000, demand: 20_000, residential: 30_000, addons: 25_000, perKg: 10_000,
      base: 1_000_000, fuel: 300_000, vat: 184_236,
      carrierCost: 1_000_000 + 125_000 + 300_000 + 184_236, // + tổng phụ phí 125k
    };
    const s = shipHoPriceStructure({ breakdown: bd, carrierCostVnd: bd.carrierCost, chargedVnd: 3_000_000, markupPercent: 25 })!;
    const labels = s.rows.map((r) => r.label);
    expect(labels).toContain('Phụ phí vùng xa');
    expect(labels).toContain('Phụ phí nhu cầu (demand)');
    expect(labels).toContain('Giao nhà dân / ký nhận');
    expect(labels).toContain('Phí xử lý NK / khác');
    // charge = cost cho từng khoản phụ phí (pass-through).
    for (const l of ['Phụ phí vùng xa', 'Phụ phí nhu cầu (demand)', 'Giao nhà dân / ký nhận', 'Phí xử lý NK / khác']) {
      const row = s.rows.find((r) => r.label === l)!;
      expect(row.chargeVnd).toBe(row.costVnd);
    }
    // Σ các khoản phụ phí (cost) = tổng phụ phí gốc 125k.
    const surSum = s.rows.filter((r) => ['Phụ phí vùng xa', 'Phụ phí nhu cầu (demand)', 'Giao nhà dân / ký nhận', 'Phí xử lý NK / khác'].includes(r.label))
      .reduce((t, r) => t + (r.costVnd ?? 0), 0);
    expect(surSum).toBe(125_000);
    // Tổng cột chi phí vẫn khớp carrierCostVnd.
    expect(s.rows.reduce((t, r) => t + (r.costVnd ?? 0), 0)).toBe(bd.carrierCost);
  });

  it('có sell (đã đối soát): cột giá thu lấy theo bill — residential/ký nhận không bị thiếu', () => {
    const actualBill = {
      breakdown: {
        base: 1_050_000, discount: -80_000, fuel: 320_000, remote: 0, demand: 0, signature: 92_700, vat: 190_000, other: 0,
        billNumber: 'B1', shipDate: '2026-07-02',
        sell: {
          baseVnd: 1_200_000, remoteVnd: 0, demandVnd: 0, resSignVnd: 92_700, customsSurVnd: 0,
          fuelVnd: 494_950, processingExVatVnd: 50_000, vatVnd: 146_932, chargedVnd: 1_984_582,
        },
      },
      totalVnd: 1_472_700, weightKg: 2.5,
    };
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill })!;
    // Cột giá thu tổng = sell.chargedVnd (KHÔNG phải quote gốc).
    expect(s.chargeTotal).toBe(1_984_582);
    // Dòng giao nhà dân/ký nhận: charge = 92.700 (theo bill), KHÔNG còn 0.
    expect(s.rows.find((r) => r.label === 'Giao nhà dân / ký nhận')?.chargeVnd).toBe(92_700);
    // Tổng cột giá thu khớp chargedVnd.
    expect(s.rows.reduce((t, r) => t + (r.chargeVnd ?? 0), 0)).toBe(1_984_582);
    // Giá thu DỰ TÍNH (quote) tách riêng, = chargedVnd gốc; residential quote = 0.
    expect(s.quoteChargeTotal).toBe(expectedCharged(25));
    expect(s.rows.find((r) => r.label === 'Giao nhà dân / ký nhận')?.quoteChargeVnd).toBe(0);
    expect(s.rows.reduce((t, r) => t + (r.quoteChargeVnd ?? 0), 0)).toBe(expectedCharged(25));
  });

  it('chưa có bill: giá thu dự tính = giá thu thực (chưa tính lại)', () => {
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25 })!;
    expect(s.quoteChargeTotal).toBe(s.chargeTotal);
    for (const r of s.rows) expect(r.quoteChargeVnd).toBe(r.chargeVnd);
  });

  it('null khi thiếu breakdown', () => {
    expect(shipHoPriceStructure({ breakdown: null, carrierCostVnd: 1, chargedVnd: 1, markupPercent: 0 })).toBeNull();
  });

  it('chưa đối soát → cột bill null toàn bộ, billTotal null, weights.quoteKg từ breakdown', () => {
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25 })!;
    expect(s.billTotal).toBeNull();
    expect(s.rows.every((r) => r.billVnd == null)).toBe(true);
    expect(s.weights).toEqual({ quoteKg: 2, billKg: null });
  });

  it('có bill: Cước cơ bản bill = freight − discount (giá NET carrier offer), tổng khớp billTotal', () => {
    const actualBill = {
      breakdown: { base: 1_050_000, discount: -80_000, fuel: 320_000, remote: 60_000, demand: 0, signature: 0, vat: 190_000, other: 10_000, billNumber: 'HANR000265761', shipDate: '2026-07-02' },
      totalVnd: 1_550_000, // netBase 970k + sur 70k + fuel 320k + vat 190k = 1.550.000 → không cần điều chỉnh
      weightKg: 2.5,
    };
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill })!;
    expect(s.billTotal).toBe(1_550_000);
    expect(s.rows.find((r) => r.label === 'Cước cơ bản')?.billVnd).toBe(970_000); // 1.050.000 − 80.000
    // Phụ phí tách khoản: vùng xa (remote 60k) + phí NK/khác (other 10k) = 70k.
    expect(s.rows.find((r) => r.label === 'Phụ phí vùng xa')?.billVnd).toBe(60_000);
    expect(s.rows.find((r) => r.label === 'Phí xử lý NK / khác')?.billVnd).toBe(10_000);
    expect(s.rows.find((r) => r.label === 'Phụ phí xăng dầu')?.billVnd).toBe(320_000);
    expect(s.rows.find((r) => r.label === 'VAT')?.billVnd).toBe(190_000);
    expect(s.rows.find((r) => r.label === 'Giảm giá / điều chỉnh')?.billVnd ?? null).toBeNull();
    const billSum = s.rows.reduce((t, r) => t + (r.billVnd ?? 0), 0);
    expect(billSum).toBe(1_550_000);
    expect(s.weights).toEqual({ quoteKg: 2, billKg: 2.5 });
    expect(s.billNumber).toBe('HANR000265761');
  });
});
