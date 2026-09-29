/**
 * THUẦN: chọn dòng nào được bổ sung ảnh / BBGN từ màn Sổ nhập (CEO 29/09/2026).
 *
 * Bối cảnh: đội kho nhận hàng rồi nhưng quên đính ảnh hoặc biên bản giao nhận.
 * Đo 29/09 trên 9.162 dòng Lark: **5.306 dòng thiếu ảnh** (3.149 đơn) và
 * **1.836 dòng thiếu BBGN**. Chỉ 6 dòng do SMS tạo, nên đường đẩy cũ qua phiếu
 * nhận (`dongBoAnhLenLark`) không dùng được cho phần còn lại — phải ghi thẳng
 * vào dòng Lark.
 *
 * Hai luật CEO chốt:
 *  1. Tải ở một dòng thì áp cho CẢ ĐƠN trong NGÀY đó — một đơn nhiều SKU nhưng
 *     chụp chung một bộ ảnh (code cũ đo 102/135 lô dùng chung đúng một file).
 *  2. Dòng ĐÃ có file thì KHÔNG đụng tới: không đè, không thêm. Máy không bao
 *     giờ sửa thứ đội kho đã đưa lên.
 */

export type LoaiFile = 'hang_den' | 'bb_ban_giao';

export interface DongKho {
  recordId: string;
  ngayImport: string | null;
  orderNumber: string | null;
  coAnhHangDen: boolean;
  coBbBanGiao: boolean;
}

export const COT_LARK: Record<LoaiFile, string> = {
  hang_den: 'Ảnh Thực Tế SP',
  bb_ban_giao: 'BB Giao Nhận',
};

export const TEN_LOAI: Record<LoaiFile, string> = {
  hang_den: 'Ảnh thực tế',
  bb_ban_giao: 'Biên bản giao nhận',
};

const daCo = (d: DongKho, loai: LoaiFile): boolean =>
  loai === 'hang_den' ? d.coAnhHangDen : d.coBbBanGiao;

/**
 * Những dòng sẽ được gắn file khi tải từ một dòng gốc.
 *
 * Cùng ĐƠN và cùng NGÀY NHẬP với dòng gốc, và CHƯA có file loại đó. Cùng ngày là
 * điều kiện bắt buộc: một đơn có thể về làm nhiều đợt, mỗi đợt ảnh khác nhau —
 * gắn ảnh đợt này sang đợt khác là nói dối về thứ đã nhận.
 *
 * Đơn TRỐNG mã (272 dòng đo được) thì chỉ áp đúng dòng gốc — không có gì để gom.
 */
export function dongDuocGan(ds: readonly DongKho[], goc: DongKho, loai: LoaiFile): string[] {
  if (daCo(goc, loai)) return [];
  const ma = goc.orderNumber?.trim();
  if (!ma) return [goc.recordId];
  return ds
    .filter((d) => d.orderNumber?.trim() === ma && d.ngayImport === goc.ngayImport && !daCo(d, loai))
    .map((d) => d.recordId);
}

/** Giá trị ghi vào ô đính kèm Lark — đúng dạng API bitable nhận. */
export function oDinhKem(tokens: readonly string[]): { file_token: string }[] {
  return tokens.map((t) => ({ file_token: t }));
}

/** Tên file hợp lệ để tải lên: chỉ ảnh và PDF, tối đa 20MB mỗi file. */
export const KIEU_CHO_PHEP = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf'] as const;
export const CO_TOI_DA = 20 * 1024 * 1024;

export function kiemFile(ten: string, kieu: string, co: number): string | null {
  if (!(KIEU_CHO_PHEP as readonly string[]).includes(kieu)) {
    return `${ten}: chỉ nhận ảnh (PNG/JPG/WEBP/HEIC) hoặc PDF.`;
  }
  if (co > CO_TOI_DA) return `${ten}: nặng hơn 20MB.`;
  if (co === 0) return `${ten}: tệp rỗng.`;
  return null;
}
