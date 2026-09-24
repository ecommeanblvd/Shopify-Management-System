import { describe, it, expect } from 'vitest';
import { conNhanDuoc, kieuTuKhoa } from './tim-don-logic';

describe('conNhanDuoc', () => {
  it('đặt 3 mới nhận 1 → VẪN hiện, vì hàng về nhiều đợt là chuyện thường', () => {
    expect(conNhanDuoc({ datSl: 3, daNhan: 1 })).toBe(true);
  });
  it('đã nhận đủ → ẩn', () => {
    expect(conNhanDuoc({ datSl: 3, daNhan: 3 })).toBe(false);
  });
  it('nhận thừa (brand gửi dư) → ẩn, không âm', () => {
    expect(conNhanDuoc({ datSl: 3, daNhan: 5 })).toBe(false);
  });
  it('chưa nhận gì → hiện', () => {
    expect(conNhanDuoc({ datSl: 1, daNhan: 0 })).toBe(true);
  });
});

describe('kieuTuKhoa', () => {
  it('toàn số dài ≥ 10 → coi là ID sản phẩm (tem V: in ra số trần)', () => {
    expect(kieuTuKhoa('35730194464936')).toBe('id');
  });
  it('có chữ → tìm theo chữ', () => {
    expect(kieuTuKhoa('MBLVD26763')).toBe('chu');
    expect(kieuTuKhoa('ao dai')).toBe('chu');
  });
  it('số ngắn → vẫn là chữ, không nhầm thành ID', () => {
    expect(kieuTuKhoa('26763')).toBe('chu');
  });
  it('dưới 2 ký tự → không tìm', () => {
    expect(kieuTuKhoa('a')).toBe('qua_ngan');
    expect(kieuTuKhoa(' ')).toBe('qua_ngan');
  });
});
