/** Pure logic cho Khu chờ đi đơn — no DB. Spec §2.3 + §5.2 + §5.3:
 *  docs/superpowers/specs/2026-06-10-warehouse-core-auto-allocation-design.md */
import { isBrandStatus } from '@/features/fulfillment/brand-statuses';

/** Nguồn hàng của một dòng đơn (chip "Nguồn" trên staging board + trang đơn). */
export type LineSource =
  | { kind: 'shipped' }                  // Đã đi
  | { kind: 'progress' }                 // Đã pick/đóng
  | { kind: 'staging' }                  // Khu chờ (đủ kiện)
  | { kind: 'warehouse'; code: string }  // Kho HN / Kho SG
  | { kind: 'brand' }                    // Chờ brand
  | { kind: 'pending' }                  // Chờ kiểm
  | { kind: 'none' };                    // —

export interface LineSourceInput {
  status: string;
  qty: number;
  /** Số kiện goods_receipt_items (allocate_to_order, QC pass) gắn dòng này. */
  stagedCount: number;
  warehouseInventoryId: string | null;
  warehouseCode: string | null;
}

export function lineSource(l: LineSourceInput): LineSource {
  if (l.status === 'shipped') return { kind: 'shipped' };
  if (l.status === 'picked' || l.status === 'packed') return { kind: 'progress' };
  if (l.stagedCount > 0 && l.stagedCount >= l.qty) return { kind: 'staging' };
  if (l.status === 'in_stock' && l.warehouseInventoryId) {
    return { kind: 'warehouse', code: l.warehouseCode ?? '?' };
  }
  if (isBrandStatus(l.status)) return { kind: 'brand' };
  if (l.status === 'pending_check') return { kind: 'pending' };
  return { kind: 'none' };
}

/** Dòng được "che" đủ: staging đủ kiện, hoặc đã giữ từ kho, hoặc đã pick/đóng/đi. */
export function lineCovered(l: LineSourceInput): boolean {
  if (l.status === 'picked' || l.status === 'packed' || l.status === 'shipped') return true;
  if (l.status === 'in_stock' && l.warehouseInventoryId) return true;
  return l.stagedCount > 0 && l.stagedCount >= l.qty;
}

// ── Nhóm theo đơn ───────────────────────────────────────────────────

/** Kiện đang nằm khu chờ (đã join receipt + line + order ở tầng query). */
export interface StagedItemRow {
  itemId: string;
  unitCode: string;
  sku: string | null;
  qcResult: string;
  receiptCode: string;
  /** Signed URL ảnh kiện (spec §5.2) — null khi không có ảnh/storage. */
  photoUrl?: string | null;
  stagedAt: Date;
  lineId: string;
  orderId: string;
  orderNumber: string;
  processedAt: Date;
}

/** TẤT CẢ dòng fulfillment của các đơn liên quan (để tính phần còn thiếu). */
export interface OrderLineRow {
  orderId: string;
  lineId: string;
  sku: string | null;
  qty: number;
  status: string;
  allocatedQty: number;
  warehouseInventoryId: string | null;
  warehouseCode: string | null;
}

export interface StagingGroupLine {
  lineId: string;
  sku: string | null;
  qty: number;
  status: string;
  stagedCount: number;
  covered: boolean;
  source: LineSource;
}

export interface StagingGroupItem {
  itemId: string;
  unitCode: string;
  sku: string | null;
  qcResult: string;
  receiptCode: string;
  photoUrl: string | null;
}

export interface StagingOrderGroup {
  orderId: string;
  orderNumber: string;
  processedAt: Date;
  /** Kiện về sớm nhất — tuổi chờ = now − oldestStagedAt (format ở client). */
  oldestStagedAt: Date;
  stagedTotal: number;
  /** Mọi dòng của đơn đều covered -> badge "Sẵn sàng đi". */
  readyToGo: boolean;
  lines: StagingGroupLine[];
  items: StagingGroupItem[];
}

/** Nhóm kiện khu chờ theo đơn + tính sẵn sàng. Đơn cũ nhất (processedAt) trước. */
export function groupStaging(items: StagedItemRow[], lines: OrderLineRow[]): StagingOrderGroup[] {
  const stagedByLine = new Map<string, number>();
  for (const it of items) stagedByLine.set(it.lineId, (stagedByLine.get(it.lineId) ?? 0) + 1);

  const byOrder = new Map<string, StagingOrderGroup>();
  for (const it of items) {
    let g = byOrder.get(it.orderId);
    if (!g) {
      g = {
        orderId: it.orderId, orderNumber: it.orderNumber, processedAt: it.processedAt,
        oldestStagedAt: it.stagedAt, stagedTotal: 0, readyToGo: false, lines: [], items: [],
      };
      byOrder.set(it.orderId, g);
    }
    g.stagedTotal += 1;
    if (it.stagedAt < g.oldestStagedAt) g.oldestStagedAt = it.stagedAt;
    g.items.push({
      itemId: it.itemId, unitCode: it.unitCode, sku: it.sku,
      qcResult: it.qcResult, receiptCode: it.receiptCode,
      photoUrl: it.photoUrl ?? null,
    });
  }

  for (const l of lines) {
    const g = byOrder.get(l.orderId);
    if (!g) continue; // đơn không có kiện staging -> không thuộc khu chờ
    const stagedCount = stagedByLine.get(l.lineId) ?? 0;
    const input: LineSourceInput = {
      status: l.status, qty: l.qty, stagedCount,
      warehouseInventoryId: l.warehouseInventoryId, warehouseCode: l.warehouseCode,
    };
    g.lines.push({
      lineId: l.lineId, sku: l.sku, qty: l.qty, status: l.status,
      stagedCount, covered: lineCovered(input), source: lineSource(input),
    });
  }

  const groups = [...byOrder.values()];
  for (const g of groups) {
    g.readyToGo = g.lines.length > 0 && g.lines.every((ln) => ln.covered);
  }
  groups.sort((a, b) =>
    a.processedAt.getTime() - b.processedAt.getTime()
    || a.orderNumber.localeCompare(b.orderNumber));
  return groups;
}
