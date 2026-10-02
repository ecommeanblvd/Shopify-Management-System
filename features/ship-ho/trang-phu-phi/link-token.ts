import { randomBytes } from 'node:crypto';

/**
 * Token cho link phụ phí của brand.
 *
 * 32 byte ngẫu nhiên → 43 ký tự `base64url`. Đoán được một token là đọc được phụ phí của brand
 * khác, nên không dùng số tăng dần, không nhúng slug, không dùng uuid của dòng.
 */
export const DO_DAI_TOI_THIEU = 32;

/**
 * `base64url` chứ không `base64`: token nằm trong URL, mà `base64` có `+` `/` `=` — ba ký tự
 * phải mã hoá. Link dán vào Zalo hay email rồi bị cắt/encode một phần là brand mở ra 404 mà
 * không ai hiểu vì sao.
 */
export function sinhToken(): string {
  return randomBytes(32).toString('base64url');
}
