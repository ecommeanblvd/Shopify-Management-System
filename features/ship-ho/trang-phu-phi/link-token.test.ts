import { describe, it, expect } from 'vitest';
import { sinhToken, duongDanLink, DO_DAI_TOI_THIEU } from './link-token';

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

describe('duongDanLink', () => {
  it('ghép origin với đường dẫn trang', () => {
    expect(duongDanLink('https://mean.example', 'abc')).toBe('https://mean.example/pp/abc');
    expect(duongDanLink('http://localhost:3000', 'abc')).toBe('http://localhost:3000/pp/abc');
  });
  /* `window.location.origin` không có dấu gạch cuối, nhưng origin truyền tay thì có — hai gạch
     liền làm link vẫn mở được mà trông như lỗi khi brand nhìn thấy. */
  it('bỏ gạch chéo thừa ở cuối origin', () => {
    expect(duongDanLink('https://mean.example/', 'abc')).toBe('https://mean.example/pp/abc');
    expect(duongDanLink('https://mean.example///', 'abc')).toBe('https://mean.example/pp/abc');
  });
});
