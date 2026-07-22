import { describe, it, expect } from 'vitest';
import { vnToday, isValidDateStr, resolveShippedAt } from './ship-date';

describe('vnToday', () => {
  it('theo giờ VN: 23h59 UTC 21/07 đã là 22/07 ở VN (UTC+7)', () => {
    expect(vnToday(new Date('2026-07-21T23:59:00Z'))).toBe('2026-07-22');
  });
  it('16:59 UTC vẫn là cùng ngày VN; 17:00 UTC sang ngày mới', () => {
    expect(vnToday(new Date('2026-07-21T16:59:00Z'))).toBe('2026-07-21');
    expect(vnToday(new Date('2026-07-21T17:00:00Z'))).toBe('2026-07-22');
  });
});

describe('isValidDateStr', () => {
  it('nhận YYYY-MM-DD thật', () => expect(isValidDateStr('2026-07-22')).toBe(true));
  it('từ chối ngày không tồn tại', () => expect(isValidDateStr('2026-02-30')).toBe(false));
  it('từ chối định dạng lạ', () => {
    expect(isValidDateStr('22/07/2026')).toBe(false);
    expect(isValidDateStr('2026-7-2')).toBe(false);
  });
});

describe('resolveShippedAt — mặc định ngày nhập tracking, staff sửa được', () => {
  const now = new Date('2026-07-21T10:00:00Z'); // = 21/07 giờ VN

  it('staff chọn ngày → dùng ngày đó (đi hàng chậm hơn ngày tạo tracking)', () => {
    expect(resolveShippedAt(null, '2026-07-23', now)).toEqual({ ok: true, value: '2026-07-23' });
  });
  it('không nhập + đơn chưa có → mặc định hôm nay giờ VN', () => {
    expect(resolveShippedAt(null, undefined, now)).toEqual({ ok: true, value: '2026-07-21' });
  });
  it('không nhập + đơn ĐÃ có ngày → giữ nguyên (sửa tracking không reset ngày)', () => {
    expect(resolveShippedAt('2026-07-19', undefined, now)).toEqual({ ok: true, value: '2026-07-19' });
  });
  it('chuỗi rỗng coi như không nhập', () => {
    expect(resolveShippedAt('2026-07-19', '', now)).toEqual({ ok: true, value: '2026-07-19' });
  });
  it('ngày sai định dạng → lỗi rõ ràng', () => {
    const r = resolveShippedAt(null, '31/12/2026', now);
    expect(r.ok).toBe(false);
  });
});
