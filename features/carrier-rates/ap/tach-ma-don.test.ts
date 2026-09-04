import { describe, it, expect } from 'vitest';
import { tachMaDon, laHangHoan, chiaTheoCan, hopLyTheoNgay } from './tach-ma-don';

describe('tachMaDon — các kiểu ghi gặp THẬT trên hoá đơn', () => {
  it('gộp hai đơn, có khoảng trắng quanh dấu cộng', () => {
    expect(tachMaDon('TA2300 + TA2301')).toEqual(['TA2300', 'TA2301']);
  });
  it('gộp hai đơn, không khoảng trắng', () => {
    expect(tachMaDon('#MBLVD24249+#MBLVD24250')).toEqual(['MBLVD24249', 'MBLVD24250']);
  });
  it('mã thứ hai trong ngoặc', () => {
    expect(tachMaDon('24-INSLG-0274 (24-INSLG-0278)')).toEqual(['24-INSLG-0274', '24-INSLG-0278']);
  });
  it('"(1)" là SỐ THỨ TỰ KIỆN, không phải mã đơn', () => {
    expect(tachMaDon('#MBLVD28958 (1)')).toEqual(['MBLVD28958']);
    expect(tachMaDon('#MBLVD25289 (02)')).toEqual(['MBLVD25289']);
  });
  it('mã kèm ghi chú', () => {
    expect(tachMaDon('#MBLVD26931 Complete')).toEqual(['MBLVD26931']);
  });
  it('SỐ TRẦN không phải mã đơn — nếu không mọi dòng hoàn sẽ bị gán nhầm', () => {
    expect(tachMaDon('RETURN OF 872181045003')).toEqual([]);
    expect(tachMaDon('889682799718 RTS')).toEqual([]);
  });
  it('chuỗi rác → rỗng', () => {
    expect(tachMaDon('KSA   UAE MR.')).toEqual([]);
    expect(tachMaDon('')).toEqual([]);
    expect(tachMaDon(null)).toEqual([]);
  });
  it('không lặp mã trùng', () => {
    expect(tachMaDon('TA2300 + TA2300')).toEqual(['TA2300']);
  });
});

describe('laHangHoan', () => {
  it('nhận diện các kiểu ghi hàng hoàn', () => {
    for (const s of ['RETURN OF 872181045003', '#MBLVD26656 - Return', 'MBLVD26934 - RETURN',
                     '#MBLVD28712_ R', 'RTS AWB 886913729798', '#MBLVD27105 - R'])
      expect(laHangHoan(s), s).toBe(true);
  });
  it('đơn thường không bị nhận nhầm', () => {
    for (const s of ['TA2300 + TA2301', '#MBLVD28958 (1)', '#MBLVD26931 Complete'])
      expect(laHangHoan(s), s).toBe(false);
  });
});

describe('chiaTheoCan', () => {
  it('chia theo tỉ lệ cân', () => {
    const r = chiaTheoCan(1_000_000, [{ so: 'A', kg: 1 }, { so: 'B', kg: 3 }]);
    expect(r.map((x) => x.tien)).toEqual([250_000, 750_000]);
  });

  it('ca THẬT TA2300 (0,6kg) + TA2301 (0,9kg) trên 1.462.228₫', () => {
    const r = chiaTheoCan(1_462_228, [{ so: 'TA2300', kg: 0.6 }, { so: 'TA2301', kg: 0.9 }]);
    expect(r[0].tien).toBe(584_891);
    expect(r[1].tien).toBe(877_337);
    expect(r[0].tien + r[1].tien).toBe(1_462_228);
  });

  it('TỔNG các phần luôn bằng đúng số tiền gốc, kể cả khi lẻ', () => {
    for (const tong of [1_000_001, 999_999, 7, 1_462_228]) {
      const r = chiaTheoCan(tong, [{ so: 'A', kg: 1 }, { so: 'B', kg: 3 }, { so: 'C', kg: 5 }]);
      expect(r.reduce((s, x) => s + x.tien, 0), `tổng ${tong}`).toBe(Math.round(tong));
    }
  });

  it('thiếu cân → chia ĐỀU và bật cờ cảnh báo, KHÔNG đoán cân', () => {
    const r = chiaTheoCan(900_000, [{ so: 'A', kg: 1 }, { so: 'B', kg: null }]);
    expect(r.map((x) => x.tien)).toEqual([450_000, 450_000]);
    expect(r.every((x) => x.chiaDeuVìThieuCan)).toBe(true);
  });

  it('cân bằng 0 cũng coi là thiếu', () => {
    expect(chiaTheoCan(100, [{ so: 'A', kg: 0 }, { so: 'B', kg: 2 }])[0].chiaDeuVìThieuCan).toBe(true);
  });

  it('một đơn → nhận trọn, không cờ', () => {
    const r = chiaTheoCan(1_462_228, [{ so: 'A', kg: 0.6 }]);
    expect(r).toEqual([{ so: 'A', tien: 1_462_228, chiaDeuVìThieuCan: false }]);
  });

  it('không đơn nào → rỗng', () => {
    expect(chiaTheoCan(100, [])).toEqual([]);
  });
});

describe('hopLyTheoNgay — chặn khớp nhầm do mã bị cắt cụt', () => {
  const bill = new Date('2026-07-14');
  it('đơn đặt gần ngày gửi → hợp lệ', () => {
    expect(hopLyTheoNgay(new Date('2026-06-25'), bill)).toBe(true);
  });
  it('ca THẬT: đơn 2021 trên hoá đơn 2026 → CHẶN', () => {
    expect(hopLyTheoNgay(new Date('2021-05-14'), bill)).toBe(false);
  });
  it('đơn đặt sau ngày gửi quá xa → chặn', () => {
    expect(hopLyTheoNgay(new Date('2026-09-01'), bill)).toBe(false);
  });
  it('đơn đặt sau ngày gửi vài ngày vẫn chấp nhận (bill ghi ngày lệch)', () => {
    expect(hopLyTheoNgay(new Date('2026-07-20'), bill)).toBe(true);
  });
  it('thiếu ngày → KHÔNG gán, thà bỏ sót còn hơn gán sai', () => {
    expect(hopLyTheoNgay(null, bill)).toBe(false);
    expect(hopLyTheoNgay(new Date('2026-06-25'), null)).toBe(false);
  });
});
