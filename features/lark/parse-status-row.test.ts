import { describe, expect, it } from 'vitest';
import { mapLarkDelivery, parseLarkStatus, resolveDeliveredAt } from './parse-status-row';

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

  it('ngày giao rác (<2020, vd 1997) → null (không dính delivered/expected)', () => {
    const junk = Date.UTC(1997, 7, 14, 17, 0, 0);
    const r = parseLarkStatus({ 'Ngày giao thực tế': junk, 'Ngày giao dự kiến': junk });
    expect(r.actualDeliveredAt).toBeNull();
    expect(r.expectedDeliveryDate).toBeNull();
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

describe('parseLarkStatus — Lark lookup shape {type, value} (cột đổi kiểu ~25/06)', () => {
  it('Final | Delivery Status dạng {type:1, value:[{text}]} → vẫn parse + map delivered', () => {
    const ms = Date.UTC(2026, 6, 1, 17, 0, 0); // 02/07 giờ VN
    const r = parseLarkStatus({
      'Final | Delivery Status': { type: 1, value: [{ text: 'Đúng dự kiến', type: 'text' }] },
      'Ngày giao thực tế': ms,
    });
    expect(r.deliveryStatus).toBe('Đúng dự kiến');
    expect(r.deliveryState).toBe('delivered');
    expect(r.actualDeliveredAt?.toISOString()).toBe('2026-07-02T00:00:00.000Z');
  });
  it('CX-FF lookup shape lồng nhau cũng đọc được', () => {
    const r = parseLarkStatus({ 'CX-FF Status (look up)': { type: 1, value: [{ text: 'Đã xác nhận', type: 'text' }] } });
    expect(r.cxFfStatus).toBe('Đã xác nhận');
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

describe('chặn ngày tương lai + fallback ngày giao (fix 29/07)', () => {
  it('"Ngày giao thực tế" ở TƯƠNG LAI (ops gõ nhầm năm) → null, không nhận', () => {
    const future = Date.now() + 30 * 24 * 3600 * 1000; // +30 ngày
    const r = parseLarkStatus({ 'Final | Delivery Status': 'Đúng dự kiến', 'Ngày giao thực tế': future });
    expect(r.actualDeliveredAt).toBeNull();
  });
  it('"Ngày giao dự kiến" tương lai vẫn được phép (chưa giao mà)', () => {
    const future = Date.now() + 5 * 24 * 3600 * 1000;
    const r = parseLarkStatus({ 'Ngày giao dự kiến': future });
    expect(r.expectedDeliveryDate).not.toBeNull();
  });

  const now = new Date('2026-07-08T10:00:00Z');
  it('resolveDeliveredAt: có ngày thực → dùng ngày thực', () => {
    const actual = new Date('2026-02-27T00:00:00Z');
    expect(resolveDeliveredAt({ actualDeliveredAt: actual, expectedDeliveryDate: new Date('2026-03-01T00:00:00Z') }, now)).toBe(actual);
  });
  it('thiếu ngày thực + dự kiến ĐÃ QUA (row phát hiện muộn) → dùng ngày dự kiến, KHÔNG dùng ngày sync', () => {
    const expected = new Date('2026-03-01T00:00:00Z');
    expect(resolveDeliveredAt({ actualDeliveredAt: null, expectedDeliveryDate: expected }, now)).toBe(expected);
  });
  it('thiếu cả hai / dự kiến còn ở tương lai → first-seen (now)', () => {
    expect(resolveDeliveredAt({ actualDeliveredAt: null, expectedDeliveryDate: null }, now)).toBe(now);
    expect(resolveDeliveredAt({ actualDeliveredAt: null, expectedDeliveryDate: new Date('2026-07-20T00:00:00Z') }, now)).toBe(now);
  });
});
