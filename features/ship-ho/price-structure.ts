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
  /** Giá thu khách dự tính (VND). null = khoản này không có bên giá thu. */
  chargeVnd: number | null;
  /** % cho dòng fuel/VAT (hiển thị phụ). */
  percent?: number | null;
}

export interface ShipHoPriceStructure {
  rows: PriceStructureRow[];
  costTotal: number;
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
  const surBill = ab ? Math.round(num(ab.remote) + num(ab.demand) + num(ab.signature) + num(ab.other)) : null;
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

  // Khi ĐÃ đối soát: cột giá thu dùng breakdown THỰC (sell) — cước cơ bản theo bảng
  // offer ở cân bill + phụ phí LẤY THEO BILL (gồm residential/ký nhận quote không có)
  // + fuel/VAT theo công thức FedEx. Chưa có bill → dùng breakdown quote như cũ.
  const sell = (ab?.sell ?? null) as Record<string, unknown> | null;
  const S = (v: unknown) => Math.round(num(v));
  const chargeBase = sell ? S(sell.baseVnd) : pick((l) => l.startsWith('Cước cơ bản'));
  const chargeFuel = sell ? S(sell.fuelVnd) : pick((l) => l === 'Phụ phí xăng dầu');
  const chargeProcessing = sell ? S(sell.processingExVatVnd) : pick((l) => l === 'Phí xử lý đơn hàng');
  const chargeVat = sell ? S(sell.vatVnd) : pick((l) => l === 'VAT');
  // Charge phụ phí theo TỪNG KHOẢN: có sell → lấy theo bill (pass-through số bill);
  // chưa có sell → = cost (quote pass-through).
  const chRemote = sell ? S(sell.remoteVnd) : R(b.remote);
  const chDemand = sell ? S(sell.demandVnd) : R(b.demand);
  const chResSign = sell ? S(sell.resSignVnd) : R(b.residential) + R(b.addons);
  const chCustoms = sell ? S(sell.customsSurVnd) : R(b.perKg) + R(b.perStep) + R(b.countryFixed) + R(b.peak);
  const chargeTotalFinal = sell ? S(sell.chargedVnd) : input.chargedVnd;
  // Phần dư GIÁ THU giữ cột khớp tổng (sell nội bộ nhất quán → ~0; quote backfill có thể lệch).
  const chargeSum = chargeBase + chRemote + chDemand + chResSign + chCustoms + chargeFuel + chargeProcessing + chargeVat;
  const adjustCharge = Math.round(chargeTotalFinal - chargeSum);

  // ── Tách phụ phí thành TỪNG KHOẢN. Gộp theo cột bill có sẵn (remote/demand/
  // signature/other) để 3 phía thẳng hàng; cột bill gộp residential+ký nhận vào
  // signature, phí NK/sửa địa chỉ/… vào other. Chỉ hiện dòng có số ở ít nhất 1 phía.
  const hasBill = ab != null;
  const surItems: PriceStructureRow[] = [
    { label: 'Phụ phí vùng xa', costVnd: R(b.remote), billVnd: hasBill ? Math.round(num(ab!.remote)) : null, chargeVnd: chRemote },
    { label: 'Phụ phí nhu cầu (demand)', costVnd: R(b.demand), billVnd: hasBill ? Math.round(num(ab!.demand)) : null, chargeVnd: chDemand },
    {
      label: 'Giao nhà dân / ký nhận',
      costVnd: R(b.residential) + R(b.addons),
      billVnd: hasBill ? Math.round(num(ab!.signature)) : null,
      chargeVnd: chResSign,
    },
    {
      label: 'Phí xử lý NK / khác',
      costVnd: R(b.perKg) + R(b.perStep) + R(b.countryFixed) + R(b.peak),
      billVnd: hasBill ? Math.round(num(ab!.other)) : null,
      chargeVnd: chCustoms,
    },
  ].filter((r) => (r.costVnd ?? 0) !== 0 || (r.billVnd ?? 0) !== 0 || (r.chargeVnd ?? 0) !== 0);

  const rows: PriceStructureRow[] = [
    { label: 'Cước cơ bản', costVnd: baseCost, billVnd: baseBill, chargeVnd: chargeBase },
    ...surItems,
    { label: 'Phụ phí xăng dầu', costVnd: fuelCost, billVnd: fuelBill, chargeVnd: chargeFuel, percent: num(b.fuelPercent) || null },
    { label: 'Phí xử lý đơn hàng', costVnd: null, billVnd: null, chargeVnd: chargeProcessing },
    { label: 'VAT', costVnd: vatCost, billVnd: vatBill, chargeVnd: chargeVat, percent: num(b.vatPercent) || null },
  ];
  if (adjustCost !== 0 || adjustCharge !== 0 || (adjustBill != null && adjustBill !== 0)) {
    rows.push({
      label: 'Giảm giá / điều chỉnh',
      costVnd: adjustCost || null,
      billVnd: adjustBill != null && adjustBill !== 0 ? adjustBill : null,
      chargeVnd: adjustCharge || null,
    });
  }

  return {
    rows,
    costTotal: input.carrierCostVnd,
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
