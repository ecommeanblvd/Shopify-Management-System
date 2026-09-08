import { describe, it, expect } from 'vitest';
import { thangHopLe, thangTruoc, danhSachThang } from './thang';

describe('thangHopLe', () => {
  it('nhận dạng đúng YYYY-MM', () => {
    expect(thangHopLe('2026-08')).toBe(true);
    expect(thangHopLe('2026-01')).toBe(true);
    expect(thangHopLe('2026-12')).toBe(true);
  });

  it('sai định dạng → false (caller dùng để rơi về giá trị mặc định)', () => {
    expect(thangHopLe('2026-13')).toBe(false);
    expect(thangHopLe('2026-00')).toBe(false);
    expect(thangHopLe('2026-8')).toBe(false);
    expect(thangHopLe('08-2026')).toBe(false);
    expect(thangHopLe('')).toBe(false);
    expect(thangHopLe(undefined)).toBe(false);
    expect(thangHopLe(null)).toBe(false);
  });
});

describe('thangTruoc', () => {
  it('lùi vài tháng trong cùng năm', () => {
    expect(thangTruoc('2026-08', 5)).toBe('2026-03');
  });

  it('lăn qua năm trước khi lùi qua tháng 1', () => {
    expect(thangTruoc('2026-02', 5)).toBe('2025-09');
  });

  it('Tháng 1 lùi 1 tháng → Tháng 12 năm trước', () => {
    expect(thangTruoc('2026-01', 1)).toBe('2025-12');
  });
});

describe('danhSachThang', () => {
  it('liệt kê tăng dần khi tu <= den', () => {
    expect(danhSachThang('2026-06', '2026-08')).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('đảo lại khi tu > den', () => {
    expect(danhSachThang('2026-08', '2026-06')).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('lăn qua năm: Tháng 12 → Tháng 1 năm sau', () => {
    expect(danhSachThang('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('giới hạn 36 tháng dù khoảng yêu cầu dài hơn', () => {
    const out = danhSachThang('2020-01', '2030-01');
    expect(out).toHaveLength(36);
    expect(out[0]).toBe('2020-01');
    expect(out[35]).toBe('2022-12');
  });

  it('tu === den → mảng một phần tử', () => {
    expect(danhSachThang('2026-08', '2026-08')).toEqual(['2026-08']);
  });
});
