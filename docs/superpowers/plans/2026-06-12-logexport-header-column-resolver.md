# Importer LOG-Export dò cột theo tên header — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Importer LOG-Export đọc cột theo TÊN header (dò từ hàng header), hết lệ thuộc vị trí; giữ map vị trí cũ làm fallback.

**Architecture:** Tách map header sang `xlsx-columns.ts` (thuần, TDD); `parseXlsxRow(row, cols=LEGACY)` tham số hoá nguồn index; `importLogExport` build map từ `opts.header`.

**Tech Stack:** TypeScript, Vitest, xlsx.

**Spec:** `docs/superpowers/specs/2026-06-12-logexport-header-column-resolver-design.md`

---

### Task 1: `xlsx-columns.ts` (map + resolveColumns) + parser tham số hoá

**Files:**
- Create: `features/shipments/xlsx-columns.ts` (+ test `xlsx-columns.test.ts`)
- Modify: `features/shipments/parse-xlsx-row.ts` (+ test `parse-xlsx-row.test.ts`)

- [ ] **Step 1: Test `xlsx-columns.test.ts` (fail trước)**
```ts
import { describe, it, expect } from 'vitest';
import { resolveColumns, LEGACY_COLUMN_MAP } from './xlsx-columns';

/** Dựng header layout 2024-25 (vị trí thật). */
function header2425(): string[] {
  const h: string[] = new Array(80).fill('');
  h[1]='Label Created Date'; h[2]='Base'; h[3]='Couriers'; h[5]='Order Number';
  h[9]='Country (look up)'; h[15]='Select VTĐG1'; h[16]='Weights'; h[18]='Dimension ( điền tay)';
  h[19]='Country'; h[22]='Tracking Number'; h[23]='INS | Chi phí Tổng (đ)'; h[24]='Mức giá cơ sở';
  h[25]='Phụ phí nhiên liệu'; h[26]='EES / Theo nhu cầu'; h[27]='Phí xử lý hàng nhập';
  h[28]='Phí kí nhận trực tiếp'; h[29]='GoGreen Plus-Basic'; h[30]='VAT/Thuế phí khác';
  h[31]='Phụ phí vùng sâu xa'; h[32]='Giá Chiết khấu'; h[43]='Log Unique code';
  h[45]='Couriers (look up)'; h[76]='Phí rủi ro gia tăng';
  return h;
}

describe('resolveColumns', () => {
  it('layout 2024-25: map đúng vị trí', () => {
    const r = resolveColumns(header2425());
    expect(r.ok).toBe(true);
    expect(r.columns.trackingNumber).toBe(22);
    expect(r.columns.carrier).toBe(3);
    expect(r.columns.orderNumber).toBe(5);
    expect(r.columns.totalCost).toBe(23);
    expect(r.columns.base).toBe(24);
    expect(r.columns.discount).toBe(32);     // "Giá Chiết khấu" hoa vẫn khớp
    expect(r.columns.country).toBe(19);       // KHÔNG dính "Country (look up)"[9]
    expect(r.columns.importHandling).toBe(27);
    expect(r.columns.elevatedRisk).toBe(76);
  });
  it('decoy "(look up)" không cướp field chính', () => {
    const r = resolveColumns(header2425());
    expect(r.columns.carrier).toBe(3);        // không phải 45 "Couriers (look up)"
  });
  it('thiếu cột bắt buộc → ok=false + missingRequired', () => {
    const h = header2425(); h[22]='';         // bỏ Tracking Number
    const r = resolveColumns(h);
    expect(r.ok).toBe(false);
    expect(r.missingRequired).toContain('trackingNumber');
  });
  it('cột optional thiếu → -1', () => {
    const h = header2425(); h[76]='';         // bỏ elevatedRisk
    const r = resolveColumns(h);
    expect(r.ok).toBe(true);
    expect(r.columns.elevatedRisk).toBe(-1);
  });
  it('LEGACY_COLUMN_MAP có đủ field', () => {
    expect(LEGACY_COLUMN_MAP.trackingNumber).toBe(4);
    expect(LEGACY_COLUMN_MAP.totalCost).toBe(34);
  });
});
```
Run `npx vitest run features/shipments/xlsx-columns.test.ts` → FAIL.

- [ ] **Step 2: Viết `features/shipments/xlsx-columns.ts`**
```ts
/** Map field LOG-Export ↔ cột Excel. Dò theo TÊN header để hết lệ thuộc vị trí. */
export type ColumnKey =
  | 'trackingNumber' | 'originHub' | 'carrier' | 'orderNumber' | 'country'
  | 'labelCreatedAt' | 'packagingCode' | 'weightKg' | 'dimension' | 'totalCost'
  | 'base' | 'fuel' | 'remote' | 'demand' | 'directSignature' | 'vat' | 'gogreen'
  | 'discount' | 'logUniqueCode' | 'importHandling' | 'elevatedRisk';

export type ColumnMap = Record<ColumnKey, number>;

/** Tên header gốc cho mỗi field (so khớp chuẩn hoá). */
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
    if (k && !byName.has(k)) byName.set(k, i); // ô đầu tiên thắng
  });
  const columns = {} as ColumnMap;
  (Object.keys(HEADER_NAME) as ColumnKey[]).forEach((field) => {
    columns[field] = byName.get(norm(HEADER_NAME[field])) ?? -1;
  });
  const missingRequired = REQUIRED_COLUMNS.filter((f) => columns[f] < 0);
  return { ok: missingRequired.length === 0, columns, missingRequired };
}
```
Run test → PASS.

