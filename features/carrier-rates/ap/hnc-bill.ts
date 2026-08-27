/**
 * Ghép BẢNG KÊ Excel của Hợp Nhất với HOÁ ĐƠN điện tử cùng kỳ thành một bill.
 *
 * Mỗi file giữ một nửa sự thật và không file nào thay được file kia:
 *   - bảng kê Excel: ngày gửi, nước đến, cân nặng, cước gốc, phụ phí xăng dầu,
 *     phí phát sinh, tỉ giá — nhưng KHÔNG có số hoá đơn và không có tiền thuế
 *     từng vận đơn
 *   - hoá đơn XML: số hoá đơn, thuế từng dòng, chữ ký số — nhưng mỗi vận đơn
 *     chỉ còn một con số tổng
 *
 * Ghép qua số vận đơn quốc tế. Kiểm chứng kỳ 25/07–22/08/2026: 36 vận đơn khớp
 * từng đồng giữa hai file.
 */
import type { HncManifest } from './hnc-manifest';
import type { VnEInvoice } from './vn-einvoice';

export interface HncBillLine {
  trackingNumber: string;
  orderNumber: string | null;
  weightKg: number | null;
  /** Cước gốc quy ra tiền Việt. Null khi bảng kê thiếu tỉ giá. */
  base: number | null;
  fuel: number | null;
  /** Phí phát sinh — hãng gộp một cột, không tách tên khoản. */
  other: number | null;
  /** Thuế của vận đơn, lấy từ hoá đơn. Null khi nhập bảng kê mà chưa có hoá đơn. */
  vat: number | null;
  /** Tổng chưa thuế theo bảng kê (đã khớp hoá đơn). */
  total: number;
  shipDate: string | null;
  note: string;
  /** Số tiền gốc bằng đô, giữ lại để tra ngược khi hãng và ta lệch nhau. */
  charges: Array<{ name: string; usd: number | null; vnd: number | null }>;
}

export interface HncBillPrefill {
  billNumber: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string | null;
  amount: number;
  currency: string;
  /** Tỉ giá hãng dùng cho kỳ này, đọc thẳng từ bảng kê. Đối soát các đơn thuộc
   *  hoá đơn phải quy đổi theo số này. */
  fxRate: number | null;
  note: string;
  lines: HncBillLine[];
  warnings: string[];
}

const vnd = (usd: number | null, fx: number | null): number | null =>
  usd === null || fx === null ? null : Math.round(usd * fx);

export function ghepBangKeVoiHoaDon(
  bangKe: HncManifest,
  hoaDon: VnEInvoice | null,
): HncBillPrefill {
  const warnings = [...bangKe.warnings, ...(hoaDon?.warnings ?? [])];
  const fx = bangKe.fxRate;

  if (fx === null) {
    warnings.push('Bảng kê không đọc được tỉ giá — không quy đổi được cước gốc và phụ phí, chỉ giữ tổng theo tiền Việt.');
  }

  const thueTheoVanDon = new Map(
    (hoaDon?.lines ?? [])
      .filter((l): l is typeof l & { trackingNumber: string } => !!l.trackingNumber)
      .map((l) => [l.trackingNumber, l]),
  );

  const lines: HncBillLine[] = bangKe.lines.map((l) => {
    const hd = thueTheoVanDon.get(l.trackingNumber);
    const total = l.totalVnd ?? 0;
    const fuel = vnd(l.fuelUsd, fx);
    const other = vnd(l.extraUsd, fx);
    // Quy đổi từng khoản rồi làm tròn có thể lệch vài đồng so với tổng hãng
    // ghi. Cho cước gốc gánh phần lẻ để cộng ba khoản luôn ra đúng tổng —
    // nếu không, mọi dòng trên màn hình đối soát đều hiện chênh lệch lặt vặt.
    const base = fuel === null || other === null ? null : total - fuel - other;

    if (hd && hd.amountExVat !== total) {
      warnings.push(`Vận đơn ${l.trackingNumber}: bảng kê ghi ${total.toLocaleString('vi-VN')}₫ nhưng hoá đơn ghi ${hd.amountExVat.toLocaleString('vi-VN')}₫.`);
    }

    return {
      trackingNumber: l.trackingNumber,
      orderNumber: null,
      weightKg: l.weightKg,
      base,
      fuel,
      other,
      vat: hd?.vatAmount ?? null,
      total,
      shipDate: l.shipDate,
      note: [l.destination, l.hncBill ? `bill HNC ${l.hncBill}` : null].filter(Boolean).join(' · '),
      charges: [
        { name: 'Cước gốc', usd: l.baseUsd, vnd: base },
        { name: 'Phụ phí xăng dầu', usd: l.fuelUsd, vnd: fuel },
        { name: 'Phí phát sinh', usd: l.extraUsd, vnd: other },
      ],
    };
  });

  // Vận đơn có trên hoá đơn mà bảng kê thiếu: bỏ im là bill thiếu tiền so với
  // số phải trả, nên phải nói ra.
  const coTrongBangKe = new Set(bangKe.lines.map((l) => l.trackingNumber));
  for (const t of thueTheoVanDon.keys()) {
    if (!coTrongBangKe.has(t)) warnings.push(`Vận đơn ${t} có trên hoá đơn nhưng không có trong bảng kê.`);
  }

  const tongPhaiTra = hoaDon?.amountInclVat ?? bangKe.amountInclVat ?? 0;
  if (hoaDon && bangKe.amountInclVat !== null && hoaDon.amountInclVat !== bangKe.amountInclVat) {
    warnings.push(`Tổng thanh toán lệch giữa hai file: bảng kê ${bangKe.amountInclVat.toLocaleString('vi-VN')}₫ vs hoá đơn ${hoaDon.amountInclVat.toLocaleString('vi-VN')}₫.`);
  }

  const gonNgay = (d: string | null) => (d ?? '').replace(/-/g, '');
  const periodStart = bangKe.periodStart ?? hoaDon?.issueDate ?? '';
  const periodEnd = bangKe.periodEnd ?? hoaDon?.issueDate ?? '';

  let billNumber: string;
  if (hoaDon) {
    billNumber = hoaDon.billNumber;
  } else {
    // Chưa có hoá đơn: đặt số tạm theo kỳ để tải lại cùng bảng kê thì CẬP NHẬT
    // chứ không đẻ thêm bill trùng.
    billNumber = `BK-${gonNgay(periodStart)}-${gonNgay(periodEnd)}`;
    warnings.push('Bảng kê chưa có hoá đơn kèm theo — bill mang số tạm theo kỳ và chưa có thuế từng vận đơn. Tải file XML hoá đơn để hoàn tất.');
  }

  const note = [
    hoaDon?.serial ? `Hoá đơn ${hoaDon.serial}-${hoaDon.billNumber}` : 'Bảng kê HNC (chưa có hoá đơn)',
    hoaDon?.sellerName ?? 'CÔNG TY CỔ PHẦN HỢP NHẤT QUỐC TẾ',
    hoaDon?.sellerTaxCode ? `MST ${hoaDon.sellerTaxCode}` : null,
    fx ? `tỉ giá ${fx.toLocaleString('vi-VN')}` : null,
  ].filter(Boolean).join(' · ');

  return {
    billNumber,
    periodStart,
    periodEnd,
    issueDate: hoaDon?.issueDate ?? null,
    amount: tongPhaiTra,
    currency: hoaDon?.currency ?? 'VND',
    fxRate: fx,
    note,
    lines,
    warnings,
  };
}
