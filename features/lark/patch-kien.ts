/**
 * Một chỗ duy nhất biến PackRow (dòng Lark) thành giá trị ghi vào `shipments`.
 * Cron `sync-lark` và webhook `/api/lark/pack` cùng dùng — hai đường vào, một luật.
 */
import type { schema } from '@/db/client';
import type { PackRow } from './parse-pack-row';

/** Patch shipment từ PackRow — chỉ field Lark có giá trị (ghi đè có điều kiện). */
export function patchFrom(row: PackRow): Record<string, unknown> {
  const p: Record<string, unknown> = { updatedAt: new Date() };
  if (row.weightKg != null) p.actualWeightKg = String(row.weightKg);
  if (row.dims) {
    p.dimLengthCm = String(row.dims.l); p.dimWidthCm = String(row.dims.w);
    if (row.dims.h != null) p.dimHeightCm = String(row.dims.h);
  }
  if (row.trackingNumber) p.trackingNumber = row.trackingNumber;
  if (row.carrierKey) p.carrierKey = row.carrierKey;
  if (row.labelDate) p.labelCreatedAt = row.labelDate;
  if (row.base) p.originHub = row.base;
  if (row.hop) p.larkHop = row.hop;
  if (row.skuText) p.skuText = row.skuText;
  if (row.pieces != null) p.pieces = row.pieces;
  return p;
}

/** Giá trị insert kiện mới từ dòng Lark đã khớp đơn. */
export function giaTriTaoKien(row: PackRow, orderId: string): typeof schema.shipments.$inferInsert {
  return {
    orderId,
    logUniqueCode: row.logUniqueCode,
    trackingNumber: row.trackingNumber,
    carrierKey: row.carrierKey,
    actualWeightKg: row.weightKg != null ? String(row.weightKg) : null,
    dimLengthCm: row.dims ? String(row.dims.l) : null,
    dimWidthCm: row.dims ? String(row.dims.w) : null,
    dimHeightCm: row.dims?.h != null ? String(row.dims.h) : null,
    labelCreatedAt: row.labelDate,
    originHub: row.base,
    larkHop: row.hop,
    skuText: row.skuText,
    pieces: row.pieces,
  };
}