- [ ] **Step 3: Tham số hoá `parse-xlsx-row.ts`**
- Thêm import: `import { LEGACY_COLUMN_MAP, type ColumnMap } from './xlsx-columns';`
- XOÁ hằng `COL = {...} as const` cục bộ (dòng ~78-86).
- `consistentImportHandling(row: RawRow, totalAmount: number, cols: ColumnMap)`: đổi mọi `COL.x` → `cols.x`.
- `parseXlsxRow(row: RawRow, cols: ColumnMap = LEGACY_COLUMN_MAP): ParseResult`: đổi mọi `row[COL.x]` → `row[cols.x]`; gọi `consistentImportHandling(row, totalAmount, cols)`.
- Không đổi gì khác.

- [ ] **Step 4: Test parser layout 2024-25** — thêm vào `parse-xlsx-row.test.ts`:
```ts
import { resolveColumns } from './xlsx-columns';
it('đọc đúng row layout 2024-25 qua resolveColumns', () => {
  const header: string[] = new Array(80).fill('');
  header[1]='Label Created Date'; header[2]='Base'; header[3]='Couriers'; header[5]='Order Number';
  header[16]='Weights'; header[19]='Country'; header[22]='Tracking Number';
  header[23]='INS | Chi phí Tổng (đ)'; header[24]='Mức giá cơ sở'; header[25]='Phụ phí nhiên liệu';
  const { columns } = resolveColumns(header);
  const row: Cell[] = new Array(80).fill(null);
  row[3]='FedEx'; row[5]='#MBLVD26831'; row[16]=0.5; row[19]='Saudi Arabia';
  row[22]='887499675299'; row[23]=1504643; row[24]=4747300; row[25]=200000;
  const r = parseXlsxRow(row, columns);
  expect(r.kind).toBe('ok');
  if (r.kind === 'ok') {
    expect(r.row.trackingNumber).toBe('887499675299');
    expect(r.row.carrier).toBe('fedex');
    expect(r.row.totalAmount).toBe(1504643);
    expect(r.row.base).toBe(4747300);
    expect(r.row.fuel).toBe(200000);
    expect(r.row.shipCountry).toBe('SA');
  }
});
```
(Country "Saudi Arabia" → ISO "SA" qua `countryNameToIso`; nếu map trả khác, chỉnh expect cho khớp giá trị thực — chạy thử rồi sửa expect, KHÔNG sửa logic.)

- [ ] **Step 5:** `npx vitest run features/shipments/` (cả test cũ phải xanh — mặc định LEGACY map) + `npx tsc --noEmit`. **Commit**
```bash
git add features/shipments/xlsx-columns.ts features/shipments/xlsx-columns.test.ts features/shipments/parse-xlsx-row.ts features/shipments/parse-xlsx-row.test.ts
git commit -m "feat(import): dò cột LOG-Export theo tên header (resolveColumns) + parser tham số hoá ColumnMap"
```

---

### Task 2: Importer build map từ header + CLI truyền header

**Files:**
- Modify: `features/shipments/import-actions.ts`
- Modify: `scripts/import-ops-xlsx.ts`

- [ ] **Step 1: `import-actions.ts`**
- Import: `import { resolveColumns, LEGACY_COLUMN_MAP } from './xlsx-columns';`
- `ImportOptions` thêm: `header?: ReadonlyArray<unknown>;`
- Đầu `importLogExport`, sau khi tạo `summary`, trước PHASE 1:
```ts
  let cols = LEGACY_COLUMN_MAP;
  if (opts.header) {
    const r = resolveColumns(opts.header);
    if (!r.ok) {
      summary.warnings.errors.push({ rowIndex: -1, reason: `Thiếu cột bắt buộc: ${r.missingRequired.join(', ')}` });
      summary.durationMs = Date.now() - start;
      return summary;
    }
    cols = r.columns;
  }
```
- PHASE 1: đổi `parseXlsxRow(rows[i])` → `parseXlsxRow(rows[i], cols)`.
- Không đổi gì khác (resolve store/order, upsert 1:1, orphan skip giữ nguyên).

- [ ] **Step 2: `scripts/import-ops-xlsx.ts`** — truyền header:
```ts
  const summary = await importLogExport(dataRows, { dryRun, header: allRows[0] });
```
(`allRows[0]` là hàng header — đang bị `slice(1)` bỏ; giờ truyền vào opts.)

- [ ] **Step 3:** `npx tsc --noEmit` + `npx eslint features/shipments/import-actions.ts scripts/import-ops-xlsx.ts` sạch; `npx vitest run` xanh. **Commit**
```bash
git add features/shipments/import-actions.ts scripts/import-ops-xlsx.ts
git commit -m "feat(import): importLogExport build ColumnMap từ header (fallback LEGACY) + CLI truyền header"
```

---

## Self-Review
- **Spec coverage:** §1 map/resolve→T1; §2 parser→T1; §3 importer→T2; §4 CLI→T2; §5 test→T1. Đủ.
- **Type consistency:** `ColumnMap`, `ColumnKey`, `resolveColumns`, `LEGACY_COLUMN_MAP`, `opts.header` nhất quán.
- **Placeholder scan:** không có TBD. (Bước áp dữ liệu §6 do coordinator chạy sau, ngoài plan code.)
