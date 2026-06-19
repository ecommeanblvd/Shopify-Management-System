/**
 * Pure display-cell helpers for the reconcile table.
 * No DB / server imports — safe to use in Client Components.
 */

export interface CarrierWeightCell { text: string; mismatch: boolean }

/** Hiển thị kg: tối đa 2 số thập phân, BỎ trailing zero (2.50→"2.5", 2.00→"2",
 *  2.04→"2.04"). String(round 2dec) tự bỏ .0/.00 vì là số JS. */
export function fmtKg(kg: number): string {
  return String(Math.round(kg * 100) / 100);
}

/** Ô "KG carrier": cân carrier thật từ hoá đơn. NULL → "—". Tô lệch khi khác
 *  cân dự kiến (engine max(cân,dim)+làm tròn) và cả hai đều có số. */
export function carrierWeightCell(
  billedWeightKg: number | null,
  chargeableKg: number | null,
): CarrierWeightCell {
  if (billedWeightKg === null) return { text: '—', mismatch: false };
  const mismatch = chargeableKg !== null && billedWeightKg !== chargeableKg;
  return { text: fmtKg(billedWeightKg), mismatch };
}
