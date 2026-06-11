/**
 * One-off CLI: seed 833 món tồn per-unit từ file vận hành thật vào
 * `goods_receipt_items` (+ synthetic `goods_receipts` + rollup `warehouse_inventory`).
 * Plan Task 5 / spec §4+§6: docs/superpowers/specs/2026-06-11-warehouse-per-unit-design.md
 *
 *   npx tsx scripts/import-warehouse-items.ts            # DRY-RUN (default, no writes)
 *   npx tsx scripts/import-warehouse-items.ts --apply    # ghi DB trong 1 transaction
 *
 * Idempotent: upsert goods_receipts theo `code`, goods_receipt_items theo `unitCode`,
 * warehouse_inventory theo (sku, warehouse_code). Chạy lại = no-op trên dữ liệu đã seed.
 */
import 'dotenv/config';
import * as XLSX from 'xlsx';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { mapWarehouseCode, mapStockStatus } from '@/features/warehouse/item-import-logic';

const SRC_FILE =
  '/Users/macos/Downloads/Operation Work files 2026 (NEW)_WH - Inventory (Nhập, QC, Pack)_Qly tồn kho tổng hợp.xlsx';
const SHEET = 'WH - Inventory (Nhập, QC, Pack)';
/** Fixed past date dùng làm receivedAt cho receipt khi không suy được từ món. */
const FALLBACK_RECEIVED_AT = new Date('2021-01-01T00:00:00Z');

type Cell = unknown;

/** Slug an inventory-type label vào phần code receipt (ascii, không dấu). */
function slug(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // bỏ dấu tiếng Việt
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** sourceType gần đúng theo Inventory type (giữ raw vào note để không mất 7 loại). */
function mapSourceType(invType: string): 'retail_for_order' | 'consignment' | 'po' {
  if (/consignment|ký gửi|ky gui/i.test(invType)) return 'consignment';
  if (/\bPO\b/i.test(invType)) return 'po';
  return 'retail_for_order';
}

/** 'QC Pass' -> 'pass', 'QC Failed' -> 'fail', else 'pending'. */
function mapQcResult(raw: string): 'pending' | 'pass' | 'fail' {
  if (/fail/i.test(raw)) return 'fail';
  if (/pass/i.test(raw)) return 'pass';
  return 'pending';
}

/** 'Lưu kho' -> store; 'Tạm nhập' -> allocate_to_order; else store. */
function mapDisposition(action: string): 'store' | 'allocate_to_order' {
  return /tạm nhập/i.test(action) ? 'allocate_to_order' : 'store';
}

function str(v: Cell): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}
function toDate(v: Cell): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v.trim());
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}
function toNum(v: Cell): string | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? String(n) : null;
}

interface MappedItem {
  unitCode: string;
  sku: string | null;
  productTitle: string | null;
  variantTitle: string | null;
  warehouse: string;
  location: string | null;
  qcResult: 'pending' | 'pass' | 'fail';
  qcFailReason: string | null;
  disposition: 'store' | 'allocate_to_order';
  stockStatus: string;
  invType: string;
  domPrice: string | null;
  globalPrice: string | null;
  globalPriceCurrency: string | null;
  weightKg: string | null;
  receivedAt: Date | null;
  orderRef: string | null;
}

function loadRows(): { header: string[]; rows: Cell[][] } {
  const wb = XLSX.readFile(SRC_FILE, { cellDates: true });
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`Sheet "${SHEET}" not found. Có: ${wb.SheetNames.join(', ')}`);
  const all = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, blankrows: false });
  const header = (all[0] ?? []).map((h) => String(h ?? ''));
  return { header, rows: all.slice(1) };
}

