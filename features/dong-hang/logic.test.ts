import { describe, it, expect } from 'vitest';
import { canQuyDoi, trangThaiKien, laNgayTuongLai, nhomTheoNgay, nhomTheoNgayVaBase, xepQuote } from './logic';
import type { CarrierQuoteRow } from '@/features/carrier-rates/compare/quote-order-carriers';

describe('canQuyDoi', () => {
  it('thể tích/5000, làm tròn 0,1 rồi trần 0,5 (luật FedEx)', () => {
    // 40×30×20 = 24000 / 5000 = 4.8 → 5.0; cân thực 1.2 → tính cước 5.0
    expect(canQuyDoi(1.2, { l: 40, w: 30, h: 20 })).toEqual({ quyDoi: 4.8, tinhCuoc: 5 });
    // 2.355 → 2.4 → 2.5
    expect(canQuyDoi(2.355, null)).toEqual({ quyDoi: null, tinhCuoc: 2.5 });
  });
  it('thiếu chiều cao → không quy đổi; thiếu cân → null', () => {
    expect(canQuyDoi(1, { l: 40, w: 30, h: null })).toEqual({ quyDoi: null, tinhCuoc: 1 });
    expect(canQuyDoi(null, null)).toEqual({ quyDoi: null, tinhCuoc: null });
  });
});

describe('trangThaiKien', () => {
  it('có tracking → đã lên nhãn (thắng mọi trạng thái)', () => {
    expect(trangThaiKien({ trackingNumber: '1Z1', selectedCarrierKey: 'ups', selectedCarrierBy: 'duc', selectedCarrierAt: '2026-09-22T03:00:00Z' })).toEqual({ ma: 'da_len_nhan', tracking: '1Z1' });
  });
  it('đã chọn hãng → da_chon kèm người/giờ; chưa gì → cho_chon', () => {
    expect(trangThaiKien({ trackingNumber: null, selectedCarrierKey: 'ups', selectedCarrierBy: 'duc', selectedCarrierAt: '2026-09-22T03:00:00Z' })).toEqual({ ma: 'da_chon', hang: 'ups', nguoi: 'duc', luc: '2026-09-22T03:00:00Z' });
    expect(trangThaiKien({ trackingNumber: null, selectedCarrierKey: null, selectedCarrierBy: null, selectedCarrierAt: null })).toEqual({ ma: 'cho_chon' });
  });
});

describe('nhomTheoNgay', () => {
  it('nhóm theo ngày VN, ngày mới trước, giữ thứ tự trong nhóm', () => {
    const r = nhomTheoNgay([
      { id: 'a', ngayDong: '2026-09-22T17:30:00Z' }, // 00:30 23/09 VN
      { id: 'b', ngayDong: '2026-09-22T03:00:00Z' }, // 22/09 VN
      { id: 'c', ngayDong: '2026-09-22T05:00:00Z' }, // 22/09 VN
    ]);
    expect(r.map((g) => [g.ngay, g.kien.map((k) => k.id)])).toEqual([['2026-09-23', ['a']], ['2026-09-22', ['b', 'c']]]);
  });
});

describe('xepQuote', () => {
  const q = (o: Partial<CarrierQuoteRow>): CarrierQuoteRow => ({ carrierKey: 'x', carrierName: 'X', accountId: 'a', ok: true, vndCost: 0, ...o });
  it('ok trước theo cước tăng dần, lỗi cuối; rẻ nhất bỏ qua hãng tạm ngưng', () => {
    const r = xepQuote([
      q({ carrierKey: 'fedex', accountId: '1', vndCost: 300 }),
      q({ carrierKey: 'dhl', accountId: '2', ok: false, error: 'no zone' }),
      q({ carrierKey: 'aramex', accountId: '3', vndCost: 100, suspendedAt: '2026-01-01T00:00:00Z' }),
      q({ carrierKey: 'ups', accountId: '4', vndCost: 200 }),
    ]);
    expect(r.rows.map((x) => x.carrierKey)).toEqual(['aramex', 'ups', 'fedex', 'dhl']);
    expect(r.reNhatKey).toBe('ups');
  });
});

describe('nhomTheoNgayVaBase', () => {
  it('trong mỗi ngày gom tiếp theo kho xuất, kho không rõ xuống cuối', () => {
    const r = nhomTheoNgayVaBase([
      { id: 'a', ngayDong: '2026-09-22T03:00:00Z', base: 'SG' },
      { id: 'b', ngayDong: '2026-09-22T04:00:00Z', base: null },
      { id: 'c', ngayDong: '2026-09-22T05:00:00Z', base: 'HN' },
      { id: 'd', ngayDong: '2026-09-22T06:00:00Z', base: 'SG' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].theoBase.map((g) => [g.base, g.kien.map((k) => k.id)])).toEqual([
      ['HN', ['c']], ['SG', ['a', 'd']], [null, ['b']],
    ]);
  });
});

describe('laNgayTuongLai', () => {
  const now = Date.parse('2026-09-22T05:00:00Z'); // 12:00 22/09 giờ VN
  it('ngày sau hôm nay (theo lịch VN) → đúng', () => {
    expect(laNgayTuongLai('2026-09-23', now)).toBe(true);
    expect(laNgayTuongLai('2026-12-31', now)).toBe(true);
  });
  it('hôm nay và ngày cũ → sai', () => {
    expect(laNgayTuongLai('2026-09-22', now)).toBe(false);
    expect(laNgayTuongLai('2026-09-21', now)).toBe(false);
  });
});
