import { describe, it, expect } from 'vitest';
import {
  GIOI_HAN, LOAI_VIEC, canLamNgay, coHanCung, soViec, thongTinLoai, xepViec,
  type Viec,
} from './uu-tien';

const v = (x: Partial<Viec> & { loai: string }): Viec => ({
  id: Math.random().toString(36).slice(2),
  nhan: 'việc', phu: null, conLai: null, tuLark: false, href: '/f/cx', ...x,
});

describe('LOAI_VIEC', () => {
  it('bảy loại, ưu tiên 1..7 không trùng', () => {
    expect(LOAI_VIEC).toHaveLength(7);
    expect(LOAI_VIEC.map((l) => l.uuTien)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(LOAI_VIEC.map((l) => l.ma)).size).toBe(7);
  });

  it('tranh chấp gấp nhất, ticket thường xếp cuối', () => {
    expect(thongTinLoai('tranh_chap')!.uuTien).toBe(1);
    expect(thongTinLoai('ticket')!.uuTien).toBe(7);
    expect(thongTinLoai('la')).toBeUndefined();
  });
});

describe('canLamNgay — tách tồn đọng, nhưng hạn cứng thắng', () => {
  it('việc phát sinh trên hệ thống luôn vào "cần làm ngay"', () => {
    expect(canLamNgay(v({ loai: 'ticket', tuLark: false }))).toBe(true);
  });

  it('việc nhập từ Lark KHÔNG có hạn thì vào tồn đọng', () => {
    expect(canLamNgay(v({ loai: 'su_co', tuLark: true, conLai: null }))).toBe(false);
  });

  it('việc nhập từ Lark CÓ hạn vẫn vào "cần làm ngay" — sắp mất tiền thật', () => {
    expect(canLamNgay(v({ loai: 'tranh_chap', tuLark: true, conLai: 3 }))).toBe(true);
  });

  it('hạn xa vẫn tính là hạn cứng — không dùng ngưỡng N ngày', () => {
    // Hồ sơ Lark hạn xa vẫn cần trong tầm mắt vì không ai đang theo nó.
    expect(coHanCung(v({ loai: 'tranh_chap', conLai: 90 }))).toBe(true);
    expect(canLamNgay(v({ loai: 'tranh_chap', tuLark: true, conLai: 90 }))).toBe(true);
  });

  it('quá hạn cũng là hạn cứng', () => {
    expect(coHanCung(v({ loai: 'tranh_chap', conLai: -5 }))).toBe(true);
  });
});

describe('soViec', () => {
  it('quá hạn trước, rồi hạn gần nhất', () => {
    const ds = [
      v({ loai: 'tranh_chap', conLai: 10 }),
      v({ loai: 'tranh_chap', conLai: -2 }),
      v({ loai: 'tranh_chap', conLai: 1 }),
    ].sort(soViec);
    expect(ds.map((x) => x.conLai)).toEqual([-2, 1, 10]);
  });

  it('việc KHÔNG có hạn xếp sau mọi việc có hạn, kể cả khi loại gấp hơn', () => {
    // Tranh chấp ưu tiên 1, sự cố ưu tiên 6 — nhưng sự cố có hạn thì lên trước.
    const ds = [
      v({ loai: 'tranh_chap', conLai: null }),
      v({ loai: 'su_co', conLai: 30 }),
    ].sort(soViec);
    expect(ds.map((x) => x.loai)).toEqual(['su_co', 'tranh_chap']);
  });

  it('cùng đều không hạn thì theo ưu tiên loại', () => {
    const ds = [
      v({ loai: 'ticket' }), v({ loai: 'su_co' }), v({ loai: 'danh_gia' }),
    ].sort(soViec);
    expect(ds.map((x) => x.loai)).toEqual(['danh_gia', 'su_co', 'ticket']);
  });
});

