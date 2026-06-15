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

/** Nhãn header thay thế cho cùng một cột. Tiếng Việt hay biến thể i/y
 *  (kí↔ký), hoặc file ghi tiếng Anh. So khớp sau khi chuẩn hoá (bỏ dấu).
 *  Thiếu synonym ở đây từng làm rớt cột Direct Signature kỳ 5–6/2026. */
const SYNONYMS: Partial<Record<ColumnKey, string[]>> = {
  directSignature: ['Phí ký nhận trực tiếp', 'Direct Signature', 'Phí ký nhận', 'Phí kí nhận'],
};

export const REQUIRED_COLUMNS: ColumnKey[] = ['trackingNumber', 'totalCost', 'carrier', 'orderNumber', 'country'];

/** Cột phí KHÔNG bắt buộc nhưng nếu vắng trong header thì nhiều khả năng là
 *  lệch nhãn → cần CẢNH BÁO (không chặn) thay vì âm thầm nạp = 0. */
export const KNOWN_OPTIONAL_MONEY: ColumnKey[] = [
  'base', 'fuel', 'remote', 'demand', 'directSignature', 'vat', 'gogreen',
  'discount', 'importHandling', 'elevatedRisk',
];

/** Nhãn header kỳ vọng — để cảnh báo nêu rõ cột nào không khớp. */
export function expectedHeaderLabel(field: ColumnKey): string {
  return HEADER_NAME[field];
}

/** Vị trí cố định layout 2026 — fallback khi không có header. */
export const LEGACY_COLUMN_MAP: ColumnMap = {
  trackingNumber: 4, originHub: 5, carrier: 6, orderNumber: 8, country: 12, labelCreatedAt: 15,
  packagingCode: 26, weightKg: 27, dimension: 28, totalCost: 34, base: 35, fuel: 36, remote: 37,
  demand: 38, directSignature: 39, vat: 40, gogreen: 41, discount: 42, logUniqueCode: 46,
  importHandling: 88, elevatedRisk: 74,
};

export interface ResolveResult {
  ok: boolean;
  columns: ColumnMap;
  missingRequired: ColumnKey[];
  /** Cột phí đã biết nhưng không tìm thấy trong header — cảnh báo, không chặn. */
  missingKnown: ColumnKey[];
}

/** Chuẩn hoá: lowercase, bỏ dấu tiếng Việt (đ→d, dấu thanh/mũ), gọn khoảng trắng.
 *  Bỏ dấu giúp khớp khi file ghi khác/không dấu; biến thể i↔y xử lý qua SYNONYMS. */
const norm = (v: unknown): string =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();

export function resolveColumns(header: ReadonlyArray<unknown>): ResolveResult {
  const byName = new Map<string, number>();
  header.forEach((cell, i) => {
    const k = norm(cell);
    if (k && !byName.has(k)) byName.set(k, i);
  });
  const find = (field: ColumnKey): number => {
    for (const label of [HEADER_NAME[field], ...(SYNONYMS[field] ?? [])]) {
      const hit = byName.get(norm(label));
      if (hit !== undefined) return hit;
    }
    return -1;
  };
  const columns = {} as ColumnMap;
  (Object.keys(HEADER_NAME) as ColumnKey[]).forEach((field) => {
    columns[field] = find(field);
  });
  const missingRequired = REQUIRED_COLUMNS.filter((f) => columns[f] < 0);
  const missingKnown = KNOWN_OPTIONAL_MONEY.filter((f) => columns[f] < 0);
  return { ok: missingRequired.length === 0, columns, missingRequired, missingKnown };
}
