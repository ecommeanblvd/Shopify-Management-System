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

  /**
   * KHÔNG mang thông tin brand — kiểm bằng CHỮ KÝ HÀM, không bằng cách soi chuỗi.
   *
   * Bản trước đòi 20 token không chứa `/kalisa|brand|mmp|slug/i`. Đó là kiểm không có cơ sở:
   * token là 43 ký tự base64url ngẫu nhiên, nên xác suất chứa một trong bốn chuỗi đó khoảng
   * 2–3% MỖI LƯỢT CHẠY — và nó đã đỏ thật ngày 08/10/2026 với token
   * `Z8NtMJmKOc5tz4qyrCXstBTVkIPk7O3M0RlarPaMmpc` (có `Mmpc`). Một bài test đỏ ngẫu nhiên vì
   * lý do vô nghĩa thì sớm muộn người ta bỏ qua cả nhóm test quanh nó.
   *
   * Điều THẬT cần giữ: hàm không NHẬN được dữ liệu brand nào. Số tham số bằng 0 nói đúng điều
   * đó, và nó đúng tuyệt đối chứ không theo xác suất. Ai thêm tham số `slug` vào đây là đỏ ngay.
   */
  it('KHÔNG nhận được thông tin brand — hàm không có tham số nào', () => {
    expect(sinhToken).toHaveLength(0);
  });

  /* Và đầu ra phải thực sự ngẫu nhiên: 50 lượt không trùng nhau lượt nào. Trùng là dấu hiệu
     token được suy ra từ cái gì đó, chứ không phải lấy từ `randomBytes`. */
  it('50 lượt không trùng nhau', () => {
    const ds = new Set(Array.from({ length: 50 }, () => sinhToken()));
    expect(ds.size).toBe(50);
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
