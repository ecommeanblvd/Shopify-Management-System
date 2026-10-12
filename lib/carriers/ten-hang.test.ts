import { describe, it, expect } from 'vitest';
import { tenHang } from './ten-hang';

describe('tenHang', () => {
  it('đổi khoá thành tên hãng', () => {
    expect(tenHang('fedex')).toBe('FedEx');
    expect(tenHang('ups')).toBe('UPS');
    expect(tenHang('sf-express')).toBe('SF Express');
  });
  /* Hãng lạ phải HIỆN RA, không được biến mất: bộ lọc đối soát trước đây gõ cứng
   * fedex/dhl/aramex nên UPS không bao giờ xuất hiện dù dữ liệu có. */
  it('khoá chưa biết vẫn hiện, viết hoa chữ đầu', () => {
    expect(tenHang('hang-moi')).toBe('Hang-moi');
  });
});
