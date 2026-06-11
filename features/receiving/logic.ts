/** Pure receiving logic — no DB. Disposition decision, QC validation, the
 *  inventory delta + resulting line status, and sequential code formatting. */

export type SourceType = 'retail_for_order' | 'consignment' | 'po';
export type QcResult = 'pending' | 'pass' | 'fail';
export type Disposition = 'pending' | 'allocate_to_order' | 'store' | 'return_to_brand';

/** Map (source, QC outcome) to the warehouse disposition. */
export function decideDisposition(sourceType: SourceType, qc: QcResult): Disposition {
  if (qc === 'fail') return 'return_to_brand';
  if (qc !== 'pass') return 'pending';
  return sourceType === 'retail_for_order' ? 'allocate_to_order' : 'store';
}

export interface QcInput { qcResult: QcResult; qcFailReason?: string | null; qcFailPhotoKey?: string | null; }

/** QC fail must carry a reason and a photo (evidence for the brand return). */
export function validateQc(input: QcInput): { ok: true } | { ok: false; error: string } {
  if (input.qcResult === 'fail') {
    if (!input.qcFailReason || input.qcFailReason.trim() === '') return { ok: false, error: 'QC fail cần lý do' };
    if (!input.qcFailPhotoKey || input.qcFailPhotoKey.trim() === '') return { ok: false, error: 'QC fail cần ảnh lỗi' };
  }
  return { ok: true };
}

export interface InvEffect { onHandDelta: number; reservedDelta: number; lineStatus: 'in_stock' | null; }

/** Stock deltas + resulting fulfillment-line status for a disposition.
 *  Stock is only touched when there's a SKU to key the aggregate row by.
 *  (The 'return_to_brand' reopen-to-brand_requested is applied by the caller,
 *  since it depends on whether the item is linked to a fulfillment line.) */
export function inventoryEffect(disposition: Disposition, hasSku: boolean): InvEffect {
  switch (disposition) {
    // Staging đi-đơn: kiện KHÔNG vào tồn kho (cross-dock) — chỉ chuyển
    // trạng thái dòng đơn. Spec 2026-06-10 warehouse-core §2.3.
    case 'allocate_to_order': return { onHandDelta: 0, reservedDelta: 0, lineStatus: 'in_stock' };
    case 'store': return { onHandDelta: hasSku ? 1 : 0, reservedDelta: 0, lineStatus: null };
    default: return { onHandDelta: 0, reservedDelta: 0, lineStatus: null };
  }
}

/** Next human code, e.g. nextSeqCode('WH', 4) => 'WH-00000005'. */
export function nextSeqCode(prefix: string, maxSeq: number): string {
  return `${prefix}-${String(maxSeq + 1).padStart(8, '0')}`;
}

/** Parse the numeric suffix of a code for the given prefix; 0 if null/mismatch. */
export function parseSeq(prefix: string, code: string | null): number {
  if (!code) return 0;
  const p = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^${p}-(\\d+)$`).exec(code);
  return m ? parseInt(m[1], 10) : 0;
}
