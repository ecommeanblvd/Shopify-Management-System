/** Pure helpers for MMP brand requests — no DB, no I/O. */

export interface BrandRequestPayload {
  requestId: string; orderNumber: string; brandSlug: string | null; sku: string | null; qty: number;
}

export function buildBrandRequestPayload(
  req: { id: string; brandSlug: string | null; sku: string | null; qty: number },
  orderNumber: string,
): BrandRequestPayload {
  return { requestId: req.id, orderNumber, brandSlug: req.brandSlug, sku: req.sku, qty: req.qty };
}

export interface ConfirmationInput {
  status: 'confirmed' | 'rejected';
  expectedDeliveryDate?: string | null;
  note?: string | null;
}
export interface ConfirmationResult {
  confirmStatus: 'confirmed' | 'rejected';
  expectedDeliveryDate: string | null;
  note: string | null;
  lineStatus: 'brand_confirmed' | 'brand_rejected';
}

export function applyConfirmation(input: ConfirmationInput): ConfirmationResult {
  const confirmed = input.status === 'confirmed';
  return {
    confirmStatus: input.status,
    expectedDeliveryDate: confirmed ? (input.expectedDeliveryDate ?? null) : null,
    note: input.note ?? null,
    lineStatus: confirmed ? 'brand_confirmed' : 'brand_rejected',
  };
}

/** A request needs follow-up when confirmed and its delivery date has arrived. */
export function isFollowUpDue(
  req: { confirmStatus: string; expectedDeliveryDate: string | null },
  todayIso: string,
): boolean {
  return req.confirmStatus === 'confirmed'
    && req.expectedDeliveryDate !== null
    && req.expectedDeliveryDate <= todayIso;
}
