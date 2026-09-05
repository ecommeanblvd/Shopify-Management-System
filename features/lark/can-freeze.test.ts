import { describe, it, expect } from 'vitest';
import { canDongTrangThai, canLapNgay, canSuaNgay, type ShipmentHienTai } from './can-freeze';

const sp = (p: Partial<ShipmentHienTai> = {}): ShipmentHienTai => ({
  deliveryStatus: null, deliveredAt: null, deliverySource: null,
  trackingNumber: null, labelCreatedAt: null, ...p,
});

describe('canDongTrangThai', () => {
  it('đã delivered rồi → không cần chạy', () => {
    expect(canDongTrangThai([sp({ deliveryStatus: 'delivered' })], true)).toBe(false);
  });
  it('chưa delivered, không phải đánh delivered → cần chạy', () => {
    expect(canDongTrangThai([sp({ deliveryStatus: 'in_transit' })], false)).toBe(true);
  });
  it('đánh delivered mà CHƯA ship (không tracking, không label) → không chạy, đúng guard 29/07', () => {
    expect(canDongTrangThai([sp()], true)).toBe(false);
  });
  it('đánh delivered và đã có tracking → cần chạy', () => {
    expect(canDongTrangThai([sp({ trackingNumber: '123' })], true)).toBe(true);
  });
  it('đơn nhiều kiện: chỉ cần MỘT kiện thoả là phải chạy', () => {
    expect(canDongTrangThai([sp({ deliveryStatus: 'delivered' }), sp({ trackingNumber: 'x' })], true)).toBe(true);
  });
  it('không có kiện nào → không chạy', () => {
    expect(canDongTrangThai([], true)).toBe(false);
  });
});

describe('canLapNgay', () => {
  it('delivered mà thiếu ngày → cần lấp', () => {
    expect(canLapNgay([sp({ deliveryStatus: 'delivered' })])).toBe(true);
  });
  it('delivered và đã có ngày → thôi', () => {
    expect(canLapNgay([sp({ deliveryStatus: 'delivered', deliveredAt: new Date() })])).toBe(false);
  });
  it('chưa delivered → thôi', () => {
    expect(canLapNgay([sp({ deliveryStatus: 'in_transit' })])).toBe(false);
  });
});

describe('canSuaNgay', () => {
  const cu = new Date('2026-05-01');
  const moi = new Date('2026-05-03');
  it('nguồn lark, ngày khác → cần sửa', () => {
    expect(canSuaNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'lark', deliveredAt: cu })], moi)).toBe(true);
  });
  it('ngày trùng → thôi', () => {
    expect(canSuaNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'lark', deliveredAt: moi })], moi)).toBe(false);
  });
  it('nguồn KHÁC lark → không đụng (POD bill / FedEx track)', () => {
    expect(canSuaNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'carrier_bill', deliveredAt: cu })], moi)).toBe(false);
  });
  it('không có ngày thực → thôi', () => {
    expect(canSuaNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'lark', deliveredAt: cu })], null)).toBe(false);
  });
});
