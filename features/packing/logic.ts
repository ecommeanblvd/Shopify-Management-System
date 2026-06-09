/** Pure packing logic — no DB. Ship gate + dimension validation. */

export interface ShipGateInput { checkPackedAt: Date | null; lineCount: number; }

/** A pack may ship only after it is check-packed and has at least one line. */
export function canShipPack(input: ShipGateInput): { ok: true } | { ok: false; error: string } {
  if (input.lineCount <= 0) return { ok: false, error: 'Kiện chưa có dòng nào' };
  if (input.checkPackedAt == null) return { ok: false, error: 'Kiện chưa được check-packed' };
  return { ok: true };
}

export interface PackDimsInput { lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null; weightKg?: number | null; }

/** Dimensions/weight are optional, but any provided value must be > 0. */
export function validatePackDims(input: PackDimsInput): { ok: true } | { ok: false; error: string } {
  const fields: [string, number | null | undefined][] = [
    ['Dài', input.lengthCm], ['Rộng', input.widthCm], ['Cao', input.heightCm], ['Cân nặng', input.weightKg],
  ];
  for (const [label, v] of fields) {
    if (v != null && !(v > 0)) return { ok: false, error: `${label} phải lớn hơn 0` };
  }
  return { ok: true };
}
