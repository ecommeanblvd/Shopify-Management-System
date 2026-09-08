# Giá vốn theo line đơn + Lãi gộp theo tháng — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhập bảng kê thanh toán brand (Google Sheet) thành giá vốn theo từng line đơn Shopify, ghi theo kỳ thực nhận, rồi báo cáo lãi gộp theo tháng bằng VND — chạy được ngay với 8 kỳ Denio 01→08/2026.

**Architecture:** Ba bảng mới (`order_line_cogs`, `brand_cogs_offline`, `fx_month_rates`) và module `features/cogs/`: đọc workbook (thuần) → cấu trúc trung gian `BangKe` → luật ghép line (thuần) → hàm ghi theo kỳ trong transaction. Báo cáo dùng lại `getStoreMetrics` (doanh thu, phí ship theo đơn) cộng với COGS theo kỳ và tỉ giá tháng; phép tính là module thuần. Đợt 2 nối MMP (webhook nhận đúng cấu trúc `BangKe`) và cron Shopify unit cost cho hàng tự sản xuất.

**Tech Stack:** Next.js 16.2.6 (App Router, server actions, `params`/`searchParams` là Promise), React 19, Drizzle + Postgres, vitest 4 (env `node`, không test component), `xlsx` 0.18.5 (đã có), Google Sheets export `…/export?format=xlsx` (link "ai có link đều xem" — đã kiểm HTTP 200, 1,39 MB).

## Global Constraints

- **Nguồn giá vốn (phương án D):** hàng brand = bảng kê thanh toán brand (sheet nay, MMP sau); hàng tự sản xuất = Shopify Cost per item; CSV để sửa tay.
- **Denio deal theo THỰC NHẬN:** chỉ xử lý tab có `A. Đơn thực nhận trong tháng`; tab `A. Đơn thực bán` bỏ qua; lấy cột **Tổng thành tiền TT** (trước thuế GTGT).
- **Kỳ ghi nhận** hàng brand = tháng thực nhận trên bảng kê (`period` = tháng của "Từ ngày"); hàng tự sản xuất = tháng đặt (giờ Bangkok).
- **Ghép theo mã đơn + line item:** SKU đúng → mã sản phẩm gốc (`DN0729`; `PKDN0729` về line chứa `DN0729`) → size/màu → đơn một line; còn mơ hồ → "không khớp", **không ghi**. Mã `#MBLVDPO…`, `#MTB…` → `brand_cogs_offline`.
- **Không đoán:** dòng không khớp không bao giờ được ghi; lệch công thức chỉ cảnh báo, số lấy theo sheet.
- **Nhập lại = (brand, kỳ)** xoá toàn bộ dòng `brand_statement` của kỳ rồi ghi mới, trong một transaction.
- **Khoá duy nhất** `order_line_cogs`: (`order_id`, `shopify_line_id`, `kind`, `period`). Ưu tiên nguồn: `brand_statement` = `mmp` > `csv` > `shopify_unit_cost`.
- **Báo cáo theo VND**, tháng theo giờ Bangkok; tỉ giá theo tháng từ `fx_month_rates`; thiếu → tỉ giá gần nhất trước đó + cờ "tỉ giá tạm".
- **Doanh thu thuần** = `netGmv − discount` theo định nghĩa sẵn có của `computeOrderMetrics` (gồm cả phí ship khách trả, trừ hoàn tiền và giảm giá) — nhất quán với dashboard hiện tại; phí ship thực lấy từ `OrderRow.shippingCost`.
- **Quyền:** thêm `view_cogs`, `manage_cogs`, chỉ gán `admin`; không tái dùng `view_orders`.
- **Chi brand ngoài Shopify** hiện cột riêng, không trừ vào lãi gộp.
- **Bỏ qua** tab không có tiêu đề `BẢNG KÊ CÔNG NỢ Từ ngày … đến … Brand: …` (nháp "Trang tính14", bảng giá đầu file).
- **Quy ước repo:** đọc `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` và `05-server-and-client-components.md` trước khi viết page/action; `timestamp` UTC-naive → so sánh thời gian trong SQL, gom tháng bằng `sqlGioKinhDoanh()` (`lib/timezone.ts`); file `'use server'` chỉ export hàm async/type → phải `npm run build`; trước push: `npx tsc --noEmit` + `npx vitest run` + `npm run build`; `gh auth switch --user ecommeanblvd` trước `git push`; tên hàm/ghi chú tiếng Việt như các module mới.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `db/migrations/0128_gia-von-line.sql`, `db/schema.ts`, `db/migrations/meta/_journal.json` | 3 bảng mới |
| `lib/auth/rbac.ts` | quyền `view_cogs`, `manage_cogs` |
| `features/cogs/tien.ts` (+test) | Thuần: đọc số tiền `1.861.500 ₫`, đổi tiền theo tháng với fallback |
| `features/cogs/doc-bang-ke.ts` (+test) | Thuần: mảng ô của mọi sheet → `BangKe[]` |
| `features/cogs/ghep-line.ts` (+test) | Thuần: luật ghép dòng bảng kê vào line đơn |
| `features/cogs/bang-ke-import.ts` | Server: tải workbook, đọc, tra đơn, ghép, xem trước, áp dụng |
| `features/cogs/bao-cao-logic.ts` (+test) | Thuần: gộp doanh thu + COGS + tỉ giá thành dòng báo cáo |
| `features/cogs/queries.ts` | Đọc COGS theo kỳ/brand/store, line chưa có giá vốn, tỉ giá |
| `features/cogs/actions.ts` | `'use server'`: xem trước, áp dụng, lưu tỉ giá, lấy VCB |
| `components/cogs/BangKeImporter.tsx`, `components/cogs/LaiGopTable.tsx`, `components/cogs/TiGiaForm.tsx` | Client |
| `app/(dashboard)/f/orders/cogs/bang-ke/page.tsx`, `app/(dashboard)/f/orders/lai-gop/page.tsx`, `app/(dashboard)/f/orders/page.tsx` | Trang + link |
| Đợt 2: `features/cogs/unit-cost-sync.ts`, `scripts/cron/sync-unit-cost.ts`, `scripts/cron/apply-own-cogs.ts`, `features/jobs/registry.ts`, `features/jobs/groups.ts`, `.railway/railway.ts`, `app/api/mmp/cogs/route.ts` | Hàng tự sản xuất + MMP |

---

## ĐỢT 1

### Task 1: Migration 0128 + schema + quyền

**Files:**
- Create: `db/migrations/0128_gia-von-line.sql`
- Modify: `db/schema.ts` (thêm 3 bảng sau `skuCosts`, khoảng dòng 950), `db/migrations/meta/_journal.json`, `lib/auth/rbac.ts:36-53`

**Interfaces:**
- Produces: `schema.orderLineCogs`, `schema.brandCogsOffline`, `schema.fxMonthRates`; `Permission` thêm `'view_cogs' | 'manage_cogs'`.

- [ ] **Step 1: Migration**

```sql
-- Giá vốn theo LINE đơn (spec docs/superpowers/specs/2026-09-08-gia-von-lai-gop-thang-design.md §3).
-- Hàng brand ký gửi: giá vốn = tiền trả brand theo bảng kê, biến thiên theo dòng
-- và gắn với KỲ thanh toán (tháng thực nhận), không gắn với ngày đặt.
CREATE TABLE order_line_cogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES shopify_orders(id) ON DELETE CASCADE,
  shopify_line_id text NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'cogs',            -- 'cogs' | 'return' (return: amount âm)
  period text NOT NULL,                          -- 'YYYY-MM'
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL,
  source text NOT NULL,                          -- 'brand_statement' | 'mmp' | 'csv' | 'shopify_unit_cost'
  brand_slug text,
  statement_ref text,
  detail jsonb,
  imported_by text REFERENCES "user"(id) ON DELETE SET NULL,
  imported_at timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX order_line_cogs_line_kind_period_idx ON order_line_cogs (order_id, shopify_line_id, kind, period);--> statement-breakpoint
CREATE INDEX order_line_cogs_period_idx ON order_line_cogs (period);--> statement-breakpoint
CREATE INDEX order_line_cogs_brand_period_idx ON order_line_cogs (brand_slug, period);--> statement-breakpoint
-- Dòng bảng kê không thuộc đơn Shopify (#MBLVDPO…, #MTB…): báo riêng, không trừ Rev Shopify.
CREATE TABLE brand_cogs_offline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_slug text NOT NULL,
  period text NOT NULL,
  kind text NOT NULL DEFAULT 'cogs',
  ref_code text NOT NULL,
  sku text,
  qty integer NOT NULL DEFAULT 1,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL,
  statement_ref text,
  imported_at timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX brand_cogs_offline_brand_period_idx ON brand_cogs_offline (brand_slug, period);--> statement-breakpoint
-- Tỉ giá THEO THÁNG để đổi doanh thu (USD) về VND. Một dòng/tháng/cặp tiền.
CREATE TABLE fx_month_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency text NOT NULL,
  to_currency text NOT NULL,
  period text NOT NULL,
  rate numeric(18,6) NOT NULL,                   -- 1 from = rate to
  source text NOT NULL DEFAULT 'manual',         -- 'manual' | 'vcb'
  updated_at timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX fx_month_rates_pair_period_idx ON fx_month_rates (from_currency, to_currency, period);
```

- [ ] **Step 2: schema.ts** — sau `skuCosts`:

```ts
/** Giá vốn theo LINE đơn — spec 2026-09-08 §3.1. kind 'return' ghi amount âm. */
export const orderLineCogs = pgTable('order_line_cogs', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull(),
  shopifyLineId: text('shopify_line_id').notNull(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  kind: text('kind').notNull().default('cogs'),
  period: text('period').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  source: text('source').notNull(),
  brandSlug: text('brand_slug'),
  statementRef: text('statement_ref'),
  detail: jsonb('detail'),
  importedBy: text('imported_by').references(() => user.id, { onDelete: 'set null' }),
  importedAt: timestamp('imported_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('order_line_cogs_line_kind_period_idx').on(t.orderId, t.shopifyLineId, t.kind, t.period),
  index('order_line_cogs_period_idx').on(t.period),
  index('order_line_cogs_brand_period_idx').on(t.brandSlug, t.period),
]);

/** Dòng bảng kê brand không thuộc đơn Shopify (PO, MTB) — spec §3.2. */
export const brandCogsOffline = pgTable('brand_cogs_offline', {
  id: uuid('id').defaultRandom().primaryKey(),
  brandSlug: text('brand_slug').notNull(),
  period: text('period').notNull(),
  kind: text('kind').notNull().default('cogs'),
  refCode: text('ref_code').notNull(),
  sku: text('sku'),
  qty: integer('qty').notNull().default(1),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  statementRef: text('statement_ref'),
  importedAt: timestamp('imported_at').defaultNow().notNull(),
}, (t) => [index('brand_cogs_offline_brand_period_idx').on(t.brandSlug, t.period)]);

/** Tỉ giá theo tháng: 1 from = rate to — spec §3.3. */
export const fxMonthRates = pgTable('fx_month_rates', {
  id: uuid('id').defaultRandom().primaryKey(),
  fromCurrency: text('from_currency').notNull(),
  toCurrency: text('to_currency').notNull(),
  period: text('period').notNull(),
  rate: numeric('rate', { precision: 18, scale: 6 }).notNull(),
  source: text('source').notNull().default('manual'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [uniqueIndex('fx_month_rates_pair_period_idx').on(t.fromCurrency, t.toCurrency, t.period)]);
```

