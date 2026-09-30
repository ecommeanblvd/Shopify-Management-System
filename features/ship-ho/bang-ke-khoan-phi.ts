/**
 * THUẦN: bóc KHOẢN PHÍ từng đơn thành payload gửi MMP (CEO 30/09/2026).
 *
 * Vì sao cần: bảng kê gửi MMP trước nay chỉ có MỘT con số `amountVnd` mỗi đơn. Kế toán bên MMP
 * không có gì để đối soát ngoài con số cuối, nên họ vẫn phải xin file tay của Đức — file có 22
 * cột khoản phí. Đối soát 30/09 chứng minh số của SMS khớp file Đức 26/26 ở phần cước, nên
 * đưa được thẳng khoản phí sang thay vì để họ đọc bản tay.
 *
 * CHỈ VẾ THU. Không có giá vốn, không có lãi — đúng như file Đức (đã đọc file thật, không suy
 * từ mã). Cộng `amountVnd` của mọi khoản luôn ra `totalVnd`, có test canh.
 *
 * MÃ KHOÁ ỔN ĐỊNH, KHÔNG PHẢI NHÃN TIẾNG VIỆT. MMP sẽ lập trình dựa trên payload này; nhãn là
 * chữ hiển thị và đã đổi vài lần trong dự án. Khoá bằng nhãn là mỗi lần sửa câu chữ lại làm
 * hỏng hệ thống của đối tác — nhãn vẫn gửi kèm, nhưng chỉ để người đọc.
 */
import type { ShipHoPriceStructure } from './price-structure';

/** Mã khoản phí gửi MMP. THÊM mã mới thì thêm vào đây VÀ vào `MA_THEO_NHAN`. */
export type MaKhoanPhi =
  | 'base' | 'fuel' | 'signature' | 'demand' | 'remote' | 'residential'
  | 'import_handling' | 'address_correction' | 'vat' | 'processing'
  | 'weight_adjust' | 'other_surcharge' | 'duty';

/**
 * Nhãn trong `price-structure.ts` → mã ổn định.
 *
 * So bằng "nhãn BẮT ĐẦU bằng" chứ không so tuyệt đối: vài nhãn có phần giải thích trong ngoặc
 * ("Ký nhận (direct signature)", "Thuế / hải quan (duty) — ngoài cước, thu hộ") và phần đó là
 * chữ cho người đọc, đổi được.
 */
export const MA_THEO_NHAN: ReadonlyArray<readonly [string, MaKhoanPhi]> = [
  ['Cước cơ bản', 'base'],
  ['Phụ phí xăng dầu', 'fuel'],
  ['Ký nhận', 'signature'],
  ['Phụ phí nhu cầu', 'demand'],
  ['Phụ phí vùng xa', 'remote'],
  ['Giao nhà dân', 'residential'],
  ['Phí xử lý hàng nhập khẩu', 'import_handling'],
  ['Phí sửa địa chỉ', 'address_correction'],
  ['VAT', 'vat'],
  ['Phí xử lý đơn hàng', 'processing'],
  ['Điều chỉnh khớp số đã ghi', 'weight_adjust'],
  ['Phụ phí khác', 'other_surcharge'],
  ['Thuế / hải quan', 'duty'],
];

/** Dòng TỔNG do `price-structure` thêm vào để hiển thị — không phải khoản phí. */
const LA_DONG_TONG = (nhan: string) => /^Tổng/.test(nhan);

export function maCuaNhan(nhan: string): MaKhoanPhi | null {
  for (const [dau, ma] of MA_THEO_NHAN) if (nhan.startsWith(dau)) return ma;
  return null;
}

export interface KhoanPhiMmp {
  /** Mã ổn định — MMP lập trình theo cái này. */
  code: MaKhoanPhi;
  /** Nhãn tiếng Việt, CHỈ để người đọc. Có thể đổi bất cứ lúc nào. */
  label: string;
  amountVnd: number;
  /** % của khoản tính theo tỉ lệ (nhiên liệu, VAT). Vắng mặt ở khoản không theo %. */
  percent?: number;
}

export interface BocKhoanPhi {
  fees: KhoanPhiMmp[];
  totalVnd: number;
  /** Nhãn KHÔNG ánh xạ được — phải rỗng, có test canh. Còn dòng ở đây là payload thiếu tiền. */
  nhanLa: string[];
}

/**
 * Bóc khoản phí từ cấu trúc giá.
 *
 * BỎ khoản bằng 0: file của Đức có cột 0đ vì đó là bảng cố định cột, còn payload là dữ liệu —
 * gửi hai chục khoản 0 mỗi đơn chỉ làm nặng và làm người đọc phải lọc. MMP muốn bày đủ cột thì
 * khoản vắng mặt = 0.
 *
 * KHÔNG bỏ khoản ÂM: "Điều chỉnh khớp số đã ghi" có thể âm, và bỏ nó là tổng không khớp.
 */
export function bocKhoanPhi(s: ShipHoPriceStructure | null): BocKhoanPhi {
  if (!s) return { fees: [], totalVnd: 0, nhanLa: [] };
  const fees: KhoanPhiMmp[] = [];
  const nhanLa: string[] = [];
  for (const r of s.rows) {
    if (LA_DONG_TONG(r.label)) continue;
    const tien = Math.round(r.chargeVnd ?? 0);
    const ma = maCuaNhan(r.label);
    if (!ma) { if (tien !== 0) nhanLa.push(r.label); continue; }
    if (tien === 0) continue;
    fees.push({
      code: ma, label: r.label, amountVnd: tien,
      // `billPercent` là % hiệu lực carrier áp trên BILL; đúng hơn `percent` (rate lock lúc
      // báo giá) vì fuel đổi hàng tuần. Rơi về `percent` khi chưa có bill.
      ...(r.billPercent != null || r.percent != null ? { percent: r.billPercent ?? r.percent ?? undefined } : {}),
    });
  }
  return { fees, totalVnd: fees.reduce((t, f) => t + f.amountVnd, 0), nhanLa };
}
