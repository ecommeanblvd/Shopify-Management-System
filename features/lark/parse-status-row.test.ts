import { describe, expect, it } from 'vitest';
import { parseLarkStatus } from './parse-status-row';

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
    expect(r).toEqual({ dispatchStatus: null, cxFfStatus: null, deliveryStatus: null, expectedDeliveryDate: null });
  });

  it('Ngày giao dự kiến không phải số → null', () => {
    const r = parseLarkStatus({ 'Ngày giao dự kiến': 'n/a' });
    expect(r.expectedDeliveryDate).toBeNull();
  });
});
