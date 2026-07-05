import { describe, it, expect } from 'vitest';
import { canCreateReturn } from './return-logic';
describe('canCreateReturn', () => {
  it('chưa có request → ok', () => { expect(canCreateReturn([], 'o1')).toEqual({ ok: true }); });
  it('đã có request "requested" cùng order → duplicate', () => {
    expect(canCreateReturn([{ orderId: 'o1', status: 'requested' }], 'o1')).toEqual({ ok: false, reason: 'duplicate' });
  });
  it('request cũ đã "rejected"/"refunded" cùng order → cho tạo lại', () => {
    expect(canCreateReturn([{ orderId: 'o1', status: 'rejected' }], 'o1')).toEqual({ ok: true });
  });
  it('request "requested" order khác → ok', () => {
    expect(canCreateReturn([{ orderId: 'o2', status: 'requested' }], 'o1')).toEqual({ ok: true });
  });
});
