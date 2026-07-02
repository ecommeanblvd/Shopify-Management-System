'use server';

import { inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { parseShipHoImportRow, statusForImportedOrder, type ParsedShipHoImport } from './import-parse';

export interface ShipHoImportSummary {
  total: number;
  inserted: number;
  updated: number;
  skippedEmpty: number;
  errors: Array<{ rowIndex: number; reason: string }>;
  dryRun: boolean;
}

function toValues(p: ParsedShipHoImport, partnerBrandSlug: string) {
  return {
    code: p.code,
    partnerBrandSlug,
    recipientName: p.recipientName,
    recipientCompany: p.recipientCompany,
    recipientPhone: p.recipientPhone,
    country: p.country,
    city: p.city,
    province: p.province,
    postcode: p.postcode,
    address1: p.address1,
    address2: p.address2,
    weightKg: String(p.weightKg),
    dimLengthCm: p.dimLengthCm == null ? null : String(p.dimLengthCm),
    dimWidthCm: p.dimWidthCm == null ? null : String(p.dimWidthCm),
    dimHeightCm: p.dimHeightCm == null ? null : String(p.dimHeightCm),
    packagingType: p.packagingType,
    carrierKey: p.carrierKey,
    trackingNumber: p.trackingNumber,
    status: statusForImportedOrder(p.trackingNumber) as 'shipped' | 'draft',
  };
}

/**
 * Import lô đơn ship hộ cho 1 partner từ các dòng file (đã bỏ header ở caller).
 * Upsert theo `code`: đã có → cập nhật field vận hành + tracking; chưa có → insert.
 * KHÔNG chạm giá (carrierCostVnd/chargedVnd) — quote là việc P1 (requote thủ công).
 */
export async function importShipHoOrders(
  rows: readonly unknown[][],
  partnerBrandSlug: string,
  opts?: { dryRun?: boolean },
): Promise<ShipHoImportSummary> {
  await requireManageShipHo();
  const dryRun = opts?.dryRun ?? false;
  const summary: ShipHoImportSummary = {
    total: rows.length, inserted: 0, updated: 0, skippedEmpty: 0, errors: [], dryRun,
  };

  const parsed: ParsedShipHoImport[] = [];
  rows.forEach((row, i) => {
    const r = parseShipHoImportRow(row);
    if (r.kind === 'ok') parsed.push(r.row);
    else if (r.kind === 'skip_empty') summary.skippedEmpty += 1;
    else summary.errors.push({ rowIndex: i, reason: r.reason });
  });

  if (parsed.length === 0 || dryRun) {
    // Với dryRun vẫn phân loại inserted/updated để xem trước.
    if (dryRun && parsed.length) {
      const codes = parsed.map((p) => p.code);
      const existing = new Set(
        (await db.select({ code: schema.shipHoOrders.code }).from(schema.shipHoOrders)
          .where(inArray(schema.shipHoOrders.code, codes))).map((r) => r.code),
      );
      for (const p of parsed) (existing.has(p.code) ? summary.updated++ : summary.inserted++);
    }
    return summary;
  }

  const codes = parsed.map((p) => p.code);
  const existing = new Set(
    (await db.select({ code: schema.shipHoOrders.code }).from(schema.shipHoOrders)
      .where(inArray(schema.shipHoOrders.code, codes))).map((r) => r.code),
  );

  for (const p of parsed) {
    const values = toValues(p, partnerBrandSlug);
    if (existing.has(p.code)) {
      const { code, ...set } = values;
      await db.update(schema.shipHoOrders).set(set).where(eq(schema.shipHoOrders.code, code));
      summary.updated += 1;
    } else {
      await db.insert(schema.shipHoOrders).values(values);
      summary.inserted += 1;
    }
  }

  revalidatePath('/f/ship-ho');
  return summary;
}
