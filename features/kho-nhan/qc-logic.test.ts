import { describe, it, expect } from 'vitest';
import {
  chuyenDuocQc, themDuocLoi, kiemLoQc, moRongDongLoi, kiemChoLoi,
} from './qc-logic';

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

/* Bảo 09/10/2026: "không thể cho nhiều ảnh vào 1 lỗi (ví dụ cùng 1 lỗi bẩn nhưng nhiều chỗ)". */
describe('moRongDongLoi', () => {
  it('một chỗ lỗi NHIỀU ảnh → nhiều dòng, cùng lý do và cùng ghi chú', () => {
    expect(moRongDongLoi([{ lyDo: 'ban', ghiChu: 'gấu váy', anhKey: ['a', 'b', 'c'] }])).toEqual([
      { lyDo: 'ban', anhKey: 'a', ghiChu: 'gấu váy' },
      { lyDo: 'ban', anhKey: 'b', ghiChu: 'gấu váy' },
      { lyDo: 'ban', anhKey: 'c', ghiChu: 'gấu váy' },
    ]);
  });

  /* Ô ảnh mới thêm mà chưa chọn ảnh là `null` — không được thành một dòng lỗi rỗng. */
  it('ô ảnh còn trống bị bỏ, không sinh dòng thừa', () => {
    expect(moRongDongLoi([{ lyDo: 'rach', ghiChu: '', anhKey: ['a', null, '', null] }])).toEqual([
      { lyDo: 'rach', anhKey: 'a', ghiChu: '' },
    ]);
  });

  /* Ảnh thôi bắt buộc từ 01/10/2026 — chỗ lỗi chưa kịp chụp vẫn phải lưu được lý do. */
  it('chỗ lỗi CHƯA có ảnh nào vẫn ra một dòng', () => {
    expect(moRongDongLoi([{ lyDo: 'co_mui', ghiChu: 'hắc', anhKey: [null] }])).toEqual([
      { lyDo: 'co_mui', anhKey: null, ghiChu: 'hắc' },
    ]);
    expect(moRongDongLoi([{ lyDo: 'co_mui', ghiChu: '', anhKey: [] }])).toEqual([
      { lyDo: 'co_mui', anhKey: null, ghiChu: '' },
    ]);
  });

  it('giữ ĐÚNG thứ tự chỗ lỗi và thứ tự ảnh trong từng chỗ', () => {
    expect(moRongDongLoi([
      { lyDo: 'ban', ghiChu: '', anhKey: ['a1', 'a2'] },
      { lyDo: 'hong_khoa', ghiChu: '', anhKey: ['b1'] },
    ]).map((d) => d.anhKey)).toEqual(['a1', 'a2', 'b1']);
  });

  it('kết quả trải ra vẫn qua được luật của máy chủ', () => {
    const vao = moRongDongLoi([{ lyDo: 'khac', ghiChu: 'chỉ thừa', anhKey: ['a', 'b'] }]);
    expect(kiemLoQc(vao)).toEqual({ ok: true });
  });
});

describe('kiemChoLoi', () => {
  it('phải có ít nhất một chỗ lỗi', () => {
    expect(kiemChoLoi([])).toEqual({ ok: false, loi: 'Phải ghi ít nhất một chỗ lỗi.' });
  });

  /* Chính lý do hàm này tồn tại: đếm theo chỗ lỗi NGƯỜI THẤY, không theo dòng sau khi trải.
     Chỗ lỗi 1 có 3 ảnh → `kiemLoQc` của máy chủ sẽ gọi chỗ lỗi 2 là "Chỗ lỗi 4". */
  it('số trong câu lỗi là số trên màn hình, không phải số dòng sau khi trải ảnh', () => {
    const cho = [
      { lyDo: 'ban' as const, ghiChu: '', anhKey: ['a', 'b', 'c'] },
      { lyDo: 'khac' as const, ghiChu: '  ', anhKey: ['d'] },
    ];
    expect(kiemChoLoi(cho)).toEqual({
      ok: false, loi: 'Chỗ lỗi 2: Lý do "Khác" phải ghi rõ trong ô ghi chú.',
    });
    expect(kiemLoQc(moRongDongLoi(cho))).toEqual({
      ok: false, loi: 'Chỗ lỗi 4: Lý do "Khác" phải ghi rõ trong ô ghi chú.',
    });
  });

  it('thiếu ảnh KHÔNG phải lỗi — ảnh bổ sung sau', () => {
    expect(kiemChoLoi([{ lyDo: 'ban', ghiChu: '', anhKey: [] }])).toEqual({ ok: true });
  });
});
