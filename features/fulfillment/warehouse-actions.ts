'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { applyMovement } from '@/features/warehouse/ledger';
import { listItems, listMovements, type MovementRow, type WarehouseItemRow } from '@/features/warehouse/queries';

async function requireWarehouse(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_warehouse')) throw new Error('Forbidden');
  return session.user.id;
}

/** Quyền XEM trang kho (drawer lịch sử) — cùng guard với page.tsx. */
async function requireWarehouseView(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) throw new Error('Forbidden');
  return session.user.id;
}

export interface WarehouseItemInput {
  sku: string; productTitle?: string | null; variantTitle?: string | null;
  /** Chỉ áp dụng khi TẠO MỚI dòng tồn (seed ban đầu). Mọi thay đổi sau đó đi qua adjust/transfer (ledger). */
  qtyOnHand?: number;
  warehouseCode?: 'GVM' | 'AP' | 'DM';
  shelf?: string | null; floor?: string | null; bin?: string | null; note?: string | null;
}

export async function upsertWarehouseItem(input: WarehouseItemInput): Promise<void> {
  const userId = await requireWarehouse();
  const warehouseCode = requireKnownWarehouse(input.warehouseCode ?? 'GVM');
  await db.insert(schema.warehouseInventory)
    .values({
      sku: input.sku.trim(),
      warehouseCode,
      productTitle: input.productTitle ?? null, variantTitle: input.variantTitle ?? null,
      qtyOnHand: input.qtyOnHand ?? 0,
      shelf: input.shelf ?? null, floor: input.floor ?? null,
      bin: input.bin ?? null, note: input.note ?? null,
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: [schema.warehouseInventory.sku, schema.warehouseInventory.warehouseCode],
      // Chỉ cập nhật metadata — KHÔNG đụng qtyOnHand/qtyReserved khi update
      // (bypass ledger). Số lượng chỉ đổi qua adjustStock/transferStock.
      set: {
        productTitle: input.productTitle ?? null, variantTitle: input.variantTitle ?? null,
        shelf: input.shelf ?? null, floor: input.floor ?? null,
        bin: input.bin ?? null, note: input.note ?? null, updatedBy: userId, updatedAt: sql`now()`,
      },
    });
  revalidatePath('/f/warehouse');
}

/** Lịch sử movement cho drawer — load khi mở, không preload theo bảng. */
export async function getMovements(warehouseInventoryId: string): Promise<MovementRow[]> {
  await requireWarehouseView();
  return listMovements(warehouseInventoryId);
}

/** Danh sách MÓN của một SKU (per-unit) cho drawer — load khi mở. */
export async function getItems(sku: string, warehouseCode?: string): Promise<WarehouseItemRow[]> {
  await requireWarehouseView();
  return listItems(sku, warehouseCode);
}

const WAREHOUSES = ['GVM', 'AP', 'DM'] as const;
/** Chặn tạo dòng tồn ở mã kho lạ (createIfMissing sẽ mint row mới). */
function requireKnownWarehouse(code: string): string {
  const c = code.trim();
  if (!(WAREHOUSES as readonly string[]).includes(c)) throw new Error(`Mã kho không hợp lệ: ${code}`);
  return c;
}

export async function adjustStock(input: {
  sku: string; warehouseCode: string; delta: number; note: string;
}): Promise<void> {
  const userId = await requireWarehouse();
  if (!input.note?.trim()) throw new Error('Điều chỉnh tay bắt buộc ghi lý do');
  if (!input.delta) throw new Error('Delta phải khác 0');
  // Per-unit: không thể bịa hàng từ số đếm. Tăng tay không hợp lệ — hàng vào kho
  // qua Nhập kho & QC. Chỉ cho phép giảm (write-off) và phải có đủ món in_stock.
  if (input.delta > 0) {
    throw new Error('Kho per-unit không tăng số đếm tay — nhập hàng qua Nhập kho & QC');
  }
  const warehouseCode = requireKnownWarehouse(input.warehouseCode);
  const sku = input.sku.trim();
  const note = input.note.trim();
  const need = -input.delta; // delta < 0 ở đây → need > 0
  await db.transaction(async (tx) => {
    // Chọn `need` món in_stock của SKU tại kho — lock theo id để xác định.
    const items = await tx.select({ id: schema.goodsReceiptItems.id })
      .from(schema.goodsReceiptItems)
      .where(and(
        eq(schema.goodsReceiptItems.sku, sku),
        eq(schema.goodsReceiptItems.stockStatus, 'in_stock'),
        eq(schema.goodsReceiptItems.currentWarehouseCode, warehouseCode),
      ))
      .orderBy(schema.goodsReceiptItems.id)
      .limit(need)
      .for('update');
    if (items.length < need) throw new Error('Không đủ món in_stock để giảm');
    // Write-off thủ công: đánh dấu qc_failed (note mang lý do).
    for (const it of items) {
      await tx.update(schema.goodsReceiptItems)
        .set({ stockStatus: 'qc_failed', updatedAt: sql`now()` })
        .where(eq(schema.goodsReceiptItems.id, it.id));
    }
    // Hạ rollup tương ứng (−onHand) qua cổng ledger.
    await applyMovement(tx, {
      sku, warehouseCode,
      deltaOnHand: input.delta, deltaReserved: 0,
      reason: 'manual_adjust', note, actor: userId,
    });
  });
  revalidatePath('/f/warehouse');
}

