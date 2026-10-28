import { describe, expect, it } from 'vitest';
import { docDanhSachDon, lyDoKhongApDung } from './lech-tai-khoan-hang';

describe('docDanhSachDon', () => {
  it('đọc được nhiều cờ --don và danh sách phẩy', () => {
    expect(docDanhSachDon(['--don', 'A-1,A-2', '--don', 'B-3'])).toEqual(['A-1', 'A-2', 'B-3']);
  });

  it('hoa hoá mã để so sánh không phụ thuộc chữ hoa/thường', () => {
    expect(docDanhSachDon(['--don', '26-inslg-sv-0164'])).toEqual(['26-INSLG-SV-0164']);
  });

  it('không có --don thì rỗng — KHÔNG mặc định lấy hết', () => {
    expect(docDanhSachDon(['--ap-dung'])).toEqual([]);
    expect(docDanhSachDon([])).toEqual([]);
  });

  /* Ca này là lý do hàm tồn tại thay vì một `split` tại chỗ: `--don` bỏ trống mã rồi tới cờ
   * khác. Coi `--ap-dung` là mã đơn thì danh sách KHÔNG rỗng, chốt dưới cho đi, và lượt chạy
   * biến thành "--ap-dung mà không nêu đơn nào" — đúng thứ chốt đó sinh ra để chặn. */
  it('--don bỏ trống rồi tới cờ khác thì KHÔNG nhận cờ đó làm mã đơn', () => {
    expect(docDanhSachDon(['--don', '--ap-dung'])).toEqual([]);
    expect(docDanhSachDon(['--ap-dung', '--don'])).toEqual([]);
  });

  it('bỏ khoảng trắng và phần tử rỗng', () => {
    expect(docDanhSachDon(['--don', ' A-1 , , A-2 '])).toEqual(['A-1', 'A-2']);
  });
});

describe('lyDoKhongApDung', () => {
  it('dry-run thì luôn cho đi, kể cả không nêu đơn nào', () => {
    expect(lyDoKhongApDung(false, [])).toBeNull();
    expect(lyDoKhongApDung(false, ['A-1'])).toBeNull();
  });

  it('--ap-dung mà KHÔNG nêu đơn nào thì TỪ CHỐI, và nói ra cách gọi đúng', () => {
    const ly = lyDoKhongApDung(true, []);
    expect(ly).not.toBeNull();
    expect(ly).toContain('--don');
  });

  it('--ap-dung kèm đơn thì cho đi', () => {
    expect(lyDoKhongApDung(true, ['26-INSLG-SV-0164'])).toBeNull();
  });
});