function mapRows(header: string[], rows: Cell[][]): MappedItem[] {
  // Header startsWith — headers dài, khớp tiền tố.
  const col = (prefix: string): number => header.findIndex((h) => h.startsWith(prefix));
  const C = {
    unitCode: col('WH - Unique code'),
    sku: col('Lineitem SKU final'),
    productTitle: 13, // "Lineitem Name" (non-lookup); col 12 là "Lineitem Name (look up)".
    warehouse: col('Warehouse'),
    location: col('Vị trí tại kho'),
    qc: col('QC Check'),
    qcFailReason: col('Lý do QC failed'),
    action: col('WH - Action'),
    invType: col('Import - Inventory type'),
    domPrice: 21, // "Dom. Price (theo file báo đơn & BBGN)".
    globalPriceImport: col('Import - Global Price'),
    globalPriceLookup: col('Global Price (look up)'),
    globalCurrencyImport: col('Import - Global Price Currency'),
    globalCurrencyLookup: col('Global Price Currency'),
    weightKg: col('Weight (kg)'),
    receivedAt: col('Ngày Import'),
    exportDate: col('Ngày xuất kho-DB final'),
    colorExtract: col('Color Extract'),
    sizeExtract: col('Size Extract'),
    orderRef: col('Order Number final'),
  };
  const out: MappedItem[] = [];
  for (const r of rows) {
    const unitCode = str(r[C.unitCode]);
    if (!unitCode) continue; // không có mã WH -> bỏ (không thể upsert)
    const colorVal = str(r[C.colorExtract]);
    const sizeVal = str(r[C.sizeExtract]);
    const variantTitle = [colorVal, sizeVal].filter((s) => s).join(' / ') || null;
    const qcRaw = str(r[C.qc]);
    const actionRaw = str(r[C.action]);
    const exportRaw = str(r[C.exportDate]); // Date -> ISO; "Chưa xuất đơn" giữ nguyên.
    const globalImport = toNum(r[C.globalPriceImport]);
    const globalLookup = toNum(r[C.globalPriceLookup]);
    const globalPrice = globalImport ?? globalLookup;
    const curImport = str(r[C.globalCurrencyImport]) || null;
    const curLookup = str(r[C.globalCurrencyLookup]) || null;
    out.push({
      unitCode,
      sku: str(r[C.sku]) || null,
      productTitle: str(r[C.productTitle]) || null,
      variantTitle,
      warehouse: mapWarehouseCode(str(r[C.warehouse])),
      location: str(r[C.location]) || null,
      qcResult: mapQcResult(qcRaw),
      qcFailReason: str(r[C.qcFailReason]) || null,
      disposition: mapDisposition(actionRaw),
      stockStatus: mapStockStatus({ qc: qcRaw, action: actionRaw, exportDate: exportRaw }),
      invType: str(r[C.invType]),
      domPrice: toNum(r[C.domPrice]),
      globalPrice,
      globalPriceCurrency: globalPrice == null ? null : curImport ?? curLookup,
      weightKg: toNum(r[C.weightKg]),
      receivedAt: toDate(r[C.receivedAt]),
      orderRef: str(r[C.orderRef]) || null,
    });
  }
  return out;
}

interface SyntheticReceipt {
  code: string;
  warehouseCode: string;
  sourceType: 'retail_for_order' | 'consignment' | 'po';
  note: string;
  receivedAt: Date;
}

/** Gom món thành 1 receipt cho mỗi (warehouse, invType). */
function buildReceipts(items: MappedItem[]): SyntheticReceipt[] {
  const byKey = new Map<string, MappedItem[]>();
  for (const it of items) {
    const k = `${it.warehouse}::${it.invType}`;
    const l = byKey.get(k) ?? [];
    l.push(it);
    byKey.set(k, l);
  }
  const receipts: SyntheticReceipt[] = [];
  for (const [, list] of byKey) {
    const first = list[0];
    const dates = list.map((i) => i.receivedAt).filter((d): d is Date => d != null);
    const minReceived = dates.length
      ? new Date(Math.min(...dates.map((d) => d.getTime())))
      : FALLBACK_RECEIVED_AT;
    receipts.push({
      code: `SEED-${first.warehouse}-${slug(first.invType) || 'unknown'}`,
      warehouseCode: first.warehouse,
      sourceType: mapSourceType(first.invType),
      note: first.invType,
      receivedAt: minReceived,
    });
  }
  return receipts;
}

