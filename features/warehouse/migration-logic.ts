/** Logic thuần cho migration một lần (scripts/migrate-warehouse-staging.ts):
 *  gỡ khỏi tồn phần hàng đi-đơn (staging) mà code Phase A từng cộng vào.
 *  Spec §2.3/§6: docs/superpowers/specs/2026-06-10-warehouse-core-auto-allocation-design.md
 *
 *  Hành vi CŨ (trước e752a41, xác minh qua git history features/receiving):
 *  - Mỗi kiện `allocate_to_order` QC pass CÓ SKU: upsert warehouse_inventory
 *    (sku @ HN) với +1 qtyOnHand, +1 qtyReserved — KHÔNG ghi ledger.
 *  - Dòng đơn gắn kèm: status='in_stock', warehouseInventoryId=<dòng HN>,
 *    allocatedQty=line.qty (kể cả khi mới 1/n kiện về!).
 *  - Pick (cũ lẫn mới): khi →picked trừ −allocatedQty/−allocatedQty; dòng
 *    GIỮ warehouseInventoryId, chỉ đổi status.
 *  Hành vi MỚI (e752a41+): kiện staging không đụng tồn; dòng nhận
 *  warehouseInventoryId=null, allocatedQty=0.
 *
 *  => Quy tắc thành viên: đóng góp của kiện còn nằm trong tồn KHI VÀ CHỈ KHI
 *  dòng đơn gắn kèm hiện còn warehouseInventoryId NOT NULL, chưa
 *  picked/packed/shipped, và linkage đó KHÔNG do allocator mới tạo (dòng không
 *  có movement auto_allocate — staging cũ không ghi ledger).
 *  Lượng gỡ mỗi dòng = SỐ KIỆN pass (mỗi kiện từng +1/+1), KHÔNG dùng
 *  allocatedQty (code cũ set = line.qty ngay từ kiện đầu — gỡ theo nó sẽ lố). */

export interface MigStagedItem {
  id: string;
  sku: string | null;
  qcResult: string;
  disposition: string;
  fulfillmentLineId: string | null;
}

export interface MigLine {
  id: string;
  status: string;
  warehouseInventoryId: string | null;
  allocatedQty: number;
}

export interface MigInventory {
  id: string;
  sku: string;
  warehouseCode: string;
  qtyOnHand: number;
  qtyReserved: number;
}

/** Một movement `migration` cần áp: gỡ −k/−k cho một dòng đơn. */
export interface StagingRemoval {
  lineId: string;
  inventoryId: string;
  sku: string;
  warehouseCode: string;
  deltaOnHand: number; // âm
  deltaReserved: number; // âm
  itemIds: string[];
  /** id kiện khi chỉ 1 kiện (refType 'receipt_item'); nhiều kiện -> null. */
  refId: string | null;
}

export interface SkippedItem { itemId: string; lineId: string | null; reason: string }
export interface StagingConflict { lineId: string; itemIds: string[]; reason: string }

export interface StagingPlan {
  removals: StagingRemoval[];
  /** Đúng theo quy tắc — không cần làm gì (đã pick / staging mới / đã nhả). */
  skipped: SkippedItem[];
  /** Dữ liệu bất thường — KHÔNG tự xử, in ra cho operator xem tay. */
  conflicts: StagingConflict[];
}

const PICKED_ONWARD = new Set(['picked', 'packed', 'shipped']);