- [ ] **Step 3: journal** — thêm sau idx 127: `{ "idx": 128, "version": "7", "when": 1787575200000, "tag": "0128_gia-von-line", "breakpoints": true }`.

- [ ] **Step 4: rbac.ts** — thêm `| 'view_cogs' | 'manage_cogs'` vào cuối union `Permission` (sau `'manage_ship_ho'`), và thêm `'view_cogs', 'manage_cogs',` vào mảng `admin` của `MATRIX` (chỉ admin).

- [ ] **Step 5: Kiểm** — `npm run db:migrate && npx tsc --noEmit && npx vitest run lib/auth`. Expected: migration áp dụng; tsc sạch; test rbac (nếu có snapshot quyền admin thì cập nhật).

- [ ] **Step 6: Commit** — `git add db/migrations/0128_gia-von-line.sql db/migrations/meta/_journal.json db/schema.ts lib/auth/rbac.ts && git commit -m "feat(cogs): bảng order_line_cogs, brand_cogs_offline, fx_month_rates + quyền view/manage_cogs"`

---

### Task 2: Tiền tệ (`features/cogs/tien.ts`)

**Files:** Create `features/cogs/tien.ts`; Test `features/cogs/tien.test.ts`

**Interfaces — Produces:**
```ts
export function docTien(s: string | number | null | undefined): number | null;   // '1.861.500 ₫' → 1861500; '35%' → null; '' → null
export function docPhanTram(s: string | number | null | undefined): number | null; // '35%' → 0.35; 0.4 → 0.4; '' → null
export interface TiGiaThang { from: string; to: string; period: string; rate: number }
export interface KetQuaDoiTien { amount: number; rate: number; periodDung: string; tam: boolean }
export function doiTienTheoThang(amount: number, from: string, to: string, period: string, rates: TiGiaThang[]): KetQuaDoiTien | null;
```

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest';
import { docTien, docPhanTram, doiTienTheoThang } from './tien';

describe('docTien', () => {
  it('đọc dạng VN có ₫ và dấu chấm nghìn', () => {
    expect(docTien('1.861.500 ₫')).toBe(1861500);
    expect(docTien('9.770.560 đ')).toBe(9770560);
    expect(docTien('2650000')).toBe(2650000);
    expect(docTien(1374000)).toBe(1374000);
  });
  it('rỗng / chữ / phần trăm → null', () => {
    expect(docTien('')).toBeNull(); expect(docTien(null)).toBeNull();
    expect(docTien('Insert Price')).toBeNull(); expect(docTien('35%')).toBeNull();
  });
});
describe('docPhanTram', () => {
  it('35% → 0.35, số thô giữ nguyên, rỗng → null', () => {
    expect(docPhanTram('35%')).toBe(0.35); expect(docPhanTram(0.4)).toBe(0.4); expect(docPhanTram('')).toBeNull();
  });
});
describe('doiTienTheoThang', () => {
  const rates = [{ from: 'USD', to: 'VND', period: '2026-06', rate: 26000 }, { from: 'USD', to: 'VND', period: '2026-08', rate: 26500 }];
  it('cùng tiền → rate 1, không tạm', () => {
    expect(doiTienTheoThang(100, 'VND', 'VND', '2026-01', [])).toEqual({ amount: 100, rate: 1, periodDung: '2026-01', tam: false });
  });
  it('có tỉ giá đúng tháng', () => {
    expect(doiTienTheoThang(10, 'USD', 'VND', '2026-08', rates)).toEqual({ amount: 265000, rate: 26500, periodDung: '2026-08', tam: false });
  });
  it('thiếu tháng → dùng tháng gần nhất TRƯỚC đó, cờ tạm', () => {
    expect(doiTienTheoThang(10, 'USD', 'VND', '2026-07', rates)).toEqual({ amount: 260000, rate: 26000, periodDung: '2026-06', tam: true });
  });
  it('không có tháng nào trước → null', () => {
    expect(doiTienTheoThang(10, 'USD', 'VND', '2026-05', rates)).toBeNull();
  });
});
```

- [ ] **Step 2:** `npx vitest run features/cogs/tien.test.ts` → FAIL (module chưa có).

- [ ] **Step 3: Module**

```ts
/** THUẦN: tiền tệ cho giá vốn — đọc số kiểu VN trên bảng kê, đổi tiền theo tháng. */

/** '1.861.500 ₫' → 1861500. Chữ, phần trăm, rỗng → null. */
export function docTien(s: string | number | null | undefined): number | null {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = s.trim();
  if (!t || t.includes('%')) return null;
  const clean = t.replace(/[₫đ\s]/gi, '').replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(clean)) return null;
  return Number(clean);
}

