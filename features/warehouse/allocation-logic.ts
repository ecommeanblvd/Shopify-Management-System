/** Pure allocation logic — no DB. Spec §3:
 *  docs/superpowers/specs/2026-06-10-warehouse-core-auto-allocation-design.md */

export interface StockCandidate { code: string; available: number }

/** Kho khả dụng nhiều nhất; hoà -> HN trước (rồi alphabet cho kho tương lai). */
export function pickWarehouse(stocks: StockCandidate[]): string | null {
  const positive = stocks.filter((s) => s.available > 0);
  if (positive.length === 0) return null;
  positive.sort((a, b) =>
    b.available - a.available
    || ((b.code === 'HN' ? 1 : 0) - (a.code === 'HN' ? 1 : 0))
    || a.code.localeCompare(b.code));
  return positive[0].code;
}

export interface AllocationPlan { warehouseCode: string; qty: number }

/** Đủ-hoặc-không tại MỘT kho (v1 không tách kiện giữa hai kho). */
// NOTE(T4): caller chỉ cần truyền { qty }
export function planAllocation(
  line: { qty: number },
  stocks: StockCandidate[],
): AllocationPlan | null {
  if (line.qty <= 0) return null;
  const code = pickWarehouse(stocks.filter((s) => s.available >= line.qty));
  return code ? { warehouseCode: code, qty: line.qty } : null;
}

/** FIFO theo thời điểm đơn về; thiếu mốc thời gian xếp cuối. */
export function fifoOrder<T extends { orderProcessedAt: Date | null }>(lines: T[]): T[] {
  return [...lines].sort((a, b) => {
    if (a.orderProcessedAt === null) return b.orderProcessedAt === null ? 0 : 1;
    if (b.orderProcessedAt === null) return -1;
    return a.orderProcessedAt.getTime() - b.orderProcessedAt.getTime();
  });
}

export interface PickableItem { id: string; warehouseCode: string; receivedAt: Date | null }
/** Chọn 1 món để cấp: kho nhiều món nhất (hoà → ưu tiên WAREHOUSE_PRIORITY),
 *  trong kho đó lấy món NHẬN CŨ NHẤT (FIFO; receivedAt null xếp cuối). */
export const WAREHOUSE_PRIORITY = ['GVM', 'AP', 'DM'];
export function pickItem<T extends PickableItem>(items: T[]): T | null {
  if (items.length === 0) return null;
  const byWh = new Map<string, T[]>();
  for (const it of items) { const l = byWh.get(it.warehouseCode) ?? []; l.push(it); byWh.set(it.warehouseCode, l); }
  let best: string | null = null;
  for (const [wh, list] of byWh) {
    if (best === null) { best = wh; continue; }
    const a = list.length, b = byWh.get(best)!.length;
    if (a > b || (a === b && rank(wh) < rank(best))) best = wh;
  }
  const pool = byWh.get(best!)!;
  return [...pool].sort((x, y) =>
    (x.receivedAt?.getTime() ?? Infinity) - (y.receivedAt?.getTime() ?? Infinity)
    || x.id.localeCompare(y.id))[0];
}
function rank(wh: string): number { const i = WAREHOUSE_PRIORITY.indexOf(wh); return i < 0 ? 99 : i; }

export interface MovementDelta { deltaOnHand: number; deltaReserved: number }

/** Bất biến tồn sau movement: on_hand ≥ 0, 0 ≤ reserved ≤ on_hand, delta ≠ rỗng. */
export function validateMovement(
  inv: { qtyOnHand: number; qtyReserved: number },
  d: MovementDelta,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(d.deltaOnHand) || !Number.isInteger(d.deltaReserved)) {
    return { ok: false, error: 'Delta không phải số nguyên hợp lệ' };
  }
  if (d.deltaOnHand === 0 && d.deltaReserved === 0) return { ok: false, error: 'Movement rỗng' };
  const onHand = inv.qtyOnHand + d.deltaOnHand;
  const reserved = inv.qtyReserved + d.deltaReserved;
  if (onHand < 0) return { ok: false, error: `on_hand âm (${onHand})` };
  if (reserved < 0) return { ok: false, error: `reserved âm (${reserved})` };
  if (reserved > onHand) return { ok: false, error: `reserved (${reserved}) vượt on_hand (${onHand})` };
  return { ok: true };
}

/**
 * Đuôi `-sale`: SKU bản BÁN LẠI mà MMP dựng trên Shopify (`<Global SKU>-sale`).
 * KHÔNG phân biệt hoa thường — dữ liệu thật dùng `-Sale` chữ S hoa.
 */
const DUOI_SALE = /-sale$/i;

/**
 * THUẦN: danh sách SKU cần thử khi tìm tồn cho một dòng đơn, theo THỨ TỰ ưu tiên.
 *
 * Dòng đơn mang SKU `-sale` phải tìm được tồn của **SKU GỐC**: đó là CÙNG MỘT CHIẾC trong
 * kho, không phải mặt hàng mới (hợp đồng `docs/mmp/resale-ton-kho.md`, mục "Đơn hàng SKU
 * -sale"). Trước 26/10/2026 allocator tra đúng `X-Sale` trong `goods_receipt_items`, không
 * thấy, rồi đánh `out_of_stock` — đo được **622/628 dòng** `-Sale` nằm im ở đó suốt hai năm,
 * không dòng nào nối tới tồn. Và nó không kêu, vì `out_of_stock` là trạng thái hợp lệ.
 *
 * Thứ tự có nghĩa: thử **nguyên văn trước**. Có 16 dòng tồn ghi ngay dưới SKU `-Sale` (bản
 * bán lại dựng tay từ 2024), nên nếu kho đã earmark đúng chiếc cho bản sale thì phải lấy
 * chiếc đó; chỉ khi không có mới mượn tồn của SKU gốc.
 */
export function skuUngVien(sku: string): string[] {
  const goc = sku.replace(DUOI_SALE, '');
  return goc === sku ? [sku] : [sku, goc];
}

/** Món tồn tối thiểu mà allocator cần để chọn. */
export interface MonTon { id: string; warehouseCode: string | null; receivedAt: Date | null }

/**
 * Tra lần lượt các SKU ứng viên, DỪNG ở cái đầu tiên có món; trả về cả SKU đó.
 *
 * Bóc ra khỏi `allocateLine` vì đây là phần dễ sai nhất của bản vá `-sale` và nó vốn nằm
 * trong một transaction nên không test thuần nào với tới. Hai tính chất được ghim:
 *
 *  1. **SKU trả về là SKU của CHIẾC** — dùng để ghi sổ cái. Ghi theo SKU dòng đơn khi đang
 *     mượn tồn SKU gốc sẽ dựng một dòng `warehouse_inventory` mới cho `X-sale` và giữ chỗ ở
 *     đó, trong khi chiếc hàng bị trừ khỏi kho của `X` — **đếm trùng**.
 *  2. **Dừng ở ứng viên đầu tiên có món** — không trộn hai SKU vào một lượt chọn, để FIFO
 *     vẫn là FIFO trong phạm vi một SKU.
 */
export async function timUngVienCoMon(
  ungVien: readonly string[],
  tra: (sku: string) => Promise<MonTon[]>,
): Promise<{ sku: string; items: MonTon[] }> {
  for (const sku of ungVien) {
    const items = await tra(sku);
    if (items.length > 0) return { sku, items };
  }
  return { sku: ungVien[0]!, items: [] };
}