function tally<T>(items: T[], by: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = by(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function printTally(label: string, m: Map<string, number>): void {
  console.log(`  ${label}:`);
  for (const [k, n] of [...m].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(14)} ${String(n).padStart(5)}`);
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(
    apply
      ? '*** --apply: SẼ GHI goods_receipts + goods_receipt_items + warehouse_inventory ***'
      : 'DRY-RUN — chỉ in, không ghi DB. (dùng --apply để ghi)',
  );

  const { header, rows } = loadRows();
  const items = mapRows(header, rows);
  console.log(`\nĐọc ${SHEET}: ${rows.length} dòng dữ liệu → ${items.length} món có unitCode.`);

  const receipts = buildReceipts(items);

  // === Đếm dry-run ===
  console.log('\n=== Tổng hợp ===');
  printTally('Theo stockStatus', tally(items, (i) => i.stockStatus));
  printTally('Theo kho (currentWarehouseCode)', tally(items, (i) => i.warehouse));
  console.log(`  Synthetic receipts: ${receipts.length}`);

  // Rollup dự kiến: (sku, warehouse) với in_stock|allocated; staging KHÔNG vào rollup.
  const rollupKeys = new Set<string>();
  for (const it of items) {
    if (!it.sku) continue;
    if (it.stockStatus === 'in_stock' || it.stockStatus === 'allocated') {
      rollupKeys.add(`${it.sku}::${it.warehouse}`);
    }
  }
  console.log(`  Rollup rows (sku × kho, in_stock|allocated): ${rollupKeys.size}`);

  // Best-effort order lookup map: orderRef (#…) → shopifyOrders.id
  const orderRefs = [...new Set(items.map((i) => i.orderRef).filter((s): s is string => !!s))];
  const orderIdByRef = new Map<string, string>();
  if (orderRefs.length) {
    const found = await db
      .select({
        num: schema.shopifyOrders.shopifyOrderNumber,
        id: schema.shopifyOrders.id,
      })
      .from(schema.shopifyOrders)
      .where(inArray(schema.shopifyOrders.shopifyOrderNumber, orderRefs));
    for (const f of found) orderIdByRef.set(f.num, f.id);
    console.log(
      `  Order refs: ${orderRefs.length} distinct → ${orderIdByRef.size} khớp shopify_orders.`,
    );
  }

  if (!apply) {
    console.log('\nDRY-RUN XONG. Không ghi gì. Chạy lại với --apply để import (Task 7).');
    await db.$client.end();
    return;
  }

  // === APPLY: tất cả writes trong 1 transaction ===
  let receiptRows = 0;
  let itemRows = 0;
  let backfillRows = 0;
  let rollupRows = 0;

  await db.transaction(async (tx) => {
    // 1) Upsert synthetic receipts → thu id theo code.
    const receiptIdByCode = new Map<string, string>();
    for (const rc of receipts) {
      const [row] = await tx
        .insert(schema.goodsReceipts)
        .values({
          code: rc.code,
          warehouseCode: rc.warehouseCode,
          sourceType: rc.sourceType,
          vendor: null,
          note: rc.note,
          receivedAt: rc.receivedAt,
        })
        .onConflictDoUpdate({
          target: schema.goodsReceipts.code,
          set: {
            warehouseCode: rc.warehouseCode,
            sourceType: rc.sourceType,
            note: rc.note,
            receivedAt: rc.receivedAt,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: schema.goodsReceipts.id });
      receiptIdByCode.set(rc.code, row.id);
      receiptRows += 1;
    }

    // 2) Upsert goods_receipt_items theo unitCode.
    const importedUnitCodes = items.map((i) => i.unitCode);
    for (const it of items) {
      const code = `SEED-${it.warehouse}-${slug(it.invType) || 'unknown'}`;
      const receiptId = receiptIdByCode.get(code);
      if (!receiptId) throw new Error(`Thiếu receipt cho code ${code} (unit ${it.unitCode})`);
      const orderId = it.orderRef ? orderIdByRef.get(it.orderRef) ?? null : null;
      const [row] = await tx
        .insert(schema.goodsReceiptItems)
        .values({
          receiptId,
          unitCode: it.unitCode,
          sku: it.sku,
          productTitle: it.productTitle,
          variantTitle: it.variantTitle,
          qcResult: it.qcResult,
          qcFailReason: it.qcFailReason,
          qcCheckedAt: it.receivedAt,
          disposition: it.disposition,
          orderId,
          domPrice: it.domPrice,
          domPriceCurrency: it.domPrice == null ? null : 'VND',
          globalPrice: it.globalPrice,
          globalPriceCurrency: it.globalPriceCurrency,
          weightKg: it.weightKg,
          currentWarehouseCode: it.warehouse,
          location: it.location,
          stockStatus: it.stockStatus as typeof schema.goodsReceiptItems.$inferInsert.stockStatus,
        })
        .onConflictDoUpdate({
          target: schema.goodsReceiptItems.unitCode,
          set: {
            receiptId,
            sku: it.sku,
            productTitle: it.productTitle,
            variantTitle: it.variantTitle,
            qcResult: it.qcResult,
            qcFailReason: it.qcFailReason,
            qcCheckedAt: it.receivedAt,
            disposition: it.disposition,
            orderId,
            domPrice: it.domPrice,
            domPriceCurrency: it.domPrice == null ? null : 'VND',
            globalPrice: it.globalPrice,
            globalPriceCurrency: it.globalPriceCurrency,
            weightKg: it.weightKg,
            currentWarehouseCode: it.warehouse,
            location: it.location,
            stockStatus: it.stockStatus as typeof schema.goodsReceiptItems.$inferInsert.stockStatus,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: schema.goodsReceiptItems.id });
      if (row) itemRows += 1;
    }

    // 3) Backfill món cũ (spec §6): rows stockStatus='pending' KHÔNG nằm trong import set.
    //    Suy stockStatus từ qcResult+disposition; currentWarehouseCode ← receipt.warehouseCode nếu null.
    const preExisting = await tx
      .select({
        id: schema.goodsReceiptItems.id,
        qcResult: schema.goodsReceiptItems.qcResult,
        disposition: schema.goodsReceiptItems.disposition,
        currentWarehouseCode: schema.goodsReceiptItems.currentWarehouseCode,
        receiptWarehouseCode: schema.goodsReceipts.warehouseCode,
      })
      .from(schema.goodsReceiptItems)
      .innerJoin(
        schema.goodsReceipts,
        eq(schema.goodsReceiptItems.receiptId, schema.goodsReceipts.id),
      )
      .where(
        and(
          eq(schema.goodsReceiptItems.stockStatus, 'pending'),
          importedUnitCodes.length
            ? sql`${schema.goodsReceiptItems.unitCode} NOT IN ${importedUnitCodes}`
            : sql`true`,
        ),
      );
    for (const row of preExisting) {
      let derived: 'qc_failed' | 'in_stock' | 'staging' | null = null;
      if (row.qcResult === 'fail') derived = 'qc_failed';
      else if (row.disposition === 'store' && row.qcResult === 'pass') derived = 'in_stock';
      else if (row.disposition === 'allocate_to_order') derived = 'staging';
      if (!derived) continue;
      const wh = row.currentWarehouseCode ?? row.receiptWarehouseCode;
      const u = await tx
        .update(schema.goodsReceiptItems)
        .set({ stockStatus: derived, currentWarehouseCode: wh, updatedAt: sql`now()` })
        .where(eq(schema.goodsReceiptItems.id, row.id));
      backfillRows += u.rowCount ?? 0;
    }

    // 4) Recompute warehouse_inventory rollup từ TẤT CẢ món (direct set — seed, không applyMovement).
    //    onHand = count(in_stock|allocated); reserved = count(allocated). Staging excluded.
    const agg = await tx
      .select({
        sku: schema.goodsReceiptItems.sku,
        warehouseCode: schema.goodsReceiptItems.currentWarehouseCode,
        onHand: sql<number>`count(*) FILTER (WHERE ${schema.goodsReceiptItems.stockStatus} IN ('in_stock','allocated'))::int`,
        reserved: sql<number>`count(*) FILTER (WHERE ${schema.goodsReceiptItems.stockStatus} = 'allocated')::int`,
      })
      .from(schema.goodsReceiptItems)
      .where(
        and(
          isNotNull(schema.goodsReceiptItems.currentWarehouseCode),
          isNotNull(schema.goodsReceiptItems.sku),
        ),
      )
      .groupBy(schema.goodsReceiptItems.sku, schema.goodsReceiptItems.currentWarehouseCode);

    for (const a of agg) {
      if (a.onHand === 0 && a.reserved === 0) continue; // (sku,kho) chỉ có staging/shipped → bỏ
      await tx
        .insert(schema.warehouseInventory)
        .values({
          sku: a.sku!,
          warehouseCode: a.warehouseCode!,
          qtyOnHand: a.onHand,
          qtyReserved: a.reserved,
          updatedBy: 'system:seed-import',
        })
        .onConflictDoUpdate({
          target: [schema.warehouseInventory.sku, schema.warehouseInventory.warehouseCode],
          set: {
            qtyOnHand: a.onHand,
            qtyReserved: a.reserved,
            updatedBy: 'system:seed-import',
            updatedAt: sql`now()`,
          },
        });
      rollupRows += 1;
    }
  });

  console.log('\n=== ✓ APPLY xong ===');
  console.log(`  goods_receipts upserted:      ${receiptRows}`);
  console.log(`  goods_receipt_items upserted: ${itemRows}`);
  console.log(`  backfill (món cũ) updated:    ${backfillRows}`);
  console.log(`  warehouse_inventory rows:     ${rollupRows}`);
  await db.$client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