/** '35%' → 0.35. Số thô (0.4) giữ nguyên. Rỗng → null. */
export function docPhanTram(s: string | number | null | undefined): number | null {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = s.trim().replace('%', '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return s.includes('%') || n > 1 ? n / 100 : n;
}

export interface TiGiaThang { from: string; to: string; period: string; rate: number }
export interface KetQuaDoiTien { amount: number; rate: number; periodDung: string; tam: boolean }

/** Đổi tiền theo tỉ giá THÁNG. Thiếu tháng → tháng gần nhất TRƯỚC đó và cờ `tam`. Không có → null. */
export function doiTienTheoThang(amount: number, from: string, to: string, period: string, rates: TiGiaThang[]): KetQuaDoiTien | null {
  if (from === to) return { amount, rate: 1, periodDung: period, tam: false };
  const cap = rates.filter((r) => r.from === from && r.to === to && r.period <= period).sort((a, b) => (a.period < b.period ? 1 : -1));
  const r = cap[0];
  if (!r) return null;
  return { amount: amount * r.rate, rate: r.rate, periodDung: r.period, tam: r.period !== period };
}
```

- [ ] **Step 4:** test PASS. **Step 5:** `git add features/cogs/tien.ts features/cogs/tien.test.ts && git commit -m "feat(cogs): đọc tiền kiểu VN, đổi tiền theo tháng có fallback"`

---

### Task 3: Đọc bảng kê (`features/cogs/doc-bang-ke.ts`)

**Files:** Create `features/cogs/doc-bang-ke.ts`; Test `features/cogs/doc-bang-ke.test.ts`

**Interfaces — Consumes:** `docTien`, `docPhanTram` (Task 2). **Produces:**
```ts
export type O = string | number | null | undefined;           // một ô
export interface DongBangKe { ngay: string; maDon: string; tenSp: string; sku: string; sl: number; giaNoiDia: number | null; ck: number | null; phiCustomize: number | null; tt: number; code: string | null; hangSheet: number }
export interface BangKe { brand: string; period: string; tuNgay: string; denNgay: string; sheet: string; lines: DongBangKe[]; returns: DongBangKe[]; canhBao: string[] }
export function docWorkbook(sheets: Array<{ name: string; rows: O[][] }>): { bangKe: BangKe[]; boQua: string[] };
export function kiemCongThuc(d: DongBangKe): boolean;    // |TT − (giá×SL×(1−CK) + customize)| ≤ 1
```
Luật: một sheet là bảng kê khi có ô chứa `BẢNG KÊ CÔNG NỢ` kèm `Từ ngày dd/mm/yyyy đến dd/mm/yyyy` và `Brand: X`; `period` = `yyyy-mm` của "Từ ngày". Chỉ nhận sheet có ô `A. Đơn thực nhận`; sheet `A. Đơn thực bán` vào `boQua` với lý do; sheet không tiêu đề vào `boQua`. Dòng tiêu đề bảng = hàng có ô `Mã đơn` và ô `SKU`; các cột tìm theo TÊN (`Ngày nhận`/`Ngày return`, `Mã đơn`, `Tên sản phẩm`, `SKU`, `Số lượng`, `Giá nội địa`, `% CK`, `Phí customize`, cột bắt đầu bằng `Tổng thành tiền`, `Code`). Dòng dữ liệu = ô "Mã đơn" bắt đầu bằng `#`. Mục `B. Đơn re…` chuyển sang `returns`. Dòng có TT null (không đọc được) → `canhBao`, bỏ dòng.

- [ ] **Step 1: Test** (fixture mô phỏng đúng cấu trúc Denio, kể cả cột thừa và tab nháp)

```ts
import { describe, it, expect } from 'vitest';
import { docWorkbook, kiemCongThuc } from './doc-bang-ke';

const HDR = ['Ngày nhận', 'Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá nội địa ', '% CK ', 'Phí customize', 'Giá phụ kiện', 'Tổng thành tiền TT', 'Note', 'Code ', 'Kỳ thanh toán ', 'Kỳ báo đơn'];
const thucNhan = {
  name: 'T8', rows: [
    [], ['', 'pp', 'pp', 'BẢNG KÊ CÔNG NỢ   Từ ngày 01/08/2026 đến 31/08/2026  Brand: Denio'], [],
    ['A. Đơn thực nhận trong tháng '], HDR,
    ['03/08/2026', '#MBLVD29521', 'Alita … / Customize', 'Denio-DN0785-Customize-NPOT-PLA', 1, '2.190.000 ₫', '35%', '438.000 ₫', '', '1.861.500 ₫', '', '#MBLVD29521Denio-DN0785-Customize-NPOT-PLA1', 'T8', 7],
    ['18/08/2026', '#MBLVD29718', 'Nara …', 'Denio-DN0695-S-CRE', 1, '2.550.000 ₫', '35%', '', '', '1.657.500 ₫', '', '#MBLVD29718Denio-DN0695-S-CRE1', 'T8', 7],
    [], ['B. Đơn return trong tháng '], ['Ngày return', ...HDR.slice(1)],
    ['04/08/2026', '#MBLVD29019', 'Nara …', 'Denio-DN0695-XL-CRE', 1, '2.550.000 ₫', '35%', '', '', '1.657.500 ₫', '', '#MBLVD29019Denio-DN0695-XL-CRE1', 'T8', 6],
    [], ['', '', 'TỔNG (A-B)', '', 90, '197.240.000 ₫', '', '', '', '122.132.000 ₫'], ['', '', 'THUẾ GTGT (8%)', '', '', '', '', '', '', '9.770.560 đ'], ['', '', 'TỔNG THANH TOÁN', '', '', '', '', '', '', '131.902.560 ₫'],
  ],
};
const thucBan = { name: 'T8 bán', rows: [[], ['', '', '', 'BẢNG KÊ CÔNG NỢ   Từ ngày 01/08/2026 đến 31/08/2026  Brand: Denio'], [], ['', 'A. Đơn thực bán trong tháng'], ['Ngày báo đơn', 'Mã đơn', 'Tên sản phẩm', 'SKU', 'Số lượng', 'Giá nội địa ', '% CK ', 'Phí customize', 'Giá phụ kiện', 'Tổng thành tiền TT', 'Note', 'Code ', 'Kỳ báo đơn'], ['03/08/2026', '#MBLVD29816', 'Bliss …', 'Denio-DN0664-M-BRO', 1, '1.980.000 ₫', '40%', '', '', '', '', '#MBLVD29816Denio-DN0664-M-BRO1', 8]] };
const nhap = { name: 'Trang tính14', rows: [['Ngày giao', 'Mã đơn hàng', 'Mã SP'], ['14/5', '#MBLVDPO24', 'Denio-DN0815-M-WCCM-PLA']] };

describe('docWorkbook', () => {
  it('nhận tab thực nhận: kỳ, brand, dòng A và B; bỏ tab thực bán và tab nháp có lý do', () => {
    const { bangKe, boQua } = docWorkbook([thucNhan, thucBan, nhap]);
    expect(bangKe).toHaveLength(1);
    const b = bangKe[0];
    expect(b).toMatchObject({ brand: 'Denio', period: '2026-08', tuNgay: '01/08/2026', denNgay: '31/08/2026', sheet: 'T8' });
    expect(b.lines).toHaveLength(2); expect(b.returns).toHaveLength(1);
    expect(b.lines[0]).toMatchObject({ maDon: '#MBLVD29521', sku: 'Denio-DN0785-Customize-NPOT-PLA', sl: 1, giaNoiDia: 2190000, ck: 0.35, phiCustomize: 438000, tt: 1861500, code: '#MBLVD29521Denio-DN0785-Customize-NPOT-PLA1' });
    expect(b.returns[0]).toMatchObject({ maDon: '#MBLVD29019', tt: 1657500 });
    expect(boQua).toEqual(expect.arrayContaining([expect.stringContaining('T8 bán'), expect.stringContaining('Trang tính14')]));
  });
  it('dòng không đọc được TT → cảnh báo, không đưa vào lines', () => {
    const rows = [...thucNhan.rows]; rows.splice(6, 0, ['05/08/2026', '#MBLVD29999', 'X', 'Denio-DN0001-S-BLA', 1, '1.000.000 ₫', '35%', '', '', 'Insert Price', '', '', 'T8', 7]);
    const { bangKe } = docWorkbook([{ name: 'T8', rows }]);
    expect(bangKe[0].lines.map((l) => l.maDon)).not.toContain('#MBLVD29999');
    expect(bangKe[0].canhBao.some((c) => c.includes('#MBLVD29999'))).toBe(true);
  });
  it('brand đọc từ tiêu đề dù cột tiêu đề là ô merged lặp', () => {
    const rows = thucNhan.rows.map((r, i) => (i === 1 ? ['', 'pp', 'pp', r[3], r[3], r[3]] : r));
    expect(docWorkbook([{ name: 'T8', rows }]).bangKe[0].brand).toBe('Denio');
  });
});
describe('kiemCongThuc', () => {
  it('TT = giá×SL×(1−CK) + customize (sai số ≤ 1)', () => {
    expect(kiemCongThuc({ ngay: '', maDon: '', tenSp: '', sku: '', sl: 1, giaNoiDia: 2190000, ck: 0.35, phiCustomize: 438000, tt: 1861500, code: null, hangSheet: 1 })).toBe(true);
    expect(kiemCongThuc({ ngay: '', maDon: '', tenSp: '', sku: '', sl: 2, giaNoiDia: 1000000, ck: 0.4, phiCustomize: null, tt: 1200000, code: null, hangSheet: 1 })).toBe(true);
    expect(kiemCongThuc({ ngay: '', maDon: '', tenSp: '', sku: '', sl: 1, giaNoiDia: 1000000, ck: 0.4, phiCustomize: null, tt: 700000, code: null, hangSheet: 1 })).toBe(false);
  });
  it('thiếu giá hoặc CK → coi là đúng (không có gì để kiểm)', () => {
    expect(kiemCongThuc({ ngay: '', maDon: '', tenSp: '', sku: '', sl: 1, giaNoiDia: null, ck: null, phiCustomize: null, tt: 250000, code: null, hangSheet: 1 })).toBe(true);
  });
});
```

- [ ] **Step 2:** chạy → FAIL.

- [ ] **Step 3: Module**

```ts
/**
 * THUẦN: mảng ô của mọi sheet trong workbook bảng kê brand → BangKe[] (spec §5).
 * Tìm cột theo TÊN tiêu đề, không theo vị trí — các tháng có cột thừa/thiếu.
 */
import { docTien, docPhanTram } from './tien';

export type O = string | number | null | undefined;
export interface DongBangKe {
  ngay: string; maDon: string; tenSp: string; sku: string; sl: number;
  giaNoiDia: number | null; ck: number | null; phiCustomize: number | null; tt: number;
  code: string | null; hangSheet: number;
}
export interface BangKe {
  brand: string; period: string; tuNgay: string; denNgay: string; sheet: string;
  lines: DongBangKe[]; returns: DongBangKe[]; canhBao: string[];
}

const RE_TIEU_DE = /BẢNG KÊ CÔNG NỢ\s+Từ ngày\s+(\d\d\/\d\d\/\d{4})\s+đến\s+(\d\d\/\d\d\/\d{4})\s+Brand:\s*([^\s|]+)/i;
const chuoi = (v: O): string => (v == null ? '' : String(v)).trim();

function timTieuDe(rows: O[][]): { tu: string; den: string; brand: string } | null {
  for (const r of rows.slice(0, 15)) for (const c of r) {
    const m = RE_TIEU_DE.exec(chuoi(c));
    if (m) return { tu: m[1], den: m[2], brand: m[3] };
  }
  return null;
}
function coO(rows: O[][], re: RegExp): boolean { return rows.some((r) => r.some((c) => re.test(chuoi(c)))); }
function laHangTieuDe(r: O[]): boolean { const s = r.map(chuoi); return s.includes('Mã đơn') && s.includes('SKU'); }
function chiSoCot(r: O[]) {
  const s = r.map((c) => chuoi(c).toLowerCase());
  const tim = (...ten: string[]) => s.findIndex((x) => ten.some((t) => x === t || x.startsWith(t)));
  return {
    ngay: 0, maDon: tim('mã đơn'), tenSp: tim('tên sản phẩm'), sku: tim('sku'), sl: tim('số lượng'),
    gia: tim('giá nội địa'), ck: tim('% ck'), custom: tim('phí customize'), tt: tim('tổng thành tiền'), code: tim('code'),
  };
}
/** dd/mm/yyyy → 'yyyy-mm'. */
export function periodTuNgay(ddmmyyyy: string): string { const [, m, y] = ddmmyyyy.split('/'); return `${y}-${m}`; }

export function docWorkbook(sheets: Array<{ name: string; rows: O[][] }>): { bangKe: BangKe[]; boQua: string[] } {
  const bangKe: BangKe[] = []; const boQua: string[] = [];
  for (const sh of sheets) {
    const td = timTieuDe(sh.rows);
    if (!td) { boQua.push(`${sh.name}: không có tiêu đề BẢNG KÊ CÔNG NỢ`); continue; }
    if (!coO(sh.rows, /A\.\s*Đơn thực nhận/i)) { boQua.push(`${sh.name}: ${coO(sh.rows, /A\.\s*Đơn thực bán/i) ? 'tab thực bán (chỉ tham khảo)' : 'không có mục A. Đơn thực nhận'}`); continue; }
    const bk: BangKe = { brand: td.brand, period: periodTuNgay(td.tu), tuNgay: td.tu, denNgay: td.den, sheet: sh.name, lines: [], returns: [], canhBao: [] };
    let muc: 'A' | 'B' | null = null; let cot: ReturnType<typeof chiSoCot> | null = null;
    sh.rows.forEach((r, i) => {
      const dau = r.map(chuoi).find((x) => x) ?? '';
      if (/^A\.\s*Đơn thực nhận/i.test(dau)) { muc = 'A'; cot = null; return; }
      if (/^B\.\s*Đơn re/i.test(dau)) { muc = 'B'; cot = null; return; }
      if (laHangTieuDe(r)) { cot = chiSoCot(r); return; }
      if (!muc || !cot) return;
      const maDon = chuoi(r[cot.maDon]);
      if (!maDon.startsWith('#')) return;
      const tt = docTien(r[cot.tt]);
      if (tt == null) { bk.canhBao.push(`${sh.name} hàng ${i + 1}: ${maDon} không đọc được Tổng thành tiền TT`); return; }
      const d: DongBangKe = {
        ngay: chuoi(r[cot.ngay]), maDon, tenSp: chuoi(r[cot.tenSp]), sku: chuoi(r[cot.sku]),
        sl: docTien(r[cot.sl]) ?? 1, giaNoiDia: docTien(r[cot.gia]), ck: docPhanTram(r[cot.ck]),
        phiCustomize: cot.custom >= 0 ? docTien(r[cot.custom]) : null, tt,
        code: cot.code >= 0 ? chuoi(r[cot.code]) || null : null, hangSheet: i + 1,
      };
      (muc === 'A' ? bk.lines : bk.returns).push(d);
    });
    bangKe.push(bk);
  }
  return { bangKe, boQua };
}

/** TT = giá × SL × (1 − CK) + customize, sai số ≤ 1 ₫. Thiếu giá/CK → true (không kiểm được). */
export function kiemCongThuc(d: DongBangKe): boolean {
  if (d.giaNoiDia == null || d.ck == null) return true;
  return Math.abs(d.tt - (d.giaNoiDia * d.sl * (1 - d.ck) + (d.phiCustomize ?? 0))) <= 1;
}
```

- [ ] **Step 4:** PASS. **Step 5:** commit `feat(cogs): đọc workbook bảng kê brand thành BangKe (tab thực nhận, mục A/B, bỏ tab nháp)`

---

### Task 4: Luật ghép line (`features/cogs/ghep-line.ts`)

**Files:** Create `features/cogs/ghep-line.ts`; Test `features/cogs/ghep-line.test.ts`

**Interfaces — Consumes:** `DongBangKe` (Task 3). **Produces:**
```ts
export interface LineDon { orderId: string; storeId: string; shopifyLineId: string; sku: string | null; quantity: number; variantTitle: string | null }
export interface DonTraCuu { orderId: string; storeId: string; maDon: string; lines: LineDon[] }   // maDon đã chuẩn hoá
export function chuanHoaMaDon(s: string): string;      // '#MBLVD29521 ' → 'MBLVD29521' (bỏ #, khoảng trắng, HOA)
export function laMaNgoaiShopify(maDon: string): boolean; // MBLVDPO…, MTB…
export function maGoc(sku: string): string[];           // 'Denio-DN0729+PK0729-Customize-CRE' → ['DN0729','PK0729']; 'Denio-PKDN0729-CRE' → ['DN0729'] (bỏ tiền tố PK)
export type LyDoKhongKhop = 'khong_co_don' | 'khong_co_line_khop' | 'mo_ho';
export interface KetQuaGhep {
  theoLine: Array<{ line: LineDon; dong: DongBangKe[]; amount: number; slSheet: number; du: boolean; cachKhop: 'sku' | 'ma_goc' | 'don_mot_line' }>;
  offline: DongBangKe[];
  khongKhop: Array<{ dong: DongBangKe; lyDo: LyDoKhongKhop }>;
}
export function ghepBangKe(dongs: DongBangKe[], don: Map<string, DonTraCuu>): KetQuaGhep;
```

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest';
import { chuanHoaMaDon, laMaNgoaiShopify, maGoc, ghepBangKe, type DonTraCuu } from './ghep-line';
import type { DongBangKe } from './doc-bang-ke';

const d = (maDon: string, sku: string, tt: number, sl = 1): DongBangKe => ({ ngay: '01/08/2026', maDon, tenSp: '', sku, sl, giaNoiDia: null, ck: null, phiCustomize: null, tt, code: null, hangSheet: 1 });
const line = (shopifyLineId: string, sku: string, quantity = 1) => ({ orderId: 'o1', storeId: 's1', shopifyLineId, sku, quantity, variantTitle: null });
const don = (maDon: string, lines: ReturnType<typeof line>[]): [string, DonTraCuu] => [maDon, { orderId: 'o1', storeId: 's1', maDon, lines }];

describe('chuẩn hoá', () => {
  it('mã đơn bỏ #, khoảng trắng, hoa', () => { expect(chuanHoaMaDon(' #mblvd29521 ')).toBe('MBLVD29521'); });
  it('mã ngoài Shopify', () => { expect(laMaNgoaiShopify('MBLVDPO24')).toBe(true); expect(laMaNgoaiShopify('MTB1490')).toBe(true); expect(laMaNgoaiShopify('MBLVD29521')).toBe(false); });
  it('mã gốc: bỏ brand, tách +, bỏ tiền tố PK', () => {
    expect(maGoc('Denio-DN0729+PK0729-Customize-CRE')).toEqual(['DN0729', 'PK0729']);
    expect(maGoc('Denio-PKDN0729-CRE')).toEqual(['DN0729']);
    expect(maGoc('Denio-DN0774+PKDN0729-XL-NALM-PLA')).toEqual(['DN0774', 'DN0729']);
    expect(maGoc('Denio-DN0695-S-CRE')).toEqual(['DN0695']);
  });
});
describe('ghepBangKe', () => {
  it('SKU đúng → ghép, cách sku', () => {
    const kq = ghepBangKe([d('#MBLVD1', 'Denio-DN0695-S-CRE', 1657500)], new Map([don('MBLVD1', [line('L1', 'Denio-DN0695-S-CRE')])]));
    expect(kq.theoLine).toHaveLength(1); expect(kq.theoLine[0]).toMatchObject({ amount: 1657500, slSheet: 1, du: false, cachKhop: 'sku' });
  });
  it('váy + phụ kiện trên sheet gộp về một line bundle qua mã gốc', () => {
    const kq = ghepBangKe([d('#MBLVD2', 'Denio-DN0729-Customize-CRE', 1943500), d('#MBLVD2', 'Denio-PKDN0729-CRE', 200000)],
      new Map([don('MBLVD2', [line('L1', 'Denio-DN0729+PK0729-Customize-CRE'), line('L2', 'Denio-DN0695-Customize-CRE')])]));
    expect(kq.theoLine).toHaveLength(1);
    expect(kq.theoLine[0]).toMatchObject({ line: { shopifyLineId: 'L1' }, amount: 2143500, slSheet: 2, du: true, cachKhop: 'ma_goc' });
    expect(kq.khongKhop).toHaveLength(0);
  });
  it('đơn một line → mọi dòng về line đó', () => {
    const kq = ghepBangKe([d('#MBLVD3', 'Denio-XYZ', 100), d('#MBLVD3', 'Denio-ABC', 50)], new Map([don('MBLVD3', [line('L1', 'Denio-KHAC', 2)])]));
    expect(kq.theoLine[0]).toMatchObject({ amount: 150, slSheet: 2, du: false, cachKhop: 'don_mot_line' });
  });
  it('PO / MTB → offline; đơn không có → khong_co_don; nhiều line không phân biệt được → mo_ho', () => {
    const kq = ghepBangKe([d('#MBLVDPO24', 'Denio-DN0815-M', 1374000), d('#MTB1490', 'Denio-DN0001', 1), d('#MBLVD9', 'Denio-DN0001', 1), d('#MBLVD4', 'Denio-DN0729-M-CRE', 1)],
      new Map([don('MBLVD4', [line('L1', 'Denio-DN0729-S-CRE'), line('L2', 'Denio-DN0729-M-BLA')])]));
    expect(kq.offline.map((o) => o.maDon)).toEqual(['#MBLVDPO24', '#MTB1490']);
    expect(kq.khongKhop).toEqual([expect.objectContaining({ lyDo: 'khong_co_don' }), expect.objectContaining({ lyDo: 'mo_ho' })]);
    expect(kq.theoLine).toHaveLength(0);
  });
  it('nhiều ứng viên cùng mã gốc → so size/màu', () => {
    const kq = ghepBangKe([d('#MBLVD5', 'Denio-DN0729-M-CRE', 1)], new Map([don('MBLVD5', [line('L1', 'Denio-DN0729+PK0729-S-CRE'), line('L2', 'Denio-DN0729+PK0729-M-CRE')])]));
    expect(kq.theoLine[0].line.shopifyLineId).toBe('L2');
  });
});
```

- [ ] **Step 2:** FAIL. **Step 3: Module**

```ts
/** THUẦN: luật ghép dòng bảng kê brand vào line đơn Shopify (spec §4). Không đoán: mơ hồ → không ghi. */
import type { DongBangKe } from './doc-bang-ke';

export interface LineDon { orderId: string; storeId: string; shopifyLineId: string; sku: string | null; quantity: number; variantTitle: string | null }
export interface DonTraCuu { orderId: string; storeId: string; maDon: string; lines: LineDon[] }

export function chuanHoaMaDon(s: string): string { return s.replace(/\s+/g, '').replace(/^#/, '').toUpperCase(); }
export function laMaNgoaiShopify(maDon: string): boolean { return /^MBLVDPO/i.test(maDon) || /^MTB/i.test(maDon); }

/** Token mã sản phẩm: bỏ tiền tố brand, tách theo '+', bỏ tiền tố 'PK' → ['DN0729','PK0729'…]. Giữ thứ tự, bỏ trùng. */
export function maGoc(sku: string): string[] {
  const phan = sku.split('-').slice(1);            // bỏ 'Denio'
  const out: string[] = [];
  for (const p of phan) for (const t of p.split('+')) {
    const m = /^(PK)?([A-Z]{2,}\d{3,})$/i.exec(t.trim());
    if (m) { const k = m[2].toUpperCase(); if (!out.includes(k)) out.push(k); }
  }
  return out;
}
/** Token size/màu: mọi phần sau mã gốc (S, M, CRE, BLA…). */
function tokenKhac(sku: string): Set<string> {
  const goc = new Set(maGoc(sku).flatMap((g) => [g, `PK${g}`]));
  return new Set(sku.split(/[-+]/).slice(1).map((t) => t.trim().toUpperCase()).filter((t) => t && !goc.has(t)));
}

export type LyDoKhongKhop = 'khong_co_don' | 'khong_co_line_khop' | 'mo_ho';
export interface KetQuaGhep {
  theoLine: Array<{ line: LineDon; dong: DongBangKe[]; amount: number; slSheet: number; du: boolean; cachKhop: 'sku' | 'ma_goc' | 'don_mot_line' }>;
  offline: DongBangKe[];
  khongKhop: Array<{ dong: DongBangKe; lyDo: LyDoKhongKhop }>;
}

function chonLine(dong: DongBangKe, lines: LineDon[]): { line: LineDon; cach: 'sku' | 'ma_goc' | 'don_mot_line' } | 'mo_ho' | null {
  const sku = dong.sku.trim().toUpperCase();
  const dung = lines.filter((l) => (l.sku ?? '').trim().toUpperCase() === sku);
  if (dung.length === 1) return { line: dung[0], cach: 'sku' };
  if (dung.length > 1) return 'mo_ho';
  const goc = maGoc(dong.sku);
  if (goc.length) {
    let ungVien = lines.filter((l) => { const g = maGoc(l.sku ?? ''); return goc.some((x) => g.includes(x)); });
    if (ungVien.length > 1) {
      const tk = tokenKhac(dong.sku);
      const hop = ungVien.filter((l) => [...tk].every((t) => tokenKhac(l.sku ?? '').has(t)));
      if (hop.length >= 1) ungVien = hop;
    }
    if (ungVien.length === 1) return { line: ungVien[0], cach: 'ma_goc' };
    if (ungVien.length > 1) return 'mo_ho';
  }
  if (lines.length === 1) return { line: lines[0], cach: 'don_mot_line' };
  return lines.length === 0 ? null : 'mo_ho';
}

export function ghepBangKe(dongs: DongBangKe[], don: Map<string, DonTraCuu>): KetQuaGhep {
  const kq: KetQuaGhep = { theoLine: [], offline: [], khongKhop: [] };
  const gom = new Map<string, KetQuaGhep['theoLine'][number]>();
  for (const dg of dongs) {
    const ma = chuanHoaMaDon(dg.maDon);
    if (laMaNgoaiShopify(ma)) { kq.offline.push(dg); continue; }
    const d = don.get(ma);
    if (!d) { kq.khongKhop.push({ dong: dg, lyDo: 'khong_co_don' }); continue; }
    const c = chonLine(dg, d.lines);
    if (c === null) { kq.khongKhop.push({ dong: dg, lyDo: 'khong_co_line_khop' }); continue; }
    if (c === 'mo_ho') { kq.khongKhop.push({ dong: dg, lyDo: 'mo_ho' }); continue; }
    const k = `${d.orderId}|${c.line.shopifyLineId}`;
    const cur = gom.get(k) ?? { line: c.line, dong: [], amount: 0, slSheet: 0, du: false, cachKhop: c.cach };
    cur.dong.push(dg); cur.amount += dg.tt; cur.slSheet += dg.sl; cur.du = cur.slSheet > c.line.quantity;
    if (c.cach !== 'sku') cur.cachKhop = c.cach;
    gom.set(k, cur);
  }
  kq.theoLine = [...gom.values()];
  return kq;
}
```

Lưu ý test "váy + phụ kiện": `du = true` vì hai dòng sheet (SL 2) về một line quantity 1 — đúng nghĩa cờ "sheet tính dư" theo spec (để kế toán soát, vẫn nhập).

- [ ] **Step 4:** PASS. **Step 5:** commit `feat(cogs): luật ghép dòng bảng kê vào line đơn (sku → mã gốc → size/màu → đơn một line)`

---

### Task 5: Bộ nhập bảng kê (server) — `features/cogs/bang-ke-import.ts`

**Files:** Create `features/cogs/bang-ke-import.ts`; Test `features/cogs/bang-ke-import.test.ts` (chỉ phần thuần: đọc id sheet, dựng URL)

**Interfaces — Consumes:** `docWorkbook`, `kiemCongThuc`, `BangKe`, `ghepBangKe`, `chuanHoaMaDon`, `DonTraCuu`, `KetQuaGhep`; `schema.orderLineCogs`, `schema.brandCogsOffline`; `XLSX` từ `'xlsx'`. **Produces:**
```ts
export function sheetIdTuUrl(url: string): string | null;                 // …/spreadsheets/d/<id>/… → id
export function urlXuatXlsx(sheetId: string): string;                    // https://docs.google.com/spreadsheets/d/<id>/export?format=xlsx
export async function taiWorkbook(input: { url?: string; buffer?: Uint8Array }): Promise<Array<{ name: string; rows: O[][] }>>; // bỏ sheet ẩn
export interface XemTruocKy { period: string; sheet: string; tongDong: number; khopSku: number; khopMaGoc: number; donMotLine: number; offline: number; khongKhop: Array<{ maDon: string; sku: string; tt: number; lyDo: string }>; returns: number; tongTT: number; tongReturn: number; lechCongThuc: number; du: Array<{ maDon: string; sku: string; slSheet: number; quantity: number }>; canhBao: string[] }
export interface XemTruoc { brand: string; boQua: string[]; ky: XemTruocKy[]; loi?: string }
export async function xemTruocBangKe(input: { brandSlug: string; url?: string; buffer?: Uint8Array }): Promise<XemTruoc>;
export async function apDungBangKe(input: { brandSlug: string; url?: string; buffer?: Uint8Array; periods: string[]; userId: string; tenFile: string }): Promise<{ daGhi: Array<{ period: string; lines: number; offline: number; returns: number }> }>;
```
Brand trên tiêu đề so với `mmp_brands.display_name`/`slug` của `brandSlug` (không phân biệt hoa thường); lệch → `loi`, không xử lý. Tra đơn: một truy vấn `shopify_orders` + `shopify_order_lines` theo danh sách mã đơn đã chuẩn hoá (`upper(replace(shopify_order_number,'#',''))`), chỉ store có `vendor` khớp brand không cần — lấy mọi store, ưu tiên khớp mã. Áp dụng theo kỳ trong `db.transaction`: xoá `order_line_cogs` (`source='brand_statement'`, `brand_slug`, `period`) và `brand_cogs_offline` (`brand_slug`, `period`) rồi insert. `detail` = `{ dong: [...], cachKhop, slSheet, du, lechCongThuc }`. `statement_ref` = `${brandSlug} ${period}`. Ghi audit `cogs_import` với `requestSummary` = số dòng.

- [ ] **Step 1: Test phần thuần**

```ts
import { describe, it, expect } from 'vitest';
import { sheetIdTuUrl, urlXuatXlsx } from './bang-ke-import';
describe('URL Google Sheet', () => {
  it('lấy id từ link chia sẻ', () => {
    expect(sheetIdTuUrl('https://docs.google.com/spreadsheets/d/1HNqRWYk_yoYQe6c1tj8eQbSEGp1_zeO3EKbpTgoAVvg/edit?usp=sharing')).toBe('1HNqRWYk_yoYQe6c1tj8eQbSEGp1_zeO3EKbpTgoAVvg');
    expect(sheetIdTuUrl('https://example.com/x')).toBeNull();
  });
  it('dựng URL xuất xlsx', () => {
    expect(urlXuatXlsx('abc')).toBe('https://docs.google.com/spreadsheets/d/abc/export?format=xlsx');
  });
});
```

- [ ] **Step 2:** FAIL. **Step 3: Module**

```ts
import * as XLSX from 'xlsx';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { recordAudit } from '@/lib/logging/audit';
import { docWorkbook, kiemCongThuc, type BangKe, type O } from './doc-bang-ke';
import { ghepBangKe, chuanHoaMaDon, type DonTraCuu, type KetQuaGhep } from './ghep-line';

export function sheetIdTuUrl(url: string): string | null { return /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(url)?.[1] ?? null; }
export function urlXuatXlsx(sheetId: string): string { return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`; }

/** Tải workbook (link Google hoặc file) → mảng ô mọi sheet KHÔNG ẩn. */
export async function taiWorkbook(input: { url?: string; buffer?: Uint8Array }): Promise<Array<{ name: string; rows: O[][] }>> {
  let buf = input.buffer;
  if (!buf) {
    const id = input.url ? sheetIdTuUrl(input.url) : null;
    if (!id) throw new Error('Link không phải Google Sheet');
    const res = await fetch(urlXuatXlsx(id), { signal: AbortSignal.timeout(60_000), redirect: 'follow' });
    if (!res.ok) throw new Error(`Google trả ${res.status} — sheet phải ở chế độ "ai có link đều xem được"`);
    buf = new Uint8Array(await res.arrayBuffer());
  }
  const wb = XLSX.read(buf, { type: 'array' });
  const an = new Set((wb.Workbook?.Sheets ?? []).filter((s) => s.Hidden && s.Hidden > 0).map((s) => s.name));
  return wb.SheetNames.filter((n) => !an.has(n)).map((name) => ({
    name, rows: XLSX.utils.sheet_to_json<O[]>(wb.Sheets[name], { header: 1, raw: false, defval: null }),
  }));
}

async function traDon(maDons: string[]): Promise<Map<string, DonTraCuu>> {
  if (maDons.length === 0) return new Map();
  const rows = await db.select({
    orderId: schema.shopifyOrders.id, storeId: schema.shopifyOrders.storeId, so: schema.shopifyOrders.shopifyOrderNumber,
    shopifyLineId: schema.shopifyOrderLines.shopifyLineId, sku: schema.shopifyOrderLines.sku, quantity: schema.shopifyOrderLines.quantity, variantTitle: schema.shopifyOrderLines.variantTitle,
  }).from(schema.shopifyOrders)
    .innerJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.orderId, schema.shopifyOrders.id))
    .where(inArray(sql`upper(replace(${schema.shopifyOrders.shopifyOrderNumber}, '#', ''))`, maDons));
  const m = new Map<string, DonTraCuu>();
  for (const r of rows) {
    const k = chuanHoaMaDon(r.so);
    const d = m.get(k) ?? { orderId: r.orderId, storeId: r.storeId, maDon: k, lines: [] };
    d.lines.push({ orderId: r.orderId, storeId: r.storeId, shopifyLineId: r.shopifyLineId, sku: r.sku, quantity: r.quantity, variantTitle: r.variantTitle });
    m.set(k, d);
  }
  return m;
}

async function kiemBrand(brandSlug: string, tenTrenSheet: string): Promise<string | null> {
  const [b] = await db.select({ slug: schema.mmpBrands.slug, ten: schema.mmpBrands.displayName }).from(schema.mmpBrands).where(eq(schema.mmpBrands.slug, brandSlug)).limit(1);
  if (!b) return `Không có brand "${brandSlug}" trong hệ thống`;
  const t = tenTrenSheet.toLowerCase();
  return t === b.slug.toLowerCase() || t === (b.ten ?? '').toLowerCase() ? null : `Sheet ghi Brand: ${tenTrenSheet}, đang nhập cho ${b.ten ?? b.slug}`;
}

interface KyDaGhep { bk: BangKe; ghep: KetQuaGhep; ghepReturn: KetQuaGhep }
async function docVaGhep(input: { brandSlug: string; url?: string; buffer?: Uint8Array }): Promise<{ brand: string; boQua: string[]; ky: KyDaGhep[]; loi?: string }> {
  const sheets = await taiWorkbook(input);
  const { bangKe, boQua } = docWorkbook(sheets);
  if (bangKe.length === 0) return { brand: '', boQua, ky: [], loi: 'Không có tab bảng kê thực nhận nào' };
  const loi = await kiemBrand(input.brandSlug, bangKe[0].brand);
  if (loi) return { brand: bangKe[0].brand, boQua, ky: [], loi };
  const maDons = [...new Set(bangKe.flatMap((b) => [...b.lines, ...b.returns].map((d) => chuanHoaMaDon(d.maDon))))];
  const don = await traDon(maDons);
  return { brand: bangKe[0].brand, boQua, ky: bangKe.map((bk) => ({ bk, ghep: ghepBangKe(bk.lines, don), ghepReturn: ghepBangKe(bk.returns, don) })) };
}

export interface XemTruocKy {
  period: string; sheet: string; tongDong: number; khopSku: number; khopMaGoc: number; donMotLine: number; offline: number;
  khongKhop: Array<{ maDon: string; sku: string; tt: number; lyDo: string }>; returns: number; tongTT: number; tongReturn: number;
  lechCongThuc: number; du: Array<{ maDon: string; sku: string; slSheet: number; quantity: number }>; canhBao: string[];
}
export interface XemTruoc { brand: string; boQua: string[]; ky: XemTruocKy[]; loi?: string }

export async function xemTruocBangKe(input: { brandSlug: string; url?: string; buffer?: Uint8Array }): Promise<XemTruoc> {
  const r = await docVaGhep(input);
  return {
    brand: r.brand, boQua: r.boQua, loi: r.loi,
    ky: r.ky.map(({ bk, ghep, ghepReturn }) => ({
      period: bk.period, sheet: bk.sheet, tongDong: bk.lines.length,
      khopSku: ghep.theoLine.filter((t) => t.cachKhop === 'sku').reduce((s, t) => s + t.dong.length, 0),
      khopMaGoc: ghep.theoLine.filter((t) => t.cachKhop === 'ma_goc').reduce((s, t) => s + t.dong.length, 0),
      donMotLine: ghep.theoLine.filter((t) => t.cachKhop === 'don_mot_line').reduce((s, t) => s + t.dong.length, 0),
      offline: ghep.offline.length + ghepReturn.offline.length,
      khongKhop: [...ghep.khongKhop, ...ghepReturn.khongKhop].map((k) => ({ maDon: k.dong.maDon, sku: k.dong.sku, tt: k.dong.tt, lyDo: k.lyDo })),
      returns: bk.returns.length, tongTT: bk.lines.reduce((s, d) => s + d.tt, 0), tongReturn: bk.returns.reduce((s, d) => s + d.tt, 0),
      lechCongThuc: [...bk.lines, ...bk.returns].filter((d) => !kiemCongThuc(d)).length,
      du: ghep.theoLine.filter((t) => t.du).map((t) => ({ maDon: t.dong[0].maDon, sku: t.line.sku ?? '', slSheet: t.slSheet, quantity: t.line.quantity })),
      canhBao: bk.canhBao,
    })),
  };
}

export async function apDungBangKe(input: { brandSlug: string; url?: string; buffer?: Uint8Array; periods: string[]; userId: string; tenFile: string }) {
  const r = await docVaGhep(input);
  if (r.loi) throw new Error(r.loi);
  const daGhi: Array<{ period: string; lines: number; offline: number; returns: number }> = [];
  for (const { bk, ghep, ghepReturn } of r.ky) {
    if (!input.periods.includes(bk.period)) continue;
    const ref = `${input.brandSlug} ${bk.period}`;
    await db.transaction(async (tx) => {
      await tx.delete(schema.orderLineCogs).where(and(eq(schema.orderLineCogs.source, 'brand_statement'), eq(schema.orderLineCogs.brandSlug, input.brandSlug), eq(schema.orderLineCogs.period, bk.period)));
      await tx.delete(schema.brandCogsOffline).where(and(eq(schema.brandCogsOffline.brandSlug, input.brandSlug), eq(schema.brandCogsOffline.period, bk.period)));
      const ghiLine = async (g: KetQuaGhep, kind: 'cogs' | 'return') => {
        for (const t of g.theoLine) {
          await tx.insert(schema.orderLineCogs).values({
            orderId: t.line.orderId, shopifyLineId: t.line.shopifyLineId, storeId: t.line.storeId, kind, period: bk.period,
            amount: String(kind === 'return' ? -t.amount : t.amount), currency: 'VND', source: 'brand_statement', brandSlug: input.brandSlug, statementRef: ref,
            detail: { dong: t.dong, cachKhop: t.cachKhop, slSheet: t.slSheet, du: t.du, lechCongThuc: t.dong.filter((d) => !kiemCongThuc(d)).length, tenFile: input.tenFile },
            importedBy: input.userId,
          });
        }
        for (const o of g.offline) {
          await tx.insert(schema.brandCogsOffline).values({ brandSlug: input.brandSlug, period: bk.period, kind, refCode: o.maDon, sku: o.sku, qty: Math.round(o.sl), amount: String(kind === 'return' ? -o.tt : o.tt), currency: 'VND', statementRef: ref });
        }
      };
      await ghiLine(ghep, 'cogs'); await ghiLine(ghepReturn, 'return');
    });
    daGhi.push({ period: bk.period, lines: ghep.theoLine.length, offline: ghep.offline.length + ghepReturn.offline.length, returns: ghepReturn.theoLine.length });
    try { await recordAudit({ userId: input.userId, action: 'cogs_import', target: ref, requestSummary: `${input.tenFile}: ${ghep.theoLine.length} line, ${ghep.offline.length} offline, ${ghep.khongKhop.length} không khớp`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  }
  return { daGhi };
}
```

- [ ] **Step 4:** `npx vitest run features/cogs && npx tsc --noEmit`. Kiểm thật (KHÔNG ghi): script tạm trong `scripts/` gọi `xemTruocBangKe({ brandSlug: 'denio', url: '<link CEO gửi>' })` và in `ky.map(k => [k.period, k.tongDong, k.khopSku, k.khopMaGoc, k.offline, k.khongKhop.length, k.tongTT])`. Expected khớp khảo sát: 8 kỳ; tổng dòng 865; Σ TT theo kỳ 01: 166.648.800 · 02: 206.330.000 · 03: 180.710.000 · 04: 148.573.400 · 05: 171.324.000 · 06: 90.762.850 · 07: 47.381.000 · 08: 123.789.500; offline 183; khongKhop tổng ≤ 5 (nếu lớn hơn, đọc danh sách và sửa luật trước khi sang Task 6). Xoá script tạm.

- [ ] **Step 5:** commit `feat(cogs): bộ nhập bảng kê brand — tải sheet, ghép line, xem trước, áp dụng theo kỳ`

---

### Task 6: Actions + trang "Bảng kê brand"

**Files:**
- Create: `features/cogs/actions.ts` (`'use server'`), `components/cogs/BangKeImporter.tsx`, `app/(dashboard)/f/orders/cogs/bang-ke/page.tsx`
- Modify: `app/(dashboard)/f/orders/page.tsx:40-60` (thêm 2 link cạnh "Shipping invoices")

**Interfaces — Produces (`actions.ts`, tất cả async):**
```ts
export async function xemTruocAction(fd: FormData): Promise<XemTruoc>;          // fields: brandSlug, url | file
export async function apDungAction(fd: FormData): Promise<{ daGhi: ... }>;       // fields: brandSlug, url | file, periods (nhiều)
export async function luuTiGiaAction(fd: FormData): Promise<void>;               // period, rate (USD→VND), source 'manual'
export async function layTiGiaVcbAction(period: string): Promise<{ rate: number }>; // fetchVcbUsd().sell → lưu source 'vcb'
export async function layBrands(): Promise<Array<{ slug: string; displayName: string }>>;
```
Mỗi action `requirePerm`: tự viết `async function requireCogs(perm: 'view_cogs' | 'manage_cogs'): Promise<string>` trong `features/cogs/perm.ts` theo đúng thân `features/receiving/perm.ts` (auth.api.getSession + getRole + hasPermission). File `url|file`: nếu `fd.get('file')` là `File` có size > 0 → `buffer = new Uint8Array(await file.arrayBuffer())`, ngược lại dùng `url`.

- [ ] **Step 1: `features/cogs/perm.ts`** — sao chép `requirePerm` từ `features/receiving/perm.ts`, đổi tên `requireCogs`, kiểu tham số `'view_cogs' | 'manage_cogs'`.

- [ ] **Step 2: `actions.ts`**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { fetchVcbUsd } from '@/lib/fx/vcb';
import { requireCogs } from './perm';
import { xemTruocBangKe, apDungBangKe, type XemTruoc } from './bang-ke-import';

async function nguon(fd: FormData): Promise<{ url?: string; buffer?: Uint8Array; tenFile: string }> {
  const f = fd.get('file');
  if (f instanceof File && f.size > 0) return { buffer: new Uint8Array(await f.arrayBuffer()), tenFile: f.name };
  const url = String(fd.get('url') ?? '').trim();
  if (!url) throw new Error('Cần link Google Sheet hoặc file');
  return { url, tenFile: url };
}
export async function layBrands() {
  await requireCogs('view_cogs');
  return db.select({ slug: schema.mmpBrands.slug, displayName: schema.mmpBrands.displayName }).from(schema.mmpBrands).orderBy(schema.mmpBrands.displayName);
}
export async function xemTruocAction(fd: FormData): Promise<XemTruoc> {
  await requireCogs('manage_cogs');
  const n = await nguon(fd);
  return xemTruocBangKe({ brandSlug: String(fd.get('brandSlug')), url: n.url, buffer: n.buffer });
}
export async function apDungAction(fd: FormData) {
  const userId = await requireCogs('manage_cogs');
  const n = await nguon(fd);
  const periods = fd.getAll('periods').map(String);
  if (periods.length === 0) throw new Error('Chọn ít nhất một kỳ');
  const r = await apDungBangKe({ brandSlug: String(fd.get('brandSlug')), url: n.url, buffer: n.buffer, periods, userId, tenFile: n.tenFile });
  revalidatePath('/f/orders/lai-gop'); revalidatePath('/f/orders/cogs/bang-ke');
  return r;
}
export async function luuTiGiaAction(fd: FormData): Promise<void> {
  await requireCogs('manage_cogs');
  const period = String(fd.get('period')); const rate = Number(String(fd.get('rate')).replace(/[,.\s]/g, (m) => (m === '.' ? '.' : '')));
  if (!/^\d{4}-\d{2}$/.test(period) || !Number.isFinite(rate) || rate <= 0) throw new Error('Kỳ hoặc tỉ giá không hợp lệ');
  await db.insert(schema.fxMonthRates).values({ fromCurrency: 'USD', toCurrency: 'VND', period, rate: String(rate), source: 'manual' })
    .onConflictDoUpdate({ target: [schema.fxMonthRates.fromCurrency, schema.fxMonthRates.toCurrency, schema.fxMonthRates.period], set: { rate: String(rate), source: 'manual', updatedAt: sql`now()` } });
  revalidatePath('/f/orders/lai-gop');
}
export async function layTiGiaVcbAction(period: string): Promise<{ rate: number }> {
  await requireCogs('manage_cogs');
  const r = await fetchVcbUsd();
  await db.insert(schema.fxMonthRates).values({ fromCurrency: 'USD', toCurrency: 'VND', period, rate: String(r.sell), source: 'vcb' })
    .onConflictDoUpdate({ target: [schema.fxMonthRates.fromCurrency, schema.fxMonthRates.toCurrency, schema.fxMonthRates.period], set: { rate: String(r.sell), source: 'vcb', updatedAt: sql`now()` } });
  revalidatePath('/f/orders/lai-gop');
  return { rate: r.sell };
}
```
(`eq` chỉ import nếu dùng; bỏ nếu tsc báo unused.)

- [ ] **Step 3: `components/cogs/BangKeImporter.tsx`** (`'use client'`): form chọn brand (select từ props), ô `url`, input `file` (accept `.xlsx,.csv`), nút **Xem trước** → `useTransition` gọi `xemTruocAction(fd)` → hiện `loi`/`boQua` và bảng theo kỳ (cột: Kỳ, Tab, Dòng, Khớp SKU, Khớp mã gốc, Đơn 1 line, Offline, Không khớp, Return, Σ TT, Lệch CT) với checkbox chọn kỳ (mặc định tất cả); danh sách "Không khớp" và "Sheet tính dư" mở rộng; nút **Áp dụng N kỳ** (disabled khi chưa xem trước) → `apDungAction(fd + periods)` → `toast.success` theo `daGhi`. Số tiền hiển thị `toLocaleString('vi-VN') + ' ₫'`. Không có test component (env node) — kiểm bằng tsc + build + chạy tay.

- [ ] **Step 4: Trang `app/(dashboard)/f/orders/cogs/bang-ke/page.tsx`**: guard `manage_cogs` (mẫu guard như `costs/page.tsx` dòng 17–24, dùng `requireCogs` không được vì page cần redirect → dùng `auth.api.getSession` + `hasPermission(role, 'manage_cogs')`), tải `layBrands()` thành props, render `<BangKeImporter brands={…} />` với tiêu đề "Bảng kê thanh toán brand" và đoạn hướng dẫn 3 dòng (sheet cần mở "ai có link", chỉ tab thực nhận được nhập, nhập lại kỳ sẽ thay toàn bộ).

- [ ] **Step 5: Link trên `app/(dashboard)/f/orders/page.tsx`**: cạnh link `/f/orders/shipping-invoices`, thêm khi `hasPermission(role, 'view_cogs')`: `<Link href="/f/orders/lai-gop">Lãi gộp</Link>`; khi `manage_cogs`: `<Link href="/f/orders/cogs/bang-ke">Bảng kê brand</Link>` (cùng kiểu Button outline như link hiện có).

- [ ] **Step 6:** `npx tsc --noEmit && npm run build`; `npm run dev`, đăng nhập admin, mở `/f/orders/cogs/bang-ke`, dán link Denio → Xem trước ra 8 kỳ đúng số Task 5 Step 4.

- [ ] **Step 7:** commit `feat(cogs): trang Bảng kê brand — xem trước và áp dụng theo kỳ`

---

### Task 7: Nhập Denio 8 kỳ (dữ liệu production, có chủ ý)

**Files:** không đổi mã.

- [ ] **Step 1:** Trên trang Task 6 (hoặc script tạm gọi `apDungBangKe` với `userId` của CEO), áp dụng 8 kỳ `2026-01`…`2026-08` cho `denio`.
- [ ] **Step 2: Kiểm DB** (script tạm, xoá sau):
```sql
select period, count(*) filter (where kind='cogs') as lines, sum(amount) filter (where kind='cogs') as tt, count(*) filter (where kind='return') as ret
from order_line_cogs where brand_slug='denio' and source='brand_statement' group by 1 order by 1;
select period, count(*), sum(amount) from brand_cogs_offline where brand_slug='denio' group by 1 order by 1;
```
Expected: 8 kỳ; Σ(lines.tt + offline.amount) mỗi kỳ = Σ TT mục A của kỳ trong khảo sát; offline tổng 183 dòng.
- [ ] **Step 3:** Ghi vào Second Brain Activity Log một dòng: "Nhập bảng kê Denio 01–08/2026 vào order_line_cogs: N line, 183 offline, K không khớp (liệt kê)".

---

### Task 8: Phép tính báo cáo (`features/cogs/bao-cao-logic.ts`)

**Files:** Create `features/cogs/bao-cao-logic.ts`; Test `features/cogs/bao-cao-logic.test.ts`

**Interfaces — Consumes:** `doiTienTheoThang`, `TiGiaThang` (Task 2). **Produces:**
```ts
export interface DoanhThuThang { period: string; storeId: string; currency: string; doanhThuThuan: number; phiShip: number; soDon: number; soLine: number; soLineCoCogs: number; doanhThuLineCoCogs: number }   // theo tiền đơn
export interface CogsThang { period: string; storeId: string | null; brandSlug: string | null; amount: number; currency: string; thuocThangTruoc: number }  // đã gộp theo kỳ, VND
export interface OfflineThang { period: string; brandSlug: string; amount: number }
export interface DongBaoCao { period: string; doanhThuThuan: number; phiShip: number; cogs: number; laiGop: number; offline: number; phuLine: number; phuDoanhThu: number; thuocThangTruoc: number; tiGiaTam: boolean; thieuTiGia: boolean }
export function tinhBaoCao(input: { thang: string[]; doanhThu: DoanhThuThang[]; cogs: CogsThang[]; offline: OfflineThang[]; rates: TiGiaThang[] }): DongBaoCao[];
```
Mọi số ra VND. `doanhThuThuan`/`phiShip` đổi theo `currency` của dòng doanh thu (USD → VND theo tháng; VND giữ nguyên). Thiếu tỉ giá hoàn toàn → dòng có `thieuTiGia = true` và doanhThu/phiShip = 0 (không cộng số sai). `phuLine` = Σ soLineCoCogs / Σ soLine; `phuDoanhThu` = Σ doanhThuLineCoCogs / Σ doanhThuThuan (cùng tiền, tính trước khi đổi — dùng tỉ lệ).

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest';
import { tinhBaoCao } from './bao-cao-logic';
const rates = [{ from: 'USD', to: 'VND', period: '2026-07', rate: 26000 }];
describe('tinhBaoCao', () => {
  it('đổi USD→VND theo tháng, trừ ship và cogs, offline cột riêng, độ phủ', () => {
    const r = tinhBaoCao({
      thang: ['2026-08'],
      doanhThu: [{ period: '2026-08', storeId: 's1', currency: 'USD', doanhThuThuan: 1000, phiShip: 100, soDon: 10, soLine: 20, soLineCoCogs: 15, doanhThuLineCoCogs: 800 }],
      cogs: [{ period: '2026-08', storeId: 's1', brandSlug: 'denio', amount: 12_000_000, currency: 'VND', thuocThangTruoc: 2_000_000 }],
      offline: [{ period: '2026-08', brandSlug: 'denio', amount: 5_000_000 }],
      rates,
    });
    expect(r).toEqual([{ period: '2026-08', doanhThuThuan: 26_000_000, phiShip: 2_600_000, cogs: 12_000_000, laiGop: 11_400_000, offline: 5_000_000, phuLine: 0.75, phuDoanhThu: 0.8, thuocThangTruoc: 2_000_000, tiGiaTam: true, thieuTiGia: false }]);
  });
  it('không có tỉ giá nào trước đó → thiếu tỉ giá, doanh thu 0, không nổ', () => {
    const r = tinhBaoCao({ thang: ['2026-05'], doanhThu: [{ period: '2026-05', storeId: 's1', currency: 'USD', doanhThuThuan: 10, phiShip: 1, soDon: 1, soLine: 1, soLineCoCogs: 0, doanhThuLineCoCogs: 0 }], cogs: [], offline: [], rates });
    expect(r[0]).toMatchObject({ thieuTiGia: true, doanhThuThuan: 0, phiShip: 0, cogs: 0, phuLine: 0 });
  });
  it('tháng không có gì → dòng 0', () => {
    expect(tinhBaoCao({ thang: ['2026-01'], doanhThu: [], cogs: [], offline: [], rates })[0]).toMatchObject({ doanhThuThuan: 0, cogs: 0, laiGop: 0, phuLine: 0, phuDoanhThu: 0 });
  });
  it('dòng doanh thu VND không đổi tiền', () => {
    const r = tinhBaoCao({ thang: ['2026-08'], doanhThu: [{ period: '2026-08', storeId: 's2', currency: 'VND', doanhThuThuan: 500, phiShip: 0, soDon: 1, soLine: 1, soLineCoCogs: 1, doanhThuLineCoCogs: 500 }], cogs: [], offline: [], rates });
    expect(r[0]).toMatchObject({ doanhThuThuan: 500, tiGiaTam: false, thieuTiGia: false, phuLine: 1 });
  });
});
```

- [ ] **Step 2:** FAIL. **Step 3: Module**

```ts
/** THUẦN: gộp doanh thu (tiền đơn) + COGS theo kỳ (VND) + tỉ giá tháng → dòng báo cáo lãi gộp, VND (spec §6). */
import { doiTienTheoThang, type TiGiaThang } from './tien';

export interface DoanhThuThang { period: string; storeId: string; currency: string; doanhThuThuan: number; phiShip: number; soDon: number; soLine: number; soLineCoCogs: number; doanhThuLineCoCogs: number }
export interface CogsThang { period: string; storeId: string | null; brandSlug: string | null; amount: number; currency: string; thuocThangTruoc: number }
export interface OfflineThang { period: string; brandSlug: string; amount: number }
export interface DongBaoCao { period: string; doanhThuThuan: number; phiShip: number; cogs: number; laiGop: number; offline: number; phuLine: number; phuDoanhThu: number; thuocThangTruoc: number; tiGiaTam: boolean; thieuTiGia: boolean }

const VND = 'VND';
export function tinhBaoCao(input: { thang: string[]; doanhThu: DoanhThuThang[]; cogs: CogsThang[]; offline: OfflineThang[]; rates: TiGiaThang[] }): DongBaoCao[] {
  return input.thang.map((period) => {
    let doanhThuThuan = 0, phiShip = 0, soLine = 0, soLineCoCogs = 0, dtGoc = 0, dtCoCogs = 0, tiGiaTam = false, thieuTiGia = false;
    for (const d of input.doanhThu.filter((x) => x.period === period)) {
      const a = doiTienTheoThang(d.doanhThuThuan, d.currency, VND, period, input.rates);
      const b = doiTienTheoThang(d.phiShip, d.currency, VND, period, input.rates);
      if (!a || !b) { thieuTiGia = true; } else { doanhThuThuan += a.amount; phiShip += b.amount; tiGiaTam ||= a.tam; }
      soLine += d.soLine; soLineCoCogs += d.soLineCoCogs; dtGoc += d.doanhThuThuan; dtCoCogs += d.doanhThuLineCoCogs;
    }
    let cogs = 0, thuocThangTruoc = 0;
    for (const c of input.cogs.filter((x) => x.period === period)) {
      const v = doiTienTheoThang(c.amount, c.currency, VND, period, input.rates);
      if (!v) { thieuTiGia = true; continue; }
      cogs += v.amount; thuocThangTruoc += c.thuocThangTruoc; tiGiaTam ||= v.tam;
    }
    const offline = input.offline.filter((x) => x.period === period).reduce((s, x) => s + x.amount, 0);
    return {
      period, doanhThuThuan, phiShip, cogs, laiGop: doanhThuThuan - phiShip - cogs, offline,
      phuLine: soLine ? soLineCoCogs / soLine : 0, phuDoanhThu: dtGoc ? dtCoCogs / dtGoc : 0,
      thuocThangTruoc, tiGiaTam, thieuTiGia,
    };
  });
}
```

- [ ] **Step 4:** PASS. **Step 5:** commit `feat(cogs): phép tính báo cáo lãi gộp theo tháng (VND, độ phủ, cờ tỉ giá)`

---

### Task 9: Truy vấn báo cáo (`features/cogs/queries.ts`)

**Files:** Create `features/cogs/queries.ts`

**Interfaces — Consumes:** `getStoreMetrics` (`features/shopify-orders/dashboard-actions.ts`: `{ storeId, dateFrom, dateTo, vendorFilter? }` → `{ total, orders: OrderRow[] }`, `OrderRow` có `orderId, currency, netGmv, discount, shippingCost, processedAt`), `sqlGioKinhDoanh` (`lib/timezone.ts`), `schema.orderLineCogs`, `schema.brandCogsOffline`, `schema.fxMonthRates`. **Produces:**
```ts
export function ranhThang(period: string): { from: Date; to: Date };                 // biên tháng theo giờ Bangkok, đổi ra UTC Date
export async function doanhThuTheoThang(thang: string[], storeIds: string[], brand?: string): Promise<DoanhThuThang[]>;
export async function cogsTheoThang(thang: string[], storeIds?: string[], brand?: string): Promise<CogsThang[]>;
export async function offlineTheoThang(thang: string[], brand?: string): Promise<OfflineThang[]>;
export async function tiGiaThang(): Promise<TiGiaThang[]>;
export async function lineChuaCoCogs(period: string, storeIds?: string[]): Promise<Array<{ store: string; brand: string | null; maDon: string; sku: string | null; sl: number; doanhThu: number; currency: string }>>;
export async function chiTietThang(period: string, brand?: string): Promise<Array<{ brandSlug: string | null; maDon: string; sku: string | null; amount: number; source: string; statementRef: string | null; kind: string }>>;
```
- `ranhThang('2026-08')`: `from = new Date('2026-08-01T00:00:00+07:00')`, `to = new Date('2026-09-01T00:00:00+07:00') − 1ms`.
- `doanhThuTheoThang`: với mỗi store và tháng gọi `getStoreMetrics({ storeId, dateFrom, dateTo, vendorFilter: brand ? [tenVendor(brand)] : undefined })`; bỏ đơn `cancelledAt != null`; `doanhThuThuan = Σ(netGmv − discount)`, `phiShip = Σ shippingCost`; `soLine`/`soLineCoCogs`/`doanhThuLineCoCogs` từ một truy vấn phụ đếm `shopify_order_lines` của các đơn đó có/không có `order_line_cogs kind='cogs'` (bất kỳ kỳ). `tenVendor(brand)` = `mmp_brands.display_name`.
- `cogsTheoThang`: SQL gộp `order_line_cogs` theo `period` (+ `store_id`, `brand_slug`), `sum(amount)`; `thuocThangTruoc` = `sum(amount) filter (where to_char(${sqlGioKinhDoanh('o.processed_at_shopify')}, 'YYYY-MM') < period)` qua join `shopify_orders o`.
- `lineChuaCoCogs(period)`: line của đơn đặt trong tháng (giờ Bangkok, `sqlGioKinhDoanh`) không có dòng `order_line_cogs kind='cogs'`, kèm store name, vendor, mã đơn, sku, quantity, `unit_price*quantity − discount_alloc`.

- [ ] **Step 1:** Viết module theo mô tả trên (SQL qua Drizzle `sql` template; tháng so trong SQL bằng `to_char(<sqlGioKinhDoanh>, 'YYYY-MM')`).
- [ ] **Step 2:** Kiểm thật bằng script tạm: `cogsTheoThang(['2026-08'])` phải ra Denio ≈ 123.789.500 − 1.657.500 (return) và `thuocThangTruoc` > 0; `doanhThuTheoThang(['2026-08'], [meanblvd])` ra USD hợp lý; `lineChuaCoCogs('2026-08')` ra danh sách. `npx tsc --noEmit`.
- [ ] **Step 3:** commit `feat(cogs): truy vấn doanh thu theo tháng, COGS theo kỳ, line chưa có giá vốn`

---

### Task 10: Trang "Lãi gộp theo tháng" + tỉ giá

**Files:** Create `components/cogs/LaiGopTable.tsx`, `components/cogs/TiGiaForm.tsx`, `app/(dashboard)/f/orders/lai-gop/page.tsx`, `app/(dashboard)/f/orders/lai-gop/chua-co-gia-von.csv/route.ts`, `app/(dashboard)/f/orders/lai-gop/bang-thang.csv/route.ts`

- [ ] **Step 1: Page** (server, guard `view_cogs`; `searchParams` Promise: `tu`, `den` dạng `YYYY-MM` mặc định 6 tháng gần nhất, `store`, `brand`): tính `thang[]`, tải song song `doanhThuTheoThang`, `cogsTheoThang`, `offlineTheoThang`, `tiGiaThang`, chạy `tinhBaoCao` → render `<LaiGopTable rows tiGia={…} canManage />`. Bộ lọc là form GET (select store từ `stores`, select brand từ `mmp_brands`, hai ô tháng).
- [ ] **Step 2: `LaiGopTable.tsx`** (`'use client'`): bảng cột đúng spec §6 (Tháng, Doanh thu thuần, Phí ship, Giá vốn, **Lãi gộp**, Chi brand ngoài Shopify, Độ phủ line/doanh thu, Thuộc đơn tháng trước, Tỉ giá). Lãi gộp tô `text-amber-700` khi `phuLine < 1`; cờ "tỉ giá tạm"/"thiếu tỉ giá" là Badge cạnh tháng; số `vi-VN`. Mỗi dòng có link `?chi-tiet=<period>` mở phần chi tiết theo brand → line (dữ liệu `chiTietThang(period)` tải ở page khi có `chi-tiet`). Nút "Xuất CSV bảng tháng" và "Xuất line chưa có giá vốn (tháng X)" trỏ tới hai route CSV.
- [ ] **Step 3: `TiGiaForm.tsx`** (`'use client'`): với `canManage`, mỗi tháng có ô nhập tỉ giá USD→VND (form gọi `luuTiGiaAction`) và nút "Lấy VCB" (`layTiGiaVcbAction(period)`), hiện tỉ giá hiện tại + nguồn.
- [ ] **Step 4: Hai route CSV** (`GET`, guard `view_cogs` bằng `auth.api.getSession` + `hasPermission`): `bang-thang.csv` từ `tinhBaoCao` với cùng tham số; `chua-co-gia-von.csv?period=` từ `lineChuaCoCogs`. Header CSV tiếng Việt, BOM `﻿` để Excel đọc UTF-8, `Content-Type: text/csv; charset=utf-8`.
- [ ] **Step 5:** `npx tsc --noEmit && npm run build`; chạy tay: nhập tỉ giá 08/2026, xem bảng 01→08 có Denio; xuất hai CSV mở được.
- [ ] **Step 6:** commit `feat(cogs): trang Lãi gộp theo tháng — bảng VND, độ phủ, chi tiết brand/line, tỉ giá tháng, xuất CSV`

---

### Task 11: Cổng, tài liệu, Second Brain, push (đợt 1)

- [ ] **Step 1:** `npx tsc --noEmit && npx vitest run && npm run build` — cả ba xanh (đọc output tsc thật).
- [ ] **Step 2:** `docs/cogs.md` (mới, ngắn): cách nhập bảng kê, luật ghép, cách đọc báo cáo, nơi nhập tỉ giá, ba nguồn và ưu tiên.
- [ ] **Step 3:** Second Brain (`Shared/Projects/Shopify-Management-System/`): Activity Log entry; Decisions **D-055** "Giá vốn hàng brand = tiền trả brand theo kỳ thực nhận; báo cáo VND" (thay thế: `sku_costs` một giá/SKU là nguồn duy nhất); Overview cập nhật.
- [ ] **Step 4:** `gh auth switch --user ecommeanblvd && git push`.

---

## ĐỢT 2 (sau khi đợt 1 chạy và CEO xác nhận với MMP)

### Task 12: Cron `sync-unit-cost` + `apply-own-cogs` (hàng tự sản xuất)

**Files:** Create `features/cogs/unit-cost-sync.ts` (+test cho phần thuần), `features/cogs/own-cogs.ts`, `scripts/cron/sync-unit-cost.ts`, `scripts/cron/apply-own-cogs.ts`; Modify `features/jobs/registry.ts` (2 khoá), `features/jobs/groups.ts` (`hang-ngay` thêm `'sync-unit-cost', 'apply-own-cogs'`), `package.json` (`cron:sync-unit-cost`, `cron:apply-own-cogs`), `.railway/railway.ts` (service `cron-hang-ngay`: `start: "npm run cron:group -- hang-ngay"`, `cronSchedule: "0 2 * * *"`, env DATABASE_URL + SHOPIFY_* + FEDEX_* như web), `features/cogs/vendor-tu-san-xuat.ts` (hằng `VENDOR_TU_SAN_XUAT = ['MEAN BLVD', 'TINH Atelier', 'Mirer']` — xác nhận tên vendor thật bằng `select distinct vendor` trước).

- `unit-cost-sync.ts`: với mỗi store, GraphQL `productVariants(first:250){ nodes{ sku inventoryItem{ unitCost{ amount currencyCode } } } }` phân trang (`getStoreToken`, `graphqlCall`, `SHOPIFY_API_VERSION`), ghi `sku_costs` (`source='shopify'`, `effectiveFrom` = hôm nay Bangkok) chỉ khi giá khác giá hiệu lực hiện tại. Phần thuần `khacGia(cu, moi)` có test.
- `own-cogs.ts`: line của đơn 90 ngày gần đây, vendor ∈ `VENDOR_TU_SAN_XUAT` hoặc store ∈ `BRAND_OWNED_STORES`, chưa có `order_line_cogs kind='cogs'` → tra `sku_costs` hiệu lực (`effective_from <= processed_at::date`, mới nhất) → insert `source='shopify_unit_cost'`, `period` = tháng đặt (Bangkok), `amount = cost × quantity`, `currency` của `sku_costs`. Không đè dòng nguồn khác (unique index + `onConflictDoNothing`).
- Kiểm: `npx vitest run features/cogs features/jobs`, chạy tay hai script với `--dry-run`? (thêm cờ `DRY_RUN=1` in ra thay vì ghi), rồi `railway config plan/apply`.

### Task 13: Webhook MMP `POST /api/mmp/cogs`

**Files:** Create `app/api/mmp/cogs/route.ts`, `features/cogs/mmp-payload.ts` (+test: parse/validate payload thuần → `BangKe`), Modify `features/cogs/bang-ke-import.ts` (tách `apDungBangKeDaDoc(bangKe: BangKe[], …, source: 'brand_statement' | 'mmp')` để webhook dùng chung ghép + ghi).

Payload: `{ brandSlug, period: 'YYYY-MM', lines: [{ orderNumber, sku, qty, amount, currency, kind: 'cogs'|'return', ref }], offline: [{ refCode, sku, qty, amount, currency, kind }] }`. Route theo mẫu `app/api/mmp/order-confirmations/route.ts` (HMAC `verifyMmpSignature` với `x-mean-signature`/`x-mean-timestamp`, 401/400 rõ lý do), rồi `apDungBangKeDaDoc` với `source='mmp'`, trả `{ period, lines, offline, khongKhop: [...] }` để MMP thấy dòng không ghép được. Ghi `docs/cogs.md` phần hợp đồng payload. **Không bật/không báo MMP cho tới khi CEO xác nhận.**

### Task 14: Cổng + Second Brain đợt 2
Ba cổng xanh; Activity Log; Decisions bổ sung D-055 (MMP là nguồn từ ngày X); push.

---

## Tự kiểm kế hoạch

**Phủ spec:** §3.1–3.3 → Task 1; §4 luật ghép → Task 4 (+ Task 5 ghi theo kỳ, transaction, return, detail); §5 bộ nhập (tải link/file, nhận diện tab, xem trước/áp dụng, audit, cấu trúc trung gian `BangKe`) → Task 3, 5, 6; nhập Denio → Task 7; §6 báo cáo (cột, VND, Bangkok, chi tiết brand/line, CSV, tỉ giá thiếu + ô nhập) → Task 8, 9, 10; §7 MMP → Task 13; hàng tự sản xuất → Task 12; VAT (TT trước thuế) → Task 3 lấy đúng cột; quyền → Task 1, 6, 10; §8 lỗi → Task 5 (transaction/không đoán), Task 13 (401/400); §9 kiểm thử → test thuần Task 2, 3, 4, 8 + kiểm thật Task 5 Step 4 với con số khảo sát; §10 ngoài phạm vi không có task; §11 thứ tự đúng.

**Lệch có chủ ý:** "Doanh thu thuần" dùng `netGmv − discount` của `computeOrderMetrics` (gồm phí ship khách trả) thay cho cách viết trong spec §6 chỉ nêu line — để cùng định nghĩa với dashboard hiện có và vì phí ship thực được trừ ngay cột kế. Ghi rõ trong `docs/cogs.md`.

**Nhất quán kiểu:** `DongBangKe`/`BangKe`/`O` (Task 3) dùng ở Task 4, 5, 13; `LineDon`/`DonTraCuu`/`KetQuaGhep` (Task 4) dùng ở Task 5; `XemTruoc`/`XemTruocKy` (Task 5) dùng ở Task 6; `DoanhThuThang`/`CogsThang`/`OfflineThang`/`DongBaoCao` (Task 8) dùng ở Task 9, 10; `TiGiaThang` (Task 2) dùng ở Task 8, 9; `requireCogs` (Task 6) dùng ở Task 6, 10.
