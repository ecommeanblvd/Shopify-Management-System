import { describe, it, expect } from 'vitest';
import { deliveryStatusToEvent } from './mmp-events-map';

describe('deliveryStatusToEvent', () => {
  it('delivered → shipment.delivered', () => {
    expect(deliveryStatusToEvent('delivered')).toBe('shipment.delivered');
  });
  it('exception/failed/returned → shipment.exception', () => {
    expect(deliveryStatusToEvent('exception')).toBe('shipment.exception');
    expect(deliveryStatusToEvent('failure')).toBe('shipment.exception');
    expect(deliveryStatusToEvent('returned')).toBe('shipment.exception');
  });
  it('mới tạo nhãn / chưa rõ → null (chưa có gì để báo brand)', () => {
    expect(deliveryStatusToEvent('label_created')).toBeNull();
    expect(deliveryStatusToEvent('unknown')).toBeNull();
  });
  it('còn lại (in_transit/out_for_delivery/…) → shipment.in_transit', () => {
    expect(deliveryStatusToEvent('in_transit')).toBe('shipment.in_transit');
    expect(deliveryStatusToEvent('out_for_delivery')).toBe('shipment.in_transit');
    expect(deliveryStatusToEvent('anything')).toBe('shipment.in_transit');
  });
});
