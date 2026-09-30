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

/** Nhãn khoản duty khi dựng thẳng từ cột `actual_duty_vnd` (không qua cấu trúc giá). */
export const NHAN_DUTY_NGAN = 'Thuế / hải quan (duty) — ngoài cước, thu hộ';

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
export function bocKhoanPhi(
  s: ShipHoPriceStructure | null,
  /**
   * Loại bảng kê — QUYẾT ĐỊNH khoản nào thuộc về nó.
   *
   * Duty đi ở bảng kê RIÊNG (`type: 'duty'`), còn `amountVnd` của bảng kê cước là
   * `actual_charged_vnd` — CHỈ CƯỚC, không gồm duty. Nhét duty vào `fees` của bảng kê cước
   * là phá đúng bất biến đã cam kết với MMP: `sum(fees) === amountVnd`.
   *
   * Lỗi này lọt qua test đầu tiên của em vì em so tổng với `cước + duty` thay vì với
   * `amountVnd` thật — test sai bất biến thì xanh cũng vô nghĩa. MMP phát hiện gián tiếp khi
   * đề xuất trả 422 nếu tổng không khớp (30/09/2026).
   */
  loai: 'freight' | 'duty' = 'freight',
  /**
   * Duty ở CỘT `ship_ho_orders.actual_duty_vnd` — lưới an toàn cho bảng kê duty.
   *
   * Vì sao cần (đo production 30/09/2026): đơn #KLS2068 không dựng được cấu trúc giá vì thiếu
   * `quoteBreakdown`, nên hàm này trả `fees` RỖNG trong khi bảng kê duty vẫn ghi amountVnd =
   * 199.581đ — đúng cảnh MMP đề xuất trả 422. Duty KHÔNG cần cấu trúc giá: nó là con số nguyên
   * ở cột, không markup, không VAT.
   *
   * CHỈ là lưới: bóc được từ cấu trúc giá thì giữ nguyên kết quả đó, không ghi đè.
   * Bảng kê CƯỚC không bao giờ đụng tới tham số này.
   */
  dutyVndCot?: number | null,
): BocKhoanPhi {
  const tuCot = (): BocKhoanPhi => {
    const v = Math.round(dutyVndCot ?? 0);
    return loai === 'duty' && v !== 0
      ? { fees: [{ code: 'duty', label: NHAN_DUTY_NGAN, amountVnd: v }], totalVnd: v, nhanLa: [] }
      : { fees: [], totalVnd: 0, nhanLa: [] };
  };
  if (!s) return tuCot();
  const fees: KhoanPhiMmp[] = [];
  const nhanLa: string[] = [];
  for (const r of s.rows) {
    if (LA_DONG_TONG(r.label)) continue;
    const tien = Math.round(r.chargeVnd ?? 0);
    const ma = maCuaNhan(r.label);
    if (!ma) { if (tien !== 0) nhanLa.push(r.label); continue; }
    // Bảng kê cước KHÔNG mang duty; bảng kê duty mang ĐÚNG duty.
    if (loai === 'duty' ? ma !== 'duty' : ma === 'duty') continue;
    if (tien === 0) continue;
    fees.push({
      code: ma, label: r.label, amountVnd: tien,
      // `billPercent` là % hiệu lực carrier áp trên BILL; đúng hơn `percent` (rate lock lúc
      // báo giá) vì fuel đổi hàng tuần. Rơi về `percent` khi chưa có bill.
      ...(r.billPercent != null || r.percent != null ? { percent: r.billPercent ?? r.percent ?? undefined } : {}),
    });
  }
  if (fees.length === 0 && nhanLa.length === 0) return tuCot();
  return { fees, totalVnd: fees.reduce((t, f) => t + f.amountVnd, 0), nhanLa };
}
