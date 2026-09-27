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

/** Khoá `"1--2.Waist*"` → thứ tự [1, 2] để sắp đúng như khách thấy lúc đặt. */
function thuTu(key: string): [number, number] {
  const m = /^(\d+)--(\d+)\./.exec(key);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/** `"1--2.Waist*"` → `"Waist"`. Bỏ tiền tố thứ tự và dấu sao bắt buộc. */
function nhanDep(key: string): string {
  return key.replace(/^\d+--\d+\./, '').replace(/\*+$/, '').replace(/^_/, '').trim();
}

/**
 * Số đo khách đặt may đo, lấy từ thuộc tính của DÒNG ĐƠN.
 *
 * Shopify để chúng lẫn với thứ khác trong `customAttributes`, khoá mang tiền tố
 * thứ tự hiển thị (`1--1.Bust*`, `2--3.Hip*`). Bỏ `Estimated Delivery` vì nó đã
 * có cột riêng — để lại là một con số ngày nằm giữa bảng số đo cơ thể.
 *
 * Sắp theo đúng tiền tố thứ tự chứ không theo bảng chữ cái: đó là trình tự
 * người thợ đọc khi may.
 */
export function locSoDo(attrs: readonly ThuocTinhDong[] | null | undefined): SoDo[] {
  return (attrs ?? [])
    .filter((a) => {
      const k = a.key.trim().toLowerCase();
      if (!a.value?.trim()) return false;
      return k !== 'estimated delivery';
    })
    .sort((a, b) => {
      const [a1, a2] = thuTu(a.key); const [b1, b2] = thuTu(b.key);
      return a1 - b1 || a2 - b2 || a.key.localeCompare(b.key);
    })
    .map((a) => ({ nhan: nhanDep(a.key), giaTri: a.value!.trim() }))
    .filter((x) => x.nhan !== '');
}

/** Họ tên khách ghép từ hai trường của Shopify. Rỗng cả hai → null. */
export function tenKhach(ho: string | null | undefined, ten: string | null | undefined): string | null {
  const s = `${(ho ?? '').trim()} ${(ten ?? '').trim()}`.trim();
  return s || null;
}
