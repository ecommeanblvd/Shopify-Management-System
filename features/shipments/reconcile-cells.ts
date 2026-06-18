/**
 * Pure display-cell helpers for the reconcile table.
 * No DB / server imports — safe to use in Client Components.
 */

export interface CarrierWeightCell { text: string; mismatch: boolean }

/** Ô "KG carrier": cân carrier thật từ hoá đơn. NULL → "—". Tô lệch khi khác
 *  cân dự kiến (engine max(cân,dim)+làm tròn) và cả hai đều có số. */
export function carrierWeightCell(
  billedWeightKg: number | null,
  chargeableKg: number | null,
): CarrierWeightCell {
  if (billedWeightKg === null) return { text: '—', mismatch: false };
  const mismatch = chargeableKg !== null && billedWeightKg !== chargeableKg;
  return { text: String(billedWeightKg), mismatch };
}
