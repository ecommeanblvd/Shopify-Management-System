import { describe, it, expect } from 'vitest';
import { COT_SHEET, hangSheet, COT_SHEET_DUTY, hangSheetDuty, type DonSheet } from './hang-sheet';
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
    expect(tenTabKy('2026-07-01', 'freight')).toBe('7.26');
    expect(tenTabKy('2026-10-01', 'freight')).toBe('10.26');
    expect(tenTabKy('2026-09-01T00:00:00.000Z', 'freight')).toBe('9.26');
  });

  /* Một brand có thể có CẢ bảng kê cước lẫn bảng kê thuế trong CÙNG MỘT KỲ — lekieu và
     tom-fried đều vậy ở kỳ 09. Thiếu hậu tố là bảng này xoá tab của bảng kia. */
  it('bảng kê thuế đi tab riêng, đúng nếp "8.26 Duty" của sheet Kalisa', () => {
    expect(tenTabKy('2026-09-01', 'duty')).toBe('9.26 Duty');
    expect(tenTabKy('2026-08-01', 'duty')).toBe('8.26 Duty');
  });

  it('hai loại cùng kỳ KHÔNG bao giờ trùng tên tab', () => {
    expect(tenTabKy('2026-09-01', 'freight')).not.toBe(tenTabKy('2026-09-01', 'duty'));
  });
});

describe('hangSheetDuty', () => {
  /* Bố cục 8 cột đọc từ chính tab "8.26 Duty" của sheet Kalisa — ít cột hơn hẳn bảng cước vì
     thuế là khoản THU HỘ nguyên giá: không markup, không nhiên liệu, không VAT. */
  const d = {
    stt: 1, maBrand: '#KLS1992', tracking: '873969176425', ngayDi: '2026-07-06', nuoc: 'SA',
    soHoaDon: '736058090', duty: 325_901, maSms: '26-INSLG-SV-0001',
  };
  it('đúng 8 cột, đúng thứ tự', () => {
    expect(COT_SHEET_DUTY).toHaveLength(8);
    expect(COT_SHEET_DUTY[5]).toBe('Số hoá đơn FedEx');
    expect(COT_SHEET_DUTY[6]).toBe('Duty/Tax (Nước tới)');
  });
  it('tiền có hậu tố đ, ngày là số serial', () => {
    const h = hangSheetDuty([d])[0];
    expect(h[3]).toBe(46209);
    expect(h[6]).toBe('325.901 đ');
    expect(h[7]).toBe('26-INSLG-SV-0001');
  });
  it('nhiều hoá đơn cho một đơn thì nối lại, không bỏ bớt', () => {
    expect(hangSheetDuty([{ ...d, soHoaDon: '734110283 + 736056768' }])[0][5]).toBe('734110283 + 736056768');
  });
});
