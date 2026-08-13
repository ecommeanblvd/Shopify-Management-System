import { describe, it, expect } from 'vitest';
import { presetRange, rangeFileSuffix, describeRange } from './export-range';

// 12/08/2026 09:00 UTC = 16:00 giờ VN cùng ngày
const NOW = new Date('2026-08-12T09:00:00Z');

describe('presetRange — theo lịch VN', () => {
  it('tháng này → 01/08 đến 31/08', () => {
    expect(presetRange('this_month', NOW)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });
  it('tháng trước → 01/07 đến 31/07', () => {
    expect(presetRange('last_month', NOW)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });
  it('tháng trước khi đang ở tháng 1 → tháng 12 năm ngoái', () => {
    expect(presetRange('last_month', new Date('2026-01-15T09:00:00Z')))
      .toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('tháng 2 năm nhuận → 29/02', () => {
    expect(presetRange('this_month', new Date('2028-02-10T09:00:00Z')))
      .toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('30 ngày qua → tính CẢ hôm nay (29 ngày trước → hôm nay)', () => {
    expect(presetRange('last_30d', NOW)).toEqual({ from: '2026-07-14', to: '2026-08-12' });
  });
  it('tất cả → không giới hạn', () => {
    expect(presetRange('all', NOW)).toEqual({ from: null, to: null });
  });

  it('biên giờ VN: 22:00 UTC ngày 31/07 đã là 01/08 giờ VN → tháng này = tháng 8', () => {
    expect(presetRange('this_month', new Date('2026-07-31T22:00:00Z')).from).toBe('2026-08-01');
  });

  it('custom: giữ nguyên ngày người dùng nhập', () => {
    expect(presetRange('custom', NOW, { from: '2026-06-05', to: '2026-06-20' }))
      .toEqual({ from: '2026-06-05', to: '2026-06-20' });
  });
  it('custom: gõ ngược from > to → tự đảo, không báo lỗi', () => {
    expect(presetRange('custom', NOW, { from: '2026-06-20', to: '2026-06-05' }))
      .toEqual({ from: '2026-06-05', to: '2026-06-20' });
  });
  it('custom: chỉ 1 đầu → khoảng mở 1 phía', () => {
    expect(presetRange('custom', NOW, { from: '2026-06-01' })).toEqual({ from: '2026-06-01', to: null });
    expect(presetRange('custom', NOW, { to: '2026-06-30' })).toEqual({ from: null, to: '2026-06-30' });
  });
  it('custom: ngày rác/rỗng → bỏ qua (không chặn export)', () => {
    expect(presetRange('custom', NOW, { from: '12/08/2026', to: '' })).toEqual({ from: null, to: null });
  });
});

describe('rangeFileSuffix / describeRange', () => {
  it('đủ 2 đầu', () => {
    const r = { from: '2026-08-01', to: '2026-08-31' };
    expect(rangeFileSuffix(r)).toBe('2026-08-01_2026-08-31');
    expect(describeRange(r)).toBe('01/08 – 31/08');
  });
  it('mở 1 phía + không giới hạn', () => {
    expect(rangeFileSuffix({ from: '2026-08-01', to: null })).toBe('tu-2026-08-01');
    expect(rangeFileSuffix({ from: null, to: '2026-08-31' })).toBe('den-2026-08-31');
    expect(rangeFileSuffix({ from: null, to: null })).toBe('all');
    expect(describeRange({ from: null, to: null })).toBe('tất cả thời gian');
  });
});
