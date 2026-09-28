import { describe, it, expect } from 'vitest';
import { LO_TOI_DA, capDaiTuDiem, capDaiTuHaiDanhSach, chiaLo } from './cap-dai';

describe('capDaiTuDiem — giữ đúng quan hệ nước ↔ mã bưu chính', () => {
  it('KHÔNG ghép tích Descartes giữa các nước', () => {
    // Hai điểm đến: VN-70000 và DE-10115. Ghép đúng phải ra tiền tố của 70000
    // CHỈ cho VN, và của 10115 CHỈ cho DE — không có VN|10115 hay DE|70000.
    const r = capDaiTuDiem([
      { country: 'VN', postcode: '70000' },
      { country: 'DE', postcode: '10115' },
    ]);
    expect(r.every((x) => (x.cc === 'VN' ? '70000'.startsWith(x.khoa) : '10115'.startsWith(x.khoa)))).toBe(true);
    expect(r.some((x) => x.cc === 'VN' && '10115'.startsWith(x.khoa) && !'70000'.startsWith(x.khoa))).toBe(false);
    // 5 tiền tố mỗi mã, hai nước → 10, chứ không phải 2 × 10 = 20.
    expect(r).toHaveLength(10);
  });

  it('gộp trùng: cùng nước cùng mã xuất hiện nhiều lần chỉ tính một', () => {
    const r = capDaiTuDiem([
      { country: 'VN', postcode: '70000' },
      { country: 'vn', postcode: '70000' },
      { country: ' VN ', postcode: '70000' },
    ]);
    expect(r).toHaveLength(5);
    expect(r.every((x) => x.cc === 'VN')).toBe(true);
  });

  it('bỏ điểm thiếu nước, thiếu mã, hoặc mã nước không hợp lệ', () => {
    expect(capDaiTuDiem([{ country: null, postcode: '70000' }])).toEqual([]);
    expect(capDaiTuDiem([{ country: 'VN', postcode: null }])).toEqual([]);
    expect(capDaiTuDiem([{ country: 'VNM', postcode: '70000' }])).toEqual([]);
    expect(capDaiTuDiem([{ country: '', postcode: '' }])).toEqual([]);
    expect(capDaiTuDiem([])).toEqual([]);
  });

  it('mã ZIP+4 sinh tiền tố theo từng bề rộng', () => {
    const r = capDaiTuDiem([{ country: 'US', postcode: '98077-5629' }]);
    expect(r.map((x) => x.khoa)).toContain('9');
    expect(r.map((x) => x.khoa)).toContain('98077');
    expect(r.every((x) => x.cc === 'US')).toBe(true);
  });
});

describe('capDaiTuHaiDanhSach — đường tương thích, VẪN là tích Descartes', () => {
  it('một nước một mã thì bằng hệt đường đúng', () => {
    expect(capDaiTuHaiDanhSach(['VN'], ['70000']))
      .toEqual(capDaiTuDiem([{ country: 'VN', postcode: '70000' }]));
  });

  it('hai nước hai mã thì NỞ ra gấp đôi — đây chính là lý do luồng hàng loạt không được dùng nó', () => {
    const cheo = capDaiTuHaiDanhSach(['VN', 'DE'], ['70000', '10115']);
    const dung = capDaiTuDiem([
      { country: 'VN', postcode: '70000' },
      { country: 'DE', postcode: '10115' },
    ]);
    expect(cheo).toHaveLength(20);
    expect(dung).toHaveLength(10);
  });
});

describe('chiaLo — trần tham số Postgres không bao giờ chạm tới', () => {
  it('chia đúng cỡ lô, lô cuối là phần dư', () => {
    expect(chiaLo([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('ít hơn một lô thì một lô duy nhất', () => {
    expect(chiaLo([1, 2], 8000)).toEqual([[1, 2]]);
  });

  it('rỗng trả rỗng — nơi gọi không phải chạy truy vấn nào', () => {
    expect(chiaLo([])).toEqual([]);
  });

  it('cỡ lô mặc định giữ tham số dưới trần 65.535 (3 tham số mỗi cặp)', () => {
    expect(LO_TOI_DA * 3).toBeLessThan(65535);
  });

  it('510.492 cặp của lỗi thật chia thành nhiều lô, không lô nào vượt trần', () => {
    const lo = chiaLo(Array.from({ length: 510492 }, (_, i) => i));
    expect(lo.length).toBe(Math.ceil(510492 / LO_TOI_DA));
    expect(lo.every((x) => x.length * 3 < 65535)).toBe(true);
  });

  it('cỡ lô không hợp lệ thì ném lỗi chứ không lặp vô hạn', () => {
    expect(() => chiaLo([1, 2], 0)).toThrow();
  });
});
