'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { pushPackFulfillmentCore } from './push-fulfillment';

/** Manual retry entry point — gated. Pushes (or re-pushes) a pack's fulfillment. */
export async function pushPackFulfillment(packId: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_fulfillment')) throw new Error('Forbidden');

  await pushPackFulfillmentCore(packId);
  const [s] = await db.select({ orderId: schema.shipments.orderId }).from(schema.shipments).where(eq(schema.shipments.id, packId)).limit(1);
  if (s) revalidatePath(`/f/fulfillment/${s.orderId}`);
}
