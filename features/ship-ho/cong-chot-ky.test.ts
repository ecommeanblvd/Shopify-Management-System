import { describe, it, expect } from 'vitest';
import { kiemCongChotKy, hangCoNguonTra, type DonKiemCong } from './cong-chot-ky';
import type { TuanFuel } from './tuan-fuel';

const FEDEX = 'acc-fedex', ARAMEX = 'acc-aramex';
const TUAN = new Map<string, TuanFuel[]>([
  [FEDEX, [
    { tu: '2026-07-06', den: '2026-07-13', pct: 38.25 },
    { tu: '2026-07-20', den: '2026-07-27', pct: 39.75 },
  ]],
  /* Aramex công bố MỘT mức phẳng 30%, không theo tuần — so đơn Aramex với bảng FedEx là
     chặn nhầm, đã xảy ra thật ở lượt chạy chỉ-đếm 03/10/2026. */
  [ARAMEX, [{ tu: '2026-07-01', den: null, pct: 30 }]],
]);
const don = (o: Partial<DonKiemCong>): DonKiemCong => ({
  code: 'X', tenHang: 'FedEx Vietnam — International Priority (IP) 2026', carrierAccountId: FEDEX,
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
    expect(kiemCongChotKy([don({ tenHang: 'Aramex HN (Hợp Nhất)', carrierAccountId: ARAMEX, pickedUpAt: null, bill: null })], TUAN)).toEqual([]);
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

  /* Hai đơn Aramex THẬT (SV-0142, SV-0154) bị bản đầu của cổng chặn nhầm vì so với bảng FedEx.
     Fuel 312.851 trên gốc 1.042.749 = đúng 30,00%, mức Aramex công bố. */
  it('đơn Aramex so với bảng CỦA ARAMEX thì qua', () => {
    expect(kiemCongChotKy([don({
      code: 'SV-0142', tenHang: 'Aramex HN (Hợp Nhất)', carrierAccountId: ARAMEX, pickedUpAt: null,
      shippedAt: '2026-09-21',
      bill: { base: 1_042_749, discount: 0, remote: 0, demand: 0, signature: 0, residential: 0,
        addressCorrection: 0, fuel: 312_825 },
    })], TUAN)).toEqual([]);
  });

  /* Số THẬT của SV-0142: 312.851 / 1.042.749 = 30,002% — hãng làm tròn tiền nên % giải ngược
     lệch vài phần nghìn. Dung sai 0,001 chặn nhầm đơn này; 0,05 thì không. */
  it('hãng làm tròn tiền thì lệch vài phần nghìn — KHÔNG chặn', () => {
    expect(kiemCongChotKy([don({
      code: 'SV-0142', tenHang: 'Aramex HN (Hợp Nhất)', carrierAccountId: ARAMEX, pickedUpAt: null,
      shippedAt: '2026-09-21',
      bill: { base: 1_042_749, discount: 0, remote: 0, demand: 0, signature: 0, residential: 0,
        addressCorrection: 0, fuel: 312_851 },
    })], TUAN)).toEqual([]);
  });

  /* Hai tuần liền kề chênh ít nhất 0,25%, nên sai MỘT TUẦN vẫn phải bị bắt. */
  it('lệch một tuần (0,25%) vẫn bị chặn', () => {
    const r = kiemCongChotKy([don({
      code: 'C1', carrierAccountId: ARAMEX, shippedAt: '2026-09-21', pickedUpAt: null,
      tenHang: 'Aramex HN (Hợp Nhất)',
      bill: { base: 1_000_000, discount: 0, remote: 0, demand: 0, signature: 0, residential: 0,
        addressCorrection: 0, fuel: 302_500 },
    })], TUAN);
    expect(r).toHaveLength(1);
    expect(r[0].ma).toBe('fuel_lech_tuan');
  });

  it('không biết bảng tuần của hãng thì BỎ QUA phép so, không so bừa', () => {
    expect(kiemCongChotKy([don({ carrierAccountId: 'acc-la', bill: BILL_DUNG })], TUAN)).toEqual([]);
  });

  it('nhiều đơn hỏng thì trả đủ danh sách, không dừng ở đơn đầu', () => {
    const r = kiemCongChotKy([
      don({ code: 'B1', pickedUpAt: null, bill: null }),
      don({ code: 'B2', bill: { ...BILL_DUNG, fuel: 579_000 } }),
    ], TUAN);
    expect(r.map((x) => x.code)).toEqual(['B1', 'B2']);
  });
});
