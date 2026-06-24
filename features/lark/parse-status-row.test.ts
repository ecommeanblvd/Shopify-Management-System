import { describe, expect, it } from 'vitest';
import { mapLarkDelivery, parseLarkStatus } from './parse-status-row';

describe('parseLarkStatus', () => {
  it('đọc field text + lookup-array + formula', () => {
    const r = parseLarkStatus({
      'LOG-EP-Dispatch Status': 'Đang giao',
      'CX-FF Status (look up)': [{ text: 'Đã xác nhận' }],
      'Final | Delivery Status': 'Delivered',
    });
    expect(r.dispatchStatus).toBe('Đang giao');
    expect(r.cxFfStatus).toBe('Đã xác nhận');
    expect(r.deliveryStatus).toBe('Delivered');
  });

  it('Ngày giao dự kiến: epoch ms → UTC nửa đêm ngày-lịch VN', () => {
    // 2026-06-08 17:00:00 UTC = 2026-06-09 00:00 giờ VN → kỳ vọng 2026-06-09T00:00:00Z
    const ms = Date.UTC(2026, 5, 8, 17, 0, 0);
    const r = parseLarkStatus({ 'Ngày giao dự kiến': ms });
    expect(r.expectedDeliveryDate?.toISOString()).toBe('2026-06-09T00:00:00.000Z');
  });

  it('field thiếu/rỗng → null', () => {
    const r = parseLarkStatus({});
    expect(r).toEqual({ dispatchStatus: null, cxFfStatus: null, deliveryStatus: null, expectedDeliveryDate: null, deliveryState: null, actualDeliveredAt: null });
  });

  it('Ngày giao dự kiến không phải số → null', () => {
    const r = parseLarkStatus({ 'Ngày giao dự kiến': 'n/a' });
    expect(r.expectedDeliveryDate).toBeNull();
  });
});

describe('mapLarkDelivery', () => {
  it('các trạng thái hoàn tất → delivered', () => {
    expect(mapLarkDelivery('Chậm hơn dự kiến')).toBe('delivered');
    expect(mapLarkDelivery('Đúng dự kiến')).toBe('delivered');
    expect(mapLarkDelivery('Nhanh hơn dự kiến')).toBe('delivered');
  });
  it('đang giao / xử lý / sự cố', () => {
    expect(mapLarkDelivery('Đang giao hàng')).toBe('out_for_delivery');
    expect(mapLarkDelivery('Đang xử lý')).toBe('in_transit');
    expect(mapLarkDelivery('Giao hàng thất bại')).toBe('exception');
    expect(mapLarkDelivery('Gặp vấn đề')).toBe('exception');
    expect(mapLarkDelivery('Mất hàng khi giao')).toBe('exception');
  });
  it('rỗng/lạ → null', () => {
    expect(mapLarkDelivery(null)).toBeNull();
    expect(mapLarkDelivery('gì đó')).toBeNull();
  });
});

describe('parseLarkStatus delivery', () => {
  it('deliveryState + actualDeliveredAt', () => {
    const ms = Date.UTC(2026, 5, 3, 17, 0, 0); // 04/06 giờ VN
    const r = parseLarkStatus({ 'Final | Delivery Status': 'Nhanh hơn dự kiến', 'Ngày giao thực tế': ms });
    expect(r.deliveryState).toBe('delivered');
    expect(r.actualDeliveredAt?.toISOString()).toBe('2026-06-04T00:00:00.000Z');
  });
  it('không có ngày giao thực tế → null', () => {
    expect(parseLarkStatus({ 'Final | Delivery Status': 'Đang giao hàng' }).actualDeliveredAt).toBeNull();
  });
});
