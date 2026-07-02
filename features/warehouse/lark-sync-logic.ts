/** THUẦN (không I/O): đối soát tồn kho Lark ↔ SMS.
 *  Lark "WH - Inventory": tồn đích của (sku, kho) = TỔNG cột 'Final stock' trong
 *  nhóm đó (1 dòng có thể đại diện >1 đơn vị; ô trống = 0, khớp Sum của Lark).
 *  Kế hoạch đối soát tính delta on_hand, LUÔN tôn trọng bất biến on_hand ≥ reserved
 *  (không hạ tồn xuống dưới phần allocator đang giữ). */
import { mapWarehouseCode } from '@/features/warehouse/item-import-logic';

export interface LarkStockRow {
  sku: string | null;
  warehouseRaw: string;
  /** Số đơn vị dòng này đại diện (cột Lark 'Final stock'); trống/NaN → 0. */
  finalStock: number;
  productTitle?: string | null;
}

export interface CurrentInv {
  sku: string;
  warehouseCode: string;
  qtyOnHand: number;
  qtyReserved: number;
}

export interface ReconcileItem {
  sku: string;
  warehouseCode: string;
  deltaOnHand: number;
  targetOnHand: number;
  cappedByReserved: boolean;
  isNew: boolean;
  productTitle?: string | null;
}

function key(sku: string, wh: string): string {
  return `${sku}|${wh}`;
}

/** Gom dòng Lark → tồn đích theo (sku, mapWarehouseCode(warehouseRaw)).
 *  Bỏ dòng sku rỗng. qty = TỔNG finalStock nhóm; productTitle lấy dòng đầu gặp được. */
export function larkStockCounts(
  rows: LarkStockRow[],
): Map<string, { qty: number; productTitle?: string | null }> {
  const out = new Map<string, { qty: number; productTitle?: string | null }>();
  for (const r of rows) {
    const sku = (r.sku ?? '').trim();
    if (!sku) continue;
    const wh = mapWarehouseCode(r.warehouseRaw);
    const k = key(sku, wh);
    const add = Number.isFinite(r.finalStock) ? r.finalStock : 0;
    const cur = out.get(k);
    if (cur) {
      cur.qty += add;
      if (cur.productTitle == null && r.productTitle != null) cur.productTitle = r.productTitle;
    } else {
      out.set(k, { qty: add, productTitle: r.productTitle ?? null });
    }
  }
  return out;
}

/** Kế hoạch đối soát cho mọi key trong (lark ∪ current):
 *   target = qty Lark (0 nếu vắng). current = onHand/reserved (0 nếu vắng).
 *   effectiveTarget = max(target, reserved)  — không hạ dưới phần đang giữ.
 *   delta = effectiveTarget - onHand;  cappedByReserved = effectiveTarget !== target.
 *   Bỏ item delta === 0. isNew = key chưa có trong current. */
export function reconcilePlan(
  lark: Map<string, { qty: number; productTitle?: string | null }>,
  current: CurrentInv[],
): ReconcileItem[] {
  const curMap = new Map<string, CurrentInv>();
  for (const c of current) curMap.set(key(c.sku, c.warehouseCode), c);

  const keys = new Set<string>([...lark.keys(), ...curMap.keys()]);
  const out: ReconcileItem[] = [];
  for (const k of keys) {
    const [sku, warehouseCode] = k.split('|');
    const larkEntry = lark.get(k);
    const cur = curMap.get(k);
    const target = larkEntry?.qty ?? 0;
    const onHand = cur?.qtyOnHand ?? 0;
    const reserved = cur?.qtyReserved ?? 0;

    const effectiveTarget = Math.max(target, reserved);
    const deltaOnHand = effectiveTarget - onHand;
    if (deltaOnHand === 0) continue;

    out.push({
      sku,
      warehouseCode,
      deltaOnHand,
      targetOnHand: effectiveTarget,
      cappedByReserved: effectiveTarget !== target,
      isNew: !cur,
      productTitle: larkEntry?.productTitle ?? null,
    });
  }
  return out;
}