export async function transferStock(input: {
  sku: string; from: string; to: string; qty: number; note?: string | null;
}): Promise<void> {
  const userId = await requireWarehouse();
  const sku = input.sku.trim();
  const from = requireKnownWarehouse(input.from);
  const to = requireKnownWarehouse(input.to);
  if (input.qty <= 0) throw new Error('Số lượng chuyển phải > 0');
  if (from === to) throw new Error('Kho nguồn trùng kho đích');
  await db.transaction(async (tx) => {
    // Per-unit: chọn `qty` món in_stock của SKU tại kho nguồn (lock theo id) và
    // dời chúng sang kho đích — món THỰC SỰ di chuyển, không chỉ đổi số đếm.
    const items = await tx.select({ id: schema.goodsReceiptItems.id })
      .from(schema.goodsReceiptItems)
      .where(and(
        eq(schema.goodsReceiptItems.sku, sku),
        eq(schema.goodsReceiptItems.stockStatus, 'in_stock'),
        eq(schema.goodsReceiptItems.currentWarehouseCode, from),
      ))
      .orderBy(schema.goodsReceiptItems.id)
      .limit(input.qty)
      .for('update');
    if (items.length < input.qty) throw new Error('Không đủ món in_stock ở kho nguồn');
    for (const it of items) {
      await tx.update(schema.goodsReceiptItems)
        .set({ currentWarehouseCode: to, updatedAt: sql`now()` })
        .where(eq(schema.goodsReceiptItems.id, it.id));
    }
    // Deterministic lock order: always lock the lexicographically-smaller
    // warehouseCode first to prevent AB-BA deadlock when two opposite transfers
    // run concurrently (e.g. GVM→AP and AP→GVM). createIfMissing is always on
    // the DESTINATION movement, regardless of which side is locked first —
    // a missing source row must throw ("Không có dòng tồn").
    //
    // Note: transferring units that are reserved is intentionally blocked —
    // applyMovement validates reserved ≤ on_hand on the from-row; moving
    // reserved stock would leave reserved > on_hand after the out-movement.
    if (to < from) {
      // to is lexicographically first → lock to (transfer_in) first
      await applyMovement(tx, {
        sku, warehouseCode: to,
        deltaOnHand: input.qty, deltaReserved: 0,
        reason: 'transfer_in', refType: 'transfer', note: input.note ?? null, actor: userId,
        createIfMissing: {},
      });
      await applyMovement(tx, {
        sku, warehouseCode: from,
        deltaOnHand: -input.qty, deltaReserved: 0,
        reason: 'transfer_out', refType: 'transfer', note: input.note ?? null, actor: userId,
      });
    } else {
      // from is lexicographically first (or equal, already rejected) → lock from (transfer_out) first
      await applyMovement(tx, {
        sku, warehouseCode: from,
        deltaOnHand: -input.qty, deltaReserved: 0,
        reason: 'transfer_out', refType: 'transfer', note: input.note ?? null, actor: userId,
      });
      await applyMovement(tx, {
        sku, warehouseCode: to,
        deltaOnHand: input.qty, deltaReserved: 0,
        reason: 'transfer_in', refType: 'transfer', note: input.note ?? null, actor: userId,
        createIfMissing: {},
      });
    }
  });
  revalidatePath('/f/warehouse');
}
