'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { recordAudit } from '@/lib/logging/audit';
import { canTransitionTransfer, nextTransferCode, validateTransfer, type TransferStatus } from './logic';

async function requirePerm(perm: Permission): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}

export interface CreateTransferInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  note?: string | null;
  lines: { sku: string; qty: number; productTitle?: string | null }[];
}

/** Create a draft transfer with an auto code. Pure log — no inventory change. */
export async function createTransfer(input: CreateTransferInput): Promise<string> {
  const userId = await requirePerm('manage_transfers');
  const v = validateTransfer(input);
  if (!v.ok) throw new Error(v.error);

  const id = await db.transaction(async (tx) => {
    const whs = await tx.select({ id: schema.warehouses.id, code: schema.warehouses.code })
      .from(schema.warehouses);
    const from = whs.find((w) => w.id === input.fromWarehouseId);
    const to = whs.find((w) => w.id === input.toWarehouseId);
    if (!from || !to) throw new Error('Kho không hợp lệ');

    const seqRes = await tx.execute(sql`SELECT nextval('transfer_code_seq')::bigint AS seq`);
    const seqRows = ((seqRes as unknown as { rows?: Array<{ seq: string }> }).rows ?? (seqRes as unknown as Array<{ seq: string }>));
    if (!seqRows[0]) throw new Error('transfer_code_seq trả về rỗng');
    const code = nextTransferCode(from.code, to.code, Number(seqRows[0].seq));

    const [t] = await tx.insert(schema.inventoryTransfers).values({
      code, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId,
      note: input.note ?? null, createdBy: userId,
    }).returning({ id: schema.inventoryTransfers.id });

    await tx.insert(schema.inventoryTransferLines).values(
      input.lines.map((l) => ({ transferId: t.id, sku: l.sku.trim(), productTitle: l.productTitle ?? null, qty: l.qty })),
    );
    return t.id;
  });

  try { await recordAudit({ userId, action: 'transfer_create', target: id, requestSummary: `lines=${input.lines.length}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath('/f/transfers');
  return id;
}

/** Advance a transfer's status with state-machine validation + timestamp stamping. */
async function transition(transferId: string, to: TransferStatus): Promise<void> {
  const userId = await requirePerm('manage_transfers');
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(schema.inventoryTransfers)
      .where(eq(schema.inventoryTransfers.id, transferId)).limit(1);
    if (!t) throw new Error('Phiếu không tồn tại');
    if (!canTransitionTransfer(t.status as TransferStatus, to)) {
      throw new Error(`Không thể chuyển ${t.status} → ${to}`);
    }
    const stamp = to === 'in_transit' ? { sentAt: sql`now()` } : to === 'received' ? { receivedAt: sql`now()` } : {};
    await tx.update(schema.inventoryTransfers)
      .set({ status: to, updatedAt: sql`now()`, ...stamp })
      .where(eq(schema.inventoryTransfers.id, transferId));
  });
  try { await recordAudit({ userId, action: 'transfer_transition', target: transferId, requestSummary: `to=${to}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath('/f/transfers');
}

export async function markInTransit(transferId: string): Promise<void> { await transition(transferId, 'in_transit'); }
export async function markReceived(transferId: string): Promise<void> { await transition(transferId, 'received'); }
export async function cancelTransfer(transferId: string): Promise<void> { await transition(transferId, 'cancelled'); }
