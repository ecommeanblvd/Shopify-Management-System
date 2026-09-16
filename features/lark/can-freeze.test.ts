import { describe, it, expect } from 'vitest';
import { canDongTrangThai, canLapNgay, canSuaNgay, type ShipmentHienTai, chonTrangThaiChoKien } from './can-freeze';

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

describe('chonTrangThaiChoKien — đơn tách kiện (CEO 16/09/2026)', () => {
  const d = (ngay: string) => ({ deliveryState: 'delivered' as const, actualDeliveredAt: new Date(ngay), expectedDeliveryDate: null });
  const theoTracking = new Map([
    ['876026631930', d('2026-08-24')],
    ['876817322555', d('2026-09-10')],
  ]);
  const cuaDon = d('2026-09-10');

  it('#MBLVD29942: mỗi kiện lấy ngày giao của CHÍNH dòng Lark có mã vận đơn đó', () => {
    expect(chonTrangThaiChoKien({ trackingNumber: '876026631930' }, 2, theoTracking, cuaDon)?.actualDeliveredAt?.toISOString().slice(0, 10)).toBe('2026-08-24');
    expect(chonTrangThaiChoKien({ trackingNumber: '876817322555' }, 2, theoTracking, cuaDon)?.actualDeliveredAt?.toISOString().slice(0, 10)).toBe('2026-09-10');
  });

  it('đơn nhiều kiện mà kiện không có dòng Lark riêng → bỏ qua, không gán ngày của cả đơn', () => {
    expect(chonTrangThaiChoKien({ trackingNumber: '999' }, 2, theoTracking, cuaDon)).toBeNull();
    expect(chonTrangThaiChoKien({ trackingNumber: null }, 2, theoTracking, cuaDon)).toBeNull();
  });

  it('đơn một kiện thì vẫn dùng trạng thái cả đơn như cũ', () => {
    expect(chonTrangThaiChoKien({ trackingNumber: null }, 1, new Map(), cuaDon)).toBe(cuaDon);
  });

  it('mã vận đơn có khoảng trắng thừa vẫn khớp', () => {
    expect(chonTrangThaiChoKien({ trackingNumber: ' 876026631930 ' }, 2, theoTracking, cuaDon)).toBe(theoTracking.get('876026631930'));
  });
});
