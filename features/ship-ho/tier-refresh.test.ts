import { describe, it, expect } from 'vitest';
import { lastMonthWindowVn } from './tier-refresh';

describe('lastMonthWindowVn — window tháng trước theo giờ VN (UTC+7)', () => {
  it('giữa tháng 7 VN → window = tháng 6 VN', () => {
    // 2026-07-09 10:00 VN = 03:00 UTC
    const w = lastMonthWindowVn(new Date('2026-07-09T03:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-05-31T17:00:00.000Z'); // 01/06 00:00 VN
    expect(w.end.toISOString()).toBe('2026-06-30T17:00:00.000Z');   // 01/07 00:00 VN
  });
  it('biên: 00:30 VN ngày 01/07 (= 17:30 UTC 30/06) → vẫn tính là tháng 7 VN → window tháng 6', () => {
    const w = lastMonthWindowVn(new Date('2026-06-30T17:30:00Z'));
    expect(w.start.toISOString()).toBe('2026-05-31T17:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-06-30T17:00:00.000Z');
  });
  it('biên: 23:30 VN ngày 30/06 (= 16:30 UTC) → tháng 6 VN → window tháng 5', () => {
    const w = lastMonthWindowVn(new Date('2026-06-30T16:30:00Z'));
    expect(w.start.toISOString()).toBe('2026-04-30T17:00:00.000Z'); // 01/05 00:00 VN
    expect(w.end.toISOString()).toBe('2026-05-31T17:00:00.000Z');
  });
  it('qua năm: tháng 1 → window tháng 12 năm trước', () => {
    const w = lastMonthWindowVn(new Date('2027-01-15T03:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-11-30T17:00:00.000Z'); // 01/12/2026 00:00 VN
    expect(w.end.toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });
});
