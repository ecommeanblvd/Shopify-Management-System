'use server';

import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';
import { parseSkuCostsCsv } from './parse-sku-costs';

export interface ApplySkuCostsInput {
  storeId: string;
  csvText: string;
  filename: string;
  userId: string;
}

export interface ApplySkuCostsResult {
  inserted: number;
  overwritten: number;
  errors: Array<{ line: number; message: string }>;
}

export async function applySkuCosts(input: ApplySkuCostsInput): Promise<ApplySkuCostsResult> {
  const { rows, errors } = parseSkuCostsCsv(input.csvText);
  if (errors.length > 0) {
    return { inserted: 0, overwritten: 0, errors };
  }
  if (rows.length === 0) {
    return { inserted: 0, overwritten: 0, errors: [] };
  }

  // Count overwrites by counting existing rows matching incoming keys before insert.
  const existingCountRes = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count FROM sku_costs
     WHERE store_id = ${input.storeId}
       AND (sku, effective_from) IN
           (${sql.join(rows.map((r) => sql`(${r.sku}, ${r.effectiveFrom}::date)`), sql`, `)})
  `);
  const overwritten = Number(
    (existingCountRes as unknown as { count: string }[])[0]?.count ?? 0,
  );

  for (const r of rows) {
    await db.insert(schema.skuCosts)
      .values({
        storeId: input.storeId,
        sku: r.sku,
        costPerUnit: r.cost,
        currency: r.currency,
        effectiveFrom: r.effectiveFrom,
        source: `csv:${input.filename}`,
        uploadedBy: input.userId,
      })
      .onConflictDoUpdate({
        target: [schema.skuCosts.storeId, schema.skuCosts.sku, schema.skuCosts.effectiveFrom],
        set: {
          costPerUnit: r.cost,
          currency: r.currency,
          source: `csv:${input.filename}`,
          uploadedBy: input.userId,
          uploadedAt: new Date(),
        },
      });
  }

  return { inserted: rows.length - overwritten, overwritten, errors: [] };
}
