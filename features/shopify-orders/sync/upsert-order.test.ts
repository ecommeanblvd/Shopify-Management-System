import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, schema } from '@/db/client';
import { upsertOrder } from './upsert-order';
import type { ShopifyOrderPayload } from '../shopify-types';

// These are integration tests that need a real Postgres. CI doesn't
// provision one, so we skip the whole suite when DATABASE_URL isn't set
// (e.g. CI runs `npm run test` with the placeholder DATABASE_URL=…@:5432
// that nothing listens on). Pure-logic suites continue to run.
const hasLiveDb = await (async () => {
  if (!process.env.DATABASE_URL) return false;
  try {
    await db.execute('SELECT 1');
    return true;
  } catch {
    return false;
  }
})();

function fixture(name: string): ShopifyOrderPayload {
  return JSON.parse(
    readFileSync(join(__dirname, '..', '__fixtures__', `${name}.json`), 'utf8'),
  );
}

async function seedStore(): Promise<string> {
  const [s] = await db
    .insert(schema.stores)
    .values({
      name: 'Test Store',
      shopDomain: `test-${Math.random().toString(36).slice(2)}.myshopify.com`,
      encryptedToken: 'test',
      scopes: ['read_orders'],
      apiVersion: '2025-01',
    })
    .returning({ id: schema.stores.id });
  return s!.id;
}

describe.skipIf(!hasLiveDb)('upsertOrder', () => {
  beforeEach(async () => {
    await db.delete(schema.shopifyOrderRefunds);
    await db.delete(schema.shopifyOrderLines);
    await db.delete(schema.shopifyOrders);
  });

  it('inserts a new order with lines, refunds, and raw_payload', async () => {
    const storeId = await seedStore();
    const payload = fixture('order-multi-line');
    await upsertOrder(storeId, payload, 'webhook');

    const [row] = await db
      .select()
      .from(schema.shopifyOrders)
      .where(eq(schema.shopifyOrders.shopifyOrderId, payload.id));
    expect(row).toBeDefined();
    expect(row.grossLineTotal).toBe('110.00');
    expect(row.source).toBe('webhook');
    expect((row.rawPayload as { id: string }).id).toBe(payload.id);

    const lines = await db
      .select()
      .from(schema.shopifyOrderLines)
      .where(eq(schema.shopifyOrderLines.orderId, row.id));
    expect(lines).toHaveLength(2);
  });

  it('re-running with the same payload is idempotent (no duplicates)', async () => {
    const storeId = await seedStore();
    const payload = fixture('order-refunded');
    await upsertOrder(storeId, payload, 'webhook');
    await upsertOrder(storeId, payload, 'cron');

    const orders = await db
      .select()
      .from(schema.shopifyOrders)
      .where(eq(schema.shopifyOrders.shopifyOrderId, payload.id));
    expect(orders).toHaveLength(1);
    expect(orders[0].source).toBe('cron'); // last write wins

    const refunds = await db
      .select()
      .from(schema.shopifyOrderRefunds)
      .where(eq(schema.shopifyOrderRefunds.orderId, orders[0].id));
    expect(refunds).toHaveLength(1);
  });

  it('replaces lines on re-upsert (Shopify can renumber lines on edit)', async () => {
    const storeId = await seedStore();
    const payload = fixture('order-multi-line');
    await upsertOrder(storeId, payload, 'webhook');

    // Simulate Shopify dropping one line on edit.
    const trimmed = {
      ...payload,
      lineItems: { nodes: [payload.lineItems.nodes[0]] },
    };
    await upsertOrder(storeId, trimmed, 'cron');

    const [order] = await db
      .select()
      .from(schema.shopifyOrders)
      .where(eq(schema.shopifyOrders.shopifyOrderId, payload.id));
    const lines = await db
      .select()
      .from(schema.shopifyOrderLines)
      .where(eq(schema.shopifyOrderLines.orderId, order.id));
    expect(lines).toHaveLength(1);
  });
});
