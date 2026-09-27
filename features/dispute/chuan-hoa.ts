/**
 * THUẦN: chuẩn hoá dữ liệu tranh chấp về MỘT từ vựng.
 *
 * Lấy từ vựng của Shopify làm chuẩn vì Shopify là nguồn đúng (trạng thái, hạn
 * nộp, số tiền đều do nó quyết), rồi dịch dữ liệu chép tay của Lark vào đó.
 */

export const TRANG_THAI = [
  'needs_response', 'under_review', 'won', 'lost', 'accepted', 'charge_refunded', 'closed',
] as const;
export type TrangThai = (typeof TRANG_THAI)[number];

export const NHAN_TRANG_THAI: Record<TrangThai, string> = {
  needs_response: 'Cần phản hồi',
  under_review: 'Đang xem xét',
  won: 'Thắng',
  lost: 'Thua',
  accepted: 'Đã chấp nhận',
  charge_refunded: 'Đã hoàn tiền',
  closed: 'Đã đóng',
};

/** Trạng thái còn phải làm gì — quyết định ca nào lên khối "Cần phản hồi". */
export const DANG_MO: TrangThai[] = ['needs_response', 'under_review'];

export function dangMo(t: string): boolean {
  return (DANG_MO as readonly string[]).includes(t);
}

/**
 * Shopify `DisputeStatus` hoặc `Status` của Lark → trạng thái bên mình.
 * Giá trị lạ trả `null` để nơi gọi quyết định, chứ không âm thầm coi là `closed`.
 */
export function mapTrangThai(v: string | null | undefined): TrangThai | null {
  const s = (v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (s) {
    case 'needs_response': case 'open': return 'needs_response';
    case 'under_review': return 'under_review';
    case 'won': return 'won';
    case 'lost': return 'lost';
    case 'accepted': return 'accepted';
    case 'charge_refunded': return 'charge_refunded';
    case 'closed': return 'closed';
    default: return null;
  }
}

/**
 * Lý do. Shopify chỉ cần hạ chữ thường; Lark thì phải dịch.
 *
 * Giá trị lạ GIỮ NGUYÊN (hạ chữ thường) chứ không ép về `khac`: Shopify thêm lý
 * do mới là chuyện thường, ép về `khac` là mất thông tin vĩnh viễn.
 */
const LY_DO_LARK: Record<string, string> = {
  'item not received': 'product_not_received',
  'product not received': 'product_not_received',
  'product unacceptable': 'product_unacceptable',
  'item not as described': 'product_unacceptable',
  'credit not processed': 'credit_not_processed',
  'missing refund or credit': 'credit_not_processed',
  // "Fradulent" là lỗi gõ trên chính bảng Lark — giữ cả hai cách viết.
  fradulent: 'fraudulent',
  fraudulent: 'fraudulent',
  'unauthorized transaction': 'fraudulent',
  'did not authorize': 'fraudulent',
  'duplicate payment': 'duplicate',
};

export function mapLyDo(v: string | null | undefined): string | null {
  const raw = (v ?? '').trim();
  if (!raw) return null;
  const s = raw.toLowerCase();
  return LY_DO_LARK[s] ?? s.replace(/[\s-]+/g, '_');
}

export const NHAN_LY_DO: Record<string, string> = {
  product_not_received: 'Chưa nhận được hàng',
  product_unacceptable: 'Hàng không đạt',
  credit_not_processed: 'Chưa hoàn tiền như đã hứa',
  fraudulent: 'Giao dịch gian lận',
  duplicate: 'Thanh toán trùng',
  subscription_cancelled: 'Đã huỷ đăng ký',
  unrecognized: 'Không nhận ra giao dịch',
  general: 'Lý do chung',
  incorrect_account_details: 'Sai thông tin tài khoản',
  insufficient_funds: 'Không đủ số dư',
  bank_cannot_process: 'Ngân hàng không xử lý được',
  debit_not_authorized: 'Ghi nợ không được cho phép',
  customer_initiated: 'Khách tự mở tranh chấp',
};

export function nhanLyDo(ma: string | null): string {
  if (!ma) return '—';
  return NHAN_LY_DO[ma] ?? ma;
}

export const CONG = [
  { ma: 'shopify_payments', ten: 'Shopify Payments' },
  { ma: 'paypal', ten: 'PayPal' },
  { ma: 'stripe', ten: 'Stripe' },
] as const;
export type MaCong = (typeof CONG)[number]['ma'];

/** Lark ghi `Stripes` và `Stripes mới` là CÙNG một cổng Stripe. */
export function mapCongThanhToan(v: string | null | undefined): MaCong | null {
  const s = (v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('shopify')) return 'shopify_payments';
  if (s.startsWith('paypal')) return 'paypal';
  if (s.startsWith('stripe')) return 'stripe';
  return null;
}

export function nhanCong(ma: string | null): string {
  return CONG.find((c) => c.ma === ma)?.ten ?? ma ?? '—';
}

export const LOAI = ['chargeback', 'inquiry'] as const;
export function mapLoai(v: string | null | undefined): 'chargeback' | 'inquiry' {
  return (v ?? '').trim().toLowerCase() === 'inquiry' ? 'inquiry' : 'chargeback';
}

/**
 * Còn bao nhiêu ngày tới hạn nộp bằng chứng. Âm = đã quá hạn, `null` = không có hạn.
 *
 * Làm tròn LÊN theo ngày: hạn còn 6 tiếng vẫn là "còn 1 ngày", không phải 0 —
 * hiện 0 cho một ca vẫn nộp được là làm người dùng bỏ luôn ca đó.
 */
export function conBaoNhieuNgay(hanNop: Date | null, moc: Date): number | null {
  if (!hanNop) return null;
  return Math.ceil((hanNop.getTime() - moc.getTime()) / 86_400_000);
}

export type CapBaoDong = 'qua_han' | 'gap' | 'sap' | 'binh_thuong' | 'khong_han';

/**
 * Mức gấp của một ca, để UI tô màu và xếp thứ tự.
 *
 * Mốc 3 và 7 ngày chọn theo dữ liệu thật: hạn nộp của Shopify cách ngày mở
 * 16–40 ngày, và trung vị Open→Closed của CX là 23 ngày. Dưới 3 ngày là gần như
 * chắc mất nếu chưa bắt tay vào.
 */
export function capBaoDong(conLai: number | null, daNop: boolean): CapBaoDong {
  if (daNop) return 'binh_thuong';
  if (conLai == null) return 'khong_han';
  if (conLai < 0) return 'qua_han';
  if (conLai <= 3) return 'gap';
  if (conLai <= 7) return 'sap';
  return 'binh_thuong';
}
