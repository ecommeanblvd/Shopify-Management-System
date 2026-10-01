import { describe, it, expect } from 'vitest';
import { chuyenDuocQc, themDuocLoi, kiemLoQc } from './qc-logic';

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
    expect(kiemLoQc([])).toEqual({ ok: false, loi: 'Phải ghi ít nhất một chỗ lỗi.' });
  });
  it('mọi dòng hợp lệ → nhận', () => {
    expect(kiemLoQc([{ lyDo: 'ban', anhKey: 'a', ghiChu: '' }])).toEqual({ ok: true });
  });
  it('nhiều chỗ lỗi trên một chiếc → nhận', () => {
    expect(kiemLoQc([
      { lyDo: 'ban', anhKey: 'a', ghiChu: 'gấu váy' },
      { lyDo: 'rach', anhKey: 'b', ghiChu: 'nách' },
      { lyDo: 'hong_khoa', anhKey: 'c', ghiChu: '' },
    ])).toEqual({ ok: true });
  });
  it('một dòng sai thì CHỈ RA DÒNG NÀO, không báo chung chung', () => {
    expect(kiemLoQc([
      { lyDo: 'ban', anhKey: 'a', ghiChu: '' },
      { lyDo: 'khac', anhKey: 'b', ghiChu: '' },
    ])).toEqual({ ok: false, loi: 'Chỗ lỗi 2: Lý do "Khác" phải ghi rõ trong ô ghi chú.' });
  });
  /* Ảnh thôi bắt buộc (CEO 01/10/2026) — xem ghi chú ở `kiemDongLoi`. */
  it('thiếu ảnh → VẪN lưu được, ảnh bổ sung sau ở bảng Nhận hôm nay', () => {
    expect(kiemLoQc([{ lyDo: 'ban', anhKey: null, ghiChu: '' }])).toEqual({ ok: true });
  });
});

/* Đường BỔ SUNG bằng chứng cho chiếc đã fail (CEO 01/10/2026) — mở ra vì ảnh lỗi thôi bắt buộc
   lúc kiểm, nên phải còn chỗ thêm ảnh sau. */
describe('themDuocLoi', () => {
  it('chiếc đã KHÔNG ĐẠT → thêm được bằng chứng', () => {
    expect(themDuocLoi('fail')).toEqual({ ok: true });
  });

  /* Thêm lỗi cho hàng ĐÃ VÀO TỒN là hai sự thật ngược nhau trên cùng một chiếc, và không có
     đường nào rút hàng ra. */
  it('chiếc đã ĐẠT → chặn, nói rõ là bế tắc', () => {
    expect(themDuocLoi('pass')).toEqual({
      ok: false, loi: 'Chiếc này đã kiểm ĐẠT — không thêm được lỗi.',
    });
  });

  /* Thêm lỗi suông cho chiếc chưa kiểm là để nó nằm "chờ QC" trong khi hồ sơ lỗi đã có —
     dữ liệu nói một đằng, trạng thái nói một nẻo. Lý do phải CHỈ ĐƯỜNG, không chỉ từ chối. */
  it('chiếc CHƯA kiểm → chặn, và chỉ đường sang nút Kiểm', () => {
    expect(themDuocLoi('pending')).toEqual({
      ok: false, loi: 'Chiếc này chưa kiểm — bấm Kiểm để ghi lỗi.',
    });
  });

  it('hai đường ngược nhau: pending đi qcKhongDat, fail đi themDongLoiQc', () => {
    expect(chuyenDuocQc('pending')).toBe(true);
    expect(themDuocLoi('pending').ok).toBe(false);
    expect(chuyenDuocQc('fail')).toBe(false);
    expect(themDuocLoi('fail').ok).toBe(true);
  });
});
