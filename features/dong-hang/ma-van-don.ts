/** THUẦN: bóc mã vận đơn từ chuỗi dán (URL hoặc số trần). */

/** Ký tự zero-width hay vô hình khác từ lỗi copy-paste. */
const INVISIBLE_CHARS = /[\s​‌‍﻿]/g;

/** Mã vận đơn hợp lệ: 8-35 ký tự, chữ hoa + số. */
const VALID_CODE_REGEX = /^[A-Z0-9]{8,35}$/;

/** Tên tham số truy vấn biết để bóc mã từ URL, không phân biệt hoa thường. */
const KNOWN_PARAMS = ['trknbr', 'tracknum', 'tracknumbers', 'trackingnumber', 'awb'];

/**
 * Bóc mã vận đơn từ chuỗi dán. Có thể là:
 * - Số trần: "876817928550" → trả như là
 * - URL có tham số biết: "https://fedex.com/?trknbr=876817928550" → bóc từ tham số
 * - Chuỗi khác: null (không đoán)
 *
 * Review Focus #1: URL lạ không có tham số mã → KHÔNG được đoán bừa một đoạn số
 * trong đường dẫn, vì mã sai trông y hệt mã đúng.
 */
export function macVanDonTu(raw: string): string | null {
  const cleaned = raw.replace(INVISIBLE_CHARS, '');
  if (!cleaned) return null;

  const upper = cleaned.toUpperCase();
  if (VALID_CODE_REGEX.test(upper)) {
    return upper;
  }

  if (!cleaned.toLowerCase().startsWith('http://') && !cleaned.toLowerCase().startsWith('https://')) {
    return null;
  }

  try {
    const url = new URL(cleaned);
    /* Duyệt tất cả tham số URL, so khớp tên tham số không phân biệt hoa thường
     * với KNOWN_PARAMS. searchParams.get() là case-sensitive nên phải duyệt entries(). */
    for (const [paramName, paramValue] of url.searchParams.entries()) {
      if (KNOWN_PARAMS.includes(paramName.toLowerCase())) {
        const codeUpper = paramValue.toUpperCase().replace(INVISIBLE_CHARS, '');
        if (VALID_CODE_REGEX.test(codeUpper)) {
          return codeUpper;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}
