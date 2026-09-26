import { describe, it, expect } from 'vitest';
import { kiemDongKien, vatTuTheoKho, maKien } from './logic';

const ok = { lineIds: ['a'], canKg: 1.2, daiCm: null, rongCm: null, caoCm: null };

describe('kiemDongKien', () => {
  it('đủ chiếc và có cân thì qua', () => {
    expect(kiemDongKien(ok)).toEqual({ ok: true });
  });

  it('chưa chọn chiếc nào thì chặn', () => {
    expect(kiemDongKien({ ...ok, lineIds: [] })).toEqual({ ok: false, loi: 'Chưa chọn chiếc nào cho kiện.' });
  });

  /* Kiện không cân thì không so được cước — đây đúng là lý do bước này tồn tại. */
  it('thiếu cân nặng thì chặn', () => {
    expect(kiemDongKien({ ...ok, canKg: null }).ok).toBe(false);
    expect(kiemDongKien({ ...ok, canKg: 0 }).ok).toBe(false);
  });

  /* Gõ nhầm gram thành kg là con số đó đi thẳng vào báo giá cước. */
  it('cân trên 200kg là gõ nhầm đơn vị', () => {
    expect(kiemDongKien({ ...ok, canKg: 1200 }).ok).toBe(false);
  });

  it('kích thước để TRỐNG được — hộp đã mang sẵn kích thước trong mã', () => {
    expect(kiemDongKien({ ...ok, daiCm: null, rongCm: null, caoCm: null })).toEqual({ ok: true });
  });

  it('kích thước có điền thì phải hợp lệ', () => {
    expect(kiemDongKien({ ...ok, daiCm: 0 }).ok).toBe(false);
    expect(kiemDongKien({ ...ok, caoCm: 500 }).ok).toBe(false);
    expect(kiemDongKien({ ...ok, daiCm: 42, rongCm: 30, caoCm: 10 })).toEqual({ ok: true });
  });
});

describe('vatTuTheoKho', () => {
  const v = (recordId: string, dinhDanh: string, warehouse: string | null) =>
    ({ recordId, dinhDanh, loai: 'VTĐG1', warehouse });

  /* Hộp là hàng tồn có vị trí thật — gợi ý hộp ở Sài Gòn cho người đóng ở Hà
   * Nội là chỉ vào thứ họ không cầm được. */
  it('chỉ lấy vật tư của đúng kho', () => {
    const r = vatTuTheoKho([v('1', 'A', 'HN | GVM'), v('2', 'B', 'SG | AP')], 'HN | GVM');
    expect(r.map((x) => x.recordId)).toEqual(['1']);
  });

  it('kho đó chưa có vật tư nào thì đưa cả danh sách, không trả ô rỗng', () => {
    const r = vatTuTheoKho([v('1', 'A', 'SG | AP')], 'HN | GVM');
    expect(r).toHaveLength(1);
  });

  it('không lọc kho thì lấy hết, sắp theo tên', () => {
    const r = vatTuTheoKho([v('1', 'B', 'HN | GVM'), v('2', 'A', 'SG | AP')], null);
    expect(r.map((x) => x.dinhDanh)).toEqual(['A', 'B']);
  });
});

describe('maKien', () => {
  it('có mã thì dùng mã', () => expect(maKien('PK-123', 'abcdef1234')).toBe('PK-123'));
  it('thiếu mã thì rơi về id ngắn, không trả chuỗi rỗng', () => {
    expect(maKien(null, 'abcdef1234')).toBe('#abcdef12');
    expect(maKien('   ', 'abcdef1234')).toBe('#abcdef12');
  });
});
