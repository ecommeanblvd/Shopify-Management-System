import { describe, test, expect } from 'vitest';
import { locBox, daSuaDim } from './loc-box';
import { dimsDongThungTuCot } from './dong-thung';
import type { BoxHien } from './tron-box';

/** Box dựng tay cho test — chỉ điền những trường mà `locBox`/`daSuaDim` cần tới. */
function box(p: Partial<BoxHien> & Pick<BoxHien, 'ten' | 'ma' | 'loai' | 'kichThuoc'>): BoxHien {
  return { larkRecordIds: [], id: null, suaTay: false, an: false, lech: null, ...p };
}

const DS: BoxHien[] = [
  box({
    ten: 'Thùng Carton 5kg', ma: 'MEAN-CARTON-40x25x20-WH-1', loai: 'thung',
    kichThuoc: { daiCm: 40, rongCm: 25, caoCm: 20 },
  }),
  box({
    ten: 'Túi FedEx Nhỏ', ma: 'MEAN-FEDEX-28x42-WH-1', loai: 'tui',
    kichThuoc: { daiCm: 28, rongCm: 42, caoCm: null },
  }),
  // loai 'khac' — không bao giờ hiện trong lưới, kể cả khi tìm trúng tên.
  box({
    ten: 'Pallet Gỗ', ma: 'MEAN-PALLET-1', loai: 'khac',
    kichThuoc: { daiCm: 120, rongCm: 100, caoCm: 15 },
  }),
  // Box bị ẩn (`an = true`) — không hiện trong lưới mặc định.
  box({
    ten: 'Thùng Cũ Đã Ẩn', ma: 'MEAN-OLD-1', loai: 'thung',
    kichThuoc: { daiCm: 30, rongCm: 30, caoCm: 30 }, an: true,
  }),
];

describe('locBox', () => {
  test('tìm theo tên, bỏ dấu, không phân biệt hoa thường', () => {
    // `toContain` một chiều không chứng minh có LỌC: box còn lại trong danh sách không lọc
    // cũng "chứa" kết quả mong đợi. Phải khẳng định luôn box KHÔNG khớp từ khoá bị loại ra.
    const timFedex = locBox(DS, 'fedex').map((b) => b.ten);
    expect(timFedex).toContain('Túi FedEx Nhỏ');
    expect(timFedex).not.toContain('Thùng Carton 5kg');

    const timThung = locBox(DS, 'THUNG CARTON 5').map((b) => b.ten);
    expect(timThung).toContain('Thùng Carton 5kg');
    expect(timThung).not.toContain('Túi FedEx Nhỏ');
  });

  test('tìm theo số đo', () => {
    const r = locBox(DS, '40x25');
    // Độ dài CHÍNH XÁC (không chỉ `toContain`) — nếu `locBox` trả nguyên `hien` mà không lọc
    // gì cả, test kiểu `toContain` vẫn xanh vì box mong đợi vẫn nằm trong đó.
    expect(r).toHaveLength(1);
    expect(r[0].ten).toBe('Thùng Carton 5kg');
  });

  test('từ khoá rỗng → nguyên danh sách trừ box ẩn và box loai="khac"', () => {
    const r = locBox(DS, '');
    expect(r.map((b) => b.ten).sort()).toEqual(['Thùng Carton 5kg', 'Túi FedEx Nhỏ']);
  });

  test('box loai="khac" không hiện dù tìm trúng tên', () => {
    expect(locBox(DS, 'pallet')).toHaveLength(0);
  });

  test('box bị ẩn không hiện dù tìm trúng tên', () => {
    expect(locBox(DS, 'đã ẩn')).toHaveLength(0);
  });
});

describe('daSuaDim', () => {
  test('giống box → false; lệch một chiều → true', () => {
    expect(daSuaDim({ daiCm: 40, rongCm: 25, caoCm: 20 }, { dai: '40', rong: '25', cao: '20' })).toBe(false);
    expect(daSuaDim({ daiCm: 40, rongCm: 25, caoCm: 20 }, { dai: '41', rong: '25', cao: '20' })).toBe(true);
  });

  test('daSuaDim: box hai số, người điền ô Cao → true', () => {
    // Box túi (caoCm null): ô Cao đúng là phải để trống. Người gõ vào đó tức đã sửa tay.
    expect(daSuaDim({ daiCm: 28, rongCm: 42, caoCm: null }, { dai: '28', rong: '42', cao: '' })).toBe(false);
    expect(daSuaDim({ daiCm: 28, rongCm: 42, caoCm: null }, { dai: '28', rong: '42', cao: '5' })).toBe(true);
  });

  test('box=null (gõ tay, chưa chọn từ danh mục) → false', () => {
    expect(daSuaDim(null, { dai: '10', rong: '10', cao: '10' })).toBe(false);
  });
});

describe('vòng lặp lưu rồi mở lại kiện đóng bằng túi (round trip)', () => {
  test('lưu túi 28×42 (cao null) → mở lại còn đủ dài+rộng, ô Cao trống, KHÔNG báo "đã sửa"', () => {
    // `kiemNhapDongThung` lưu cao = null cho túi → ba cột DB sau khi lưu: '28', '42', null.
    const dims = dimsDongThungTuCot('28', '42', null);
    expect(dims).toEqual({ l: 28, w: 42, h: null });

    // KhoiDongThung điền lại ô khi mở lại dialog — `h ?? ''` để ô Cao TRỐNG, không phải 'null'.
    const dang = { dai: String(dims!.l), rong: String(dims!.w), cao: String(dims!.h ?? '') };
    expect(dang).toEqual({ dai: '28', rong: '42', cao: '' });

    // Box đã chọn khớp theo `ma` chính là túi này — so lại KHÔNG được báo "đã sửa" dù chưa ai
    // gõ gì, vì đây đúng là số của box đó (bug cũ: '' != 28 khiến daSuaDim báo sai 'true').
    const tuiDaChon = DS.find((b) => b.ten === 'Túi FedEx Nhỏ')!;
    expect(daSuaDim(tuiDaChon.kichThuoc, dang)).toBe(false);
  });
});
