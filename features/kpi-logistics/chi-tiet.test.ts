import { describe, it, expect } from 'vitest';
import { xepLoaiSla, demKetQuaSla, TEN_TIEU_CHI, CACH_DO, type DongSla } from './chi-tiet';

const kien = (soNgay: number, slaNgay: number, biLoaiTru = false): DongSla => ({
  maDon: null, tracking: null, nuoc: 'US', line: 'fedex', ngayGui: '2026-08-01', ngayGiao: '2026-08-06',
  soNgay, slaNgay, slaLineNgay: slaNgay, ketQua: xepLoaiSla(soNgay, slaNgay, biLoaiTru), lyDoCham: null,
});

describe('xepLoaiSla', () => {
  it('đúng hạn khi bằng hoặc dưới cam kết', () => {
    expect(xepLoaiSla(4, 5, false)).toBe('dat');
    expect(xepLoaiSla(5, 5, false)).toBe('dat');
  });
  it('quá cam kết nhưng chưa quá 20 ngày là trễ; quá 20 ngày tách riêng', () => {
    expect(xepLoaiSla(6, 5, false)).toBe('tre');
    expect(xepLoaiSla(20, 5, false)).toBe('tre');
    expect(xepLoaiSla(21, 5, false)).toBe('ngoai_le');
  });
  it('kiện có lý do ngoài tầm kiểm soát bị loại, kể cả khi đang đúng hạn', () => {
    expect(xepLoaiSla(3, 5, true)).toBe('loai_tru');
    expect(xepLoaiSla(30, 5, true)).toBe('loai_tru');
  });
});

describe('thước chấm điểm', () => {
  it('chấm theo cam kết của NƯỚC, không theo thước chặt hơn của hãng — nếu không report sẽ lệch bảng điểm', () => {
    // Nhật: nước cam kết 4 ngày, riêng DHL nội bộ đặt 3 ngày. Kiện giao 4 ngày là ĐẠT.
    const k = { ...kien(4, 4), slaLineNgay: 3 };
    expect(k.ketQua).toBe('dat');
    expect(k.slaLineNgay).toBeLessThan(k.slaNgay);
  });
});

describe('demKetQuaSla', () => {
  it('kiện bị loại KHÔNG vào mẫu số — đúng như cách chấm điểm', () => {
    const d = demKetQuaSla([kien(3, 5), kien(4, 5), kien(9, 5), kien(30, 5), kien(3, 5, true)]);
    expect(d).toMatchObject({ dat: 2, tre: 1, ngoai_le: 1, loai_tru: 1, tinhKpi: 4 });
    expect(d.tyLeDat).toBe(0.5);
  });
  it('không có kiện nào tính KPI → tỉ lệ null, không chia cho 0', () => {
    expect(demKetQuaSla([kien(3, 5, true)]).tyLeDat).toBeNull();
    expect(demKetQuaSla([]).tyLeDat).toBeNull();
  });
});

describe('nhãn tiêu chí', () => {
  it('đủ 4 tiêu chí Pillar 1 và tiêu chí nào cũng có câu giải thích cách đo', () => {
    for (const ma of ['1.1', '1.2', '1.3', '1.4'] as const) {
      expect(TEN_TIEU_CHI[ma]).toBeTruthy();
      expect(CACH_DO[ma].length).toBeGreaterThan(40);
    }
  });
});
