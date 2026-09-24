import { describe, it, expect } from 'vitest';
import { chuyenDuocQc, kiemLoQc } from './qc-logic';

describe('chuyenDuocQc', () => {
  it('pending → QC được', () => { expect(chuyenDuocQc('pending')).toBe(true); });
  it('đã pass rồi thì KHÔNG cho QC lại — hàng đã vào tồn, QC lại là nhập đôi', () => {
    expect(chuyenDuocQc('pass')).toBe(false);
  });
  it('đã fail rồi thì KHÔNG cho QC lại', () => {
    expect(chuyenDuocQc('fail')).toBe(false);
  });
});

describe('kiemLoQc', () => {
  it('QC không đạt phải có ÍT NHẤT MỘT chỗ lỗi', () => {
    expect(kiemLoQc([], true)).toEqual({ ok: false, loi: 'Phải ghi ít nhất một chỗ lỗi.' });
  });
  it('mọi dòng hợp lệ → nhận', () => {
    expect(kiemLoQc([{ lyDo: 'ban', anhKey: 'a', ghiChu: '' }], true)).toEqual({ ok: true });
  });
  it('nhiều chỗ lỗi trên một chiếc → nhận', () => {
    expect(kiemLoQc([
      { lyDo: 'ban', anhKey: 'a', ghiChu: 'gấu váy' },
      { lyDo: 'rach', anhKey: 'b', ghiChu: 'nách' },
      { lyDo: 'hong_khoa', anhKey: 'c', ghiChu: '' },
    ], true)).toEqual({ ok: true });
  });
  it('một dòng sai thì CHỈ RA DÒNG NÀO, không báo chung chung', () => {
    expect(kiemLoQc([
      { lyDo: 'ban', anhKey: 'a', ghiChu: '' },
      { lyDo: 'khac', anhKey: 'b', ghiChu: '' },
    ], true)).toEqual({ ok: false, loi: 'Chỗ lỗi 2: Lý do "Khác" phải ghi rõ trong ô ghi chú.' });
  });
  it('thiếu ảnh khi CÓ kho ảnh → chỉ ra đúng dòng', () => {
    expect(kiemLoQc([{ lyDo: 'ban', anhKey: null, ghiChu: '' }], true))
      .toEqual({ ok: false, loi: 'Chỗ lỗi 1: Phải chụp ảnh chỗ lỗi.' });
  });
  it('CHƯA có kho ảnh → vẫn lưu được lỗi, không chặn kho', () => {
    expect(kiemLoQc([{ lyDo: 'ban', anhKey: null, ghiChu: '' }], false)).toEqual({ ok: true });
  });
});
