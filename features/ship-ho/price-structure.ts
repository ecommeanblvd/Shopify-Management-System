/**
 * THUẦN: dựng cấu trúc giá 2 phía cho 1 đơn ship hộ từ quoteBreakdown đã lưu:
 *   - Chi phí carrier (mình trả): base + phụ phí + fuel + VAT (quy VND).
 *   - Giá thu khách (dự tính): tái dùng computeBrandCharge → khớp tuyệt đối chargedVnd.
 * Dùng cho bảng chi tiết đơn để đối chiếu / đối soát.
 */
import { computeBrandCharge, type BrandChargeParts } from './brand-pricing';

export interface PriceStructureRow {
  label: string;
  /** Chi phí carrier (VND). null = khoản này không có bên chi phí. */
  costVnd: number | null;
  /** Giá thu khách (VND). null = khoản này không có bên giá thu. */
  chargeVnd: number | null;
  /** % cho dòng fuel/VAT (hiển thị phụ). */
  percent?: number | null;
}

export interface ShipHoPriceStructure {
  rows: PriceStructureRow[];
  costTotal: number;
  chargeTotal: number;
  /** Hệ số quy cost-currency → VND (carrierCostVnd / breakdown.carrierCost). */
  factor: number;
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/** Đọc breakdown (jsonb) → cấu trúc giá 2 phía. null nếu thiếu dữ liệu để quy đổi. */
export function shipHoPriceStructure(input: {
  breakdown: unknown;
  carrierCostVnd: number;
  chargedVnd: number;
  markupPercent: number;
  serviceLabel?: string;
}): ShipHoPriceStructure | null {
  const b = input.breakdown as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return null;
  const carrierCost = num(b.carrierCost);
  if (!(carrierCost > 0) || !(input.carrierCostVnd > 0)) return null;

  const factor = input.carrierCostVnd / carrierCost;
  const R = (v: unknown) => Math.round(num(v) * factor);

  // ── Phía CHI PHÍ CARRIER (mình trả) ──
  const baseCost = R(b.base);
  const fuelCost = R(b.fuel);
  const vatCost = R(b.vat);
  const surCost = R(b.remote) + R(b.perKg) + R(b.demand) + R(b.countryFixed) + R(b.perStep) + R(b.peak) + R(b.residential) + R(b.addons);
  // Phần dư CHI PHÍ (giảm giá / làm tròn) để cột chi phí luôn khớp carrierCostVnd.
  const adjustCost = Math.round(input.carrierCostVnd - (baseCost + surCost + fuelCost + vatCost));

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
  const chargeBase = pick((l) => l.startsWith('Cước cơ bản'));
  const chargeSur = pick((l) => l === 'Phụ phí vùng/địa chỉ' || l === 'Phí giao nhà dân' || l.startsWith('Ký nhận'));
  const chargeFuel = pick((l) => l === 'Phụ phí xăng dầu');
  const chargeProcessing = pick((l) => l === 'Phí xử lý đơn hàng');
  const chargeVat = pick((l) => l === 'VAT');
  // Phần dư GIÁ THU để cột giá thu luôn khớp chargedVnd (số brand đã được báo — bất
  // biến). Với đơn backfill, chargedVnd gốc có thể lệch breakdown re-quote (fuel tuần
  // khác) → phần dư này thể hiện chênh đó, giữ tổng đúng authoritative.
  const chargeSum = chargeBase + chargeSur + chargeFuel + chargeProcessing + chargeVat;
  const adjustCharge = Math.round(input.chargedVnd - chargeSum);

  const rows: PriceStructureRow[] = [
    { label: 'Cước cơ bản', costVnd: baseCost, chargeVnd: chargeBase },
    { label: 'Phụ phí (vùng/địa chỉ/ký nhận)', costVnd: surCost, chargeVnd: chargeSur },
    { label: 'Phụ phí xăng dầu', costVnd: fuelCost, chargeVnd: chargeFuel, percent: num(b.fuelPercent) || null },
    { label: 'Phí xử lý đơn hàng', costVnd: null, chargeVnd: chargeProcessing },
    { label: 'VAT', costVnd: vatCost, chargeVnd: chargeVat, percent: num(b.vatPercent) || null },
  ];
  if (adjustCost !== 0 || adjustCharge !== 0) {
    rows.push({ label: 'Giảm giá / điều chỉnh', costVnd: adjustCost || null, chargeVnd: adjustCharge || null });
  }

  return { rows, costTotal: input.carrierCostVnd, chargeTotal: input.chargedVnd, factor };
}
