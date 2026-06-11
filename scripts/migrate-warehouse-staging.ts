/**
 * Migration MỘT LẦN (spec §2.3/§6 — 2026-06-10 warehouse-core):
 *   (1) gỡ khỏi tồn phần hàng đi-đơn (staging) mà code Phase A từng cộng
 *       (+1 on-hand +1 reserved mỗi kiện allocate_to_order QC pass) — gỡ qua
 *       ledger (movement `migration`) rồi unlink dòng đơn khỏi dòng tồn;
 *   (2) backfill allocator FIFO cho các dòng pending_check/out_of_stock
 *       của đơn chưa huỷ (theo processedAtShopify của ĐƠN).
 *
 * Mặc định DRY-RUN — chỉ in, KHÔNG ghi gì. Thêm --apply để chạy thật:
 *
 *   npx tsx scripts/migrate-warehouse-staging.ts            # dry-run
 *   npx tsx scripts/migrate-warehouse-staging.ts --apply    # ghi thật
 *
 * Quy tắc thành viên + bất biến nằm trong logic thuần đã unit-test:
 * features/warehouse/migration-logic.ts. Script này chỉ là I/O mỏng.
 */
import 'dotenv/config';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { fifoOrder } from '@/features/warehouse/allocation-logic';
import { applyMovement } from '@/features/warehouse/ledger';
import { computeStagingRemovals, type StagingRemoval } from '@/features/warehouse/migration-logic';

const ACTOR = 'system:migration';
const NOTE = 'Gỡ staging khỏi tồn (spec §2.3 — hàng đi-đơn không nằm kho)';

function fmt(n: number): string { return n > 0 ? `+${n}` : String(n); }

async function phase1(apply: boolean): Promise<void> {
  console.log('───────────────────────────────────────────────────────────────');
  console.log('PHASE 1 — gỡ đóng góp staging cũ khỏi tồn kho');
  console.log('───────────────────────────────────────────────────────────────');

  // Vũ trụ: kiện đi-đơn đã QC pass (lọc thêm trong logic thuần).
  const items = await db.select({
    id: schema.goodsReceiptItems.id,
    sku: schema.goodsReceiptItems.sku,
    qcResult: schema.goodsReceiptItems.qcResult,
    disposition: schema.goodsReceiptItems.disposition,
    fulfillmentLineId: schema.goodsReceiptItems.fulfillmentLineId,
  }).from(schema.goodsReceiptItems)
    .where(and(eq(schema.goodsReceiptItems.disposition, 'allocate_to_order'),
               eq(schema.goodsReceiptItems.qcResult, 'pass')));

  const lineIds = [...new Set(items.map((i) => i.fulfillmentLineId).filter((x): x is string => !!x))];
  const lines = lineIds.length === 0 ? [] : await db.select({
    id: schema.orderFulfillmentLines.id,
    status: schema.orderFulfillmentLines.status,
    warehouseInventoryId: schema.orderFulfillmentLines.warehouseInventoryId,
    allocatedQty: schema.orderFulfillmentLines.allocatedQty,
  }).from(schema.orderFulfillmentLines)
    .where(inArray(schema.orderFulfillmentLines.id, lineIds));

  const invIds = [...new Set(lines.map((l) => l.warehouseInventoryId).filter((x): x is string => !!x))];
  const inventory = invIds.length === 0 ? [] : await db.select({
    id: schema.warehouseInventory.id,
    sku: schema.warehouseInventory.sku,
    warehouseCode: schema.warehouseInventory.warehouseCode,
    qtyOnHand: schema.warehouseInventory.qtyOnHand,
    qtyReserved: schema.warehouseInventory.qtyReserved,
  }).from(schema.warehouseInventory)
    .where(inArray(schema.warehouseInventory.id, invIds));

  // Dòng có movement auto_allocate: linkage do allocator MỚI — không đụng.
  const allocMoves = lineIds.length === 0 ? [] : await db.select({
    refId: schema.inventoryMovements.refId,
  }).from(schema.inventoryMovements)
    .where(and(eq(schema.inventoryMovements.reason, 'auto_allocate'),
               eq(schema.inventoryMovements.refType, 'fulfillment_line'),
               inArray(schema.inventoryMovements.refId, lineIds)));

  const plan = computeStagingRemovals(items, lines, inventory,
    new Set(allocMoves.map((m) => m.refId).filter((x): x is string => !!x)));

  console.log(`Kiện đi-đơn QC pass: ${items.length} — gỡ: ${plan.removals.length} dòng đơn, bỏ qua: ${plan.skipped.length} kiện, conflict: ${plan.conflicts.length}`);

  // Bảng theo (sku, kho): tổng delta + kiện đứng sau.
  const bySkuWh = new Map<string, { sku: string; wh: string; onHand: number; reserved: number; itemIds: string[]; lines: number }>();
  for (const r of plan.removals) {
    const key = `${r.sku}@${r.warehouseCode}`;
    const agg = bySkuWh.get(key) ?? { sku: r.sku, wh: r.warehouseCode, onHand: 0, reserved: 0, itemIds: [], lines: 0 };
    agg.onHand += r.deltaOnHand; agg.reserved += r.deltaReserved;
    agg.itemIds.push(...r.itemIds); agg.lines += 1;
    bySkuWh.set(key, agg);
  }
  if (bySkuWh.size > 0) {
    console.log('\n  SKU @ kho                      ΔonHand  Δreserved  dòng  kiện (goods_receipt_items.id)');
    for (const a of bySkuWh.values()) {
      console.log(`  ${`${a.sku} @ ${a.wh}`.padEnd(30)} ${fmt(a.onHand).padStart(7)}  ${fmt(a.reserved).padStart(9)}  ${String(a.lines).padStart(4)}  ${a.itemIds.join(', ')}`);
    }
  } else {
    console.log('  (không có gì để gỡ — tồn đã sạch staging)');
  }
  console.log(`\n  Dòng đơn sẽ unlink (warehouseInventoryId→null, allocatedQty→0, giữ in_stock): ${plan.removals.length}`);

  for (const s of plan.skipped) console.log(`  bỏ qua kiện ${s.itemId}: ${s.reason}`);
  for (const c of plan.conflicts) console.log(`  ⚠ CONFLICT dòng ${c.lineId} (kiện ${c.itemIds.join(', ')}): ${c.reason} — KHÔNG tự xử, xem tay`);

  if (!apply) return;

  let applied = 0;
  for (const r of plan.removals) {
    await db.transaction(async (tx) => {
      // applyMovement lock dòng tồn + kiểm bất biến lần cuối (trạng thái DB
      // có thể đã đổi giữa lúc đọc và lúc ghi).
      await applyMovement(tx, {
        sku: r.sku, warehouseCode: r.warehouseCode,
        deltaOnHand: r.deltaOnHand, deltaReserved: r.deltaReserved,
        reason: 'migration', refType: 'receipt_item', refId: r.refId,
        note: NOTE, actor: ACTOR,
      });
      // Unlink CÓ GUARD: chỉ khi dòng vẫn trỏ đúng dòng tồn đã tính.
      const unlinked = await tx.update(schema.orderFulfillmentLines)
        .set({ warehouseInventoryId: null, allocatedQty: 0, updatedAt: sql`now()` })
        .where(and(eq(schema.orderFulfillmentLines.id, r.lineId),
                   eq(schema.orderFulfillmentLines.warehouseInventoryId, r.inventoryId)))
        .returning({ id: schema.orderFulfillmentLines.id });
      if (unlinked.length === 0) throw new Error(`dòng ${r.lineId} không còn trỏ ${r.inventoryId} — rollback movement`);
    });
    applied += 1;
    console.log(`  ✓ gỡ ${fmt(r.deltaOnHand)}/${fmt(r.deltaReserved)} ${r.sku}@${r.warehouseCode}, unlink dòng ${r.lineId}`);
  }
  console.log(`  ÁP DỤNG PHASE 1: ${applied}/${plan.removals.length} dòng`);
}

