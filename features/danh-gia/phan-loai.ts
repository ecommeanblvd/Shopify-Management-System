/**
 * THUẦN: phân loại đánh giá, dựng TỪ 45 bản ghi thật của bảng Lark
 * `Truspilot Review`. Số trong chú thích là số ca đo được.
 */

export const SAO_MIN = 1;
export const SAO_MAX = 5;

/** Số sao phải là số NGUYÊN 1–5. `4.5` là dữ liệu sai, không phải nửa sao. */
export function soSaoHopLe(v: unknown): boolean {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return Number.isInteger(n) && n >= SAO_MIN && n <= SAO_MAX;
}

export const TRANG = [
  { ma: 'trustpilot', ten: 'Trustpilot' },   // 22
  { ma: 'judge_me', ten: 'Judge.me' },       // 5
  { ma: 'khac', ten: 'Khác' },
] as const;

/** 40% dòng Lark để trống cột này, nên trả `null` chứ không ép về `khac`. */
export function mapTrang(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase().replace(/[\s._-]+/g, '');
  if (!s) return null;
  if (s.startsWith('trustpilot') || s.startsWith('truspilot')) return 'trustpilot';
  if (s.startsWith('judgeme')) return 'judge_me';
  return 'khac';
}

export function nhanTrang(ma: string | null): string {
  if (!ma) return '—';
  return TRANG.find((t) => t.ma === ma)?.ten ?? ma;
}

/**
 * Chín trạng thái, giữ NGUYÊN bộ Lark khai dù chỉ 5 cái có dữ liệu.
 *
 * Khác module ticket (ở đó bỏ các lựa chọn không dùng): 675 dòng là bằng chứng đủ
 * để kết luận một lựa chọn vô dụng, 45 dòng thì không — và chín giá trị này là
 * trạng thái do CHÍNH Trustpilot định nghĩa, không phải CX tự nghĩ ra.
 */
export const TRANG_THAI = [
  { ma: 'pending_customer_feedback', ten: 'Chờ khách phản hồi' },  // 5
  { ma: 'request_info', ten: 'Đã hỏi thêm thông tin' },            // 4
  { ma: 'responded', ten: 'Đã trả lời' },                          // 23
  { ma: 'approved', ten: 'Đã duyệt' },
  { ma: 'edited', ten: 'Khách đã sửa' },
  { ma: 'flagged', ten: 'Đã báo cáo' },
  { ma: 'hidden', ten: 'Đã ẩn' },
  { ma: 'archived', ten: 'Đã lưu trữ' },                           // 9
  { ma: 'deleted', ten: 'Đã xoá' },
] as const;

const TT = new Map<string, { ma: string; ten: string }>(TRANG_THAI.map((t) => [t.ma, t]));

/** Trạng thái nào coi là ĐÃ XỬ LÝ — quyết định ca nào lên khối "Cần chữa". */
export const DA_XU_LY = ['responded', 'archived'] as const;

export function daXuLy(ma: string | null): boolean {
  return ma != null && (DA_XU_LY as readonly string[]).includes(ma);
}

export function mapTrangThai(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!s) return null;
  return TT.has(s) ? s : null;
}

export function nhanTrangThai(ma: string | null): string {
  if (!ma) return 'chưa ghi';
  return TT.get(ma)?.ten ?? ma;
}

export const KENH = [
  { ma: 'email', ten: 'Email' },           // 30
  { ma: 'facebook', ten: 'Facebook' },     // 1
  { ma: 'instagram', ten: 'Instagram' },   // 2
  { ma: 'whatsapp', ten: 'WhatsApp' },
] as const;

const KENH_MA = new Set<string>(KENH.map((k) => k.ma));

export function mapKenh(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase();
  if (!s) return null;
  return KENH_MA.has(s) ? s : null;
}

export function nhanKenh(ma: string | null): string {
  if (!ma) return '—';
  return KENH.find((k) => k.ma === ma)?.ten ?? ma;
}

/**
 * Lọc rác khỏi cột `Country` của Lark.
 *
 * 22/45 dòng trả về TOÀN BỘ danh sách 75 quốc gia thay vì một nước — lookup cấu
 * hình sai. Dấu hiệu dứt khoát là DẤU PHẨY: không tên quốc gia thật nào chứa nó,
 * kể cả `Lao People's Democratic Republic` hay `Trinidad and Tobago`.
 */
export function locQuocGia(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (s.includes(',')) return null;
  return s;
}

/** Mã đánh giá đọc được: `DG-0001`. */
export function maDanhGia(so: number): string {
  return `DG-${String(so).padStart(4, '0')}`;
}
