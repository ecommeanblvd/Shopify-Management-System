import { describe, it, expect } from 'vitest';
import { kiemDongLoi, NHAN_LY_DO, LY_DO_HOP_LE } from './loi-qc';

describe('kiemDongLoi', () => {
  it('lý do hợp lệ + có ảnh → nhận', () => {
    expect(kiemDongLoi({ lyDo: 'ban', anhKey: 'qc-loi/a/1.jpg', ghiChu: '', coStorage: true }))
      .toEqual({ ok: true });
  });
  it('lý do "khác" BẮT BUỘC ghi chú', () => {
    expect(kiemDongLoi({ lyDo: 'khac', anhKey: 'k', ghiChu: '  ', coStorage: true }))
      .toEqual({ ok: false, loi: 'Lý do "Khác" phải ghi rõ trong ô ghi chú.' });
    expect(kiemDongLoi({ lyDo: 'khac', anhKey: 'k', ghiChu: 'chỉ thừa', coStorage: true }))
      .toEqual({ ok: true });
  });
  it('có kho ảnh thì ảnh BẮT BUỘC — biên bản gửi brand không ảnh thì không cãi được', () => {
    expect(kiemDongLoi({ lyDo: 'rach', anhKey: null, ghiChu: '', coStorage: true }))
      .toEqual({ ok: false, loi: 'Phải chụp ảnh chỗ lỗi.' });
  });
  it('CHƯA cấu hình kho ảnh → vẫn ghi được lỗi, không chặn kho làm việc', () => {
    expect(kiemDongLoi({ lyDo: 'rach', anhKey: null, ghiChu: '', coStorage: false }))
      .toEqual({ ok: true });
  });
  it('lý do lạ → từ chối, KHÔNG im lặng đổi sang "khác"', () => {
    expect(kiemDongLoi({ lyDo: 'vo_chai' as never, anhKey: 'k', ghiChu: '', coStorage: true }))
      .toEqual({ ok: false, loi: 'Lý do lỗi không hợp lệ.' });
  });
  it('đủ 12 lý do, mỗi lý do có nhãn tiếng Việt', () => {
    expect(LY_DO_HOP_LE).toHaveLength(12);
    for (const l of LY_DO_HOP_LE) expect(NHAN_LY_DO[l]).toBeTruthy();
  });
});
