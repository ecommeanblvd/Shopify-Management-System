/**
 * THUẦN: parse 1 dòng file hoá đơn carrier (tracking + cước thực VND) và tính
 * đối soát (delta engine vs thực, margin thu vs thực). Không I/O.
 */
export const CARRIER_INVOICE_COLUMNS = { trackingNumber: 0, actualCostVnd: 1 } as const;

export type ParseInvoiceResult =
  | { kind: 'ok'; trackingNumber: string; actualCostVnd: number }
  | { kind: 'skip_empty' }
  | { kind: 'error'; reason: 'missing_tracking' | 'bad_cost' };

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}
function numOrNull(v: unknown): number | null {
  const s = str(v).replace(/[,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseCarrierInvoiceRow(row: readonly unknown[]): ParseInvoiceResult {
  if (row.every((c) => str(c) === '')) return { kind: 'skip_empty' };
  const trackingNumber = str(row[CARRIER_INVOICE_COLUMNS.trackingNumber]);
  if (trackingNumber === '') return { kind: 'error', reason: 'missing_tracking' };
  const actualCostVnd = numOrNull(row[CARRIER_INVOICE_COLUMNS.actualCostVnd]);
  if (actualCostVnd == null || actualCostVnd < 0) return { kind: 'error', reason: 'bad_cost' };
  return { kind: 'ok', trackingNumber, actualCostVnd };
}

export function computeReconcile(input: {
  estimateVnd: number | null;
  chargedVnd: number | null;
  actualVnd: number;
}): { deltaVnd: number | null; marginVnd: number | null; reconcileStatus: string } {
  const deltaVnd = input.estimateVnd == null ? null : Math.round(input.actualVnd - input.estimateVnd);
  const marginVnd = input.chargedVnd == null ? null : Math.round(input.chargedVnd - input.actualVnd);
  return { deltaVnd, marginVnd, reconcileStatus: 'reconciled' };
}
