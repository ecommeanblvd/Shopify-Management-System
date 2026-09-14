import { describe, it, expect } from 'vitest';
import { xepLoaiSla, demKetQuaSla, chenhSauThuHoi, laCoVanDe, laSizeCoVanDe, xepChoCsv, TEN_TIEU_CHI, CACH_DO, type DongSla, type KetQuaSla } from './chi-tiet';

const kien = (soNgay: number, slaNgay: number, biLoaiTru = false): DongSla => ({
  shipmentId: 'x', nguon: 'shopify', thuocVe: 'MEAN BLVD', maDon: null, tracking: null, nuoc: 'US', line: 'fedex', ngayGui: '2026-08-01', ngayGiao: '2026-08-06',
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

describe('chenhSauThuHoi', () => {
  it('trừ tiền carrier đã trả lại rồi mới so với cước thu khách', () => {
    // #MBLVD29751: bill 11.268.313đ, đã đòi lại 9.419.518đ, khách trả 2.000.000đ.
    expect(chenhSauThuHoi(11_268_313, 9_419_518, 2_000_000)).toEqual({
      carrierRongVnd: 1_848_795, chenhVnd: -151_205, conAm: false,
    });
  });
  it('chưa thu hồi được gì thì giữ nguyên số gốc', () => {
    expect(chenhSauThuHoi(3_000_000, 0, 1_000_000)).toEqual({ carrierRongVnd: 3_000_000, chenhVnd: 2_000_000, conAm: true });
  });
  it('thu hồi một phần, vẫn còn âm', () => {
    expect(chenhSauThuHoi(5_000_000, 1_000_000, 2_000_000)).toMatchObject({ carrierRongVnd: 4_000_000, chenhVnd: 2_000_000, conAm: true });
  });
  it('hoà đúng bằng 0 KHÔNG tính là còn âm', () => {
    expect(chenhSauThuHoi(3_000_000, 1_000_000, 2_000_000).conAm).toBe(false);
  });
});

describe('kiện CHƯA GIAO tại thời điểm chấm (CEO 13/09/2026)', () => {
  it('chưa giao mà còn trong cam kết → chưa tới hạn, đứng ngoài mẫu số', () => {
    expect(xepLoaiSla(3, 5, false, undefined, true)).toBe('chua_den_han');
    expect(xepLoaiSla(5, 5, false, undefined, true)).toBe('chua_den_han');
  });

  it('chưa giao mà ĐÃ quá cam kết → trễ chắc chắn, không chờ nó tới mới chấm', () => {
    expect(xepLoaiSla(6, 5, false, undefined, true)).toBe('tre');
    expect(xepLoaiSla(25, 5, false, undefined, true)).toBe('ngoai_le');
  });

  it('đã giao thì giữ nguyên cách chấm cũ', () => {
    expect(xepLoaiSla(5, 5, false, undefined, false)).toBe('dat');
    expect(xepLoaiSla(6, 5, false, undefined, false)).toBe('tre');
  });

  it('kiện bị loại trừ vẫn loại, bất kể đã giao hay chưa', () => {
    expect(xepLoaiSla(30, 5, true, undefined, true)).toBe('loai_tru');
  });

  it('chưa tới hạn KHÔNG vào mẫu số nên không kéo tỉ lệ xuống', () => {
    const k = (soNgay: number, chuaGiao: boolean) => ({
      shipmentId: null, nguon: 'ship_ho' as const, thuocVe: 'Ship hộ · kalisa',
      maDon: null, tracking: null, nuoc: 'US', line: 'fedex',
      ngayGui: '2026-09-01', ngayGiao: '', soNgay, slaNgay: 5, slaLineNgay: 5,
      ketQua: xepLoaiSla(soNgay, 5, false, undefined, chuaGiao), lyDoCham: null, chuaGiao,
    });
    const d = demKetQuaSla([k(4, false), k(3, true), k(9, true)]);
    expect(d.dat).toBe(1);
    expect(d.chua_den_han).toBe(1);
    expect(d.tre).toBe(1);
    expect(d.tinhKpi).toBe(2);      // kiện chưa tới hạn đứng ngoài
    expect(d.tyLeDat).toBe(0.5);
  });
});

describe('lọc hiển thị và thứ tự CSV (CEO 14/09/2026)', () => {
  it('kiện đạt và kiện chưa tới hạn KHÔNG phải việc phải xử lý', () => {
    expect(laCoVanDe('dat')).toBe(false);
    expect(laCoVanDe('chua_den_han')).toBe(false);
  });

  it('trễ, trễ nặng và loại trừ đều cần người soi', () => {
    expect(laCoVanDe('tre')).toBe(true);
    expect(laCoVanDe('ngoai_le')).toBe(true);
    expect(laCoVanDe('loai_tru')).toBe(true);
  });

  it('CSV xếp đơn đạt lên đầu, trong nhóm thì kiện lâu ngày nhất trước', () => {
    const k = (ketQua: KetQuaSla, soNgay: number): DongSla => ({
      shipmentId: null, nguon: 'ship_ho', thuocVe: 'x', maDon: String(soNgay), tracking: null,
      nuoc: 'US', line: 'fedex', ngayGui: '2026-09-01', ngayGiao: '', soNgay,
      slaNgay: 5, slaLineNgay: 5, ketQua, lyDoCham: null,
    });
    const r = xepChoCsv([k('ngoai_le', 30), k('dat', 3), k('tre', 9), k('dat', 4), k('chua_den_han', 2)]);
    expect(r.map((x) => x.ketQua)).toEqual(['dat', 'dat', 'chua_den_han', 'tre', 'ngoai_le']);
    expect(r.slice(0, 2).map((x) => x.soNgay)).toEqual([4, 3]);
  });

  it('1.4: chỉ kiện KHÔNG đúng size mới phải soi', () => {
    expect(laSizeCoVanDe('dung')).toBe(false);
    expect(laSizeCoVanDe('sai_thung')).toBe(true);
    expect(laSizeCoVanDe('thieu_du_lieu')).toBe(true);
  });
});
