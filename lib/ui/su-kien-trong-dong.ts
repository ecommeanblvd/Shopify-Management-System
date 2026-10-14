/**
 * THUẦN: sự kiện này có THẬT SỰ phát ra từ bên trong phần tử đang bắt nó không?
 *
 * Vì sao cần (14/10/2026 — Đức báo modal đối soát tự đóng rồi nhảy sang trang khác):
 * React cho sự kiện nổi bọt theo CÂY COMPONENT, không theo cây DOM. Một hộp thoại dựng qua
 * portal nằm ở `document.body`, nhưng nếu trong mã nó được viết bên trong một
 * `<tr role="link" onClick={…}>` thì MỌI cú click và phím bấm trong hộp thoại vẫn chạy qua
 * tay cái `<tr>` đó. Người dùng gõ dấu cách vào ô lý do → dòng hiểu là "bấm Space trên link"
 * → điều hướng đi, mất sạch những gì đang gõ.
 *
 * `currentTarget.contains(target)` phân biệt đúng chỗ đó: nội dung portal nằm ngoài DOM của
 * dòng nên trả `false`, còn mọi thứ thật sự nằm trong dòng trả `true`.
 *
 * KHÔNG chữa bằng `stopPropagation` ở phía hộp thoại: như thế mỗi hộp thoại phải tự nhớ,
 * quên một cái là lỗi quay lại — mà lỗi này im lặng, chỉ lộ ra khi có người gõ chữ.
 *
 * Nhận diện bằng HÌNH DÁNG (`có hàm contains` / `có hàm closest`) chứ không `instanceof Node`:
 * bộ test của repo chạy môi trường `node`, không có DOM. Thiếu hàm thì KHÔNG chặn — mất một
 * lớp bảo vệ còn hơn khoá nhầm cả dòng.
 */
interface CoContains { contains(n: unknown): boolean }
interface CoClosest { closest(sel: string): unknown }

const coContains = (x: unknown): x is CoContains =>
  typeof x === 'object' && x !== null && typeof (x as CoContains).contains === 'function';
const coClosest = (x: unknown): x is CoClosest =>
  typeof x === 'object' && x !== null && typeof (x as CoClosest).closest === 'function';

export function tuTrongPhanTuNay(e: { currentTarget: unknown; target: unknown }): boolean {
  if (!coContains(e.currentTarget)) return true;
  return e.currentTarget.contains(e.target);
}

/** Phần tử tự có việc riêng khi bấm — dòng không được giành lấy cú bấm đó. */
export const TU_CO_VIEC =
  'button,a,input,select,textarea,label,[role="button"],[role="link"],[contenteditable="true"]';

/**
 * Dòng-là-link có được xử cú tương tác này không: phải phát ra TỪ TRONG dòng, và không phải
 * từ một thứ vốn đã có việc riêng (nút, link, ô nhập…).
 */
export function dongDuocXuLy(e: { currentTarget: unknown; target: unknown }): boolean {
  if (!tuTrongPhanTuNay(e)) return false;
  if (coClosest(e.target)) {
    const coViec = e.target.closest(TU_CO_VIEC);
    // `!== currentTarget` là phần BẮT BUỘC, không phải tinh chỉnh: chính cái dòng thường
    // mang `role="link"`/`role="button"` để bàn phím đi được, nên `closest` leo lên sẽ gặp
    // CHÍNH NÓ và kết luận "đã có người lo" — dòng không bao giờ mở ra nữa. Chỉ con cháu
    // mới được quyền giành cú bấm khỏi dòng.
    if (coViec != null && coViec !== e.currentTarget) return false;
  }
  return true;
}
