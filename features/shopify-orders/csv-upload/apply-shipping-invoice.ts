'use server';

import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { parseShippingInvoiceCsv } from './parse-shipping-invoice';

export interface ApplyShippingInvoiceInput {
  storeId: string;
  carrierAccountId: string;
  invoicePeriodStart: string;
  invoicePeriodEnd: string;
  csvText: string;
  filename: string;
}

export interface ApplyShippingInvoiceResult {
  inserted: number;
  overwritten: number;
  errors: Array<{ line: number; message: string }>;
}

export async function applyShippingInvoice(input: ApplyShippingInvoiceInput): Promise<ApplyShippingInvoiceResult> {
  const { rows, errors } = parseShippingInvoiceCsv(input.csvText);
  if (errors.length > 0) return { inserted: 0, overwritten: 0, errors };
  if (rows.length === 0) return { inserted: 0, overwritten: 0, errors: [] };

  let inserted = 0;
  let overwritten = 0;
  for (const r of rows) {
    const found = await db
      .select({ id: schema.shippingInvoices.id })
      .from(schema.shippingInvoices)
      .where(and(
        eq(schema.shippingInvoices.storeId, input.storeId),
        eq(schema.shippingInvoices.trackingNumber, r.trackingNumber),
      ));
    if (found.length > 0) overwritten++; else inserted++;

    await db.insert(schema.shippingInvoices)
      .values({
        storeId: input.storeId,
        carrierAccountId: input.carrierAccountId,
        trackingNumber: r.trackingNumber,
        invoicePeriodStart: input.invoicePeriodStart,
        invoicePeriodEnd: input.invoicePeriodEnd,
        actualCost: r.actualCost,
        currency: r.currency,
        source: `csv:${input.filename}`,
      })
      .onConflictDoUpdate({
        target: [schema.shippingInvoices.storeId, schema.shippingInvoices.trackingNumber],
        set: {
          actualCost: r.actualCost,
          currency: r.currency,
          invoicePeriodStart: input.invoicePeriodStart,
          invoicePeriodEnd: input.invoicePeriodEnd,
          source: `csv:${input.filename}`,
          uploadedAt: new Date(),
        },
      });
  }

  return { inserted, overwritten, errors: [] };
}
