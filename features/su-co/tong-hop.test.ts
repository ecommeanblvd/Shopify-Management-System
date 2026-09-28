import { describe, it, expect } from 'vitest';
import {
  boPhanChiu, gomTheoBoPhan, gomTheoLoai, gomTheoNguyenNhan, tongTatCa,
  type DongChiPhi,
} from './tong-hop';

const d = (x: Partial<DongChiPhi> & { soTien: number }): DongChiPhi => ({
  suCoId: 'sc1', loai: 'hoan_bank', tienTe: 'USD',
  boPhan: null, boPhanChinh: 'PROCUREMENT', nguyenNhan: 'sold_out', ...x,
});

describe('boPhanChiu — quy tắc quy bộ phận viết một lần', () => {
  it('dòng tự khai thì theo dòng', () => {
    expect(boPhanChiu(d({ soTien: 10, boPhan: 'DISCO-WH' }))).toBe('DISCO-WH');
  });
  it('dòng không khai thì thừa hưởng bộ phận chính của sự cố', () => {
    expect(boPhanChiu(d({ soTien: 10 }))).toBe('PROCUREMENT');
  });
  it('cả hai đều trống thì null', () => {
    expect(boPhanChiu(d({ soTien: 10, boPhanChinh: null }))).toBeNull();
  });
});

describe('gomTheoBoPhan — KHÔNG cộng trùng như bảng Lark', () => {
  it('một sự cố hai bộ phận: tổng theo bộ phận BẰNG tổng thật', () => {
    // Đúng hình lỗi của Lark: cộng theo bộ phận ra 46.791 vs tổng thật 42.601.
    // Ở đây $500 do Procurement, $50 do Warehouse — mỗi đồng một chỗ.
    const dong = [
      d({ suCoId: 'sc1', loai: 'hoan_bank', soTien: 500, boPhan: 'PROCUREMENT' }),
      d({ suCoId: 'sc1', loai: 'phi_gui_lai', soTien: 50, boPhan: 'DISCO-WH' }),
    ];
    const nhom = gomTheoBoPhan(dong);
    const tongNhom = nhom.reduce((a, n) => a + (n.tong[0]?.tong ?? 0), 0);
    expect(tongNhom).toBe(550);
    expect(tongTatCa(dong)[0]).toEqual({ tienTe: 'USD', tong: 550, soCa: 2 });
    expect(nhom.map((n) => [n.khoa, n.tong[0]!.tong])).toEqual([
      ['PROCUREMENT', 500], ['DISCO-WH', 50],
    ]);
  });

  it('đếm SỐ SỰ CỐ khác nhau, không phải số dòng chi phí', () => {
    const nhom = gomTheoBoPhan([
      d({ suCoId: 'sc1', soTien: 100 }),
      d({ suCoId: 'sc1', soTien: 200, loai: 'thue' }),
      d({ suCoId: 'sc2', soTien: 300 }),
    ]);
    expect(nhom).toHaveLength(1);
    expect(nhom[0]!.soSuCo).toBe(2);
    expect(nhom[0]!.soDong).toBe(3);
  });

  it('GIỮ nhóm "(chưa ghi)" — 29/156 ca Lark không ghi bộ phận mà vẫn mang 8.523 tiền', () => {
    const nhom = gomTheoBoPhan([
      d({ suCoId: 'sc1', soTien: 100, boPhanChinh: null }),
      d({ suCoId: 'sc2', soTien: 400 }),
    ]);
    expect(nhom.map((n) => n.khoa).sort()).toEqual(['(chưa ghi)', 'PROCUREMENT']);
    expect(nhom.find((n) => n.khoa === '(chưa ghi)')!.tong[0]!.tong).toBe(100);
  });

  it('tách theo đơn vị tiền, không cộng USD với KRW', () => {
    const nhom = gomTheoBoPhan([
      d({ soTien: 100, tienTe: 'USD' }),
      d({ soTien: 279000, tienTe: 'KRW' }),
    ]);
    expect(nhom).toHaveLength(1);
    expect(nhom[0]!.tong).toEqual([
      { tienTe: 'KRW', tong: 279000, soCa: 1 },
      { tienTe: 'USD', tong: 100, soCa: 1 },
    ]);
  });

  it('rỗng trả rỗng', () => {
    expect(gomTheoBoPhan([])).toEqual([]);
    expect(tongTatCa([])).toEqual([]);
  });
});

describe('gomTheoLoai và gomTheoNguyenNhan', () => {
  it('gom theo loại chi phí, xếp tiền giảm dần', () => {
    const nhom = gomTheoLoai([
      d({ soTien: 50, loai: 'phi_pickup' }),
      d({ soTien: 900, loai: 'hoan_bank' }),
      d({ soTien: 100, loai: 'hoan_bank' }),
    ]);
    expect(nhom.map((n) => [n.khoa, n.tong[0]!.tong])).toEqual([
      ['hoan_bank', 1000], ['phi_pickup', 50],
    ]);
  });

  it('gom theo nguyên nhân', () => {
    const nhom = gomTheoNguyenNhan([
      d({ suCoId: 'a', soTien: 700, nguyenNhan: 'sold_out' }),
      d({ suCoId: 'b', soTien: 300, nguyenNhan: 'delayed_delivery' }),
    ]);
    expect(nhom.map((n) => n.khoa)).toEqual(['sold_out', 'delayed_delivery']);
  });
});
