/** Pure transfer logic — no DB. Status state machine, code format, validation. */

export type TransferStatus = 'draft' | 'in_transit' | 'received' | 'cancelled';

const ALLOWED: Record<TransferStatus, TransferStatus[]> = {
  draft: ['in_transit', 'cancelled'],
  in_transit: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

export function canTransitionTransfer(from: TransferStatus, to: TransferStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function nextTransferCode(fromCode: string, toCode: string, seq: number): string {
  return `${fromCode}-${toCode}-${seq}`;
}

export interface TransferLineInput { sku: string; qty: number; }
export interface ValidateTransferInput { fromWarehouseId: string; toWarehouseId: string; lines: TransferLineInput[]; }

export function validateTransfer(input: ValidateTransferInput): { ok: true } | { ok: false; error: string } {
  if (!input.fromWarehouseId || !input.toWarehouseId) return { ok: false, error: 'Thiếu kho gửi/nhận' };
  if (input.fromWarehouseId === input.toWarehouseId) return { ok: false, error: 'Kho gửi và nhận phải khác nhau' };
  if (input.lines.length === 0) return { ok: false, error: 'Cần ít nhất một dòng hàng' };
  for (const l of input.lines) {
    if (!l.sku || l.sku.trim() === '') return { ok: false, error: 'SKU không được trống' };
    if (!(l.qty > 0)) return { ok: false, error: 'Số lượng phải lớn hơn 0' };
  }
  return { ok: true };
}
