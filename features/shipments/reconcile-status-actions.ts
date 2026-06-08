'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

const ROUTE = '/f/shipping-reconcile';

async function requireUser(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    throw new Error('Forbidden');
  }
  return session.user.id;
}

export interface SetReconcileStatusInput {
  shipmentId: string;
  status: 'reconciled' | 'ignored';
  note?: string | null;
  /** Current billed total, snapshotted for change detection. */
  billedTotal: number;
}

export async function setReconcileStatus(input: SetReconcileStatusInput): Promise<void> {
  const userId = await requireUser();
  await db
    .insert(schema.shipmentReconcileStatus)
    .values({
      shipmentId: input.shipmentId,
      status: input.status,
      note: input.note?.trim() || null,
      billedTotalAtReview: input.billedTotal.toString(),
      reconciledBy: userId,
    })
    .onConflictDoUpdate({
      target: schema.shipmentReconcileStatus.shipmentId,
      set: {
        status: input.status,
        note: input.note?.trim() || null,
        billedTotalAtReview: input.billedTotal.toString(),
        reconciledBy: userId,
        reconciledAt: sql`now()`,
      },
    });
  revalidatePath(ROUTE);
}

/** Remove the status row → shipment returns to "pending". */
export async function clearReconcileStatus(shipmentId: string): Promise<void> {
  await requireUser();
  await db
    .delete(schema.shipmentReconcileStatus)
    .where(eq(schema.shipmentReconcileStatus.shipmentId, shipmentId));
  revalidatePath(ROUTE);
}
