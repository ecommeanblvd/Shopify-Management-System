/**
 * THUẦN: luật trạng thái của ticket CX.
 *
 * Hai tầng trạng thái, cố ý tách rời:
 *  - TICKET: `moi` → `dang_xu_ly` → `xong` (đúng `New case`/`Processing`/`Done`
 *    của Lark).
 *  - PHẦN VIỆC của từng bộ phận: `dang_xu_ly` / `da_xu_ly` / `chua_du_thong_tin`
 *    (đúng ba giá trị `CS Process`, `MER Process`… của Lark).
 *
 * Trên Lark 259/675 dòng (38%) để TRỐNG cột `Status TODO` — không ai biết ticket
 * đó còn sống hay đã xong. Ở đây trạng thái là bắt buộc, có mặc định.
 */

export const TRANG_THAI_TICKET = ['moi', 'dang_xu_ly', 'xong'] as const;
export type TrangThaiTicket = (typeof TRANG_THAI_TICKET)[number];

export const TRANG_THAI_VIEC = ['dang_xu_ly', 'da_xu_ly', 'chua_du_thong_tin'] as const;
export type TrangThaiViec = (typeof TRANG_THAI_VIEC)[number];

export const NHAN_TICKET: Record<TrangThaiTicket, string> = {
  moi: 'Mới', dang_xu_ly: 'Đang xử lý', xong: 'Xong',
};
export const NHAN_VIEC: Record<TrangThaiViec, string> = {
  dang_xu_ly: 'Đang xử lý', da_xu_ly: 'Đã xử lý', chua_du_thong_tin: 'Chưa đủ thông tin',
};

/**
 * `xong` là ĐÓNG HẲN: mở lại một ticket đã đóng làm mọi thống kê thời gian xử lý
 * sai, nên muốn tiếp tục thì tạo ticket mới và dẫn chiếu ticket cũ.
 */
export function chuyenDuocTrangThai(tu: string, den: string): boolean {
  if (tu === den) return false;
  if (tu === 'xong') return false;
  return (TRANG_THAI_TICKET as readonly string[]).includes(tu)
    && (TRANG_THAI_TICKET as readonly string[]).includes(den);
}

export function trangThaiVietHopLe(v: string): boolean {
  return (TRANG_THAI_VIEC as readonly string[]).includes(v);
}

/**
 * Bộ phận CHƯA xong — dùng để cảnh báo lúc đóng ticket.
 *
 * CEO 25/09: "không muốn chặn cứng mà chỉ hiện lên thông báo noti để người dùng
 * biết". Nên hàm này TRẢ VỀ danh sách để UI hiện, KHÔNG phải cờ chặn.
 * `chua_du_thong_tin` cũng tính là chưa xong: bộ phận đó đang đợi thêm dữ liệu.
 */
export function boPhanConTac(
  phanViec: { boPhan: string; trangThai: string }[],
): string[] {
  return phanViec.filter((p) => p.trangThai !== 'da_xu_ly').map((p) => p.boPhan);
}

/**
 * Ai được ghi phần việc của bộ phận nào.
 *
 * `toanQuyen` = người có `manage_cx_ticket` (CX). CEO 27/09 chốt CX được GHI HỘ
 * bộ phận chưa có tài khoản — hệ thống mới chỉ có 4 tài khoản, không có CX,
 * MERCHANDISE, PROCUREMENT hay WAREHOUSE.
 *
 * Người không toàn quyền chỉ ghi được phần của CHÍNH bộ phận mình; chưa gắn bộ
 * phận thì không ghi được gì.
 */
export function ghiDuocPhanViec(
  toanQuyen: boolean, boPhanCuaNguoi: string | null, boPhanDich: string,
): boolean {
  if (toanQuyen) return true;
  return boPhanCuaNguoi != null && boPhanCuaNguoi === boPhanDich;
}

/** Ghi vào phần việc của bộ phận KHÁC mình là ghi hộ — đánh dấu để sau đo được
 *  bộ phận nào cần mở tài khoản trước. */
export function laGhiHo(boPhanCuaNguoi: string | null, boPhanDich: string): boolean {
  return boPhanCuaNguoi !== boPhanDich;
}
