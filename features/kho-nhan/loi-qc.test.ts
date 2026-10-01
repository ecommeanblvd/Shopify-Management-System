import { describe, it, expect } from 'vitest';
import { kiemDongLoi, NHAN_LY_DO, LY_DO_HOP_LE } from './loi-qc';

describe('kiemDongLoi', () => {
  it('lý do hợp lệ + có ảnh → nhận', () => {
    expect(kiemDongLoi({ lyDo: 'ban', anhKey: 'qc-loi/a/1.jpg', ghiChu: '' }))
      .toEqual({ ok: true });
  });
  it('lý do "khác" BẮT BUỘC ghi chú', () => {
    expect(kiemDongLoi({ lyDo: 'khac', anhKey: 'k', ghiChu: '  ' }))
      .toEqual({ ok: false, loi: 'Lý do "Khác" phải ghi rõ trong ô ghi chú.' });
    expect(kiemDongLoi({ lyDo: 'khac', anhKey: 'k', ghiChu: 'chỉ thừa' }))
      .toEqual({ ok: true });
  });
  /* Ảnh thôi BẮT BUỘC (CEO 01/10/2026) — kiểm xong mà chưa kịp chụp thì phải lưu được, ảnh bổ
     sung sau ở bảng Nhận hôm nay. Trước đó luật này chặn lưu và kho kẹt giữa ca. */
  it('KHÔNG có ảnh → vẫn lưu được, ảnh bổ sung sau', () => {
    expect(kiemDongLoi({ lyDo: 'rach', anhKey: null, ghiChu: '' })).toEqual({ ok: true });
  });
  it('lý do lạ → từ chối, KHÔNG im lặng đổi sang "khác"', () => {
    expect(kiemDongLoi({ lyDo: 'vo_chai' as never, anhKey: 'k', ghiChu: '' }))
      .toEqual({ ok: false, loi: 'Lý do lỗi không hợp lệ.' });
  });
  it('đủ 12 lý do, mỗi lý do có nhãn tiếng Việt', () => {
    expect(LY_DO_HOP_LE).toHaveLength(12);
    for (const l of LY_DO_HOP_LE) expect(NHAN_LY_DO[l]).toBeTruthy();
  });
});
