import { describe, it, expect } from 'vitest';
import { duongDanGhiDuoc, chiLayPath, DAI_TOI_DA } from './duong-dan-404';

describe('duongDanGhiDuoc — đường dẫn từ client là dữ liệu KHÔNG tin được', () => {
  it('nhận path tuyệt đối bình thường', () => {
    expect(duongDanGhiDuoc('/f/kpi')).toBe(true);
    expect(duongDanGhiDuoc('/')).toBe(true);
  });

  it('từ chối thứ không phải chuỗi, chuỗi rỗng, và chuỗi quá dài', () => {
    expect(duongDanGhiDuoc(undefined)).toBe(false);
    expect(duongDanGhiDuoc(42)).toBe(false);
    expect(duongDanGhiDuoc('')).toBe(false);
    expect(duongDanGhiDuoc('/' + 'a'.repeat(DAI_TOI_DA))).toBe(false);
  });

  it('từ chối URL đầy đủ và URL giao thức tương đối — đó là client gửi thứ khác usePathname', () => {
    expect(duongDanGhiDuoc('https://ke-khac.example/f/kpi')).toBe(false);
    expect(duongDanGhiDuoc('//ke-khac.example/f/kpi')).toBe(false);
    expect(duongDanGhiDuoc('f/kpi')).toBe(false);
  });

  it('từ chối ký tự điều khiển — chèn dòng mới là làm một mục thành nhiều mục', () => {
    expect(duongDanGhiDuoc('/f/kpi\nket-qua=OK')).toBe(false);
    expect(duongDanGhiDuoc('/f/kpi\u0000')).toBe(false);
  });
});

describe('chiLayPath — nhật ký KHÔNG giữ query', () => {
  it('bỏ query và fragment', () => {
    // Query hay mang mã đơn, email, token. Không đáng đánh đổi để tìm một đường dẫn gõ sai.
    expect(chiLayPath('/f/ship-report?tab=kpi&ky=2026-08')).toBe('/f/ship-report');
    expect(chiLayPath('/f/kpi#dau-trang')).toBe('/f/kpi');
    expect(chiLayPath('/f/kpi')).toBe('/f/kpi');
  });
});
