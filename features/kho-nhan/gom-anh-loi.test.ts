import { describe, it, expect } from 'vitest';
import { gomAnhLoi } from './gom-anh-loi';
import type { AnhLoiQc } from './anh-loi-qc';

const a = (id: string, lyDo: AnhLoiQc['lyDo'], nhanLyDo: string, ghiChu: string | null): AnhLoiQc =>
  ({ id, itemId: 'i1', lyDo, nhanLyDo, ghiChu, url: `u/${id}` });

describe('gomAnhLoi', () => {
  /* Chính ca Bảo báo 09/10/2026: cùng một vết bẩn, nhiều tấm ảnh. */
  it('nhiều ảnh cùng lý do + cùng ghi chú → MỘT chỗ lỗi', () => {
    const r = gomAnhLoi([
      a('1', 'ban', 'Bẩn', 'gấu váy'),
      a('2', 'ban', 'Bẩn', 'gấu váy'),
      a('3', 'ban', 'Bẩn', 'gấu váy'),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.anh.map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(r[0]!.ghiChu).toBe('gấu váy');
  });

  /* Gộp theo lý do suông là mất chi tiết: hai vị trí bẩn khác nhau là hai chỗ lỗi thật. */
  it('cùng lý do nhưng KHÁC ghi chú → hai chỗ lỗi', () => {
    const r = gomAnhLoi([
      a('1', 'ban', 'Bẩn', 'gấu váy'),
      a('2', 'ban', 'Bẩn', 'cổ áo'),
    ]);
    expect(r.map((x) => x.ghiChu)).toEqual(['gấu váy', 'cổ áo']);
  });

  it('ghi chú null và chuỗi trắng là CÙNG một chỗ lỗi', () => {
    const r = gomAnhLoi([a('1', 'rach', 'Rách', null), a('2', 'rach', 'Rách', '   ')]);
    expect(r).toHaveLength(1);
    expect(r[0]!.ghiChu).toBe('');
  });

  it('giữ thứ tự người kiểm đã nhập, không sắp xếp lại', () => {
    const r = gomAnhLoi([
      a('1', 'hong_khoa', 'Hỏng khoá kéo', ''),
      a('2', 'ban', 'Bẩn', ''),
      a('3', 'hong_khoa', 'Hỏng khoá kéo', ''),
    ]);
    expect(r.map((x) => x.lyDo)).toEqual(['hong_khoa', 'ban']);
    expect(r[0]!.anh.map((x) => x.id)).toEqual(['1', '3']);
  });

  it('không có ảnh nào → danh sách rỗng', () => {
    expect(gomAnhLoi([])).toEqual([]);
  });
});
