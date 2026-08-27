/**
 * Chuyển hoá đơn điện tử Việt Nam (vn-einvoice.ts) thành bill + dòng bill của
 * hệ thống.
 *
 * Nguyên tắc xuyên suốt: hoá đơn tài chính chỉ có TỔNG TIỀN mỗi vận đơn. Không
 * suy ra cước gốc / phụ phí xăng dầu / cân nặng bằng cách chia tỉ lệ — số bịa
 * trông y như số thật và sẽ âm thầm làm sai đối soát. Thà để trống, kèm ghi chú
 * nói rõ vì sao trống.
 */
import { periodFromLines, type VnEInvoice } from './vn-einvoice';

export interface VnBillLine {
  trackingNumber: string;
  /** Tiền chưa thuế của vận đơn, ĐÃ trừ chiết khấu. Hoá đơn không tách phụ phí
   *  nên đây là toàn bộ cước. */
  base: number;
  /** Chiết khấu hoá đơn ghi cho dòng. Null khi nguồn không tách (bản in PDF). */
  discount: number | null;
  /** Null khi nguồn không có thuế từng dòng (bản PDF). */
  vat: number | null;
  total: number;
  /** Luôn null: hoá đơn tài chính không in các khoản này. */
  fuel: null;
  other: null;
  weightKg: null;
  note: string;
}

export interface VnBillPrefill {
  billNumber: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  amount: number;
  currency: string;
  note: string;
  lines: VnBillLine[];
  warnings: string[];
}

export function vnInvoiceToBill(
  inv: VnEInvoice,
  accountCurrency: string,
  /** Đồng HIỂN THỊ của tài khoản. Aramex tính giá bằng USD nhưng hiển thị VND,
   *  nên hoá đơn VND là đúng — thiếu tham số này sẽ báo động nhầm mỗi lần nhập. */
  displayCurrency?: string,
): VnBillPrefill {
  const { periodStart, periodEnd } = periodFromLines(inv.lines.map((l) => l.description), inv.issueDate);
  const warnings = [...inv.warnings];

  const thieuVanDon = inv.lines.filter((l) => !l.trackingNumber).length;
  if (thieuVanDon > 0) {
    warnings.push(`${thieuVanDon} dòng không có số vận đơn (phí dịch vụ khác) — không nhập thành dòng bill, nhưng vẫn nằm trong tổng hoá đơn.`);
  }

  // Tiền tệ theo HOÁ ĐƠN. Lấy theo tài khoản là biến 42 triệu đồng thành 42
  // triệu đô. Aramex tính giá bằng USD nhưng hiển thị VND nên hoá đơn VND khớp
  // đồng hiển thị — chỉ báo động khi lệch CẢ HAI.
  const hopLe = inv.currency === accountCurrency || (displayCurrency ? inv.currency === displayCurrency : false);
  if (!hopLe) {
    warnings.push(`Hoá đơn ghi ${inv.currency} nhưng tài khoản carrier đặt ${accountCurrency}${displayCurrency && displayCurrency !== accountCurrency ? ` (hiển thị ${displayCurrency})` : ''} — bill lưu theo ${inv.currency}, đối soát cần quy đổi.`);
  }

  const lines: VnBillLine[] = inv.lines
    .filter((l): l is typeof l & { trackingNumber: string } => !!l.trackingNumber)
    .map((l) => ({
      trackingNumber: l.trackingNumber,
      base: l.amountExVat,
      discount: l.discount,
      vat: l.vatAmount,
      total: l.total,
      fuel: null,
      other: null,
      weightKg: null,
      note: 'Hoá đơn GTGT — không tách phụ phí xăng dầu/vùng sâu vùng xa',
    }));

  const nguoiBan = [inv.sellerName, inv.sellerTaxCode ? `MST ${inv.sellerTaxCode}` : null]
    .filter(Boolean).join(' · ');
  const note = [inv.serial ? `Hoá đơn ${inv.serial}-${inv.billNumber}` : `Hoá đơn ${inv.billNumber}`, nguoiBan]
    .filter(Boolean).join(' · ');

  return {
    billNumber: inv.billNumber,
    periodStart,
    periodEnd,
    issueDate: inv.issueDate,
    // Số PHẢI TRẢ — đã gồm thuế, khớp dòng "Tổng tiền thanh toán" trên hoá đơn.
    amount: inv.amountInclVat,
    currency: inv.currency,
    note,
    lines,
    warnings,
  };
}
