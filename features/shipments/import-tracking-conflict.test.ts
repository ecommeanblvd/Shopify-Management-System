import { describe, it, expect } from 'vitest';
import { trackingConflict } from './import-actions';

describe('trackingConflict', () => {
  const incoming = { orderId: 'order-new', orderNumber: 'TA2130' };

  it('không có shipment cũ cho tracking → null', () => {
    expect(trackingConflict('2454631491', incoming, undefined)).toBeNull();
  });

  it('shipment cũ cùng order → null (re-import bình thường)', () => {
    expect(trackingConflict('2454631491', incoming, { orderId: 'order-new', orderNumber: 'TA2130' })).toBeNull();
  });

  it('shipment cũ thuộc ĐƠN KHÁC → cảnh báo nêu tên cả hai đơn', () => {
    const w = trackingConflict('2454631491', incoming, { orderId: 'order-old', orderNumber: '#MBLVD25904' });
    expect(w).not.toBeNull();
    expect(w).toContain('2454631491');
    expect(w).toContain('TA2130');
    expect(w).toContain('#MBLVD25904');
  });
});
