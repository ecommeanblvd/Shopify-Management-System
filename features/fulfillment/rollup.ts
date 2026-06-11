/** Shared rollup: recompute + persist the order status from its lines.
 *  MUST run inside the same tx as the line mutation so concurrent
 *  transitions can't leave a torn status. */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { rollupOrderStatus, type LineStatus } from './logic';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function recomputeRollup(tx: Tx, fulfillmentId: string): Promise<void> {
  const lines = await tx.select({ status: schema.orderFulfillmentLines.status })
    .from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, fulfillmentId));
  const status = rollupOrderStatus(lines.map((l) => l.status as LineStatus));
  await tx.update(schema.orderFulfillment).set({ status, updatedAt: sql`now()` })
    .where(eq(schema.orderFulfillment.id, fulfillmentId));
}
