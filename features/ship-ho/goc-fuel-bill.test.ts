import { describe, it, expect } from 'vitest';
import { gocFuelTrenBill, phanTramFuelDangTin } from './goc-fuel-bill';

const k = (o: Partial<Parameters<typeof gocFuelTrenBill>[0]>) => ({
  base: 0, discount: 0, remote: 0, demand: 0, signature: 0, residential: 0, addressCorrection: 0, ...o,
});

describe('gocFuelTrenBill', () => {
  /* Hai đơn THẬT có phí sửa địa chỉ. Bỏ AC ra khỏi mẫu số thì %fuel hiện lên một con số không
     phải mức FedEx nào từng công bố — đó là cách lỗi này lộ ra. */
  it('#KLS1998 (20/07/2026): cộng AC thì ra đúng mức FedEx 39,75% của tuần đó', () => {
    const goc = gocFuelTrenBill(k({ base: 2_674_800, discount: -1_868_080, residential: 84_400, addressCorrection: 289_200 }));
    expect(goc).toBe(1_180_320);
    expect(Math.round(469_177 / goc * 10_000) / 100).toBe(39.75);
  });

  it('bỏ AC ra là ra 52,65% — không phải mức nào của hãng', () => {
    const thieu = 1_180_320 - 289_200;
    expect(Math.round(469_177 / thieu * 10_000) / 100).toBe(52.65);
  });

  it('SV-0015 (09/07/2026): 38,25%', () => {
    const goc = gocFuelTrenBill(k({ base: 3_442_200, discount: -2_404_032, addressCorrection: 289_200 }));
    expect(Math.round(507_718 / goc * 10_000) / 100).toBe(38.25);
  });

  /* Chiết khấu lưu SỐ ÂM trên hoá đơn — cộng vào, không trừ. Trừ là mẫu số phình gấp đôi và
     %fuel tụt xuống còn một nửa. */
  it('chiết khấu âm được CỘNG vào', () => {
    expect(gocFuelTrenBill(k({ base: 1_000_000, discount: -400_000 }))).toBe(600_000);
  });

  it('VAT / duty / phí xử lý hàng nhập không nằm trong gốc — không có chỗ nhận chúng', () => {
    expect(gocFuelTrenBill(k({ base: 1_000_000 }))).toBe(1_000_000);
  });
});

describe('phanTramFuelDangTin — chốt chặn mẫu số sai', () => {
  it('mức thật của hãng đều qua', () => {
    for (const p of [38.25, 38.5, 39.75, 43, 52.5, 53.75, 30]) expect(phanTramFuelDangTin(p)).toBe(true);
  });
  /* Hai con số THẬT đã lọt ra bảng đối soát ngày 02/10/2026, cả hai do mẫu số thiếu phí sửa
     địa chỉ. Không mức nào của hãng từng là 52,65% hay 48,91%. */
  it('hai con số đã lọt ra bảng bị chặn', () => {
    expect(phanTramFuelDangTin(52.65)).toBe(false);
    expect(phanTramFuelDangTin(48.91)).toBe(false);
  });
  it('làm tròn của hãng vẫn qua, lệch to thì không', () => {
    expect(phanTramFuelDangTin(38.26)).toBe(true);
    expect(phanTramFuelDangTin(38.2)).toBe(true);
    expect(phanTramFuelDangTin(38.19)).toBe(false);
  });
  it('số vô lý bị chặn', () => {
    for (const p of [0, -5, 120, NaN, Infinity]) expect(phanTramFuelDangTin(p)).toBe(false);
  });
});

describe('Additional Handling nằm TRONG gốc tính fuel (CEO 08/10/2026)', () => {
  /* Hai vận đơn thật, kiểm bằng chính %fuel FedEx công bố tuần đó:
   *
   *  877674305295 (TA2337, đi 24/09, FedEx công bố 51,75%)
   *    base 37.596.000 · discount −28.151.885 · demand 1.718.900 · signature 92.700 · AH 679.700
   *    fuel 6.176.578
   *
   *  873356889943 (#MBLVD28701, đi 22/06, FedEx công bố 41,5%)
   *    base 5.079.100 · discount −4.001.823 · demand 99.250 · AH 679.700
   *    fuel 770.335
   *
   * Bỏ AH ra khỏi mẫu số thì vận đơn thứ hai ra 65,475% — không phải mức nào FedEx từng công
   * bố. Cùng cơ chế đã làm #KLS1998 hiện 52,65% hồi 20/07. */
  const TA2337 = { base: 37_596_000, discount: -28_151_885, remote: 0, demand: 1_718_900,
    signature: 92_700, residential: 0, addressCorrection: 0, additionalHandling: 679_700 };
  const MBLVD28701 = { base: 5_079_100, discount: -4_001_823, remote: 0, demand: 99_250,
    signature: 0, residential: 0, addressCorrection: 0, additionalHandling: 679_700 };

  it('%fuel khớp mức FedEx công bố khi CÓ tính Additional Handling', () => {
    expect((6_176_578 / gocFuelTrenBill(TA2337)) * 100).toBeCloseTo(51.75, 1);
    expect((770_335 / gocFuelTrenBill(MBLVD28701)) * 100).toBeCloseTo(41.5, 1);
  });

  /* Bỏ AH ra thì ra 65,475% — và LƯỚI 0,25% VẪN CHO QUA (gần nấc 65,5%, lệch 0,025 < sai số
     0,05). Nên lưới KHÔNG bắt được ca này; chỉ đối chiếu mức FedEx công bố mới bắt được. Ghi
     lại đúng giới hạn đó thay vì khẳng định một hàng rào mình không có. */
  it('bỏ Additional Handling ra thì %fuel sai hẳn mức công bố, dù lưới vẫn cho qua', () => {
    const thieu = gocFuelTrenBill({ ...MBLVD28701, additionalHandling: 0 });
    const pct = (770_335 / thieu) * 100;
    expect(pct).toBeCloseTo(65.475, 2);
    expect(Math.abs(pct - 41.5)).toBeGreaterThan(20);
    expect(phanTramFuelDangTin(pct)).toBe(true);
  });
});
