import { describe, it, expect } from 'vitest';
import { kiemCongChotKy, hangCoNguonTra, type DonKiemCong } from './cong-chot-ky';
import type { TuanFuel } from './tuan-fuel';

const TUAN: TuanFuel[] = [
  { tu: '2026-07-06', den: '2026-07-13', pct: 38.25 },
  { tu: '2026-07-20', den: '2026-07-27', pct: 39.75 },
];
const don = (o: Partial<DonKiemCong>): DonKiemCong => ({
  code: 'X', tenHang: 'FedEx Vietnam — International Priority (IP) 2026',
  pickedUpAt: new Date(2026, 6, 6), shippedAt: '2026-07-06', bill: null, ...o,
});
/* Hoá đơn THẬT của AWB 873918787369: fuel 420.576 trên gốc 1.099.544 = 38,25%. */
const BILL_DUNG = { base: 3_058_500, discount: -2_136_056, remote: 0, demand: 0,
  signature: 92_700, residential: 84_400, addressCorrection: 0, fuel: 420_576 };

describe('hangCoNguonTra', () => {
  it('FedEx/UPS/DHL có nguồn, Aramex thì không', () => {
    expect(hangCoNguonTra('FedEx Vietnam — International Priority (IP) 2026')).toBe(true);
    expect(hangCoNguonTra('UPS Worldwide Expedited')).toBe(true);
    expect(hangCoNguonTra('DHL Express Vietnam — Worldwide Export 2026')).toBe(true);
    expect(hangCoNguonTra('Aramex HN (Hợp Nhất)')).toBe(false);
  });
  /* Không biết hãng thì KHÔNG được coi là "không có nguồn" rồi cho qua — 2 đơn trong dữ liệu
     thật thiếu `carrier_account_id`. Coi như có nguồn để cổng chặn và người đi xem lại. */
  it('không biết hãng thì coi như CÓ nguồn — để cổng chặn', () => {
    expect(hangCoNguonTra(null)).toBe(true);
  });
});

describe('kiemCongChotKy', () => {
  it('đơn đủ điều kiện thì không có lỗi nào', () => {
    expect(kiemCongChotKy([don({ bill: BILL_DUNG })], TUAN)).toEqual([]);
  });

  it('hãng có nguồn tra mà thiếu ngày hãng → chặn', () => {
    const r = kiemCongChotKy([don({ code: 'A1', pickedUpAt: null, bill: BILL_DUNG })], TUAN);
    expect(r).toHaveLength(1);
    expect(r[0].ma).toBe('thieu_ngay_di');
    expect(r[0].code).toBe('A1');
  });

  /* Aramex không có API — ngoại lệ ĐƯỢC KHAI BÁO, dùng ngày Lark, không bị chặn. */
  it('Aramex thiếu ngày hãng thì KHÔNG chặn', () => {
    expect(kiemCongChotKy([don({ tenHang: 'Aramex HN (Hợp Nhất)', pickedUpAt: null, bill: null })], TUAN)).toEqual([]);
  });

  /* Đúng lỗi của #KLS1998: tuần của ngày đi là 39,75% nhưng bill ra 38,25%. */
  it('%fuel không khớp tuần của ngày đi → chặn', () => {
    const r = kiemCongChotKy([don({
      code: 'A2', pickedUpAt: new Date(2026, 6, 20), shippedAt: '2026-07-20', bill: BILL_DUNG,
    })], TUAN);
    expect(r).toHaveLength(1);
    expect(r[0].ma).toBe('fuel_lech_tuan');
    expect(r[0].ly).toContain('39,75');
    expect(r[0].ly).toContain('38,25');
  });

  /* 52,65% — con số đã lọt ra bảng gửi brand ngày 02/10. Không mức nào của hãng là 52,65%. */
  it('%fuel ngoài lưới 0,25% → chặn', () => {
    const r = kiemCongChotKy([don({
      code: 'A3', bill: { ...BILL_DUNG, fuel: 579_000 },
    })], TUAN);
    expect(r).toHaveLength(1);
    expect(r[0].ma).toBe('fuel_ngoai_luoi');
  });

  it('đơn chưa có hoá đơn thì bỏ qua hai phép kiểm fuel', () => {
    expect(kiemCongChotKy([don({ bill: null })], TUAN)).toEqual([]);
  });

  it('nhiều đơn hỏng thì trả đủ danh sách, không dừng ở đơn đầu', () => {
    const r = kiemCongChotKy([
      don({ code: 'B1', pickedUpAt: null, bill: null }),
      don({ code: 'B2', bill: { ...BILL_DUNG, fuel: 579_000 } }),
    ], TUAN);
    expect(r.map((x) => x.code)).toEqual(['B1', 'B2']);
  });
});
