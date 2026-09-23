import { describe, it, expect } from 'vitest';
import { chiPhiMotDong, tongChiPhi, soNgayTre } from './chi-phi';
import type { DongDon } from './types';

const d = (o: Partial<DongDon>): DongDon => ({
  id: 'x', sku: 'A-1', tenHang: null, kho: 'GVM', soLuong: 1, hinhThuc: 'tang',
  hanTra: null, giaVon: '100', giaVonTienTe: 'VND', soLuongDaTra: 0, soLuongNhapLai: 0, ...o,
});

describe('chiPhiMotDong', () => {
  it('hàng tặng tính chi phí toàn bộ số lượng', () => {
    expect(chiPhiMotDong(d({ hinhThuc: 'tang', soLuong: 3, giaVon: '100' })))
      .toEqual({ daTieu: 3, dangTreo: 0, tienChiPhi: 300, tienTe: 'VND', thieuGiaVon: false });
  });
  it('hàng mượn trả về VÀ nhập lại kho thì KHÔNG tính chi phí', () => {
    expect(chiPhiMotDong(d({ hinhThuc: 'muon', soLuong: 2, soLuongDaTra: 2, soLuongNhapLai: 2, giaVon: '100' })))
      .toEqual({ daTieu: 0, dangTreo: 0, tienChiPhi: 0, tienTe: 'VND', thieuGiaVon: false });
  });
  it('hàng mượn trả về nhưng hỏng không nhập lại thì CÓ tính', () => {
    expect(chiPhiMotDong(d({ hinhThuc: 'muon', soLuong: 2, soLuongDaTra: 2, soLuongNhapLai: 0, giaVon: '100' })))
      .toEqual({ daTieu: 2, dangTreo: 0, tienChiPhi: 200, tienTe: 'VND', thieuGiaVon: false });
  });
  it('giữ nguyên tiền tệ của dòng, không mặc định về VND', () => {
    const r = chiPhiMotDong(d({ soLuong: 2, giaVon: '4', giaVonTienTe: 'USD' }));
    expect(r.tienChiPhi).toBe(8);
    expect(r.tienTe).toBe('USD');
  });
  it('hàng mượn chưa trả thì nằm ở cột đang treo, không trộn vào chi phí', () => {
    const r = chiPhiMotDong(d({ hinhThuc: 'muon', soLuong: 3, soLuongDaTra: 0, giaVon: '100' }));
    expect(r.dangTreo).toBe(3);
    expect(r.daTieu).toBe(3);
  });
  it('trả một phần: gửi 3 về 2 nhập lại 2 → tiêu 1, treo 1', () => {
    const r = chiPhiMotDong(d({ hinhThuc: 'muon', soLuong: 3, soLuongDaTra: 2, soLuongNhapLai: 2, giaVon: '100' }));
    expect(r).toEqual({ daTieu: 1, dangTreo: 1, tienChiPhi: 100, tienTe: 'VND', thieuGiaVon: false });
  });
  it('thiếu giá vốn thì báo thiếu, KHÔNG coi là 0 đồng', () => {
    const r = chiPhiMotDong(d({ giaVon: null, soLuong: 2 }));
    expect(r.tienChiPhi).toBeNull();
    expect(r.thieuGiaVon).toBe(true);
    expect(r.daTieu).toBe(2);
  });
});

describe('tongChiPhi', () => {
  it('cộng dồn và ĐẾM RIÊNG số dòng thiếu giá vốn', () => {
    expect(tongChiPhi([
      d({ hinhThuc: 'tang', soLuong: 2, giaVon: '50' }),
      d({ hinhThuc: 'muon', soLuong: 1, soLuongDaTra: 0, giaVon: null }),
      d({ hinhThuc: 'muon', soLuong: 4, soLuongDaTra: 4, soLuongNhapLai: 4, giaVon: '10' }),
    ])).toEqual({ theoTienTe: { VND: 100 }, soMonDaTieu: 3, soMonDangTreo: 1, soDongThieuGiaVon: 1 });
  });
  it('KHÔNG cộng thẳng hai loại tiền vào một số', () => {
    expect(tongChiPhi([
      d({ soLuong: 1, giaVon: '100', giaVonTienTe: 'VND' }),
      d({ soLuong: 1, giaVon: '4', giaVonTienTe: 'USD' }),
    ]).theoTienTe).toEqual({ VND: 100, USD: 4 });
  });
  it('danh sách rỗng ra rỗng, không ném lỗi', () => {
    expect(tongChiPhi([])).toEqual({ theoTienTe: {}, soMonDaTieu: 0, soMonDangTreo: 0, soDongThieuGiaVon: 0 });
  });
});

describe('soNgayTre', () => {
  it('chưa tới hạn trả về số âm', () => { expect(soNgayTre('2026-10-01', '2026-09-23')).toBe(-8); });
  it('đúng hạn là 0', () => { expect(soNgayTre('2026-09-23', '2026-09-23')).toBe(0); });
  it('quá hạn trả về số dương', () => { expect(soNgayTre('2026-09-20', '2026-09-23')).toBe(3); });
  it('không có hạn thì null', () => { expect(soNgayTre(null, '2026-09-23')).toBeNull(); });
});
