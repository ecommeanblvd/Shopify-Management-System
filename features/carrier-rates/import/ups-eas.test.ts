import { describe, it, expect } from 'vitest';
import { phanTichEas, bungDaiChuSo, gopDai, chuanHoaHangMuc, TIER_THEO_HANG_MUC } from './ups-eas';

/** Dựng một dòng sheet: [nước, ISO-2, Thấp, Cao, Thành phố, điểm đi, điểm đến]. */
const d = (iso: string, lo: string, hi: string, dich: string, city = '') =>
  ['Tên nước', iso, lo, hi, city, 'Không', dich];

const MO_RONG = 'Phụ phí Khu vực mở rộng';
const PHAT_HANG = 'Phụ phí Khu vực Phát hàng';
const VUNG_SAU = 'Phụ phí Vùng sâu vùng xa';

describe('chuanHoaHangMuc', () => {
  it('gộp hai dạng Unicode tiếng Việt về một', () => {
    const nfc = 'Phụ phí Khu vực mở rộng'.normalize('NFC');
    const nfd = 'Phụ phí Khu vực mở rộng'.normalize('NFD');
    expect(nfc === nfd).toBe(false); // hai chuỗi KHÁC nhau về byte…
    expect(chuanHoaHangMuc(nfd)).toBe(chuanHoaHangMuc(nfc)); // …nhưng cùng một hạng mục
  });

  it('file thật trộn NFC và NFD — cả hai dạng đều tra ra tier', () => {
    const rows = [
      d('AO', '000000', '999999', MO_RONG.normalize('NFD')),
      d('US', '01038', '01039', PHAT_HANG.normalize('NFC')),
    ];
    const { dong } = phanTichEas(rows);
    expect(dong.map((x) => x.tier).sort()).toEqual(['Extended', PHAT_HANG]);
  });
});

describe('TIER_THEO_HANG_MUC', () => {
  it('hai hạng mục ĐÃ CÓ GIÁ ghép vào nhãn tier có sẵn của tài khoản UPS', () => {
    // Nếu đổi hai dòng này thành tên tiếng Việt thì hai dòng carrier_surcharges
    // 646.720 ₫ / 721.450 ₫ hết khớp và báo giá UPS lại thiếu phụ phí.
    expect(TIER_THEO_HANG_MUC[MO_RONG]).toBe('Extended');
    expect(TIER_THEO_HANG_MUC[VUNG_SAU]).toBe('Remote');
  });

  it('ba hạng mục CHƯA CÓ GIÁ giữ nguyên tên tiếng Việt trong file', () => {
    expect(TIER_THEO_HANG_MUC[PHAT_HANG]).toBe(PHAT_HANG);
    expect(TIER_THEO_HANG_MUC['Phụ phí Khu vực Phát hàng - Mở rộng']).toBe('Phụ phí Khu vực Phát hàng - Mở rộng');
    expect(TIER_THEO_HANG_MUC['Phụ phí Vùng sâu vùng xa - Mở rộng']).toBe('Phụ phí Vùng sâu vùng xa - Mở rộng');
  });
});

