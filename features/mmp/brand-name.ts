/**
 * THUẦN: chuẩn hoá tên hiển thị brand — quy tắc 2 bên SMS/MMP thống nhất 21/07:
 * MỖI TỪ chỉ viết hoa CHỮ CÁI ĐẦU, còn lại thường ("TOM FRIED" → "Tom Fried",
 * "À TOUS" → "À Tous", "LEKIEU" → "Lekieu"). Từ bắt đầu bằng số: viết hoa chữ
 * CÁI đầu tiên gặp ("21SIX" → "21Six"). Unicode-aware (À, Đ...).
 */
export function normalizeBrandDisplayName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => {
      let done = false;
      let out = '';
      for (const ch of word) {
        if (!done && ch.toLowerCase() !== ch.toUpperCase()) { // là chữ cái
          out += ch.toLocaleUpperCase('vi');
          done = true;
        } else {
          out += done ? ch.toLocaleLowerCase('vi') : ch;
        }
      }
      return out;
    })
    .join(' ');
}
