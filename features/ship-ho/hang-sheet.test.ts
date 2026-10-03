import { describe, it, expect } from 'vitest';
import { COT_SHEET, hangSheet, type DonSheet } from './hang-sheet';
import { tenTabKy } from './day-sheet';

/* Số THẬT của đơn 26-INSLG-SV-0007 (kalisakol85) đọc từ bảng đối soát ngày 03/10/2026. */
const don: DonSheet = {
  stt: 1, maBrand: 'kalisakol85', tracking: '873918787369', hang: 'FEDEX',
  ngayDi: '2026-07-06', canKg: 2, nuoc: 'US',
  cuoc: 996_240, pctFuel: 38.25, fuel: 448_803, kyNhan: 92_700, nhuCau: 0, vungXa: 0,
  nhaDan: 84_400, xuLyNhap: 68_300, suaDiaChi: 0, phuPhiKhac: 0, vat: 139_235,
  xuLyDon: 50_000, tongThu: 1_879_678, maSms: '26-INSLG-SV-0007',
};

describe('hangSheet', () => {
  it('đúng thứ tự 21 cột của sheet đối soát', () => {
    expect(COT_SHEET).toHaveLength(21);
    expect(COT_SHEET[0]).toBe('STT');
    expect(COT_SHEET[13]).toBe('Phí Giao nhà dân');
    expect(COT_SHEET[20]).toBe('Mã SMS');
  });

  /* Tiền trên sheet là CHUỖI "996.240 đ" chứ không phải số — đo trực tiếp ô thật. Ghi số vào
     là mất hậu tố và lệch định dạng cả cột. */
  it('tiền là chuỗi có hậu tố đ, phần trăm dùng dấu phẩy', () => {
    const h = hangSheet([don])[0];
    expect(h[7]).toBe('996.240 đ');
    expect(h[8]).toBe('38,25%');
    expect(h[13]).toBe('84.400 đ');
  });

  /* Ngày là SỐ serial để Google hiểu là ngày thật — ghi chuỗi thì cột mất khả năng sắp xếp,
     và locale đọc sai thứ tự ngày/tháng (sheet từng lưu 03/07 thành 7 tháng 3). */
  it('ngày là số serial, không phải chuỗi', () => {
    expect(hangSheet([don])[0][4]).toBe(46209);
  });

  it('không có ngày thì để trống, KHÔNG ghi số 0 (Google hiện ra 30/12/1899)', () => {
    expect(hangSheet([{ ...don, ngayDi: null }])[0][4]).toBe('');
  });

  it('nhiều đơn thì giữ nguyên thứ tự truyền vào', () => {
    const r = hangSheet([don, { ...don, stt: 2, maSms: 'X' }]);
    expect(r.map((h) => h[20])).toEqual(['26-INSLG-SV-0007', 'X']);
  });
});

describe('tenTabKy', () => {
  /* Nếp sheet Kalisa đang dùng: "7.26", "8.26" — tháng không có số 0 ở đầu, năm 2 chữ số. */
  it('đúng nếp tab của sheet đang dùng', () => {
    expect(tenTabKy('2026-07-01')).toBe('7.26');
    expect(tenTabKy('2026-10-01')).toBe('10.26');
    expect(tenTabKy('2026-09-01T00:00:00.000Z')).toBe('9.26');
  });
});
