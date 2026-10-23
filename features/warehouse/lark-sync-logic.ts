/** THUẦN (không I/O): đối soát tồn kho Lark ↔ SMS.
 *  Lark "WH - Inventory": tồn đích của (sku, kho) = TỔNG cột 'Final stock' trong
 *  nhóm đó (1 dòng có thể đại diện >1 đơn vị; ô trống = 0, khớp Sum của Lark).
 *  Kế hoạch đối soát tính delta on_hand, LUÔN tôn trọng bất biến on_hand ≥ reserved
 *  (không hạ tồn xuống dưới phần allocator đang giữ). */
import { mapWarehouseCode } from '@/features/warehouse/item-import-logic';

/**
 * Bóc SỐ từ ô Lark. Field 'Final stock' là CÔNG THỨC → shape `{type:2, value:[1]}`
 * (value là mảng), không phải text — `larkText` trả null. Xử lý: number thẳng;
 * mảng → phần tử đầu; object có `value`/`text`; chuỗi số. Không parse được → 0.
 */
export function larkNumber(f: unknown): number {
  if (f == null) return 0;
  if (typeof f === 'number') return Number.isFinite(f) ? f : 0;
  if (Array.isArray(f)) return larkNumber(f[0]);
  if (typeof f === 'object') {
    const o = f as { value?: unknown; text?: unknown };
    if (o.value !== undefined) return larkNumber(o.value);
    if (o.text !== undefined) return larkNumber(o.text);
    return 0;
  }
  const n = Number(String(f).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

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

/** Trần dòng bị ĐẶT VỀ 0 trong một lượt: tối thiểu 20, hoặc 25% số dòng đang có tồn. */
export const TRAN_VE_0_TOI_THIEU = 20;
export const TRAN_VE_0_TY_LE = 0.25;

/**
 * THUẦN: chốt chặn trước khi GHI THẬT. Trả lý do từ chối, hoặc `null` nếu an toàn.
 *
 * Vì sao cần: `reconcilePlan` coi dòng vắng trên Lark là "đích = 0". Lark trả rỗng/thiếu
 * (lỗi API giữa chừng, đổi tên cột, view bị sửa bộ lọc) thì kế hoạch hợp lệ về mặt toán học
 * nhưng sẽ quét sạch tồn của cả kho trong một giao dịch — và sổ cái ghi nó như một lần điều
 * chỉnh tay bình thường. Hai dấu hiệu: Lark không có dòng nào, hoặc số dòng về 0 vượt trần.
 * Từ chối thì lượt chạy đỏ trên /f/jobs để người xem kế hoạch rồi quyết, thay vì tự ghi.
 */
export function lyDoTuChoiGhi(
  larkRows: number,
  plan: readonly ReconcileItem[],
  current: readonly CurrentInv[],
): string | null {
  if (larkRows === 0) return 'Lark trả 0 dòng — nghi lỗi đọc bảng/đổi cột, KHÔNG ghi để khỏi xoá sạch tồn.';
  const dangCoTon = current.filter((c) => c.qtyOnHand > 0).length;
  const veKhong = plan.filter((p) => !p.isNew && p.targetOnHand === 0).length;
  const tran = Math.max(TRAN_VE_0_TOI_THIEU, Math.ceil(dangCoTon * TRAN_VE_0_TY_LE));
  if (veKhong > tran) {
    return `Kế hoạch đặt ${veKhong}/${dangCoTon} dòng tồn về 0 (trần ${tran}) — quá bất thường, KHÔNG ghi. Xem kế hoạch chạy thử rồi quyết.`;
  }
  return null;
}
