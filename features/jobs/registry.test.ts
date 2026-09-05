import { describe, it, expect } from 'vitest';
import {
  JOB_REGISTRY, JOB_KEYS, trangThaiJob, hanChotMs, xepTheoMucDoLo,
  type JobDinhNghia, type LanChayGanNhat,
} from './registry';

const job: JobDinhNghia = { key: 'x', ten: 'X', chuKyPhut: 60, hauQua: '' };
const now = new Date('2026-09-04T12:00:00Z');
const chay = (phutTruoc: number, status = 'ok'): LanChayGanNhat => ({
  startedAt: new Date(now.getTime() - phutTruoc * 60_000),
  status, durationMs: 1000, error: null,
});

describe('trangThaiJob', () => {
  it('chưa có lần chạy nào → chua_chay (nặng nhất: chưa ai lên lịch)', () => {
    expect(trangThaiJob(job, null, now)).toBe('chua_chay');
  });

  it('trong chu kỳ → bình thường', () => {
    expect(trangThaiJob(job, chay(30), now)).toBe('binh_thuong');
  });

  it('vượt 1 chu kỳ nhưng chưa tới 2 → vẫn bình thường, không kêu oan vì lỡ nhịp', () => {
    expect(trangThaiJob(job, chay(90), now)).toBe('binh_thuong');
  });

  it('vượt 2 lần chu kỳ → quá hạn', () => {
    expect(trangThaiJob(job, chay(121), now)).toBe('qua_han');
  });

  it('đúng mốc 2 chu kỳ chưa tính là quá hạn', () => {
    expect(trangThaiJob(job, chay(120), now)).toBe('binh_thuong');
  });

  it('quá hạn THẮNG cả trạng thái lỗi — ngưng chạy nghiêm trọng hơn chạy lỗi', () => {
    expect(trangThaiJob(job, chay(200, 'error'), now)).toBe('qua_han');
  });

  it('còn trong hạn mà lần cuối lỗi → loi', () => {
    expect(trangThaiJob(job, chay(10, 'error'), now)).toBe('loi');
  });

  it('còn trong hạn mà đang chạy → dang_chay', () => {
    expect(trangThaiJob(job, chay(1, 'running'), now)).toBe('dang_chay');
  });

  it("'running' quá một chu kỳ = tiến trình chết giữa chừng → tính là LỖI, không báo xanh", () => {
    expect(trangThaiJob(job, chay(61, 'running'), now)).toBe('loi');
  });
});

describe('sổ đăng ký', () => {
  it('khoá không trùng nhau', () => {
    expect(new Set(JOB_KEYS).size).toBe(JOB_KEYS.length);
  });
  it('mọi job đều khai chu kỳ dương và có mô tả hậu quả', () => {
    for (const j of JOB_REGISTRY) {
      expect(j.chuKyPhut).toBeGreaterThan(0);
      expect(j.ten.length).toBeGreaterThan(0);
      expect(j.hauQua.length).toBeGreaterThan(0);
    }
  });
  it('gồm đủ các tác vụ đã phát hiện chết 04/09', () => {
    for (const k of ['retry-ship-ho-events', 'prune-logs', 'track-shipments', 'refresh-vcb-fx', 'refresh-demand', 'sync-catalog'])
      expect(JOB_KEYS).toContain(k);
  });
  it('hanChotMs = 2 lần chu kỳ', () => {
    expect(hanChotMs(60)).toBe(2 * 60 * 60_000);
  });
});

describe('xepTheoMucDoLo', () => {
  it('cái đáng lo lên trước', () => {
    const rows = [
      { trangThai: 'binh_thuong' as const, k: 'a' },
      { trangThai: 'qua_han' as const, k: 'b' },
      { trangThai: 'chua_chay' as const, k: 'c' },
      { trangThai: 'loi' as const, k: 'd' },
    ];
    expect(xepTheoMucDoLo(rows).map((r) => r.k)).toEqual(['c', 'b', 'd', 'a']);
  });
});