export function computeStagingRemovals(
  items: MigStagedItem[],
  lines: MigLine[],
  inventory: MigInventory[],
  /** id các dòng đơn CÓ movement auto_allocate (linkage do allocator mới). */
  newAllocatorLineIds: Set<string>,
): StagingPlan {
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const invById = new Map(inventory.map((i) => [i.id, i]));
  const skipped: SkippedItem[] = [];
  const conflicts: StagingConflict[] = [];

  // 1) Vũ trụ: kiện đi-đơn đã QC pass. Kiện khác bỏ qua im lặng.
  const staged = items.filter((i) => i.disposition === 'allocate_to_order' && i.qcResult === 'pass');

  // 2) Gom theo dòng đơn; loại sớm kiện không thể từng cộng tồn.
  const byLine = new Map<string, MigStagedItem[]>();
  for (const it of staged) {
    if (!it.fulfillmentLineId) {
      skipped.push({ itemId: it.id, lineId: null, reason: 'kiện không gắn dòng đơn' });
      continue;
    }
    if (!it.sku) {
      skipped.push({ itemId: it.id, lineId: it.fulfillmentLineId, reason: 'kiện không có SKU (code cũ không cộng tồn)' });
      continue;
    }
    const group = byLine.get(it.fulfillmentLineId) ?? [];
    group.push(it);
    byLine.set(it.fulfillmentLineId, group);
  }

  // 3) Quy tắc thành viên từng dòng.
  const candidates: StagingRemoval[] = [];
  for (const [lineId, group] of byLine) {
    const itemIds = group.map((i) => i.id).sort();
    const ln = lineById.get(lineId);
    if (!ln) {
      conflicts.push({ lineId, itemIds, reason: 'không tìm thấy dòng đơn (dữ liệu lệch FK?)' });
      continue;
    }
    if (!ln.warehouseInventoryId) {
      for (const id of itemIds) {
        skipped.push({ itemId: id, lineId, reason: 'dòng không còn trỏ kho (kiện QC sau e752a41 / đã nhả / đã unlink)' });
      }
      continue;
    }
    if (PICKED_ONWARD.has(ln.status)) {
      for (const id of itemIds) {
        skipped.push({ itemId: id, lineId, reason: `dòng đã ${ln.status} — pick đã trừ tồn` });
      }
      continue;
    }
    if (newAllocatorLineIds.has(lineId)) {
      conflicts.push({ lineId, itemIds, reason: 'dòng có movement auto_allocate — linkage hiện tại do allocator MỚI cấp, không phải staging cũ; xử lý tay' });
      continue;
    }
    const inv = invById.get(ln.warehouseInventoryId);
    if (!inv) {
      conflicts.push({ lineId, itemIds, reason: `không tìm thấy dòng tồn ${ln.warehouseInventoryId}` });
      continue;
    }
    const badSku = group.find((i) => i.sku !== inv.sku);
    if (badSku) {
      conflicts.push({ lineId, itemIds, reason: `SKU kiện (${badSku.sku}) khác SKU dòng tồn (${inv.sku})` });
      continue;
    }
    const k = group.length;
    candidates.push({
      lineId, inventoryId: inv.id, sku: inv.sku, warehouseCode: inv.warehouseCode,
      deltaOnHand: -k, deltaReserved: -k, itemIds,
      refId: itemIds.length === 1 ? itemIds[0] : null,
    });
  }

  // 4) Bất biến CỘNG DỒN theo dòng tồn: tổng gỡ không được vượt tồn hiện tại
  //    (reserved ≤ on_hand tự bảo toàn vì gỡ hai vế bằng nhau).
  const totalByInv = new Map<string, number>();
  for (const c of candidates) {
    totalByInv.set(c.inventoryId, (totalByInv.get(c.inventoryId) ?? 0) - c.deltaOnHand);
  }
  const removals: StagingRemoval[] = [];
  for (const c of candidates) {
    const inv = invById.get(c.inventoryId)!;
    const total = totalByInv.get(c.inventoryId)!;
    if (total > inv.qtyOnHand || total > inv.qtyReserved) {
      conflicts.push({
        lineId: c.lineId, itemIds: c.itemIds,
        reason: `tồn hiện tại không đủ để gỡ: cần −${total}/−${total} nhưng ${inv.sku}@${inv.warehouseCode} chỉ có on_hand=${inv.qtyOnHand}, reserved=${inv.qtyReserved}`,
      });
      continue;
    }
    removals.push(c);
  }

  // 5) Sắp xếp ổn định để dry-run diff được giữa các lần chạy.
  removals.sort((a, b) =>
    a.sku.localeCompare(b.sku) || a.warehouseCode.localeCompare(b.warehouseCode) || a.lineId.localeCompare(b.lineId));
  skipped.sort((a, b) => a.itemId.localeCompare(b.itemId));
  conflicts.sort((a, b) => a.lineId.localeCompare(b.lineId));
  return { removals, skipped, conflicts };
}
