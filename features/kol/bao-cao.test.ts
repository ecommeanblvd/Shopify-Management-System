import { describe, it, expect } from 'vitest';
import { gomTheoThang, gomTheoNguoiNhan, quyVeVnd } from './bao-cao';
import type { DongDon } from './types';

const base: DongDon = {
  id: 'x', sku: 'A-1', tenHang: null, kho: 'GVM', soLuong: 1, hinhThuc: 'tang',
  hanTra: null, giaVon: '100', giaVonTienTe: 'VND', soLuongDaTra: 0, soLuongNhapLai: 0,
};

describe('gomTheoThang', () => {
  it('gom theo tháng của ngày gửi, sắp xếp tháng mới nhất trước', () => {
    const r = gomTheoThang([
      { ...base, guiLuc: '2026-09-10T00:00:00Z', soLuong: 2 },
      { ...base, guiLuc: '2026-08-05T00:00:00Z', soLuong: 1 },
      { ...base, guiLuc: '2026-09-20T00:00:00Z', soLuong: 3 },
    ]);
    expect(r.map((x) => x.khoa)).toEqual(['2026-09', '2026-08']);
    expect(r[0].theoTienTe).toEqual({ VND: 500 });
    expect(r[1].theoTienTe).toEqual({ VND: 100 });
  });
  it('dòng chưa gửi gom vào khoá "chua_gui", KHÔNG bị bỏ im lặng', () => {
    const r = gomTheoThang([{ ...base, guiLuc: null }]);
    expect(r.map((x) => x.khoa)).toEqual(['chua_gui']);
  });
});

describe('gomTheoNguoiNhan', () => {
  it('cộng dồn theo tên và đếm riêng dòng thiếu giá vốn', () => {
    const r = gomTheoNguoiNhan([
      { ...base, tenNhan: 'Mai', soLuong: 2 },
      { ...base, tenNhan: 'Mai', giaVon: null },
      { ...base, tenNhan: 'Lan', soLuong: 1 },
    ]);
    const mai = r.find((x) => x.khoa === 'Mai')!;
    expect(mai.theoTienTe).toEqual({ VND: 200 });
    expect(mai.soDongThieuGiaVon).toBe(1);
    expect(r.find((x) => x.khoa === 'Lan')!.theoTienTe).toEqual({ VND: 100 });
  });
});

describe('quyVeVnd', () => {
  const rates = [{ from: 'USD', to: 'VND', period: '2026-09', rate: 25000 }];
  it('VND giữ nguyên, không cần tỷ giá', () => {
    expect(quyVeVnd({ VND: 500 }, '2026-09', [])).toEqual({ vnd: 500, khongDoiDuoc: [] });
  });
  it('USD quy đổi theo tỷ giá đúng tháng', () => {
    expect(quyVeVnd({ VND: 500, USD: 4 }, '2026-09', rates)).toEqual({ vnd: 100500, khongDoiDuoc: [] });
  });
  it('thiếu tỷ giá thì KHÔNG cộng bừa, mà kê tên loại tiền không đổi được', () => {
    const r = quyVeVnd({ VND: 500, USD: 4 }, '2026-10', rates);
    expect(r.vnd).toBe(500);
    expect(r.khongDoiDuoc).toEqual(['USD']);
  });
});
