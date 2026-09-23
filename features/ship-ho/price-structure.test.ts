import { describe, it, expect } from 'vitest';
import { shipHoPriceStructure, shipHoFreightSubtotal, shipHoFinalTotal, shipHoFreightAndDutyRows, shipHoRowMarginVnd } from './price-structure';
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
    const adj = s.rows.find((r) => r.label === 'Điều chỉnh khớp số đã ghi');
    expect(adj?.costVnd).toBe(-100_000);
    const costSum = s.rows.reduce((t, r) => t + (r.costVnd ?? 0), 0);
    expect(costSum).toBe(1_434_236);
  });

  it('đơn backfill: chargedVnd gốc lệch breakdown → dòng điều chỉnh giữ cột thu khớp', () => {
    const charged = expectedCharged(25) + 138_411; // chargedVnd gốc cao hơn recompute
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: charged, markupPercent: 25 })!;
    const adj = s.rows.find((r) => r.label === 'Điều chỉnh khớp số đã ghi');
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
    // Tách 2 khoản: Giao nhà dân (residential 30k) + Ký nhận (addons 25k).
    expect(labels).toContain('Giao nhà dân');
    expect(labels).toContain('Ký nhận (direct signature)');
    expect(s.rows.find((r) => r.label === 'Giao nhà dân')?.costVnd).toBe(30_000);
    expect(s.rows.find((r) => r.label === 'Ký nhận (direct signature)')?.costVnd).toBe(25_000);
    expect(labels).toContain('Phụ phí khác (chưa phân loại)'); // perKg 10k trong fixture
    const surLabels = ['Phụ phí vùng xa', 'Phụ phí nhu cầu (demand)', 'Giao nhà dân', 'Ký nhận (direct signature)', 'Phụ phí khác (chưa phân loại)'];
    // charge = cost cho từng khoản phụ phí (pass-through).
    for (const l of surLabels) {
      const row = s.rows.find((r) => r.label === l)!;
      expect(row.chargeVnd).toBe(row.costVnd);
    }
    // Σ các khoản phụ phí (cost) = tổng phụ phí gốc 125k.
    const surSum = s.rows.filter((r) => surLabels.includes(r.label))
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
    // Đơn CŨ (sell chưa tách residentialVnd/signatureVnd) → residential gộp trong
    // signature bill → hiện toàn bộ 92.700 ở "Ký nhận", "Giao nhà dân" = 0.
    expect(s.rows.find((r) => r.label === 'Ký nhận (direct signature)')?.chargeVnd).toBe(92_700);
    expect(s.rows.find((r) => r.label === 'Giao nhà dân')?.chargeVnd ?? 0).toBe(0);
    // Tổng cột giá thu khớp chargedVnd.
    expect(s.rows.reduce((t, r) => t + (r.chargeVnd ?? 0), 0)).toBe(1_984_582);
    // Giá thu DỰ TÍNH (quote) tách riêng, = chargedVnd gốc; ký nhận quote = 0 (breakdown addons 0).
    expect(s.quoteChargeTotal).toBe(expectedCharged(25));
    expect(s.rows.find((r) => r.label === 'Ký nhận (direct signature)')?.quoteChargeVnd ?? 0).toBe(0);
    expect(s.rows.reduce((t, r) => t + (r.quoteChargeVnd ?? 0), 0)).toBe(expectedCharged(25));
  });

  it('có sell TÁCH residential + ký nhận: 2 dòng đúng số, tổng bảo toàn', () => {
    const actualBill = {
      breakdown: {
        base: 1_050_000, discount: -80_000, fuel: 320_000, remote: 0, demand: 0,
        signature: 52_700, residential: 40_000, vat: 190_000, other: 0,
        billNumber: 'B2', shipDate: '2026-07-02',
        sell: {
          baseVnd: 1_200_000, remoteVnd: 0, demandVnd: 0,
          resSignVnd: 92_700, residentialVnd: 40_000, signatureVnd: 52_700, customsSurVnd: 0,
          fuelVnd: 494_950, processingExVatVnd: 50_000, vatVnd: 146_932, chargedVnd: 1_984_582,
        },
      },
      totalVnd: 1_472_700, weightKg: 2.5,
    };
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill })!;
    // Bill tách đúng.
    expect(s.rows.find((r) => r.label === 'Giao nhà dân')?.billVnd).toBe(40_000);
    expect(s.rows.find((r) => r.label === 'Ký nhận (direct signature)')?.billVnd).toBe(52_700);
    // Giá thu thực tách đúng.
    expect(s.rows.find((r) => r.label === 'Giao nhà dân')?.chargeVnd).toBe(40_000);
    expect(s.rows.find((r) => r.label === 'Ký nhận (direct signature)')?.chargeVnd).toBe(52_700);
    // Tổng cột giá thu vẫn khớp.
    expect(s.rows.reduce((t, r) => t + (r.chargeVnd ?? 0), 0)).toBe(1_984_582);
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
    expect(s.rows.find((r) => r.label === 'Phí xử lý hàng nhập khẩu')?.billVnd).toBe(10_000); // bill cũ chưa tách cột → other hiện ở dòng NK
    expect(s.rows.find((r) => r.label === 'Phụ phí xăng dầu')?.billVnd).toBe(320_000);
    expect(s.rows.find((r) => r.label === 'VAT')?.billVnd).toBe(190_000);
    expect(s.rows.find((r) => r.label === 'Điều chỉnh khớp số đã ghi')?.billVnd ?? null).toBeNull();
    const billSum = s.rows.reduce((t, r) => t + (r.billVnd ?? 0), 0);
    expect(billSum).toBe(1_550_000);
    expect(s.weights).toEqual({ quoteKg: 2, billKg: 2.5 });
    expect(s.billNumber).toBe('HANR000265761');
  });
  it('duty: NGOÀI cước — không vào tổng cước, không đẻ dòng điều chỉnh ảo', () => {
    const actualBill = {
      breakdown: {
        base: 1_050_000, discount: -80_000, fuel: 320_000, remote: 0, demand: 0, signature: 0,
        vat: 190_000, other: 0, importHandling: 0, duty: 736_241,
        billNumber: '734110283 + 736059786', shipDate: '2026-07-02',
        sell: {
          baseVnd: 1_200_000, remoteVnd: 0, demandVnd: 0, resSignVnd: 0, residentialVnd: 0, signatureVnd: 0,
          importHandlingVnd: 0, dutyVnd: 736_241, otherVnd: 0,
          fuelVnd: 494_950, processingExVatVnd: 50_000, vatVnd: 146_932, chargedVnd: 1_891_882,
        },
      },
      totalVnd: 2_208_941, weightKg: 2.5,
    };
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill })!;
    // sell.chargedVnd CHỈ còn cước → tổng cước không gồm duty.
    expect(s.chargeTotal).toBe(1_891_882);
    expect(s.dutyChargeVnd).toBe(736_241);
    expect(s.chargeWithDutyTotal).toBe(1_891_882 + 736_241);
    // Duty vẫn hiện thành dòng riêng, đánh dấu ngoài cước.
    const dongDuty = s.rows.find((r) => r.label.startsWith('Thuế / hải quan (duty)'))!;
    expect(dongDuty.label).toContain('ngoài cước');
    expect(dongDuty.chargeVnd).toBe(736_241);
    expect(dongDuty.billVnd).toBe(736_241);
    // KHÔNG còn dòng điều chỉnh ảo −duty ở cột giá thu thực.
    expect(s.rows.find((r) => r.label === 'Điều chỉnh khớp số đã ghi')?.chargeVnd ?? null).toBeNull();
    // Cột giá thu thực (trừ dòng duty) cộng lại = tổng CƯỚC.
    const tongPhu = ['Thuế / hải quan (duty) — ngoài cước, thu hộ'];
    expect(s.rows.filter((r) => !tongPhu.includes(r.label)).reduce((t, r) => t + (r.chargeVnd ?? 0), 0)).toBe(1_891_882);
    // Tổng cước + duty (không còn dòng tổng hợp riêng trong `rows` — dùng shipHoFinalTotal, xem describe riêng).
    expect(s.chargeWithDutyTotal).toBe(2_628_123);
  });

  it('không có duty → dutyChargeVnd = 0, chargeWithDutyTotal = chargeTotal', () => {
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25 })!;
    expect(s.dutyChargeVnd).toBe(0);
    expect(s.chargeWithDutyTotal).toBe(s.chargeTotal);
  });

  // Change 2 (CEO 23/09): dòng tổng hợp cũ "Tổng brand phải trả = cước + thuế/phí NK
  // thu hộ" bị GỠ HẲN khỏi `rows` — cả 3 nơi hiển thị (trang chi tiết, modal đối
  // soát dùng chung StructureDetail, trang danh sách qua cùng modal đó) giờ đều tự
  // dựng "Tổng cuối" bằng `shipHoFinalTotal`, nên dòng này chỉ còn là dữ liệu chết
  // trong `rows` — đã rà mọi consumer (grep toàn repo) trước khi gỡ.
  it('rows KHÔNG còn chứa dòng tổng hợp "Tổng brand phải trả" dù có duty — dùng shipHoFinalTotal thay thế', () => {
    const actualBill = {
      breakdown: {
        base: 1_050_000, discount: -80_000, fuel: 320_000, remote: 0, demand: 0, signature: 0,
        vat: 190_000, other: 0, importHandling: 0, duty: 736_241,
        billNumber: '734110283', shipDate: '2026-07-02',
        sell: {
          baseVnd: 1_200_000, remoteVnd: 0, demandVnd: 0, resSignVnd: 0, residentialVnd: 0, signatureVnd: 0,
          importHandlingVnd: 0, dutyVnd: 736_241, otherVnd: 0,
          fuelVnd: 494_950, processingExVatVnd: 50_000, vatVnd: 146_932, chargedVnd: 1_891_882,
        },
      },
      totalVnd: 2_208_941, weightKg: 2.5,
    };
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill })!;
    expect(s.rows.some((r) => r.label.startsWith('Tổng brand phải trả'))).toBe(false);
    // Dòng duty vẫn có mặt trong rows (chỉ dòng TỔNG HỢP cũ mới bị gỡ).
    expect(s.rows.some((r) => r.label.startsWith('Thuế / hải quan (duty)'))).toBe(true);
    expect(shipHoFinalTotal(s).chargeVnd).toBe(2_628_123);
  });
});

