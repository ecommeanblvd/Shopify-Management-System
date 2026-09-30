/**
 * THUẦN: dịch lỗi của luồng nối store Shopify thành câu người đọc hiểu (CEO 30/09/2026).
 *
 * Vì sao cần: luồng OAuth trước nay hỏng thì trả JSON thô `{"error":"OAuth callback failed"}`
 * giữa màn hình, còn thành công thì đẩy về dashboard KHÔNG nói một chữ. CEO bấm nối store HC,
 * bị đẩy về dashboard, và không có cách nào biết đã nối được chưa — phải hỏi, rồi phải suy luận
 * ngược từ dữ liệu mới trả lời được.
 *
 * Nguyên tắc khi dịch: KHÔNG ném nguyên văn lỗi kỹ thuật ra URL. Vừa vô nghĩa với người đọc, vừa
 * lộ chi tiết nội bộ trên thanh địa chỉ và trong lịch sử trình duyệt. Mỗi lỗi quy về một MÃ NGẮN,
 * chi tiết thật vẫn nằm trong nhật ký để người kỹ thuật đọc.
 */

export type MaLoiNoiStore =
  | 'ten-store-sai'
  | 'het-han'
  | 'chu-ky-sai'
  | 'doi-ma-hong'
  | 'khac';

/** Câu hiện cho người dùng, kèm việc họ làm được tiếp theo. */
export const THONG_DIEP_LOI: Record<MaLoiNoiStore, string> = {
  'ten-store-sai': 'Tên store không đúng dạng. Chỉ gõ phần handle, ví dụ "hc-store" — hệ thống tự thêm .myshopify.com.',
  'het-han': 'Phiên nối đã hết hạn hoặc bắt đầu từ nơi khác. Phải bấm nối TỪ trang này chứ không cài từ Shopify admin, và làm xong trong 5 phút.',
  'chu-ky-sai': 'Shopify ký không khớp. Thường là do khoá ứng dụng trên Railway khác với khoá của app đang cài.',
  'doi-ma-hong': 'Shopify từ chối cấp quyền truy cập. Kiểm tra app đã được duyệt cho store đó chưa.',
  khac: 'Nối store không thành công. Chi tiết đã ghi vào nhật ký hệ thống.',
};

/**
 * Quy một lỗi ném ra từ callback về mã ngắn.
 *
 * So bằng chuỗi vì các lỗi này do chính callback ném ra với câu cố định — không phải lỗi của thư
 * viện ngoài. Không khớp được thì về 'khac' chứ KHÔNG đoán: đoán sai thì câu hướng dẫn sẽ chỉ
 * người dùng đi sửa nhầm chỗ.
 */
export function maLoiTuLoi(err: unknown): MaLoiNoiStore {
  const s = String(err);
  if (s.includes('Invalid shop domain')) return 'ten-store-sai';
  if (s.includes('Missing state cookie') || s.includes('State mismatch')) return 'het-han';
  if (s.includes('HMAC validation failed')) return 'chu-ky-sai';
  if (s.includes('Token exchange failed') || s.includes('No access_token')) return 'doi-ma-hong';
  return 'khac';
}

/**
 * Mã đọc từ URL có hợp lệ không — không tin thẳng thứ nằm trên thanh địa chỉ.
 *
 * Dùng `Object.hasOwn` chứ KHÔNG dùng `in`: `'constructor' in {}` là true, nên `in` sẽ nhận
 * `?ma=constructor` là mã hợp lệ rồi tra ra `undefined` và màn hiện câu trống.
 */
export function laMaLoi(v: string | null | undefined): v is MaLoiNoiStore {
  return v != null && Object.hasOwn(THONG_DIEP_LOI, v);
}

/** Tên store rút gọn để hiện lại cho người dùng; bỏ đuôi cho đỡ dài. */
export function tenGon(shop: string): string {
  return shop.replace(/\.myshopify\.com$/i, '');
}
