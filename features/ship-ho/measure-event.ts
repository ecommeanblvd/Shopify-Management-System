/**
 * THUẦN: dựng payload event `order.measured` gửi MMP sau khi SMS (Inecso) cân/đo
 * lại kiện tại kho — KHỚP hay LỆCH đều gửi để MMP ghi lên đơn của brand.
 *
 *   matched        — số đo khớp brand khai (cân + kích thước + cân tính phí).
 *   price.changed  — giá thu đổi sau re-quote (độc lập với matched: fuel tuần
 *                    mới có thể đổi giá dù số đo khớp).
 */

export interface ParcelMeasure {
  weightKg: number;
  dimLengthCm: number | null;
  dimWidthCm: number | null;
  dimHeightCm: number | null;
}

const DIM_DIVISOR = 5000; // FedEx/DHL: L×W×H(cm)/5000 = dim weight (kg)
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function dimWeightKg(p: ParcelMeasure): number | null {
  const { dimLengthCm: l, dimWidthCm: w, dimHeightCm: h } = p;
  return l && w && h ? r3((l * w * h) / DIM_DIVISOR) : null;
}

export function chargeableKg(p: ParcelMeasure): number {
  return Math.max(p.weightKg, dimWeightKg(p) ?? 0);
}

function side(p: ParcelMeasure) {
  return {
    weightKg: p.weightKg,
    dimLengthCm: p.dimLengthCm, dimWidthCm: p.dimWidthCm, dimHeightCm: p.dimHeightCm,
    dimWeightKg: dimWeightKg(p),
    chargeableWeightKg: chargeableKg(p),
  };
}

export interface MeasuredEventPrice {
  previousChargedVnd: number | null;
  chargedVnd: number | null;
  /** Cấu trúc giá mới (lines của estimate) — chỉ khi giá đổi. */
  lines?: Array<{ label: string; amountVnd: number }>;
}

export function buildMeasurementEventData(
  declared: ParcelMeasure,
  measured: ParcelMeasure,
  price: MeasuredEventPrice,
) {
  const d = side(declared);
  const m = side(measured);
  const dimsEqual = declared.dimLengthCm === measured.dimLengthCm
    && declared.dimWidthCm === measured.dimWidthCm
    && declared.dimHeightCm === measured.dimHeightCm;
  const matched = d.weightKg === m.weightKg && dimsEqual && d.chargeableWeightKg === m.chargeableWeightKg;
  const priceChanged = price.previousChargedVnd != null && price.chargedVnd != null
    && price.previousChargedVnd !== price.chargedVnd;

  return {
    matched,
    declared: d,
    measured: m,
    delta: {
      weightKg: r3(m.weightKg - d.weightKg),
      chargeableWeightKg: r3(m.chargeableWeightKg - d.chargeableWeightKg),
    },
    price: {
      changed: priceChanged,
      previousChargedVnd: price.previousChargedVnd,
      chargedVnd: price.chargedVnd,
      deltaVnd: priceChanged ? (price.chargedVnd! - price.previousChargedVnd!) : 0,
      ...(priceChanged && price.lines ? { lines: price.lines } : {}),
    },
  };
}
