/**
 * THUẦN: tách thông tin khách và ngày giao dự kiến từ dữ liệu Shopify.
 *
 * Ba việc CEO chốt 27/09 sau khi đối chiếu file CX: email khách, tách EDD
 * thành hai đầu, và số đo khách đặt may đo.
 */

/**
 * `"6 October - 20 October"` → hai đầu.
 *
 * Dạng chuỗi không đồng nhất — có dòng kèm thứ (`"Friday, 06 March - Tuesday,
 * 17 March"`), có dòng không. Nhưng đo 6.161/6.161 dòng: MỌI chuỗi có ĐÚNG MỘT
 * lần `" - "`, nên tách ở đó là không nhập nhằng.
 */
export function tachEdd(s: string | null): { min: string | null; max: string | null } {
  const t = (s ?? '').trim();
  if (!t) return { min: null, max: null };
  const i = t.indexOf(' - ');
  if (i < 0) return { min: t, max: null };
  const min = t.slice(0, i).trim();
  const max = t.slice(i + 3).trim();
  return { min: min || null, max: max || null };
}

export interface ThuocTinhDong { key: string; value: string | null }
export interface SoDo { nhan: string; giaTri: string }

/**
 * Khoá số đo có dạng `"1--2.Waist*"`, đôi khi có số phụ `"7--13.1.Dress Length"`.
 * `_Customize Type` là loại trang phục, không mang số thứ tự.
 */
const KHOA_SO_DO = /^(\d+)--(\d+)(?:\.(\d+))?\./;
const KHOA_LOAI = '_customize type';

/** Thứ tự để sắp đúng như khách thấy lúc đặt. Loại trang phục đứng đầu. */
function thuTu(key: string): [number, number, number] {
  const m = KHOA_SO_DO.exec(key);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : [0, 0, 0];
}

/** `"1--2.Waist*"` → `"Waist"`. Bỏ tiền tố thứ tự và dấu sao bắt buộc. */
function nhanDep(key: string): string {
  return key.replace(KHOA_SO_DO, '').replace(/\*+$/, '').replace(/^_/, '').trim();
}

/**
 * Số đo khách đặt may đo, lấy từ thuộc tính của DÒNG ĐƠN.
 *
 * CHỈ nhận khoá đúng dạng số đo (`1--1.Bust*`, `7--13.1.Dress Length`) và
 * `_Customize Type`. Lọc theo danh sách CHO PHÉP chứ không phải loại trừ: ô
 * `customAttributes` của Shopify là bãi chứa chung, app khuyến mãi nhét cả
 * `foxDiscount` với nguyên một khối JSON vào đó — lọc kiểu loại trừ là khối
 * JSON ấy hiện lên giữa bảng số đo cơ thể (đã mắc đúng thế 27/09).
 *
 * Sắp theo đúng tiền tố thứ tự chứ không theo bảng chữ cái: đó là trình tự
 * người thợ đọc khi may.
 */
export function locSoDo(attrs: readonly ThuocTinhDong[] | null | undefined): SoDo[] {
  return (attrs ?? [])
    .filter((a) => {
      if (!a.value?.trim()) return false;
      const k = a.key.trim();
      return KHOA_SO_DO.test(k) || k.toLowerCase() === KHOA_LOAI;
    })
    .sort((a, b) => {
      const [a1, a2, a3] = thuTu(a.key); const [b1, b2, b3] = thuTu(b.key);
      return a1 - b1 || a2 - b2 || a3 - b3 || a.key.localeCompare(b.key);
    })
    .map((a) => ({ nhan: nhanDep(a.key), giaTri: a.value!.trim() }))
    .filter((x) => x.nhan !== '');
}

/** Họ tên khách ghép từ hai trường của Shopify. Rỗng cả hai → null. */
export function tenKhach(ho: string | null | undefined, ten: string | null | undefined): string | null {
  const s = `${(ho ?? '').trim()} ${(ten ?? '').trim()}`.trim();
  return s || null;
}
