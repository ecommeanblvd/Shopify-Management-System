/**
 * THUẦN: dựng cấu trúc giá cho 1 đơn ship hộ để đối chiếu 3 con số theo từng khoản:
 *   - Chi phí Carrier DỰ TÍNH (mình trả, từ quoteBreakdown, quy VND).
 *   - Cước TỪ CARRIER (thực, từ hoá đơn carrier đã đối soát — actualBillBreakdown).
 *   - Giá thu khách DỰ TÍNH (tái dùng computeBrandCharge → khớp tuyệt đối chargedVnd).
 * Kèm cân tính phí của từng công thức (quote chargeable vs bill billed weight) để
 * chênh lệch cân lộ ra ngay.
 */
import { computeBrandCharge, type BrandChargeParts } from './brand-pricing';

export interface PriceStructureRow {
  label: string;
  /** Chi phí carrier dự tính (VND). null = khoản này không có bên chi phí. */
  costVnd: number | null;
  /** Cước thực từ hoá đơn carrier (VND). null = chưa có bill hoặc khoản không có. */
  billVnd: number | null;
  /** Giá thu khách DỰ TÍNH — quote lúc khách tạo vận đơn (VND). */
  quoteChargeVnd: number | null;
  /** Giá thu khách THỰC — tính lại theo bill (VND). Chưa có bill = null hoặc = dự tính. */
  chargeVnd: number | null;
  /** % cho dòng fuel/VAT (hiển thị phụ). */
  percent?: number | null;
}

