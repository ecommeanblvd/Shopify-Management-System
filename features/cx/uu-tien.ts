/**
 * THUẦN: xếp việc CX theo mức gấp và tách tồn đọng khỏi việc phát sinh.
 *
 * Hai luật, cả hai đều rút từ số đo thật:
 *
 * 1. **Tách tồn đọng.** Đo 28/09: 204 việc đang treo, và TOÀN BỘ là hồ sơ nhập từ
 *    Lark (việc phát sinh trên hệ thống đang bằng 0). Dồn chung là mỗi sáng CX mở
 *    ra thấy 204 dòng rồi bỏ qua cả trang. Theo đúng nguyên tắc CEO chọn ở
 *    workspace nhận hàng 25/09 ("tách nhóm tồn hôm trước").
 *
 * 2. **Hạn cứng thắng mọi thứ.** Một tranh chấp nhập từ Lark sắp hết hạn nộp bằng
 *    chứng vẫn là mất tiền thật, nên nó phải nằm ở "cần làm ngay" dù thuộc nhóm
 *    tồn đọng.
 */

/** Bảy loại việc, xếp theo HẬU QUẢ nếu bỏ qua. Số nhỏ = gấp hơn. */
export const LOAI_VIEC = [
  { ma: 'tranh_chap', uuTien: 1, ten: 'Tranh chấp chưa nộp bằng chứng',
    hauQua: 'Quá hạn là mất tiền vĩnh viễn, không lùi được', href: '/f/cx/tranh-chap' },
  { ma: 'doi_tra', uuTien: 2, ten: 'Đổi trả đang chờ',
    hauQua: 'Khách đang đợi', href: '/f/customer-account/requests' },
  { ma: 'danh_gia', uuTien: 3, ten: 'Đánh giá 1–2 sao chưa xử lý',
    hauQua: 'Công khai, càng để lâu càng khó chữa', href: '/f/cx/danh-gia?cc=1' },
  { ma: 'ticket_han', uuTien: 4, ten: 'Ticket có hạn xử lý sắp đến',
    hauQua: 'Bộ phận khác đang chờ', href: '/f/cx/viec-can-lam' },
  { ma: 'su_co_xem_lai', uuTien: 5, ten: 'Sự cố cần rà lại quy trách nhiệm',
    hauQua: 'Tiền đang gán cho bộ phận Lark liệt kê đầu, chưa ai xác nhận',
    href: '/f/cx/su-co?xl=1' },
  { ma: 'su_co', uuTien: 6, ten: 'Sự cố chưa xong',
    hauQua: 'Tiền đã mất mà chưa kết luận', href: '/f/cx/su-co' },
  { ma: 'ticket', uuTien: 7, ten: 'Ticket chưa xong',
    hauQua: 'Vấn đề của khách còn treo', href: '/f/cx/viec-can-lam' },
] as const;

export type MaLoaiViec = (typeof LOAI_VIEC)[number]['ma'];

const THEO_MA = new Map<string, (typeof LOAI_VIEC)[number]>(
  LOAI_VIEC.map((l) => [l.ma, l]),
);

export function thongTinLoai(ma: string): (typeof LOAI_VIEC)[number] | undefined {
  return THEO_MA.get(ma);
}

export interface Viec {
  id: string;
  loai: string;
  /** Dòng chính hiện trên danh sách. */
  nhan: string;
  /** Dòng phụ: mã đơn, brand, số tiền… */
  phu: string | null;
  /** Số ngày còn lại tới hạn cứng; âm = quá hạn; null = không có hạn. */
  conLai: number | null;
  /** Hồ sơ nhập từ Lark — quyết định nó vào nhóm tồn đọng hay không. */
  tuLark: boolean;
  href: string;
}

export interface KhoiViec {
  loai: string;
  ten: string;
  hauQua: string;
  href: string;
  /** Tổng THẬT, không phải số dòng sau khi cắt. */
  tong: number;
  /** Tối đa `GIOI_HAN` việc gấp nhất. */
  viec: Viec[];
}

/** Số việc hiện trên mỗi khối ở trang Hôm nay. */
export const GIOI_HAN = 5;

/**
 * Một việc có hạn cứng khi nó có mốc hạn — bất kể còn bao nhiêu ngày.
 *
 * Cố ý KHÔNG dùng ngưỡng "còn dưới N ngày": hồ sơ nhập từ Lark có hạn xa vẫn cần
 * nằm trong tầm mắt, vì không ai đang theo nó cả.
 */
export function coHanCung(v: Viec): boolean {
  return v.conLai != null;
}

/** Việc vào nhóm "Cần làm ngay": phát sinh trên hệ thống, HOẶC có hạn cứng. */
export function canLamNgay(v: Viec): boolean {
  return !v.tuLark || coHanCung(v);
}

/**
 * So hai việc: gấp trước. Thứ tự — quá hạn, rồi hạn gần nhất, rồi ưu tiên loại.
 *
 * Việc KHÔNG có hạn xếp sau mọi việc có hạn: đẩy một ca sắp mất tiền xuống dưới
 * một ca không có mốc nào là sai hẳn mục đích của trang.
 */
export function soViec(a: Viec, b: Viec): number {
  const ha = a.conLai != null;
  const hb = b.conLai != null;
  if (ha !== hb) return ha ? -1 : 1;
  if (ha && hb && a.conLai !== b.conLai) return a.conLai! - b.conLai!;
  const ua = thongTinLoai(a.loai)?.uuTien ?? 99;
  const ub = thongTinLoai(b.loai)?.uuTien ?? 99;
  return ua - ub;
}

export interface KetQuaXep {
  ngay: KhoiViec[];
  tonDong: KhoiViec[];
  tongNgay: number;
  tongTonDong: number;
}

/**
 * Gom việc thành khối theo loại, tách hai nhóm, cắt còn `GIOI_HAN` mỗi khối.
 *
 * `tong` của mỗi khối là TỔNG THẬT trước khi cắt. Đây là lỗi đã mắc ở màn sổ nhập
 * 26/09: header báo "397 chiếc" trong khi kho thật có 470, vì đếm trên danh sách
 * đã bị LIMIT.
 */
export function xepViec(ds: Viec[]): KetQuaXep {
  const ngay = ds.filter(canLamNgay);
  const ton = ds.filter((v) => !canLamNgay(v));
  return {
    ngay: gomKhoi(ngay),
    tonDong: gomKhoi(ton),
    tongNgay: ngay.length,
    tongTonDong: ton.length,
  };
}

function gomKhoi(ds: Viec[]): KhoiViec[] {
  const m = new Map<string, Viec[]>();
  for (const v of ds) {
    const cur = m.get(v.loai) ?? [];
    cur.push(v);
    m.set(v.loai, cur);
  }
  return [...m]
    .map(([loai, viec]) => {
      const t = thongTinLoai(loai);
      return {
        loai,
        ten: t?.ten ?? loai,
        hauQua: t?.hauQua ?? '',
        href: t?.href ?? '/f/cx',
        tong: viec.length,
        viec: [...viec].sort(soViec).slice(0, GIOI_HAN),
      };
    })
    .sort((a, b) => (thongTinLoai(a.loai)?.uuTien ?? 99) - (thongTinLoai(b.loai)?.uuTien ?? 99));
}
