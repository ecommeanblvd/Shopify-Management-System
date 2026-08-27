import { describe, expect, it } from 'vitest';
import { ghepCapBangKeHoaDon } from './hnc-pairing';

const bk = (tong: number, ten: string) => ({ ten, tong });
const hd = (tong: number, ten: string) => ({ ten, tong });

describe('ghepCapBangKeHoaDon', () => {
  it('một bảng kê một hoá đơn thì ghép thẳng', () => {
    const r = ghepCapBangKeHoaDon([bk(1415057, 'bk.xls')], [hd(1415057, 'hd.xml')]);
    expect(r.cap).toHaveLength(1);
    expect(r.cap[0]).toEqual({ bangKe: bk(1415057, 'bk.xls'), hoaDon: hd(1415057, 'hd.xml') });
    expect(r.hoaDonThua).toEqual([]);
  });

  // Một bảng kê một hoá đơn là trường hợp thường gặp; tổng lệch thường do một
  // file thuộc kỳ khác, nhưng chặn lại thì người dùng bế tắc mà không hiểu vì sao.
  it('một cặp nhưng tổng lệch thì vẫn ghép và báo để người dùng tự kiểm', () => {
    const r = ghepCapBangKeHoaDon([bk(1000, 'bk.xls')], [hd(2000, 'hd.xml')]);
    expect(r.cap).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/lệch/i);
  });

  it('nhiều file thì ghép theo tổng thanh toán trùng nhau', () => {
    const r = ghepCapBangKeHoaDon(
      [bk(100, 'a.xls'), bk(200, 'b.xls')],
      [hd(200, 'y.xml'), hd(100, 'x.xml')],
    );
    expect(r.cap.map((c) => [c.bangKe.ten, c.hoaDon?.ten])).toEqual([['a.xls', 'x.xml'], ['b.xls', 'y.xml']]);
  });

  it('bảng kê không có hoá đơn khớp thì để trống, không ghép bừa', () => {
    const r = ghepCapBangKeHoaDon([bk(100, 'a.xls'), bk(300, 'b.xls')], [hd(100, 'x.xml')]);
    expect(r.cap[0].hoaDon?.ten).toBe('x.xml');
    expect(r.cap[1].hoaDon).toBeNull();
  });

  it('hoá đơn không có bảng kê thì trả riêng để xử lý theo đường cũ', () => {
    const r = ghepCapBangKeHoaDon([], [hd(100, 'x.xml')]);
    expect(r.cap).toEqual([]);
    expect(r.hoaDonThua.map((h) => h.ten)).toEqual(['x.xml']);
  });

  it('không có file nào thì trả rỗng', () => {
    expect(ghepCapBangKeHoaDon([], [])).toEqual({ cap: [], hoaDonThua: [], warnings: [] });
  });
});
