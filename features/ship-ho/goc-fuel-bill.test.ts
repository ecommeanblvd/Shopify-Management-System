import { describe, it, expect } from 'vitest';
import { gocFuelTrenBill } from './goc-fuel-bill';

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