// ── Change 1 (CEO 23/09): % xăng dầu HIỆU LỰC trên bill, tách khỏi % quote —
// fuel rate carrier bill và fuel rate quote lock khác nhau (rate đổi hàng tuần).
// Công thức base ĐÃ kiểm read-only trên TOÀN BỘ 127 đơn reconciled ở production
// (23/09/2026, script throwaway scripts/tmp-verify-fuel-rate.ts, đã xoá):
//   billFuelBase = cước cơ bản bill NET (ab.base + ab.discount)
//                + remote + demand + residential + signature (bill, cùng đợt)
// tái tạo đúng ab.fuel (làm tròn rate 3 chữ số %, sai số ≤ 2đ do làm tròn tiền tệ
// nhiều bước) ở 127/127 đơn — các base khác thử qua (chỉ net cước: 63/127; +residential
// nhưng thiếu remote/demand: 97/127; ab.base thô chưa trừ discount: 14/127) đều KHÔNG
// đáng tin. base ≤ 0 (dữ liệu thiếu) → để null, KHÔNG bịa %.
describe('fuel: billPercent (% hiệu lực trên bill, tách khỏi % quote)', () => {
  it('đơn thực 26-INSLG-SV-0094 (23/09): base = cước cơ bản net + ký nhận → 46.5%', () => {
    const actualBill = {
      breakdown: {
        base: 1_038_168, discount: 0, fuel: 525_854, remote: 0, demand: 0, residential: 0,
        signature: 92_700, vat: 0, other: 0, billNumber: 'X-0094', shipDate: '2026-08-26',
      },
      totalVnd: 1_038_168 + 92_700 + 525_854, weightKg: 2.5,
    };
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill })!;
    const fuelRow = s.rows.find((r) => r.label === 'Phụ phí xăng dầu')!;
    expect(fuelRow.billPercent).toBe(46.5);
    // % quote (breakdown.fuelPercent = 30 trong fixture) KHÔNG đổi theo Change 1 — vẫn
    // là % lock lúc quote, độc lập với % hiệu lực trên bill.
    expect(fuelRow.percent).toBe(30);
  });

  it('phụ phí vùng xa/nhu cầu/giao nhà dân trên bill cũng nằm trong base tính %', () => {
    // base = (1.050.000−80.000) + remote 60.000 + demand 20.000 + residential 30.000 + signature 40.000 = 1.120.000
    // chọn fuel = 1.120.000 × 45% = 504.000 → rate suy ra phải đúng 45%.
    const actualBill = {
      breakdown: {
        base: 1_050_000, discount: -80_000, fuel: 504_000, remote: 60_000, demand: 20_000,
        residential: 30_000, signature: 40_000, vat: 0, other: 0, billNumber: 'X2', shipDate: '2026-08-26',
      },
      totalVnd: 2_000_000, weightKg: 2.5,
    };
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill })!;
    const fuelRow = s.rows.find((r) => r.label === 'Phụ phí xăng dầu')!;
    expect(fuelRow.billPercent).toBe(45);
  });

  it('chưa có bill → billPercent null (không bịa %)', () => {
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25 })!;
    const fuelRow = s.rows.find((r) => r.label === 'Phụ phí xăng dầu')!;
    expect(fuelRow.billPercent ?? null).toBeNull();
  });

  it('có bill nhưng base suy ra ≤ 0 (dữ liệu hỏng) → billPercent null, không NaN/Infinity', () => {
    const actualBill = {
      breakdown: {
        base: 0, discount: 0, fuel: 100_000, remote: 0, demand: 0, residential: 0, signature: 0,
        vat: 0, other: 0, billNumber: 'X3', shipDate: '2026-08-26',
      },
      totalVnd: 100_000, weightKg: 2.5,
    };
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill })!;
    const fuelRow = s.rows.find((r) => r.label === 'Phụ phí xăng dầu')!;
    expect(fuelRow.billPercent ?? null).toBeNull();
  });

  it('dòng khác (VAT) KHÔNG có billPercent — chỉ dòng fuel mới có', () => {
    const actualBill = {
      breakdown: {
        base: 1_038_168, discount: 0, fuel: 525_854, remote: 0, demand: 0, residential: 0,
        signature: 92_700, vat: 190_000, other: 0, billNumber: 'X-0094', shipDate: '2026-08-26',
      },
      totalVnd: 1_038_168 + 92_700 + 525_854 + 190_000, weightKg: 2.5,
    };
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill })!;
    const vatRow = s.rows.find((r) => r.label === 'VAT')!;
    expect(vatRow.billPercent ?? null).toBeNull();
  });
});

