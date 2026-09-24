import { describe, it, expect } from 'vitest';
import { chonDauVaoBaoGia, chonDongTheoHang, type DonCanBaoGia } from './auto-quote-logic';

const don = (o: Partial<DonCanBaoGia> = {}): DonCanBaoGia => ({
  id: 'id1', carrierKey: 'fedex', country: 'US', weightKg: '2', smsWeightKg: null,
  carrierCostVnd: null, postcode: '04353', city: 'Whitefield',
  dimLengthCm: null, dimWidthCm: null, dimHeightCm: null,
  smsDimLengthCm: null, smsDimWidthCm: null, smsDimHeightCm: null,
  ...o,
});

describe('chonDauVaoBaoGia', () => {
  it('đơn đủ dữ liệu → báo giá được, cân theo số khai', () => {
    const r = chonDauVaoBaoGia(don());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dauVao).toMatchObject({ country: 'US', weightKg: 2, canTheo: 'khai' });
  });

  it('ĐÃ có ước tính → bỏ qua, KHÔNG báo giá đè', () => {
    expect(chonDauVaoBaoGia(don({ carrierCostVnd: '123' }))).toEqual({ ok: false, lyDo: 'da_co_uoc_tinh' });
  });

  it('không rõ hãng → bỏ qua, TUYỆT ĐỐI không rơi về hãng mặc định', () => {
    expect(chonDauVaoBaoGia(don({ carrierKey: null }))).toEqual({ ok: false, lyDo: 'khong_ro_hang' });
    expect(chonDauVaoBaoGia(don({ carrierKey: '  ' }))).toEqual({ ok: false, lyDo: 'khong_ro_hang' });
  });

  it('nước không phải ISO-2 → bỏ qua', () => {
    expect(chonDauVaoBaoGia(don({ country: 'United States' }))).toEqual({ ok: false, lyDo: 'thieu_nuoc' });
    expect(chonDauVaoBaoGia(don({ country: null }))).toEqual({ ok: false, lyDo: 'thieu_nuoc' });
  });

  it('cân <= 0 hoặc trống → bỏ qua', () => {
    expect(chonDauVaoBaoGia(don({ weightKg: '0' }))).toEqual({ ok: false, lyDo: 'thieu_can' });
    expect(chonDauVaoBaoGia(don({ weightKg: null }))).toEqual({ ok: false, lyDo: 'thieu_can' });
  });

  it('có cân SMS đo lại → ưu tiên cân SMS, không dùng số brand khai', () => {
    const r = chonDauVaoBaoGia(don({ weightKg: '2', smsWeightKg: '3.4' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dauVao).toMatchObject({ weightKg: 3.4, canTheo: 'sms' });
  });

  it('kích thước chỉ nhận khi ĐỦ ba chiều', () => {
    const thieu = chonDauVaoBaoGia(don({ dimLengthCm: '40', dimWidthCm: '30', dimHeightCm: null }));
    expect(thieu.ok && thieu.dauVao.dimensions).toBe(null);
    const du = chonDauVaoBaoGia(don({ dimLengthCm: '40', dimWidthCm: '30', dimHeightCm: '20' }));
    expect(du.ok && du.dauVao.dimensions).toEqual({ lengthCm: 40, widthCm: 30, heightCm: 20 });
  });

  it('cân theo SMS thì kích thước cũng lấy bộ SMS', () => {
    const r = chonDauVaoBaoGia(don({
      smsWeightKg: '3', dimLengthCm: '40', dimWidthCm: '30', dimHeightCm: '20',
      smsDimLengthCm: '50', smsDimWidthCm: '40', smsDimHeightCm: '30',
    }));
    expect(r.ok && r.dauVao.dimensions).toEqual({ lengthCm: 50, widthCm: 40, heightCm: 30 });
  });
});

describe('chonDongTheoHang', () => {
  const rows = [
    { carrierKey: 'dhl', ok: true, vndCost: 100, breakdown: { a: 1 } },
    { carrierKey: 'fedex', ok: true, vndCost: 900, breakdown: { b: 2 } },
    { carrierKey: 'ups', ok: false, error: 'no_zone' },
  ];

  it('lấy ĐÚNG hãng đã gửi đơn, KHÔNG lấy hãng rẻ nhất', () => {
    expect(chonDongTheoHang(rows, 'fedex')).toEqual({ ok: true, vndCost: 900, breakdown: { b: 2 } });
  });

  it('hãng của đơn không có account đang bật → báo lý do, không thay hãng khác', () => {
    expect(chonDongTheoHang(rows, 'aramex')).toEqual({ ok: false, lyDo: 'hang_khong_co_account' });
  });

  it('hãng của đơn báo giá lỗi → báo lý do, không rơi sang hãng khác', () => {
    expect(chonDongTheoHang(rows, 'ups')).toEqual({ ok: false, lyDo: 'hang_bao_gia_loi', chiTiet: 'no_zone' });
  });

  it('hãng khớp nhưng thiếu cước → coi là lỗi', () => {
    expect(chonDongTheoHang([{ carrierKey: 'fedex', ok: true }], 'fedex')).toMatchObject({ ok: false, lyDo: 'hang_bao_gia_loi' });
  });
});
