'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
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
  const warehouseCode = requireKnownWarehouse(input.warehouseCode);
  await db.transaction(async (tx) => {
    await applyMovement(tx, {
      sku: input.sku.trim(), warehouseCode,
      deltaOnHand: input.delta, deltaReserved: 0,
      reason: 'manual_adjust', note: input.note.trim(), actor: userId,
      createIfMissing: {},
    });
  });
  if (input.delta > 0) {
    // Hàng mới xuất hiện → thử cấp cho đơn chờ (spec §4b), best-effort.
    try {
      const { reallocateSku } = await import('@/features/warehouse/allocate');
      await reallocateSku(input.sku.trim());
    } catch (e) { console.error('reallocate after adjust:', e); }
  }
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
    // Deterministic lock order: always lock the lexicographically-smaller
    // warehouseCode first to prevent AB-BA deadlock when two opposite transfers
    // run concurrently (e.g. HN→SG and SG→HN). createIfMissing is always on
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