// ── Bảng cấu trúc giá tái cấu trúc (CEO 23/09): Tổng cước (subtotal, KHÔNG gồm
// duty) → dòng duty riêng → Tổng cuối (cước + duty). Vì duty thu đúng giá vốn
// (không markup), margin "Tổng cước" PHẢI bằng margin "Tổng cuối".
describe('shipHoFreightSubtotal / shipHoFinalTotal', () => {
  const actualBillWithDuty = {
    breakdown: {
      base: 1_050_000, discount: -80_000, fuel: 320_000, remote: 0, demand: 0, signature: 0,
      vat: 190_000, other: 0, importHandling: 0, duty: 736_241,
      billNumber: '734110283 + 736059786', shipDate: '2026-07-02',
      sell: {
        baseVnd: 1_200_000, remoteVnd: 0, demandVnd: 0, resSignVnd: 0, residentialVnd: 0, signatureVnd: 0,
        importHandlingVnd: 0, dutyVnd: 736_241, otherVnd: 0,
        fuelVnd: 494_950, processingExVatVnd: 50_000, vatVnd: 146_932, chargedVnd: 1_891_882,
      },
    },
    totalVnd: 2_208_941, weightKg: 2.5,
  };

  it('đơn CÓ duty: Tổng cước không gồm duty (bill trừ phần duty), Tổng cuối = Tổng cước + duty, margin hai dòng BẰNG NHAU', () => {
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill: actualBillWithDuty })!;
    const freight = shipHoFreightSubtotal(s);
    const final = shipHoFinalTotal(s);

    // Tổng cước: cột chi/thu KHÔNG đổi so với costTotal/quoteChargeTotal/chargeTotal
    // đã có (đúng nghĩa "CHỈ CƯỚC"); cột bill = billTotal (cả hoá đơn, GỘP duty)
    // trừ đúng phần duty trên hoá đơn → còn lại thuần cước.
    expect(freight.costVnd).toBe(s.costTotal);
    expect(freight.quoteChargeVnd).toBe(s.quoteChargeTotal);
    expect(freight.chargeVnd).toBe(s.chargeTotal);
    expect(freight.billVnd).toBe(1_472_700); // 2.208.941 − 736.241

    // Tổng cuối: cước + duty ở CẢ hai bên chi lẫn thu.
    expect(final.billVnd).toBe(s.billTotal);
    expect(final.chargeVnd).toBe(s.chargeWithDutyTotal);
    expect(final.chargeVnd).toBe(1_891_882 + 736_241);

    // Điểm mấu chốt của layout: margin không đổi khi gộp duty vào.
    expect(freight.marginVnd).toBe(final.marginVnd);
    expect(freight.marginVnd).toBe(419_182); // 1.891.882 − 1.472.700
    expect(final.marginVnd).toBe(419_182); // 2.628.123 − 2.208.941

    // Yêu cầu CEO: margin "Tổng cuối" PHẢI bằng tổng margin từng dòng (freight rows
    // + dòng duty riêng) SAU KHI sửa bug 2 (revenue-only row không còn margin null).
    const { freightRows, dutyRow } = shipHoFreightAndDutyRows(s);
    const tongMarginTungDong = [...freightRows, ...(dutyRow ? [dutyRow] : [])]
      .reduce((t, r) => t + (shipHoRowMarginVnd(r, true) ?? 0), 0);
    expect(tongMarginTungDong).toBe(final.marginVnd);
  });

  it('đơn KHÔNG có duty (có bill): Tổng cước = Tổng cuối y hệt, không lệch một đồng', () => {
    const actualBillNoDuty = {
      breakdown: { base: 1_050_000, discount: -80_000, fuel: 320_000, remote: 60_000, demand: 0, signature: 0, vat: 190_000, other: 10_000, billNumber: 'HANR000265761', shipDate: '2026-07-02' },
      totalVnd: 1_550_000, weightKg: 2.5,
    };
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill: actualBillNoDuty })!;
    expect(s.dutyChargeVnd).toBe(0);
    const freight = shipHoFreightSubtotal(s);
    const final = shipHoFinalTotal(s);
    expect({ ...freight, label: '' }).toEqual({ ...final, label: '' });
    expect(freight.billVnd).toBe(s.billTotal);
    expect(freight.marginVnd).toBe(s.chargeTotal - s.billTotal!);
  });

  it('đơn CHƯA có bill (chỉ dự tính): Tổng cước = Tổng cuối, billVnd null, margin = thu dự tính − chi dự tính', () => {
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25 })!;
    const freight = shipHoFreightSubtotal(s);
    const final = shipHoFinalTotal(s);
    expect({ ...freight, label: '' }).toEqual({ ...final, label: '' });
    expect(freight.billVnd).toBeNull();
    expect(freight.marginVnd).toBe(s.chargeTotal - s.costTotal);
  });
});

