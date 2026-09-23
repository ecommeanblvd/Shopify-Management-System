/**
 * Hình dạng UUID tối thiểu.
 *
 * Mọi id đi vào luồng KOL đều tới từ bên ngoài — trường ẩn trong FormData hoặc
 * query string trên URL — nên không có gì đảm bảo đúng khuôn. Ép một chuỗi rác
 * thẳng vào so sánh cột `uuid` thì Postgres ném `invalid input syntax for type
 * uuid` (22P02): ở server action nó rơi vào nhánh lỗi hạ tầng và người dùng
 * nhận một thông báo sai hẳn về nguyên nhân, còn ở trang server-render thì nó
 * làm HỎNG CẢ TRANG thay vì chỉ bỏ qua bộ lọc.
 *
 * Tách ra file riêng (không nằm trong `actions.ts`) vì `actions.ts` là
 * `'use server'` — file đó chỉ được export hàm async, nên không thể chia sẻ
 * hàm thuần này cho các trang dùng chung.
 */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** THUẦN: chuỗi có đúng hình dạng uuid không. */
export function dangUuid(s: string | null | undefined): boolean {
  return typeof s === 'string' && RE_UUID.test(s);
}
