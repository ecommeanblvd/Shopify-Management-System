/**
 * THUẦN: giá thu khách THỰC khi đối soát từ hoá đơn carrier — dựng lại đúng công
 * thức FedEx áp cho mình (kiểm chứng bằng số thực trên bill 734104615):
 *
 *   Cước cơ bản  = bảng giá offer cho brand (đã markup theo tier) ở CÂN BILL.
 *   Phụ phí      = LẤY NGUYÊN theo bill carrier (pass-through, không markup) —
 *                  gồm cả residential/ký nhận mà lúc quote không có.
 *   Fuel         = fuel% × (cước cơ bản + phụ phí VẬN CHUYỂN). KHÔNG áp lên phí
 *                  xử lý hàng NK/customs (FedEx cũng không tính fuel khoản này).
 *   Phí xử lý    = 50.000 (cố định, chịu VAT).
 *   VAT          = vat% × (cước cơ bản + MỌI phụ phí + fuel + phí xử lý) — phí NK
 *                  KHÔNG chịu fuel nhưng VẪN chịu VAT ở bước cuối (đúng như FedEx).
 *
 * Tổng lines == chargedVnd tuyệt đối (VAT là dòng residual).
 */
import { ORDER_PROCESSING_FEE_VND } from './offer-pricing';
import type { BrandChargeLine } from './brand-pricing';

export interface ReconciledChargeInput {
  /** Cước cơ bản GỐC (chưa markup, VND) ở cân bill. */
  baseVnd: number;
  /** Markup hiệu dụng (%) theo tier brand. */
  markupPercent: number;
  /** Phụ phí VẬN CHUYỂN từ bill (vùng xa, demand, giao nhà dân, ký nhận) — CÓ fuel. */
  transportSurchargesVnd: number;
  /** Phí customs / xử lý hàng NK pass-through từ bill — KHÔNG fuel, CÓ VAT. */
  customsSurchargesVnd: number;
  fuelPercent: number;
  vatPercent: number;
  serviceLabel: string;
}

export interface ReconciledCharge {
  chargedVnd: number;
  markedBaseVnd: number;
  fuelVnd: number;
  processingExVatVnd: number;
  vatVnd: number;
  lines: BrandChargeLine[];
}

export function reconciledBrandCharge(i: ReconciledChargeInput): ReconciledCharge {
  const f = i.fuelPercent / 100;
  const v = i.vatPercent / 100;
  const markedBase = Math.round(i.baseVnd * (1 + i.markupPercent / 100));
  const transport = Math.round(i.transportSurchargesVnd);
  const customs = Math.round(i.customsSurchargesVnd);
  // Fuel CHỈ trên cước + phụ phí vận chuyển (không gồm customs) — đúng FedEx.
  const fuel = Math.round((markedBase + transport) * f);
  const processingExVat = Math.round(ORDER_PROCESSING_FEE_VND);
  // VAT ở bước cuối trên TẤT CẢ (gồm cả customs + fuel + phí xử lý).
  const vatBase = markedBase + transport + customs + fuel + processingExVat;
  const vat = Math.round(vatBase * v);
  const chargedVnd = vatBase + vat;

  const lines: BrandChargeLine[] = [
    { label: `Cước cơ bản (${i.serviceLabel})`, amountVnd: markedBase },
  ];
  if (transport > 0) lines.push({ label: 'Phụ phí vận chuyển (theo bill)', amountVnd: transport });
  if (customs > 0) lines.push({ label: 'Phí xử lý hàng NK (theo bill)', amountVnd: customs });
  lines.push({ label: 'Phụ phí xăng dầu', amountVnd: fuel });
  lines.push({ label: 'Phí xử lý đơn hàng', amountVnd: processingExVat });
  lines.push({ label: 'VAT', amountVnd: vat });

  return { chargedVnd, markedBaseVnd: markedBase, fuelVnd: fuel, processingExVatVnd: processingExVat, vatVnd: vat, lines };
}
