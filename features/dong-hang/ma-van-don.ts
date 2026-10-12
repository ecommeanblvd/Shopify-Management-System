/** THUẦN: bóc mã vận đơn từ chuỗi dán (URL hoặc số trần). */

/** Ký tự zero-width hay vô hình khác từ lỗi copy-paste. */
const INVISIBLE_CHARS = /[\s​‌‍﻿]/g;

/** Mã vận đơn hợp lệ: 8-35 ký tự, chữ hoa + số. */
const VALID_CODE_REGEX = /^[A-Z0-9]{8,35}$/;

/** Tham số truy vấn biết trong URL để bóc mã (case-insensitive). */
const KNOWN_PARAMS = ['trknbr', 'tracknum', 'tracknumbers', 'trackingnumber', 'awb'];

/**
 * Bóc mã vận đơn từ chuỗi dán. Có thể là:
 * - Số trần: "876817928550" → trả như là
 * - URL có tham số biết: "https://fedex.com/?trknbr=876817928550" → bóc từ tham số
 * - Chuỗi khác: null (không đoán)
 */
export function macVanDonTu(raw: string): string | null {
  // Chuẩn hoá: bỏ khoảng trắng + ký tự vô hình
  const cleaned = raw.replace(INVISIBLE_CHARS, '');

  // Rỗng sau khi chuẩn hoá → null
  if (!cleaned) return null;

  // Viết hoa để so sánh
  const upper = cleaned.toUpperCase();

  // Nếu toàn bộ là mã hợp lệ → trả luôn
  if (VALID_CODE_REGEX.test(upper)) {
    return upper;
  }

  // Kiểm tra xem có phải URL không
  if (!cleaned.toLowerCase().startsWith('http://') && !cleaned.toLowerCase().startsWith('https://')) {
    // Không phải URL, không phải mã trần → null
    return null;
  }

  // Là URL → chỉ đọc tham số biết, không moi từ đường dẫn
  try {
    const url = new URL(cleaned);
    for (const param of KNOWN_PARAMS) {
      const value = url.searchParams.get(param);
      if (value) {
        const codeUpper = value.toUpperCase().replace(INVISIBLE_CHARS, '');
        // Kiểm tra xem giá trị tham số có phải là mã hợp lệ không
        if (VALID_CODE_REGEX.test(codeUpper)) {
          return codeUpper;
        }
      }
    }
  } catch {
    // URL không hợp lệ → null
    return null;
  }

  // URL không có tham số biết → null
  return null;
}
