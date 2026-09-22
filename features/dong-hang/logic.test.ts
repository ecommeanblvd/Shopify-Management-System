import { describe, it, expect } from 'vitest';
import { canQuyDoi, trangThaiKien, laNgayTuongLai, nhomTheoNgay, nhomTheoNgayVaBase, tenNguoiDung, xepQuote } from './logic';
import type { CarrierQuoteRow } from '@/features/carrier-rates/compare/quote-order-carriers';

describe('canQuyDoi', () => {
  it('thể tích/5000, làm tròn 0,1 rồi trần 0,5 (luật FedEx)', () => {
    // 40×30×20 = 24000 / 5000 = 4.8 → 5.0; cân thực 1.2 → tính cước 5.0
    expect(canQuyDoi(1.2, { l: 40, w: 30, h: 20 })).toEqual({ quyDoi: 4.8, tinhCuoc: 5, theo: 'quy_doi' });
    // 2.355 → 2.4 → 2.5
    expect(canQuyDoi(2.355, null)).toEqual({ quyDoi: null, tinhCuoc: 2.5, theo: 'thuc' });
  });
  it('thiếu chiều cao → không quy đổi; thiếu cân → null', () => {
    expect(canQuyDoi(1, { l: 40, w: 30, h: null })).toEqual({ quyDoi: null, tinhCuoc: 1, theo: 'thuc' });
    expect(canQuyDoi(null, null)).toEqual({ quyDoi: null, tinhCuoc: null, theo: null });
  });
});

describe('cân nào quyết định cước', () => {
  it('kiện to nhẹ → cân quy đổi thắng', () => {
    expect(canQuyDoi(0.4, { l: 40, w: 31, h: 2 }).theo).toBe('quy_doi');
  });
  it('kiện nhỏ nặng → cân thực thắng', () => {
    expect(canQuyDoi(3.6, { l: 30, w: 20, h: 10 }).theo).toBe('thuc');
  });
  it('bằng nhau → tính là cân thực, không báo quy đổi vượt', () => {
    expect(canQuyDoi(5, { l: 50, w: 50, h: 10 }).theo).toBe('thuc');
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
  const now = Date.parse('2026-09-22T05:00:00Z'); // 12:00 22/09 giờ VN
  it('nhóm theo ngày VN, ngày mới trước, giữ thứ tự trong nhóm', () => {
    const r = nhomTheoNgay([
      { id: 'a', ngayDong: '2026-09-21T17:30:00Z' }, // 00:30 22/09 VN
      { id: 'b', ngayDong: '2026-09-20T03:00:00Z' }, // 20/09 VN
      { id: 'c', ngayDong: '2026-09-20T05:00:00Z' }, // 20/09 VN
    ], now);
    expect(r.map((g) => [g.ngay, g.kien.map((k) => k.id)])).toEqual([['2026-09-22', ['a']], ['2026-09-20', ['b', 'c']]]);
  });

  it('ngày Lark hẹn đi trong tương lai dồn XUỐNG CUỐI, gần nhất trước', () => {
    const r = nhomTheoNgay([
      { id: 'giuCho', ngayDong: '2026-12-31T00:00:00Z' },
      { id: 'homNay', ngayDong: '2026-09-22T03:00:00Z' },
      { id: 'holdGan', ngayDong: '2026-09-30T00:00:00Z' },
      { id: 'homQua', ngayDong: '2026-09-21T03:00:00Z' },
    ], now);
    expect(r.map((g) => g.ngay)).toEqual(['2026-09-22', '2026-09-21', '2026-09-30', '2026-12-31']);
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
    ], Date.parse('2026-09-22T09:00:00Z'));
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

describe('tenNguoiDung', () => {
  it('có tên thật thì dùng tên', () => {
    expect(tenNguoiDung('Bá Đức', 'bduc13922@gmail.com')).toBe('Bá Đức');
  });
  it('chưa có tên thì lấy phần trước @', () => {
    expect(tenNguoiDung(null, 'bduc13922@gmail.com')).toBe('bduc13922');
    expect(tenNguoiDung('   ', 'lmtiep@gmail.com')).toBe('lmtiep');
  });
  it('không có gì → null; chuỗi không phải email giữ nguyên', () => {
    expect(tenNguoiDung(null, null)).toBeNull();
    expect(tenNguoiDung(null, 'he-thong')).toBe('he-thong');
  });
});
