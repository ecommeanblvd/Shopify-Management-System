import { describe, it, expect } from 'vitest';
import { soTemDuocIn, phanLoaiQuet, duChiec, chuTemMon, chuTemDong } from './nhan-nhanh-logic';

describe('soTemDuocIn', () => {
  it('còn nợ đủ → in hết theo đơn', () => {
    expect(soTemDuocIn({ mongDoi: 2, daIn: 0, daXacNhan: 0 }, 2)).toEqual({ theoDon: 2, ngoaiKeHoach: 0 });
  });
  it('brand gửi thiếu: in 1, còn nợ 1 (không ép in đủ)', () => {
    expect(soTemDuocIn({ mongDoi: 2, daIn: 0, daXacNhan: 0 }, 1)).toEqual({ theoDon: 1, ngoaiKeHoach: 0 });
  });
  it('brand gửi thừa: tối đa = mong đợi, phần dư ngoài kế hoạch', () => {
    expect(soTemDuocIn({ mongDoi: 2, daIn: 0, daXacNhan: 0 }, 3)).toEqual({ theoDon: 2, ngoaiKeHoach: 1 });
  });
  it('đã in trước đó thì trừ đi', () => {
    expect(soTemDuocIn({ mongDoi: 2, daIn: 1, daXacNhan: 0 }, 2)).toEqual({ theoDon: 1, ngoaiKeHoach: 1 });
    expect(soTemDuocIn({ mongDoi: 2, daIn: 2, daXacNhan: 2 }, 1)).toEqual({ theoDon: 0, ngoaiKeHoach: 1 });
  });
  it('yêu cầu ≤ 0 → không in gì', () => {
    expect(soTemDuocIn({ mongDoi: 2, daIn: 0, daXacNhan: 0 }, 0)).toEqual({ theoDon: 0, ngoaiKeHoach: 0 });
    expect(soTemDuocIn({ mongDoi: 2, daIn: 0, daXacNhan: 0 }, -5)).toEqual({ theoDon: 0, ngoaiKeHoach: 0 });
  });
});

describe('phanLoaiQuet', () => {
  it('mã không có → khong_ton_tai', () => {
    expect(phanLoaiQuet(null, 'p1')).toBe('khong_ton_tai');
  });
  it('tem của phiếu khác → khac_phieu', () => {
    expect(phanLoaiQuet({ receiptId: 'p2', confirmedAt: null }, 'p1')).toBe('khac_phieu');
  });
  it('đã xác nhận rồi → da_xac_nhan', () => {
    expect(phanLoaiQuet({ receiptId: 'p1', confirmedAt: new Date() }, 'p1')).toBe('da_xac_nhan');
  });
  it('đúng phiếu, chưa xác nhận → khop', () => {
    expect(phanLoaiQuet({ receiptId: 'p1', confirmedAt: null }, 'p1')).toBe('khop');
  });
});

describe('duChiec', () => {
  it('đủ khi đã xác nhận ≥ mong đợi', () => {
    expect(duChiec({ mongDoi: 2, daIn: 2, daXacNhan: 2 })).toBe(true);
    expect(duChiec({ mongDoi: 2, daIn: 2, daXacNhan: 1 })).toBe(false);
    expect(duChiec({ mongDoi: 0, daIn: 0, daXacNhan: 0 })).toBe(false);
  });
});

describe('chữ trên tem', () => {
  it('tem món: #đơn · tên · size · i/n · brand, bỏ phần trống', () => {
    expect(chuTemMon({ orderNumber: 'TA2331', productTitle: 'Áo X', variantTitle: 'XL', thuTu: 1, tong: 2, brand: 'TINH' }))
      .toBe('#TA2331 · Áo X · XL · 1/2 · TINH');
    expect(chuTemMon({ orderNumber: '#MBLVD1', productTitle: 'Áo X', variantTitle: null, thuTu: 1, tong: 1, brand: null }))
      .toBe('#MBLVD1 · Áo X · 1/1');
  });
  it('tem dòng: #đơn · dòng k · tên · size × qty', () => {
    expect(chuTemDong({ orderNumber: 'TA2331', thuTuDong: 2, productTitle: 'Áo X', variantTitle: 'XL', qty: 2 }))
      .toBe('#TA2331 · dòng 2 · Áo X · XL × 2');
  });
});