describe('shipHoFreightAndDutyRows', () => {
  it('tách dòng duty + dòng "Tổng brand phải trả" ra khỏi khối cước', () => {
    const actualBill = {
      breakdown: {
        base: 1_050_000, discount: -80_000, fuel: 320_000, remote: 0, demand: 0, signature: 0,
        vat: 190_000, other: 0, importHandling: 0, duty: 736_241,
        billNumber: '734110283', shipDate: '2026-07-02',
        sell: {
          baseVnd: 1_200_000, remoteVnd: 0, demandVnd: 0, resSignVnd: 0, residentialVnd: 0, signatureVnd: 0,
          importHandlingVnd: 0, dutyVnd: 736_241, otherVnd: 0,
          fuelVnd: 494_950, processingExVatVnd: 50_000, vatVnd: 146_932, chargedVnd: 1_891_882,
        },
      },
      totalVnd: 2_208_941, weightKg: 2.5,
    };
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill })!;
    const { freightRows, dutyRow } = shipHoFreightAndDutyRows(s);
    expect(dutyRow?.label).toContain('Thuế / hải quan (duty)');
    expect(dutyRow?.chargeVnd).toBe(736_241);
    expect(freightRows.some((r) => r.label.startsWith('Thuế / hải quan'))).toBe(false);
    expect(freightRows.some((r) => r.label.startsWith('Tổng brand phải trả'))).toBe(false);
    // Freight rows vẫn cộng đúng costTotal/chargeTotal như trước (không mất dòng nào khác).
    expect(freightRows.reduce((t, r) => t + (r.costVnd ?? 0), 0)).toBe(s.costTotal);
    expect(freightRows.reduce((t, r) => t + (r.chargeVnd ?? 0), 0)).toBe(s.chargeTotal);
  });

  it('không có duty → dutyRow null, freightRows = toàn bộ rows', () => {
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25 })!;
    const { freightRows, dutyRow } = shipHoFreightAndDutyRows(s);
    expect(dutyRow).toBeNull();
    expect(freightRows).toEqual(s.rows);
  });
});

