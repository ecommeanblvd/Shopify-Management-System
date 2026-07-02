import { describe, it, expect } from 'vitest';
import { orderStatusAfterTrack } from './track';

describe('orderStatusAfterTrack', () => {
  it('delivered → chuyển order sang delivered', () => {
    expect(orderStatusAfterTrack('shipped', 'delivered')).toBe('delivered');
  });
  it('chưa giao → giữ nguyên status hiện tại', () => {
    expect(orderStatusAfterTrack('shipped', 'in_transit')).toBe('shipped');
    expect(orderStatusAfterTrack('quoted', 'exception')).toBe('quoted');
  });
  it('đã billed/settled → KHÔNG hạ về delivered (giữ trạng thái cao hơn)', () => {
    expect(orderStatusAfterTrack('billed', 'delivered')).toBe('billed');
    expect(orderStatusAfterTrack('settled', 'delivered')).toBe('settled');
  });
});