interface BackfillCandidate { lineId: string; sku: string | null; status: string; orderProcessedAt: Date | null }

async function phase2(apply: boolean): Promise<void> {
  console.log('───────────────────────────────────────────────────────────────');
  console.log('PHASE 2 — backfill allocator FIFO cho dòng đang chờ');
  console.log('───────────────────────────────────────────────────────────────');

  const rows: BackfillCandidate[] = await db.select({
    lineId: schema.orderFulfillmentLines.id,
    sku: schema.orderFulfillmentLines.sku,
    status: schema.orderFulfillmentLines.status,
    orderProcessedAt: schema.shopifyOrders.processedAtShopify,
  }).from(schema.orderFulfillmentLines)
    .innerJoin(schema.orderFulfillment,
      eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .innerJoin(schema.shopifyOrders,
      eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .where(and(
      inArray(schema.orderFulfillmentLines.status, ['pending_check', 'out_of_stock']),
      isNotNull(schema.orderFulfillmentLines.sku),
      isNull(schema.shopifyOrders.cancelledAtShopify),
    ));

  // FIFO theo processedAtShopify của ĐƠN — cùng hàm đã test của allocator.
  const candidates = fifoOrder(rows);
  const byStatus = new Map<string, number>();
  for (const c of candidates) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
  console.log(`Dòng chờ allocator: ${candidates.length} (${[...byStatus].map(([s, n]) => `${s}: ${n}`).join(', ') || '—'})`);
  const LIST_CAP = 50;
  for (const c of candidates.slice(0, LIST_CAP)) {
    console.log(`  ${c.lineId}  sku=${c.sku}  ${c.status}  đơn về=${c.orderProcessedAt?.toISOString() ?? '—'}`);
  }
  if (candidates.length > LIST_CAP) {
    console.log(`  … và ${candidates.length - LIST_CAP} dòng nữa (FIFO theo processedAtShopify; --apply sẽ chạy TẤT CẢ).`);
  }

  if (!apply) return;

  // Import lười: dry-run không được kéo allocator vào.
  const { allocateLine } = await import('@/features/warehouse/allocate');
  let granted = 0, denied = 0, failed = 0;
  for (const c of candidates) {
    try {
      if (await allocateLine(c.lineId)) granted += 1;
      else denied += 1; // không đủ tồn -> out_of_stock, đi luồng brand như cũ
    } catch (err) {
      failed += 1;
      console.error(`  ✗ allocateLine(${c.lineId}) lỗi:`, err);
    }
  }
  console.log(`  ÁP DỤNG PHASE 2: cấp được ${granted}, thiếu tồn ${denied}, lỗi ${failed}`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(apply
    ? '*** CHẾ ĐỘ --apply: SẼ GHI VÀO DATABASE ***'
    : 'DRY-RUN (mặc định) — chỉ in, không ghi gì. Thêm --apply để chạy thật.');
  await phase1(apply);
  await phase2(apply);
  console.log('───────────────────────────────────────────────────────────────');
  console.log(apply ? 'ÁP DỤNG XONG.' : 'DRY-RUN XONG — không có gì bị thay đổi.');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