export interface ShipHoPriceStructure {
  rows: PriceStructureRow[];
  costTotal: number;
  /** Tổng giá thu DỰ TÍNH (quote gốc lúc khách tạo vận đơn). */
  quoteChargeTotal: number;
  /** Tổng giá thu THỰC (tính lại theo bill; = dự tính khi chưa có bill). */
  chargeTotal: number;
  /** Tổng cước bill thực (actualCarrierCostVnd). null khi chưa đối soát. */
  billTotal: number | null;
  /** Cân tính phí từng công thức: quote (chargeable) vs bill (billed weight). */
  weights: { quoteKg: number | null; billKg: number | null };
  /** Hệ số quy cost-currency → VND (carrierCostVnd / breakdown.carrierCost). */
  factor: number;
  /** Số hoá đơn carrier (nếu đã đối soát). */
  billNumber: string | null;
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

/** Đọc breakdown (jsonb) → cấu trúc giá 3 phía. null nếu thiếu dữ liệu để quy đổi. */
export function shipHoPriceStructure(input: {
  breakdown: unknown;
  carrierCostVnd: number;
  chargedVnd: number;
  markupPercent: number;
  serviceLabel?: string;
  /** Bill thực (sau đối soát): breakdown VND đã lưu + tổng + cân bill. */
  actualBill?: { breakdown: unknown; totalVnd: number; weightKg: number | null } | null;
}): ShipHoPriceStructure | null {
  const b = input.breakdown as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return null;
  const carrierCost = num(b.carrierCost);
  if (!(carrierCost > 0) || !(input.carrierCostVnd > 0)) return null;

  const factor = input.carrierCostVnd / carrierCost;
  const R = (v: unknown) => Math.round(num(v) * factor);

  // ── Phía CHI PHÍ CARRIER dự tính (mình trả) ──
  const baseCost = R(b.base);
  const fuelCost = R(b.fuel);
  const vatCost = R(b.vat);
  const surCost = R(b.remote) + R(b.perKg) + R(b.demand) + R(b.countryFixed) + R(b.perStep) + R(b.peak) + R(b.residential) + R(b.addons);
  // Phần dư CHI PHÍ (giảm giá / làm tròn) để cột chi phí luôn khớp carrierCostVnd.
  const adjustCost = Math.round(input.carrierCostVnd - (baseCost + surCost + fuelCost + vatCost));

  // ── Phía CƯỚC TỪ CARRIER (bill thực, breakdown đã là VND) ──
  // Cước cơ bản bill = Freight − Base Discount (giá NET carrier offer mình) — để so
  // thẳng hàng với cước cơ bản dự tính (bảng cước mua vào cũng là giá net); giá
  // list + dòng chiết khấu riêng chỉ gây lệch đỏ/xanh ảo từng dòng.
  const ab = (input.actualBill?.breakdown ?? null) as Record<string, unknown> | null;
  const billTotal = input.actualBill ? Math.round(input.actualBill.totalVnd) : null;
  const baseBill = ab ? Math.round(num(ab.base) + num(ab.discount)) : null;
  const fuelBill = ab ? Math.round(num(ab.fuel)) : null;
  const vatBill = ab ? Math.round(num(ab.vat)) : null;
  const surBill = ab ? Math.round(num(ab.remote) + num(ab.demand) + num(ab.signature) + num(ab.residential) + num(ab.other)) : null;
  // Phần dư BILL (làm tròn / khoản lạ) để cột bill luôn khớp billTotal.
  const adjustBill = billTotal != null
    ? Math.round(billTotal - ((baseBill ?? 0) + (surBill ?? 0) + (fuelBill ?? 0) + (vatBill ?? 0)))
    : null;

  // ── Phía GIÁ THU KHÁCH (tái dùng đúng engine giá brand) ──
  const parts: BrandChargeParts = {
    surchargesVnd: R(b.remote) + R(b.perKg) + R(b.demand) + R(b.countryFixed) + R(b.perStep) + R(b.peak),
    residentialVnd: R(b.residential),
    directSignatureVnd: R(b.addons),
    fuelRealVnd: fuelCost,
    vatRealVnd: vatCost,
  };
  const { lines } = computeBrandCharge({
    carrierCostVnd: input.carrierCostVnd,
    baseVnd: baseCost,
    fuelPercent: num(b.fuelPercent),
    vatPercent: num(b.vatPercent),
    markupPercent: input.markupPercent,
    parts,
    serviceLabel: input.serviceLabel ?? 'Express Delivery',
  });
  const pick = (test: (l: string) => boolean) =>
    lines.filter((l) => test(l.label)).reduce((s, l) => s + l.amountVnd, 0);

  // ── GIÁ THU DỰ TÍNH (quote lúc khách tạo vận đơn) — luôn từ breakdown quote,
  // phụ phí = pass-through cost. Tổng = chargedVnd gốc đã báo brand.
  const qBase = pick((l) => l.startsWith('Cước cơ bản'));
  const qFuel = pick((l) => l === 'Phụ phí xăng dầu');
  const qProcessing = pick((l) => l === 'Phí xử lý đơn hàng');
  const qVat = pick((l) => l === 'VAT');
  const qRemote = R(b.remote);
  const qDemand = R(b.demand);
  // Tách "Giao nhà dân" (residential) và "Ký nhận" (direct signature = addons).
  const qResidential = R(b.residential);
  const qSignature = R(b.addons);
  const qCustoms = R(b.perKg) + R(b.perStep) + R(b.countryFixed) + R(b.peak);
  const quoteTotal = input.chargedVnd;
  const adjustQuoteCharge = Math.round(
    quoteTotal - (qBase + qRemote + qDemand + qResidential + qSignature + qCustoms + qFuel + qProcessing + qVat),
  );

  // ── GIÁ THU THỰC — khi ĐÃ đối soát dùng breakdown THỰC (sell): cước cơ bản theo
  // bảng offer ở cân bill + phụ phí LẤY THEO BILL (gồm residential/ký nhận quote
  // không có) + fuel/VAT công thức FedEx. Chưa có bill → = giá dự tính.
  const sell = (ab?.sell ?? null) as Record<string, unknown> | null;
  const S = (v: unknown) => Math.round(num(v));
  const chargeBase = sell ? S(sell.baseVnd) : qBase;
  const chargeFuel = sell ? S(sell.fuelVnd) : qFuel;
  const chargeProcessing = sell ? S(sell.processingExVatVnd) : qProcessing;
  const chargeVat = sell ? S(sell.vatVnd) : qVat;
  const chRemote = sell ? S(sell.remoteVnd) : qRemote;
  const chDemand = sell ? S(sell.demandVnd) : qDemand;
  // Đơn cũ (sell chưa có 2 field tách) fallback: residential từ quote, signature = phần còn lại.
  const chResidential = sell ? S(sell.residentialVnd ?? 0) : qResidential;
  const chSignature = sell
    ? (sell.signatureVnd != null ? S(sell.signatureVnd) : Math.max(0, S(sell.resSignVnd) - S(sell.residentialVnd ?? 0)))
    : qSignature;
  // Tách NK / duty / other (21/07). Sell cũ chỉ có customsSurVnd → fallback vào dòng NK.
  const qImport = R(b.countryFixed); // engine dự tính phí NK qua countryFixed (vd US 68.300)
  const qOtherSur = R(b.perKg) + R(b.perStep) + R(b.peak);
  const chImport = sell ? S(sell.importHandlingVnd ?? sell.customsSurVnd) : qImport;
  const chDuty = sell ? S(sell.dutyVnd ?? 0) : 0;
  const chOther = sell ? S(sell.otherVnd ?? 0) : qOtherSur;
  const chCustoms = chImport + chDuty + chOther; // tổng nhóm (giữ cho chargeSum)
  // Phí sửa địa chỉ: quote không dự tính được (chỉ phát sinh khi địa chỉ sai).
  const chAc = sell ? S(sell.acVnd ?? 0) : 0;
  const chargeTotalFinal = sell ? S(sell.chargedVnd) : quoteTotal;
  const chargeSum = chargeBase + chRemote + chDemand + chResidential + chSignature + chAc + chImport + chDuty + chOther + chargeFuel + chargeProcessing + chargeVat;
  const adjustCharge = Math.round(chargeTotalFinal - chargeSum);

  // ── Tách phụ phí thành TỪNG KHOẢN. Gộp theo cột bill có sẵn (remote/demand/
  // signature/other) để 3 phía thẳng hàng; cột bill gộp residential+ký nhận vào
  // signature, phí NK/sửa địa chỉ/… vào other. Chỉ hiện dòng có số ở ít nhất 1 phía.
  const hasBill = ab != null;
  const surItems: PriceStructureRow[] = [
    { label: 'Phụ phí vùng xa', costVnd: R(b.remote), billVnd: hasBill ? Math.round(num(ab!.remote)) : null, quoteChargeVnd: qRemote, chargeVnd: chRemote },
    { label: 'Phụ phí nhu cầu (demand)', costVnd: R(b.demand), billVnd: hasBill ? Math.round(num(ab!.demand)) : null, quoteChargeVnd: qDemand, chargeVnd: chDemand },
    {
      label: 'Giao nhà dân',
      costVnd: R(b.residential),
      billVnd: hasBill ? Math.round(num(ab!.residential)) : null,
      quoteChargeVnd: qResidential, chargeVnd: chResidential,
    },
    {
      label: 'Ký nhận (direct signature)',
      costVnd: R(b.addons),
      billVnd: hasBill ? Math.round(num(ab!.signature)) : null,
      quoteChargeVnd: qSignature, chargeVnd: chSignature,
    },
    {
      label: 'Phí sửa địa chỉ (Address Correction)',
      costVnd: null,
      billVnd: hasBill ? Math.round(num(ab!.addressCorrection)) : null,
      quoteChargeVnd: 0, chargeVnd: chAc,
    },
    {
      label: 'Phí xử lý hàng nhập khẩu',
      costVnd: R(b.countryFixed),
      billVnd: hasBill ? Math.round(num(ab!.importHandling ?? ab!.other)) : null, // bill cũ chưa tách → hiện ở đây
      quoteChargeVnd: qImport, chargeVnd: chImport,
    },
    {
      label: 'Thuế / hải quan (duty)',
      costVnd: null, // không dự tính được — pass-through thuần, không VAT
      billVnd: hasBill ? Math.round(num(ab!.duty)) : null,
      quoteChargeVnd: 0, chargeVnd: chDuty,
    },
    {
      label: 'Phụ phí khác (chưa phân loại)',
      costVnd: R(b.perKg) + R(b.perStep) + R(b.peak),
      billVnd: hasBill && ab!.importHandling != null ? Math.round(num(ab!.other)) : null, // bill cũ: other đã hiện ở dòng NK
      quoteChargeVnd: qOtherSur, chargeVnd: chOther,
    },
  ].filter((r) => (r.costVnd ?? 0) !== 0 || (r.billVnd ?? 0) !== 0 || (r.quoteChargeVnd ?? 0) !== 0 || (r.chargeVnd ?? 0) !== 0);

  const rows: PriceStructureRow[] = [
    { label: 'Cước cơ bản', costVnd: baseCost, billVnd: baseBill, quoteChargeVnd: qBase, chargeVnd: chargeBase },
    ...surItems,
    { label: 'Phụ phí xăng dầu', costVnd: fuelCost, billVnd: fuelBill, quoteChargeVnd: qFuel, chargeVnd: chargeFuel, percent: num(b.fuelPercent) || null },
    { label: 'Phí xử lý đơn hàng', costVnd: null, billVnd: null, quoteChargeVnd: qProcessing, chargeVnd: chargeProcessing },
    { label: 'VAT', costVnd: vatCost, billVnd: vatBill, quoteChargeVnd: qVat, chargeVnd: chargeVat, percent: num(b.vatPercent) || null },
  ];
  if (adjustCost !== 0 || adjustCharge !== 0 || adjustQuoteCharge !== 0 || (adjustBill != null && adjustBill !== 0)) {
    rows.push({
      label: 'Giảm giá / điều chỉnh',
      costVnd: adjustCost || null,
      billVnd: adjustBill != null && adjustBill !== 0 ? adjustBill : null,
      quoteChargeVnd: adjustQuoteCharge || null,
      chargeVnd: adjustCharge || null,
    });
  }

  return {
    rows,
    costTotal: input.carrierCostVnd,
    quoteChargeTotal: quoteTotal,
    chargeTotal: chargeTotalFinal,
    billTotal,
    weights: {
      quoteKg: numOrNull(b.chargeableWeightKg),
      billKg: input.actualBill?.weightKg ?? null,
    },
    factor,
    billNumber: ab && typeof ab.billNumber === 'string' ? ab.billNumber : null,
  };
}
