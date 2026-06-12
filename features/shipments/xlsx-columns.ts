/** Map field LOG-Export ↔ cột Excel. Dò theo TÊN header để hết lệ thuộc vị trí. */
export type ColumnKey =
  | 'trackingNumber' | 'originHub' | 'carrier' | 'orderNumber' | 'country'
  | 'labelCreatedAt' | 'packagingCode' | 'weightKg' | 'dimension' | 'totalCost'
  | 'base' | 'fuel' | 'remote' | 'demand' | 'directSignature' | 'vat' | 'gogreen'
  | 'discount' | 'logUniqueCode' | 'importHandling' | 'elevatedRisk';

export type ColumnMap = Record<ColumnKey, number>;

const HEADER_NAME: Record<ColumnKey, string> = {
  trackingNumber: 'Tracking Number', originHub: 'Base', carrier: 'Couriers',
  orderNumber: 'Order Number', country: 'Country', labelCreatedAt: 'Label Created Date',
  packagingCode: 'Select VTĐG1', weightKg: 'Weights', dimension: 'Dimension ( điền tay)',
  totalCost: 'INS | Chi phí Tổng (đ)', base: 'Mức giá cơ sở', fuel: 'Phụ phí nhiên liệu',
  remote: 'Phụ phí vùng sâu xa', demand: 'EES / Theo nhu cầu', directSignature: 'Phí kí nhận trực tiếp',
  vat: 'VAT/Thuế phí khác', gogreen: 'GoGreen Plus-Basic', discount: 'Giá chiết khấu',
  logUniqueCode: 'Log Unique code', importHandling: 'Phí xử lý hàng nhập', elevatedRisk: 'Phí rủi ro gia tăng',
};

export const REQUIRED_COLUMNS: ColumnKey[] = ['trackingNumber', 'totalCost', 'carrier', 'orderNumber', 'country'];

/** Vị trí cố định layout 2026 — fallback khi không có header. */
export const LEGACY_COLUMN_MAP: ColumnMap = {
  trackingNumber: 4, originHub: 5, carrier: 6, orderNumber: 8, country: 12, labelCreatedAt: 15,
  packagingCode: 26, weightKg: 27, dimension: 28, totalCost: 34, base: 35, fuel: 36, remote: 37,
  demand: 38, directSignature: 39, vat: 40, gogreen: 41, discount: 42, logUniqueCode: 46,
  importHandling: 88, elevatedRisk: 74,
};

export interface ResolveResult { ok: boolean; columns: ColumnMap; missingRequired: ColumnKey[]; }

const norm = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function resolveColumns(header: ReadonlyArray<unknown>): ResolveResult {
  const byName = new Map<string, number>();
  header.forEach((cell, i) => {
    const k = norm(cell);
    if (k && !byName.has(k)) byName.set(k, i);
  });
  const columns = {} as ColumnMap;
  (Object.keys(HEADER_NAME) as ColumnKey[]).forEach((field) => {
    columns[field] = byName.get(norm(HEADER_NAME[field])) ?? -1;
  });
  const missingRequired = REQUIRED_COLUMNS.filter((f) => columns[f] < 0);
  return { ok: missingRequired.length === 0, columns, missingRequired };
}
