/**
 * THUẦN: chọn dòng nào được bổ sung ảnh / BBGN từ màn Sổ nhập (CEO 29/09/2026).
 *
 * Bối cảnh: đội kho nhận hàng rồi nhưng quên đính ảnh hoặc biên bản giao nhận.
 * Đo 29/09 trên 9.162 dòng Lark: **5.306 dòng thiếu ảnh** (3.149 đơn) và
 * **1.836 dòng thiếu BBGN**. Chỉ 6 dòng do SMS tạo, nên đường đẩy cũ qua phiếu
 * nhận (`dongBoAnhLenLark`) không dùng được cho phần còn lại — phải ghi thẳng
 * vào dòng Lark.
 *
 * Luật CEO chốt, theo TỪNG LOẠI file:
 *  1. Ảnh hàng đến · biên bản — tải ở một dòng thì áp cho CẢ ĐƠN trong NGÀY đó (một đơn nhiều
 *     SKU nhưng chụp chung một bộ ảnh; đo 102/135 lô dùng chung đúng một file), và dòng ĐÃ có
 *     file thì KHÔNG đụng tới: không đè, không thêm.
 *  2. Ảnh lỗi QC (03/10/2026) — chỉ áp ĐÚNG dòng đó, và CỘNG THÊM vào ô đang có. Lỗi là chuyện
 *     của từng chiếc, và bằng chứng thì còn bổ sung dài dài. Xem `CONG_THEM`.
 *
 * Luật KHÔNG đổi cho cả hai: máy không bao giờ GỠ thứ đội kho đã đưa lên.
 */

export type LoaiFile = 'hang_den' | 'bb_ban_giao' | 'loi_qc';

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
  loi_qc: 'Ảnh chụp lỗi QC fail',
};

export const TEN_LOAI: Record<LoaiFile, string> = {
  hang_den: 'Ảnh thực tế',
  bb_ban_giao: 'Biên bản giao nhận',
  loi_qc: 'Ảnh lỗi QC',
};

/**
 * Loại nào CỘNG THÊM thay vì chỉ điền vào ô trống (CEO 03/10/2026).
 *
 * Ảnh hàng đến và biên bản là ảnh chụp MỘT LẦN cho cả lô; ô đã có thì không ai cần thêm, và
 * cấm hẳn là cách chắc chắn nhất để máy không đè file đội kho đưa lên.
 *
 * Ảnh lỗi QC thì ngược: một chiếc có thể nhiều chỗ lỗi, phát hiện ở nhiều lúc, và 429/463 dòng
 * QC Failed đã có ảnh người dán tay. Chặn khi ô có sẵn là khoá luôn việc bổ sung bằng chứng.
 * Cộng thêm vẫn giữ nguyên luật gốc: KHÔNG BAO GIỜ gỡ thứ đang có.
 */
export const CONG_THEM: Record<LoaiFile, boolean> = {
  hang_den: false, bb_ban_giao: false, loi_qc: true,
};

const daCo = (d: DongKho, loai: LoaiFile): boolean =>
  loai === 'hang_den' ? d.coAnhHangDen
    : loai === 'bb_ban_giao' ? d.coBbBanGiao
    : false;   // ảnh lỗi: luôn cho thêm, xem `CONG_THEM`

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
  /* Ảnh LỖI chỉ thuộc về ĐÚNG chiếc được chụp (CEO 03/10/2026). Ảnh hàng đến và biên bản áp cho
   * cả đơn vì chụp chung một lô; nhưng một chiếc xước vai không nói gì về chiếc cùng đơn khác
   * size — rải ảnh lỗi ra cả đơn là vu cho những chiếc còn lại một lỗi chúng không có. */
  if (loai === 'loi_qc') return [goc.recordId];
  if (daCo(goc, loai)) return [];
  const ma = goc.orderNumber?.trim();
  if (!ma) return [goc.recordId];
  return ds
    .filter((d) => d.orderNumber?.trim() === ma && d.ngayImport === goc.ngayImport && !daCo(d, loai))
    .map((d) => d.recordId);
}

/**
 * THUẦN: token sau khi cộng thêm — giữ nguyên thứ tự cũ, bỏ token đã có.
 *
 * Không bao giờ trả ít hơn `dangCo`: đây là chỗ duy nhất quyết định ô đính kèm sẽ mang gì, nên
 * nó cũng là chỗ duy nhất có thể làm mất ảnh của người khác.
 */
export function gopToken(dangCo: readonly string[], moi: readonly string[]): string[] {
  return [...dangCo, ...moi.filter((t) => !dangCo.includes(t))];
}

/** THUẦN: đọc token từ ô đính kèm Lark đọc về. */
export function tokenTuO(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (x as { file_token?: unknown })?.file_token)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
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