describe('phanTichEas', () => {
  it('Thấp = Cao → dòng mã chính xác, không có cột dải', () => {
    const [x] = phanTichEas([d('US', '01234', '01234', PHAT_HANG)]).dong;
    expect(x).toEqual({ nuoc: 'US', tier: PHAT_HANG, pattern: '01234' });
  });

  it('Thấp ≠ Cao → dòng dải, pattern giữ dạng đọc được', () => {
    const [x] = phanTichEas([d('PT', '6441000', '7999999', MO_RONG)]).dong;
    expect(x).toEqual({
      nuoc: 'PT', tier: 'Extended', pattern: '6441000-7999999',
      batDau: '6441000', ketThuc: '7999999', doDai: 7,
    });
  });

  it('bỏ qua dòng điểm đến "Không" và dòng rỗng', () => {
    const { dong } = phanTichEas([
      d('US', '01234', '01234', 'Không'),
      [],
      d('US', '01235', '01235', ''),
    ]);
    expect(dong).toEqual([]);
  });

  it('CHỈ đọc cột điểm đến — cột điểm đi bị bỏ qua hoàn toàn', () => {
    // MEAN gửi từ Việt Nam nên phụ phí điểm đi của nước khác không liên quan.
    const { dong } = phanTichEas([['Hoa Kỳ', 'US', '99950', '99950', '', MO_RONG, 'Không']]);
    expect(dong).toEqual([]);
  });

  it('nước không có mã bưu chính (Thấp = Cao = 0) → lưu TÊN THÀNH PHỐ đã chuẩn hoá', () => {
    const [x] = phanTichEas([d('BN', '0', '0', MO_RONG, 'Kuala Belait')]).dong;
    expect(x).toEqual({ nuoc: 'BN', tier: 'Extended', pattern: 'KUALABELAIT' });
  });

  it('không mã lẫn tên thành phố → bỏ qua kèm cảnh báo', () => {
    const { dong, canhBao } = phanTichEas([d('BN', '0', '0', MO_RONG, '0')]);
    expect(dong).toEqual([]);
    expect(canhBao.join()).toContain('không có mã lẫn tên thành phố');
  });

  it('mã nước không phải ISO-2 → bỏ qua kèm cảnh báo', () => {
    const { dong, canhBao } = phanTichEas([d('USA', '01234', '01234', PHAT_HANG)]);
    expect(dong).toEqual([]);
    expect(canhBao.join()).toContain('không phải ISO-2');
  });

  it('hạng mục lạ → bỏ qua và kêu lên để người nhập bổ sung bảng tra', () => {
    const { dong, canhBao } = phanTichEas([d('US', '01234', '01234', 'Phụ phí gì đó mới')]);
    expect(dong).toEqual([]);
    expect(canhBao.join()).toContain('TIER_THEO_HANG_MUC');
  });

  it('mã Anh được BUNG thành từng quận, kể cả khi hai đầu lệch độ dài', () => {
    const { dong } = phanTichEas([d('GB', 'IV4', 'IV11', VUNG_SAU)]);
    expect(dong.every((x) => x.batDau === undefined)).toBe(true);
    expect(dong.map((x) => x.pattern)).toEqual(['IV4', 'IV5', 'IV6', 'IV7', 'IV8', 'IV9', 'IV10', 'IV11']);
  });

  it('dải ngược → bỏ qua kèm cảnh báo', () => {
    const { dong, canhBao } = phanTichEas([d('US', '09999', '01000', PHAT_HANG)]);
    expect(dong).toEqual([]);
    expect(canhBao.join()).toContain('dải ngược');
  });

  it('trùng (nước, mã) khác tier → giữ dòng đầu và kêu lên', () => {
    const { dong, canhBao } = phanTichEas([
      d('NG', '0', '0', MO_RONG, 'Emeora'),
      d('NG', '0', '0', VUNG_SAU, 'Emeora'),
    ]);
    expect(dong).toHaveLength(1);
    expect(dong[0].tier).toBe('Extended');
    expect(canhBao.join()).toContain('giữ cái đầu');
  });

  it('thống kê tách rõ mã / dải / thành phố', () => {
    const { thongKe } = phanTichEas([
      d('US', '01234', '01234', PHAT_HANG),
      d('US', '02000', '02999', PHAT_HANG),
      d('BN', '0', '0', PHAT_HANG, 'Seria'),
    ]);
    expect(thongKe.get(PHAT_HANG)).toEqual({ ma: 1, dai: 1, thanhPho: 1 });
  });
});

describe('bungDaiChuSo', () => {
  it('bung dải chữ-rồi-số', () => {
    expect(bungDaiChuSo('AB37', 'AB38')).toEqual(['AB37', 'AB38']);
  });

  it('từ chối khi khác cụm chữ hoặc không đúng dạng', () => {
    expect(bungDaiChuSo('AB37', 'CD38')).toBeNull();
    expect(bungDaiChuSo('A0A1A0', 'A0J1V0')).toBeNull();
    expect(bungDaiChuSo('01234', '01235')).toBeNull();
  });

  it('từ chối dải quá rộng thay vì đẻ ra hàng nghìn dòng', () => {
    expect(bungDaiChuSo('AB1', 'AB9999')).toBeNull();
  });
});

describe('gopDai', () => {
  const t = (batDau: string, ketThuc: string, tier = 'Extended') =>
    ({ nuoc: 'US', tier, batDau, ketThuc, doDai: batDau.length });

  it('gộp hai dải chồng nhau cùng tier thành một', () => {
    expect(gopDai([t('10000', '10500'), t('10400', '10900')]))
      .toEqual([t('10000', '10900')]);
  });

  it('KHÔNG gộp dải liền kề — hai vùng nối nhau không phải một vùng', () => {
    expect(gopDai([t('10000', '10099'), t('10100', '10199')])).toHaveLength(2);
  });

  it('KHÔNG gộp qua tier khác nhau', () => {
    expect(gopDai([t('10000', '10500'), t('10400', '10900', 'Remote')])).toHaveLength(2);
  });

  it('kết quả không phụ thuộc thứ tự đầu vào', () => {
    const a = gopDai([t('10000', '10500'), t('10400', '10900')]);
    const b = gopDai([t('10400', '10900'), t('10000', '10500')]);
    expect(a).toEqual(b);
  });
});
