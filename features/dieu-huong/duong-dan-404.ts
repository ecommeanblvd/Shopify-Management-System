/**
 * THUẦN: lọc đường dẫn 404 do TRÌNH DUYỆT gửi lên trước khi ghi vào nhật ký (CEO 30/09/2026).
 *
 * Vì sao cần: Đức báo "page not found" ở KPI Logistics. Em đã kiểm hết phía máy chủ — quyền
 * thông, mọi route sống, không chỗ nào ném 404 — và vẫn KHÔNG biết anh ấy vào đường dẫn nào,
 * vì hệ thống không có nhật ký mức request. Hai vòng hỏi–đáp mà vẫn thiếu đúng một mẩu dữ kiện.
 * Nên mỗi lần 404 từ nay phải TỰ ĐỂ LẠI DẤU.
 *
 * Đường dẫn này đến từ client nên là dữ liệu KHÔNG TIN ĐƯỢC: phải lọc, không ghi thẳng.
 */

/** Ghi tối đa ngần này ký tự — đủ cho mọi route thật, chặn chuỗi rác dài. */
export const DAI_TOI_DA = 512;

/**
 * Đường dẫn có ghi được không.
 *
 * Chỉ nhận PATH tuyệt đối, không nhận URL đầy đủ: một URL đầy đủ nghĩa là client đang gửi thứ
 * khác với `usePathname()` trả về, và ghi nó vào là để người khác bơm dữ liệu vào nhật ký của mình.
 * Chặn ký tự điều khiển để không ai chèn dòng mới rồi làm nhật ký đọc thành nhiều mục.
 */
export function duongDanGhiDuoc(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (v.length === 0 || v.length > DAI_TOI_DA) return false;
  if (!v.startsWith('/')) return false;
  if (v.startsWith('//')) return false;           // '//host' là URL giao thức tương đối
  if (/[\u0000-\u001f\u007f]/.test(v)) return false;
  return true;
}

/**
 * Bỏ phần truy vấn và fragment nếu client vẫn gửi kèm.
 *
 * Nhật ký KHÔNG được giữ query: query là chỗ hay mang mã đơn, email, token — thứ không nên nằm
 * trong bảng nhật ký chỉ để phục vụ việc tìm một đường dẫn gõ sai.
 */
export function chiLayPath(v: string): string {
  return v.split('#')[0].split('?')[0];
}
