import { describe, expect, it } from 'vitest';
import {
  COT_SHEET, COT_SHEET_DUTY, COT_TIEN, COT_TIEN_DUTY, chuCot, dongTong, hangSheet,
} from './hang-sheet';

const don = {
  stt: 1, maBrand: '#KLS2053', tracking: '876408903973', hang: 'FEDEX',
  ngayDi: '2026-09-03', canKg: 3.5, nuoc: 'US',
  cuoc: 1_311_096, pctFuel: 47.75, fuel: 709_563, kyNhan: 92_700, nhuCau: 0,
  vungXa: 82_200, nhaDan: 0, xuLyNhap: 68_300, suaDiaChi: 0, phuPhiKhac: 0,
  vat: 185_109, xuLyDon: 50_000, tongThu: 2_498_968, maSms: '26-INSLG-SV-0126',
};

describe('hangSheet — tiền là SỐ', () => {
  /* CEO 08/10/2026: "để số number thôi... để có thể tính toán được". Bản đầu ghi chuỗi
     "996.240 đ" nên brand không cộng được cột nào. */
  it('ô tiền ghi số, không ghi chuỗi có đuôi đ', () => {
    const h = hangSheet([don])[0]!;
    for (const c of COT_TIEN) expect(typeof h[c]).toBe('number');
    expect(h[19]).toBe(2_498_968);
  });

  /* Mã tracking PHẢI là chuỗi: chuỗi số 12 ký tự mà thành số thì Sheets hiện dạng khoa học
     (8,76409E+11) và mất khả năng tra cứu. */
  it('mã tracking giữ kiểu chuỗi', () => {
    expect(typeof hangSheet([don])[0]![2]).toBe('string');
  });

  it('phần trăm vẫn là chuỗi có dấu %', () => {
    expect(hangSheet([don])[0]![8]).toBe('47,75%');
  });
});

describe('COT_TIEN trỏ đúng cột tiền', () => {
  /* Hàng rào: đổi thứ tự cột mà quên sửa chỉ số thì định dạng tiền và dòng TỔNG rơi nhầm ô. */
  const KHONG_PHAI_TIEN = ['STT', 'Mã đơn', 'Mã tracking', 'Couriers', 'Ngày gửi',
    'Cân nặng tính cước', 'Quốc gia', '% PP Nhiên liệu', 'Mã SMS', 'Số hoá đơn FedEx'];
  it('mọi chỉ số trong COT_TIEN đều là cột tiền của bảng cước', () => {
    for (const c of COT_TIEN) expect(KHONG_PHAI_TIEN).not.toContain(COT_SHEET[c]);
    expect(COT_SHEET[19]).toBe('Tổng thu');
  });
  it('bảng thuế chỉ có một cột tiền', () => {
    expect(COT_TIEN_DUTY.map((c) => COT_SHEET_DUTY[c])).toEqual(['Duty/Tax (Nước tới)']);
  });
});

describe('chuCot', () => {
  it('đổi chỉ số sang chữ cột A1', () => {
    expect([0, 7, 19, 25, 26, 27].map(chuCot)).toEqual(['A', 'H', 'T', 'Z', 'AA', 'AB']);
  });
});

describe('dongTong', () => {
  it('ô tiền là công thức SUM trên đúng dải dữ liệu', () => {
    const t = dongTong(COT_SHEET.length, COT_TIEN, 74);
    expect(t[0]).toBe('TỔNG');
    expect(t[7]).toBe('=SUM(H2:H75)');
    expect(t[19]).toBe('=SUM(T2:T75)');
  });

  /* Công thức chứ không phải số tính sẵn: brand lọc/sửa một dòng thì tổng phải đổi theo. */
  it('không ô nào là số tính sẵn', () => {
    for (const v of dongTong(COT_SHEET.length, COT_TIEN, 10)) {
      if (v !== '' && v !== 'TỔNG') expect(String(v).startsWith('=SUM(')).toBe(true);
    }
  });

  it('cột không phải tiền thì để trống', () => {
    const t = dongTong(COT_SHEET.length, COT_TIEN, 5);
    expect(t[2]).toBe('');
    expect(t[8]).toBe('');
    expect(t[20]).toBe('');
  });

  /* Bảng rỗng: không dựng SUM trên dải A2:A1 — công thức đó trả lỗi trên sheet. */
  it('không có dòng dữ liệu nào thì không sinh công thức', () => {
    expect(dongTong(COT_SHEET.length, COT_TIEN, 0).every((v) => v === '' || v === 'TỔNG')).toBe(true);
  });
});
