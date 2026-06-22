/**
 * THUẦN: phân loại PackRow thành update / create / unmatched / skipped.
 * - update: đã có shipment (khớp logUniqueCode hoặc trackingNumber).
 * - create: chưa có shipment NHƯNG order resolve được → tạo mới.
 * - unmatched: store connected nhưng order không resolve (cảnh báo).
 * - skipped: store disconnected / DISCN / no_prefix.
 */
import { lookupStorePrefix } from '@/features/shipments/store-prefix';
import type { PackRow } from './parse-pack-row';

export interface ClassifyMaps {
  shipmentByLogCode: Map<string, string>;
  shipmentByTracking: Map<string, string>;
  orderIdByNumber: Map<string, string>;
}
export interface ClassifyResult {
  update: Array<{ row: PackRow; shipmentId: string }>;
  create: Array<{ row: PackRow; orderId: string }>;
  unmatched: Array<{ orderNumber: string; reason: string }>;
  skipped: Array<{ orderNumber: string; reason: string }>;
}

const bare = (n: string) => n.trim().replace(/^#/, '');

export function classifyPackRows(rows: PackRow[], maps: ClassifyMaps): ClassifyResult {
  const out: ClassifyResult = { update: [], create: [], unmatched: [], skipped: [] };
  for (const row of rows) {
    // 1. shipment đã tồn tại?
    const existingId =
      (row.logUniqueCode && maps.shipmentByLogCode.get(row.logUniqueCode)) ||
      (row.trackingNumber && maps.shipmentByTracking.get(row.trackingNumber)) ||
      null;
    if (existingId) { out.update.push({ row, shipmentId: existingId }); continue; }

    // 2. resolve store/order
    const look = lookupStorePrefix(row.orderNumber);
    if (look.kind === 'partner_ship') { out.skipped.push({ orderNumber: row.orderNumber, reason: 'DISCN partner ship' }); continue; }
    if (look.kind === 'no_prefix') { out.skipped.push({ orderNumber: row.orderNumber, reason: 'không nhận prefix store' }); continue; }
    if (!look.info.connected) { out.skipped.push({ orderNumber: row.orderNumber, reason: `store chưa kết nối (${look.info.displayName})` }); continue; }

    const orderId = maps.orderIdByNumber.get(bare(row.orderNumber));
    if (orderId) out.create.push({ row, orderId });
    else out.unmatched.push({ orderNumber: row.orderNumber, reason: 'order chưa có trong hệ thống' });
  }
  return out;
}