describe('shipHoRowMarginVnd (bug: dòng chỉ có bên thu — vd Phí xử lý đơn hàng — margin không được là null)', () => {
  it('dòng revenue-only (costVnd = billVnd = null) có bill khác: margin = toàn bộ giá thu, không phải "—"', () => {
    const actualBill = {
      breakdown: { base: 1_050_000, discount: -80_000, fuel: 320_000, remote: 60_000, demand: 0, signature: 0, vat: 190_000, other: 10_000, billNumber: 'HANR000265761', shipDate: '2026-07-02' },
      totalVnd: 1_550_000, weightKg: 2.5,
    };
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill })!;
    const row = s.rows.find((r) => r.label === 'Phí xử lý đơn hàng')!;
    expect(row.costVnd).toBeNull();
    expect(row.billVnd).toBeNull();
    expect(row.chargeVnd).toBeGreaterThan(0);
    expect(shipHoRowMarginVnd(row, true)).toBe(row.chargeVnd);
  });

  it('dòng bình thường có bill: margin = charge − bill (không đổi so với trước)', () => {
    const actualBill = {
      breakdown: { base: 1_050_000, discount: -80_000, fuel: 320_000, remote: 60_000, demand: 0, signature: 0, vat: 190_000, other: 10_000, billNumber: 'HANR000265761', shipDate: '2026-07-02' },
      totalVnd: 1_550_000, weightKg: 2.5,
    };
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25, actualBill })!;
    const row = s.rows.find((r) => r.label === 'Cước cơ bản')!;
    expect(shipHoRowMarginVnd(row, true)).toBe(row.chargeVnd! - row.billVnd!);
  });

  it('chưa có bill: margin = charge − cost (dự tính)', () => {
    const s = shipHoPriceStructure({ breakdown, carrierCostVnd: 1_534_236, chargedVnd: expectedCharged(25), markupPercent: 25 })!;
    const row = s.rows.find((r) => r.label === 'Cước cơ bản')!;
    expect(shipHoRowMarginVnd(row, false)).toBe(row.quoteChargeVnd! - row.costVnd!);
  });
});
