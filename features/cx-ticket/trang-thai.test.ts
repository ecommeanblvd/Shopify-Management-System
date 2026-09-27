import { describe, it, expect } from 'vitest';
import {
  chuyenDuocTrangThai, trangThaiVietHopLe, boPhanConTac, ghiDuocPhanViec, laGhiHo,
} from './trang-thai';

describe('trạng thái ticket', () => {
  it('đi được giữa các trạng thái chưa đóng', () => {
    expect(chuyenDuocTrangThai('moi', 'dang_xu_ly')).toBe(true);
    expect(chuyenDuocTrangThai('moi', 'xong')).toBe(true);
    expect(chuyenDuocTrangThai('dang_xu_ly', 'xong')).toBe(true);
    // lùi lại được: CX đóng nhầm khi chưa xong thì phải sửa được
    expect(chuyenDuocTrangThai('dang_xu_ly', 'moi')).toBe(true);
  });

  it('ticket đã đóng thì không mở lại — mở lại làm thống kê thời gian xử lý sai', () => {
    expect(chuyenDuocTrangThai('xong', 'dang_xu_ly')).toBe(false);
    expect(chuyenDuocTrangThai('xong', 'moi')).toBe(false);
  });

  it('không chuyển sang chính nó, không nhận trạng thái lạ', () => {
    expect(chuyenDuocTrangThai('moi', 'moi')).toBe(false);
    expect(chuyenDuocTrangThai('moi', 'Done')).toBe(false);
    expect(chuyenDuocTrangThai('New case', 'xong')).toBe(false);
  });

  it('trạng thái phần việc đúng ba giá trị Lark', () => {
    expect(trangThaiVietHopLe('dang_xu_ly')).toBe(true);
    expect(trangThaiVietHopLe('da_xu_ly')).toBe(true);
    expect(trangThaiVietHopLe('chua_du_thong_tin')).toBe(true);
    expect(trangThaiVietHopLe('CS Đã xử lý')).toBe(false);
  });
});

describe('boPhanConTac — để CẢNH BÁO lúc đóng, không phải để chặn', () => {
  it('kể tên bộ phận chưa xử lý xong', () => {
    expect(boPhanConTac([
      { boPhan: 'CX-CS', trangThai: 'da_xu_ly' },
      { boPhan: 'PROCUREMENT', trangThai: 'dang_xu_ly' },
      { boPhan: 'MERCHANDISE', trangThai: 'chua_du_thong_tin' },
    ])).toEqual(['PROCUREMENT', 'MERCHANDISE']);
  });

  it('rỗng khi mọi bộ phận đã xong', () => {
    expect(boPhanConTac([
      { boPhan: 'CX-CS', trangThai: 'da_xu_ly' },
      { boPhan: 'DISCO-LOG', trangThai: 'da_xu_ly' },
    ])).toEqual([]);
  });

  it('rỗng khi ticket chưa gán bộ phận nào', () => {
    expect(boPhanConTac([])).toEqual([]);
  });

  it('chua_du_thong_tin tính là CHƯA xong — bộ phận đó đang đợi dữ liệu', () => {
    expect(boPhanConTac([{ boPhan: 'MERCHANDISE', trangThai: 'chua_du_thong_tin' }]))
      .toEqual(['MERCHANDISE']);
  });
});

describe('ghiDuocPhanViec — CX ghi hộ bộ phận chưa có tài khoản', () => {
  it('toàn quyền ghi được cho mọi bộ phận', () => {
    expect(ghiDuocPhanViec(true, 'CX-CS', 'PROCUREMENT')).toBe(true);
    expect(ghiDuocPhanViec(true, null, 'MERCHANDISE')).toBe(true);
  });

  it('không toàn quyền chỉ ghi được phần bộ phận mình', () => {
    expect(ghiDuocPhanViec(false, 'DISCO-LOG', 'DISCO-LOG')).toBe(true);
    expect(ghiDuocPhanViec(false, 'DISCO-LOG', 'PROCUREMENT')).toBe(false);
  });

  it('chưa gắn bộ phận thì không ghi được gì', () => {
    expect(ghiDuocPhanViec(false, null, 'CX-CS')).toBe(false);
    expect(ghiDuocPhanViec(false, '', 'CX-CS')).toBe(false);
  });
});

describe('laGhiHo', () => {
  it('ghi cho bộ phận khác mình là ghi hộ', () => {
    expect(laGhiHo('CX-CS', 'PROCUREMENT')).toBe(true);
    expect(laGhiHo(null, 'PROCUREMENT')).toBe(true);
  });

  it('ghi cho chính bộ phận mình thì không', () => {
    expect(laGhiHo('PROCUREMENT', 'PROCUREMENT')).toBe(false);
  });
});
