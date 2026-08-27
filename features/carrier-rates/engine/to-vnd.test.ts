import { describe, expect, it } from 'vitest';
import { cuocEngineSangVnd, heSoQuyDoiVnd } from './to-vnd';

describe('cuocEngineSangVnd', () => {
  it('tài khoản tính bằng tiền Việt thì giữ nguyên', () => {
    expect(cuocEngineSangVnd({ carrierCost: 605656, costCurrency: 'VND' })).toBe(605656);
  });

  // Bảng kê kỳ 25/07–22/08 ghi 26.310; tỉ giá tài khoản lúc này là 26.465.
  it('ưu tiên tỉ giá ghi trên hoá đơn đang đối soát', () => {
    expect(cuocEngineSangVnd({
      carrierCost: 23.02, costCurrency: 'USD', fxRateBill: 26310, fxCostPerDisplay: 1 / 26465,
    })).toBe(Math.round(23.02 * 26310));
  });

  it('hoá đơn không ghi tỉ giá thì lùi về tỉ giá tài khoản', () => {
    expect(cuocEngineSangVnd({
      carrierCost: 23.02, costCurrency: 'USD', fxRateBill: null, fxCostPerDisplay: 1 / 26465,
    })).toBe(Math.round(23.02 * 26465));
  });

  it('tỉ giá hoá đơn bằng 0 hoặc âm thì coi như không có', () => {
    expect(cuocEngineSangVnd({ carrierCost: 10, costCurrency: 'USD', fxRateBill: 0, fxCostPerDisplay: 1 / 26465 }))
      .toBe(Math.round(10 * 26465));
    expect(cuocEngineSangVnd({ carrierCost: 10, costCurrency: 'USD', fxRateBill: -5, fxCostPerDisplay: 1 / 26465 }))
      .toBe(Math.round(10 * 26465));
  });

  // Đoán bừa một tỉ giá sẽ tạo ra con số trông như thật trên màn đối soát.
  it('không biết tỉ giá nào thì trả null, không đoán', () => {
    expect(cuocEngineSangVnd({ carrierCost: 23.02, costCurrency: 'USD' })).toBeNull();
    expect(cuocEngineSangVnd({ carrierCost: 23.02, costCurrency: 'USD', fxCostPerDisplay: 0 })).toBeNull();
  });

  it('cước không hợp lệ thì trả null', () => {
    expect(cuocEngineSangVnd({ carrierCost: NaN, costCurrency: 'VND' })).toBeNull();
  });

  it('hai tỉ giá cho kết quả khác nhau — đó chính là lý do phải chọn đúng', () => {
    const theoHoaDon = cuocEngineSangVnd({ carrierCost: 1000, costCurrency: 'USD', fxRateBill: 26310, fxCostPerDisplay: 1 / 26465 })!;
    const theoTaiKhoan = cuocEngineSangVnd({ carrierCost: 1000, costCurrency: 'USD', fxCostPerDisplay: 1 / 26465 })!;
    expect(theoTaiKhoan - theoHoaDon).toBe(155000);
  });
});

describe('heSoQuyDoiVnd', () => {
  it('tài khoản tính bằng tiền Việt thì hệ số là 1', () => {
    expect(heSoQuyDoiVnd({ costCurrency: 'VND' })).toBe(1);
  });

  it('ưu tiên tỉ giá của hoá đơn', () => {
    expect(heSoQuyDoiVnd({ costCurrency: 'USD', fxRateBill: 26310, fxCostPerDisplay: 1 / 26465 })).toBe(26310);
  });

  it('không có tỉ giá hoá đơn thì lấy nghịch đảo tỉ giá tài khoản', () => {
    expect(heSoQuyDoiVnd({ costCurrency: 'USD', fxCostPerDisplay: 1 / 26465 })).toBeCloseTo(26465, 6);
  });

  it('không biết tỉ giá nào thì trả null', () => {
    expect(heSoQuyDoiVnd({ costCurrency: 'USD' })).toBeNull();
  });
});