describe('xepViec', () => {
  it('chia đúng hai nhóm', () => {
    const r = xepViec([
      v({ loai: 'ticket', tuLark: false }),
      v({ loai: 'su_co', tuLark: true }),
      v({ loai: 'su_co', tuLark: true }),
    ]);
    expect(r.tongNgay).toBe(1);
    expect(r.tongTonDong).toBe(2);
    expect(r.ngay.map((k) => k.loai)).toEqual(['ticket']);
    expect(r.tonDong.map((k) => k.loai)).toEqual(['su_co']);
  });

  it('khối xếp theo ưu tiên loại', () => {
    const r = xepViec([
      v({ loai: 'ticket' }), v({ loai: 'tranh_chap' }), v({ loai: 'danh_gia' }),
    ]);
    expect(r.ngay.map((k) => k.loai)).toEqual(['tranh_chap', 'danh_gia', 'ticket']);
  });

  it('CẮT còn 5 việc nhưng `tong` vẫn là TỔNG THẬT', () => {
    // Đúng lỗi đã mắc ở màn sổ nhập 26/09: header báo 397 trong khi thật có 470.
    const r = xepViec(Array.from({ length: 12 }, () => v({ loai: 'su_co' })));
    expect(r.ngay[0]!.viec).toHaveLength(GIOI_HAN);
    expect(r.ngay[0]!.tong).toBe(12);
    expect(r.tongNgay).toBe(12);
  });

  it('trong mỗi khối, việc gấp nhất được giữ lại sau khi cắt', () => {
    const ds = [
      ...Array.from({ length: 8 }, () => v({ loai: 'tranh_chap', conLai: 50 })),
      v({ loai: 'tranh_chap', conLai: -1, nhan: 'quá hạn' }),
      v({ loai: 'tranh_chap', conLai: 2, nhan: 'gấp' }),
    ];
    const r = xepViec(ds);
    expect(r.ngay[0]!.viec[0]!.nhan).toBe('quá hạn');
    expect(r.ngay[0]!.viec[1]!.nhan).toBe('gấp');
    expect(r.ngay[0]!.tong).toBe(10);
  });

  it('BẤT BIẾN: tổng hai nhóm luôn bằng số việc đưa vào', () => {
    // Bất biến này là thứ bị vi phạm ngày 28/09 — không phải ở hàm thuần mà ở nơi
    // GỌI nó: `tong-quan.ts` lấy LIMIT 100 dòng sự cố rồi đưa vào đây, nên trang
    // báo 170 trong khi thật có 190. Hàm thuần đúng; dữ liệu vào bị cắt.
    const ds = [
      ...Array.from({ length: 37 }, () => v({ loai: 'su_co', tuLark: true })),
      ...Array.from({ length: 11 }, () => v({ loai: 'ticket', tuLark: false })),
      ...Array.from({ length: 5 }, () => v({ loai: 'tranh_chap', tuLark: true, conLai: 9 })),
    ];
    const r = xepViec(ds);
    expect(r.tongNgay + r.tongTonDong).toBe(ds.length);
    // Và tổng `tong` của mọi khối cũng bằng đúng ngần ấy, dù mỗi khối chỉ hiện 5.
    const tongKhoi = [...r.ngay, ...r.tonDong].reduce((a, k) => a + k.tong, 0);
    expect(tongKhoi).toBe(ds.length);
    expect([...r.ngay, ...r.tonDong].every((k) => k.viec.length <= GIOI_HAN)).toBe(true);
  });

  it('rỗng trả hai nhóm rỗng, không nổ', () => {
    const r = xepViec([]);
    expect(r).toEqual({ ngay: [], tonDong: [], tongNgay: 0, tongTonDong: 0 });
  });

  it('loại lạ không làm sập — xếp cuối', () => {
    const r = xepViec([v({ loai: 'loai_moi' }), v({ loai: 'tranh_chap' })]);
    expect(r.ngay.map((k) => k.loai)).toEqual(['tranh_chap', 'loai_moi']);
    expect(r.ngay[1]!.ten).toBe('loai_moi');
  });
});
