import { describe, it, expect } from 'vitest';
import { sinhToken, DO_DAI_TOI_THIEU } from './link-token';

describe('sinhToken', () => {
  /* Đoán được một token là đọc được phụ phí của brand khác. */
  it('đủ dài và khác nhau mỗi lần', () => {
    const a = sinhToken(), b = sinhToken();
    expect(a.length).toBeGreaterThanOrEqual(DO_DAI_TOI_THIEU);
    expect(a).not.toBe(b);
  });

  /* Token nằm trong URL. base64 thường có + / = — dán vào Zalo rồi bị encode một phần là
     brand mở ra 404 mà không ai hiểu vì sao. */
  it('chỉ chứa ký tự an toàn cho URL', () => {
    for (let i = 0; i < 50; i++) expect(sinhToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('KHÔNG mang thông tin brand', () => {
    for (let i = 0; i < 20; i++) expect(sinhToken()).not.toMatch(/kalisa|brand|mmp|slug/i);
  });
});
