# Tách duty khỏi cước ship hộ — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `actual_charged_vnd` chỉ còn cước; duty FedEx ứng hộ đi cột riêng, bảng kê riêng (kỳ theo ngày hoá đơn FedEx), sự kiện MMP riêng; bảng kê cước xếp kỳ theo ngày gửi và chỉ gồm đơn Đức đã chốt đối soát.

**Architecture:** Bốn lớp độc lập: (1) hàm thuần tính cước/duty (`reconcile-charge.ts`, `duty.ts`, `gia-cuoi-mmp.ts`); (2) đối soát ghi hai cột riêng và bắn hai sự kiện riêng (`reconcile-actions.ts`, `reconcile-decision-actions.ts`); (3) bảng kê có `type` với luật gom riêng từng loại (`statement-*.ts`) và sự kiện cấp brand `statement.issued/paid` đẩy trực tiếp như `ratecard-push.ts`; (4) ba script chuyển đổi một lần, mỗi script có `--dry`. Công tắc `MMP_TACH_DUTY` quyết định `finalChargedVnd` gửi MMP là cước hay cước+duty, để đổi hợp đồng đúng ngày hai bên hẹn.

**Tech Stack:** Next.js (đọc `node_modules/next/dist/docs/` trước khi sửa page/action), Drizzle + Postgres (Supabase), vitest 4 (node), `xlsx` 0.18 (client-side export đã dùng), webhook MMP ký HMAC (`features/mmp/hmac`).

## Global Constraints

- **`actual_charged_vnd` = cước, không duty** (spec §3.1): `reconciledBrandCharge().chargedVnd` bỏ `+ duty`; `lines` không còn dòng "Thuế/hải quan"; `dutyVnd` trả riêng.
- **Duty ghi độc lập với đối soát cước** (spec §4.2): cột `actual_duty_vnd`, `duty_bill_numbers text[]`; cộng dồn theo số hoá đơn, hoá đơn đã trong mảng không cộng lại; không đổi `reconcile_status`, không phá đóng băng (`donDaDongBang` chỉ so cước).
- **Không thu thêm gì trên duty** (spec §2.4).
- **Kỳ cước = `shipped_at`; điều kiện vào kê = `reconciled`** (spec §2.1–2.2): gom `shipped_at ≤ end`, `statement_id IS NULL`, `reconciled`; "Chờ hoá đơn" = `shipped_at ∈ [start,end]` chưa reconciled, chỉ hiển thị. `giaThuBangKe` không còn nhánh giá báo.
- **Kỳ duty = `carrier_bills.issue_date`** (thiếu → `period_start`) (spec §2.3): gom dòng duty của hoá đơn trong kỳ, `duty_statement_id IS NULL`.
- **Sự kiện MMP** (spec §5): `order.reconciled.data` thêm `dutyVnd`, `totalWithDutyVnd`, `shippedAt`; `order.duty_charged { dutyVnd, addedVnd, fedexInvoiceNumber, invoiceDate, shippedAt, trackingNumber, note }` khoá `(mmpRef, fedexInvoiceNumber)`; `statement.issued/paid` cấp brand (`code = mmpRef = brandSlug`), là bản đối soát; `order.shipped_at { shippedAt }` backfill một lần.
- **Công tắc `MMP_TACH_DUTY`**: chưa `=1` → `finalChargedVnd` gửi MMP = cước + duty (nghĩa cũ), không bắn `order.duty_charged`; `=1` → cước, kèm `dutyVnd`, bắn `duty_charged`. Cột trong DB tách **ngay** bất kể công tắc.
- **Chuyển đổi dữ liệu** (spec §7): 61 đơn có duty; 3 bảng kê đều nháp; bảng kê Kalisa `0dcc5f5c` xoá, tạo lại T7 (01–31/07) và T8 (01–31/08) loại `freight`.
- **Quy ước repo:** tiếng Việt tên hàm/ghi chú mới; `sql` template với mảng JS dùng `IN ${arr}` không `= ANY`; file `'use server'` chỉ export hàm async; không top-level await trong `scripts/`; migration = file SQL trong `db/migrations/` áp bằng script `sql.raw` (journal drizzle không cập nhật từ 0139 — theo nếp hiện tại); `npx tsc --noEmit && npx vitest run` xanh trước mỗi push (hook); commit kết bằng `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; làm trên `main`.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `db/migrations/0147_tach-duty.sql`, `db/schema.ts` | Cột mới trên `ship_ho_orders`; enum + cột `type` trên `ship_ho_statements` |
| `features/ship-ho/reconcile-charge.ts` (+test) | Cước thực không gồm duty |
| `features/ship-ho/gia-cuoi-mmp.ts` (+test) | Thuần: `giaCuoiChoMmp(cuoc, duty, shippedAt, batTach)` → payload `order.reconciled` theo công tắc |
| `features/ship-ho/carrier-invoice-lookup.ts` | `getDutyLinesByTracking(tracking)` → dòng duty kèm số hoá đơn, ngày hoá đơn |
| `features/ship-ho/duty.ts` (+test) | Thuần `tinhDutyMoi`; DB `ghiDutyChoDon` + bắn `order.duty_charged` |
| `features/ship-ho/reconcile-actions.ts`, `reconcile-decision-actions.ts` | Ghi cước riêng, gọi `ghiDutyChoDon`, payload qua `giaCuoiChoMmp` |
| `features/ship-ho/statement-logic.ts` (+test) | `giaThuBangKe` reconciled-only; `LoaiBangKe`; `tomTatBangKe` |
| `features/ship-ho/statement-core.ts`, `statement-actions.ts`, `statement-queries.ts` | Gom/tính lại theo `type`; chờ hoá đơn; dòng duty kèm hoá đơn; công nợ tách loại |
| `features/ship-ho/statement-push.ts` (+test) | Payload + push `statement.issued/paid` cấp brand (mẫu `ratecard-push.ts`) |
| `features/ship-ho/statement-export-action.ts`, `app/(dashboard)/f/ship-ho/statements/StatementsManager.tsx` | Chọn loại, cột Loại/Mốc, chờ hoá đơn, xuất xlsx hai loại |
| `docs/integrations/mmp-ship-ho-api.md` | Hợp đồng §5 |
| `scripts/chuyen-doi/tach-duty.ts` | Bóc duty khỏi 61 đơn; tính lại nháp; tách kê Kalisa T7/T8 (`--dry`) |
| `scripts/chuyen-doi/backfill-shipped-at-mmp.ts` | Bắn `order.shipped_at` theo danh sách MMP (`--dry`) |
| `scripts/chuyen-doi/ban-lai-tach-duty.ts` | Khi bật công tắc: bắn lại `order.reconciled` + `duty_charged` cho đơn đã gửi kiểu cũ (`--dry`) |

---

### Task 1: Migration + schema

**Files:**
- Create: `db/migrations/0147_tach-duty.sql`
- Modify: `db/schema.ts` (`shipHoStatements` ~2149, `shipHoOrders` gần `statementId` ~2242)

**Interfaces:**
- Produces: `schema.shipHoOrders.actualDutyVnd` (numeric string|null), `.dutyBillNumbers` (string[]|null), `.dutyStatementId`; `schema.shipHoStatements.type` (`'freight'|'duty'`); `shipHoStatementTypeEnum`.

- [ ] **Bước 1: SQL**

```sql
-- db/migrations/0147_tach-duty.sql
-- Tách thuế/phí nhập khẩu (duty) khỏi cước ship hộ (spec 2026-09-21).
DO $$ BEGIN
  CREATE TYPE ship_ho_statement_type AS ENUM ('freight', 'duty');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE ship_ho_statements ADD COLUMN IF NOT EXISTS type ship_ho_statement_type NOT NULL DEFAULT 'freight';
ALTER TABLE ship_ho_orders ADD COLUMN IF NOT EXISTS actual_duty_vnd numeric(14,2);
ALTER TABLE ship_ho_orders ADD COLUMN IF NOT EXISTS duty_bill_numbers text[];
ALTER TABLE ship_ho_orders ADD COLUMN IF NOT EXISTS duty_statement_id uuid REFERENCES ship_ho_statements(id);
CREATE INDEX IF NOT EXISTS ship_ho_orders_duty_statement_idx ON ship_ho_orders(duty_statement_id);
```

- [ ] **Bước 2: schema.ts** — cạnh `shipHoStatementStatusEnum` (dòng ~2093):

```ts
export const shipHoStatementTypeEnum = pgEnum('ship_ho_statement_type', ['freight', 'duty']);
```

Trong `shipHoStatements` sau `status`:

```ts
  /** freight = cước (kỳ theo ngày gửi); duty = thuế/phí NK thu hộ (kỳ theo ngày hoá đơn FedEx). Spec 21/09/2026. */
  type: shipHoStatementTypeEnum('type').notNull().default('freight'),
```

Trong `shipHoOrders` ngay sau `statementId`:

```ts
  /** Duty FedEx ứng hộ, cộng dồn từ carrier_bill_lines.duty theo mã vận đơn. NULL = chưa có hoá đơn duty. Không nằm trong actual_charged_vnd. */
  actualDutyVnd: numeric('actual_duty_vnd', { precision: 14, scale: 2 }),
  /** Số hoá đơn FedEx đã cộng vào actual_duty_vnd — hoá đơn mới về mới cộng thêm. */
  dutyBillNumbers: text('duty_bill_numbers').array(),
  /** Bảng kê duty đơn thuộc về (khác statement_id = bảng kê cước). */
  dutyStatementId: uuid('duty_statement_id').references(() => shipHoStatements.id),
```

- [ ] **Bước 3: Áp lên prod** — tạo tạm `scripts/_mig.ts`:

```ts
import { readFileSync } from 'node:fs';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
async function main() {
  await db.execute(sql.raw(readFileSync('db/migrations/0147_tach-duty.sql', 'utf8')));
  const r: any = await db.execute(sql`select column_name from information_schema.columns where table_name in ('ship_ho_orders','ship_ho_statements') and column_name in ('actual_duty_vnd','duty_bill_numbers','duty_statement_id','type') order by 1`);
  console.log(r.rows);
  process.exit(0);
}
main();
```

Run: `npx tsx --env-file=.env scripts/_mig.ts` → 4 dòng. Xoá `scripts/_mig.ts`.

- [ ] **Bước 4: Kiểm + commit**

Run: `npx tsc --noEmit` → sạch.

```bash
git add db/migrations/0147_tach-duty.sql db/schema.ts
git commit -m "feat(ship-ho): cột duty riêng trên đơn, loại bảng kê freight/duty

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Cước thực không gồm duty + payload MMP theo công tắc

**Files:**
- Modify: `features/ship-ho/reconcile-charge.ts:56-71`
- Modify: `features/ship-ho/reconcile-charge.test.ts`
- Create: `features/ship-ho/gia-cuoi-mmp.ts`, `features/ship-ho/gia-cuoi-mmp.test.ts`

**Interfaces:**
- Produces: `reconciledBrandCharge(i).chargedVnd` không gồm duty, `.dutyVnd` giữ; `batTachDuty(env?: string): boolean`; `giaCuoiChoMmp(i: { cuocVnd: number; dutyVnd: number | null; shippedAt: string | null }, bat = batTachDuty()): { finalChargedVnd: number; dutyVnd?: number; totalWithDutyVnd?: number; shippedAt: string | null }`.

- [ ] **Bước 1: Test đỏ — reconcile-charge** (append vào describe hiện có):

```ts
  it('duty KHÔNG nằm trong chargedVnd, không có dòng duty; dutyVnd trả riêng (spec tách duty 21/09)', () => {
    const khong = reconciledBrandCharge({ ...base, customsSurchargesVnd: 68_300 });
    const co = reconciledBrandCharge({ ...base, customsSurchargesVnd: 68_300, dutyVnd: 736_241 });
    expect(co.chargedVnd).toBe(khong.chargedVnd);
    expect(co.dutyVnd).toBe(736_241);
    expect(co.lines.some((l) => l.label.includes('Thuế'))).toBe(false);
    expect(co.lines.reduce((s, l) => s + l.amountVnd, 0)).toBe(co.chargedVnd);
  });
```

Run: `npx vitest run features/ship-ho/reconcile-charge.test.ts` → test mới FAIL (`chargedVnd` chênh 736.241).

- [ ] **Bước 2: Sửa `reconciledBrandCharge`** — dòng `const chargedVnd = vatBase + vat + duty;` → `const chargedVnd = vatBase + vat;`; xoá dòng `if (duty > 0) lines.push({ label: 'Thuế/hải quan (theo bill)', … })`; sửa doc đầu file: thêm câu "Duty KHÔNG nằm trong chargedVnd (tách 21/09/2026) — trả `dutyVnd` để caller ghi cột riêng." Giữ `dutyVnd: duty` trong return.

Run: test → PASS toàn file.

- [ ] **Bước 3: Test đỏ — gia-cuoi-mmp**

```ts
// features/ship-ho/gia-cuoi-mmp.test.ts
import { describe, it, expect } from 'vitest';
import { batTachDuty, giaCuoiChoMmp } from './gia-cuoi-mmp';

describe('batTachDuty', () => {
  it('"1" → bật; khác → tắt', () => {
    expect(batTachDuty('1')).toBe(true);
    expect(batTachDuty('')).toBe(false);
    expect(batTachDuty(undefined)).toBe(false);
  });
});

describe('giaCuoiChoMmp', () => {
  const i = { cuocVnd: 1_567_050, dutyVnd: 736_241, shippedAt: '2026-07-06' };
  it('công tắc TẮT → finalChargedVnd = cước + duty (nghĩa cũ), KHÔNG có dutyVnd, vẫn có shippedAt', () => {
    expect(giaCuoiChoMmp(i, false)).toEqual({ finalChargedVnd: 2_303_291, shippedAt: '2026-07-06' });
  });
  it('công tắc BẬT → finalChargedVnd = cước, kèm dutyVnd và totalWithDutyVnd', () => {
    expect(giaCuoiChoMmp(i, true)).toEqual({ finalChargedVnd: 1_567_050, dutyVnd: 736_241, totalWithDutyVnd: 2_303_291, shippedAt: '2026-07-06' });
  });
  it('chưa có duty → 0', () => {
    expect(giaCuoiChoMmp({ ...i, dutyVnd: null }, true).dutyVnd).toBe(0);
    expect(giaCuoiChoMmp({ ...i, dutyVnd: null }, false).finalChargedVnd).toBe(1_567_050);
  });
});
```

Run → FAIL (module không tồn tại).

- [ ] **Bước 4: Viết `gia-cuoi-mmp.ts`**

```ts
/**
 * THUẦN: dựng phần giá trong `order.reconciled` gửi MMP theo công tắc MMP_TACH_DUTY.
 *
 * Cột DB đã tách cước/duty từ 21/09/2026, nhưng MMP đổi hợp đồng theo ngày hẹn: trước ngày
 * đó `finalChargedVnd` vẫn phải = cước + duty (nghĩa cũ), không thì kỳ 07/08 MMP đã khoá
 * lệch. Bật `1` → cước riêng, kèm `dutyVnd`; sự kiện KHÔNG có `dutyVnd` là bản cũ.
 */
export const batTachDuty = (env: string | undefined = process.env.MMP_TACH_DUTY): boolean => env === '1';

export interface GiaCuoiMmp {
  finalChargedVnd: number;
  dutyVnd?: number;
  totalWithDutyVnd?: number;
  /** Mốc xếp kỳ cước phía MMP (spec §2.1). */
  shippedAt: string | null;
}

export function giaCuoiChoMmp(
  i: { cuocVnd: number; dutyVnd: number | null; shippedAt: string | null },
  bat: boolean = batTachDuty(),
): GiaCuoiMmp {
  const duty = Math.round(i.dutyVnd ?? 0);
  const cuoc = Math.round(i.cuocVnd);
  if (!bat) return { finalChargedVnd: cuoc + duty, shippedAt: i.shippedAt };
  return { finalChargedVnd: cuoc, dutyVnd: duty, totalWithDutyVnd: cuoc + duty, shippedAt: i.shippedAt };
}
```

Run: `npx vitest run features/ship-ho/gia-cuoi-mmp.test.ts features/ship-ho/reconcile-charge.test.ts` → PASS.

- [ ] **Bước 5: Commit**

```bash
git add features/ship-ho/reconcile-charge.ts features/ship-ho/reconcile-charge.test.ts features/ship-ho/gia-cuoi-mmp.ts features/ship-ho/gia-cuoi-mmp.test.ts
git commit -m "feat(ship-ho): cước thực không gồm duty; payload giá cuối MMP theo công tắc MMP_TACH_DUTY

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Ghi duty cho đơn + bắn `order.duty_charged`

**Files:**
- Modify: `features/ship-ho/carrier-invoice-lookup.ts` (thêm hàm cuối file)
- Create: `features/ship-ho/duty.ts`, `features/ship-ho/duty.test.ts`

**Interfaces:**
- Consumes: `emitShipHoEvent(order, event, data)` (`./mmp-events`), `batTachDuty` (Task 2), `schema.shipHoOrders.actualDutyVnd/dutyBillNumbers` (Task 1).
- Produces:

```ts
export interface DongDuty { billNumber: string; issueDate: string; dutyVnd: number }
export async function getDutyLinesByTracking(trackingNumber: string): Promise<DongDuty[]>;   // carrier-invoice-lookup.ts
export function tinhDutyMoi(dong: readonly DongDuty[], daCong: readonly string[]): { tong: number; moi: DongDuty[]; billNumbers: string[] };
export async function ghiDutyChoDon(order: { id: string; code: string; source: string; mmpRef: string | null; trackingNumber: string | null; shippedAt: string | null; actualDutyVnd: string | null; dutyBillNumbers: string[] | null }): Promise<{ daGhi: boolean; tong: number; moi: number }>;
```

- [ ] **Bước 1: Test đỏ `duty.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { tinhDutyMoi, type DongDuty } from './duty';

const d = (billNumber: string, dutyVnd: number, issueDate = '2026-08-20'): DongDuty => ({ billNumber, issueDate, dutyVnd });

describe('tinhDutyMoi', () => {
  it('cộng dồn mọi dòng; billNumbers = tất cả hoá đơn', () => {
    const r = tinhDutyMoi([d('736059786', 325_901), d('736060188', 100_000)], []);
    expect(r.tong).toBe(425_901);
    expect(r.moi.map((x) => x.billNumber)).toEqual(['736059786', '736060188']);
    expect(r.billNumbers).toEqual(['736059786', '736060188']);
  });
  it('hoá đơn đã cộng không tính là MỚI nhưng vẫn nằm trong tổng (tổng = sự thật hiện tại)', () => {
    const r = tinhDutyMoi([d('736059786', 325_901), d('736060188', 100_000)], ['736059786']);
    expect(r.tong).toBe(425_901);
    expect(r.moi.map((x) => x.billNumber)).toEqual(['736060188']);
  });
  it('cùng số hoá đơn gửi lại số khác → ghi đè (tổng theo số mới), coi là MỚI để bắn lại MMP', () => {
    const r = tinhDutyMoi([d('736059786', 300_000)], ['736059786']);
    expect(r.tong).toBe(300_000);
    expect(r.moi).toHaveLength(0); // cùng số hoá đơn, đã cộng → không bắn lại; ghi đè chỉ khi tổng đổi (ghiDutyChoDon so tổng)
  });
  it('dòng duty 0 bỏ qua; không dòng nào → tổng 0, không mới', () => {
    expect(tinhDutyMoi([d('x', 0)], [])).toEqual({ tong: 0, moi: [], billNumbers: [] });
  });
});
```

Run → FAIL (module không tồn tại).

- [ ] **Bước 2: `getDutyLinesByTracking`** — append vào `carrier-invoice-lookup.ts`:

```ts
export interface DongDuty { billNumber: string; issueDate: string; dutyVnd: number }

/** Dòng DUTY (thuế/phí NK FedEx ứng hộ) của một mã vận đơn, kèm số + ngày hoá đơn — nguồn
 *  cho cột actual_duty_vnd và bảng kê duty (spec 21/09/2026). Ngày hoá đơn: issue_date, thiếu
 *  thì period_start. Quy về VND cùng cách với cước. */
export async function getDutyLinesByTracking(trackingNumber: string): Promise<DongDuty[]> {
  if (!trackingNumber) return [];
  const rows = await db
    .select({
      duty: schema.carrierBillLines.duty,
      billNumber: schema.carrierBills.billNumber,
      issueDate: sql<string>`coalesce(${schema.carrierBills.issueDate}, ${schema.carrierBills.periodStart})::text`,
      costCurrency: schema.carrierAccounts.costCurrency,
      displayCurrency: schema.carrierAccounts.displayCurrency,
      fx: schema.carrierAccounts.fxCostPerDisplay,
    })
    .from(schema.carrierBillLines)
    .innerJoin(schema.carrierBills, eq(schema.carrierBills.id, schema.carrierBillLines.billId))
    .innerJoin(schema.carrierAccounts, eq(schema.carrierAccounts.id, schema.carrierBills.carrierAccountId))
    .where(and(eq(schema.carrierBillLines.trackingNumber, trackingNumber), sql`${schema.carrierBillLines.duty} > 0`))
    .orderBy(schema.carrierBills.periodStart);
  const out: DongDuty[] = [];
  for (const r of rows) {
    const factor = costToVndFactor(r.costCurrency, r.displayCurrency, Number(r.fx));
    if (factor == null || !r.billNumber) continue;
    out.push({ billNumber: r.billNumber, issueDate: r.issueDate, dutyVnd: Math.round(Number(r.duty) * factor) });
  }
  return out;
}
```

- [ ] **Bước 3: `duty.ts`**

```ts
/**
 * Duty (thuế/phí nhập khẩu FedEx ứng hộ) của đơn ship hộ — cột RIÊNG, độc lập với đối soát
 * cước (spec 2026-09-21 §4.2). Thu nguyên giá: không markup, không nhiên liệu, không VAT.
 *
 * Hoá đơn duty về sau cước 3–6 tuần, có thể nhiều hoá đơn một đơn. Cộng dồn theo SỐ hoá đơn:
 * hoá đơn đã trong `duty_bill_numbers` không coi là mới; tổng luôn tính lại từ toàn bộ dòng
 * hiện có (FedEx sửa số trên cùng hoá đơn → tổng đổi → ghi đè, bắn lại với cùng số hoá đơn).
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getDutyLinesByTracking, type DongDuty } from './carrier-invoice-lookup';
import { emitShipHoEvent, type ShipHoEmitOrder } from './mmp-events';
import { batTachDuty } from './gia-cuoi-mmp';

export type { DongDuty };

export const GHI_CHU_DUTY = 'Thuế/phí nhập khẩu FedEx ứng hộ, thu đúng nguyên giá, không markup/VAT';

export function tinhDutyMoi(dong: readonly DongDuty[], daCong: readonly string[]): { tong: number; moi: DongDuty[]; billNumbers: string[] } {
  const co = dong.filter((d) => d.dutyVnd > 0);
  const tong = co.reduce((s, d) => s + d.dutyVnd, 0);
  const moi = co.filter((d) => !daCong.includes(d.billNumber));
  return { tong, moi, billNumbers: [...new Set(co.map((d) => d.billNumber))] };
}

export interface DonChoDuty extends ShipHoEmitOrder {
  trackingNumber: string | null; shippedAt: string | null;
  actualDutyVnd: string | null; dutyBillNumbers: string[] | null;
}

/** Đọc dòng duty của đơn, ghi cột, bắn `order.duty_charged` cho hoá đơn mới (hoặc tổng đổi). */
export async function ghiDutyChoDon(o: DonChoDuty): Promise<{ daGhi: boolean; tong: number; moi: number }> {
  if (!o.trackingNumber) return { daGhi: false, tong: 0, moi: 0 };
  const dong = await getDutyLinesByTracking(o.trackingNumber);
  const { tong, moi, billNumbers } = tinhDutyMoi(dong, o.dutyBillNumbers ?? []);
  const cu = o.actualDutyVnd == null ? null : Math.round(Number(o.actualDutyVnd));
  if (dong.length === 0 && cu == null) return { daGhi: false, tong: 0, moi: 0 };
  const tongDoi = cu !== tong;
  if (!tongDoi && moi.length === 0) return { daGhi: false, tong, moi: 0 };

  await db.update(schema.shipHoOrders)
    .set({ actualDutyVnd: String(tong), dutyBillNumbers: billNumbers, updatedAt: sql`now()` } as Record<string, unknown>)
    .where(eq(schema.shipHoOrders.id, o.id));

  // Bắn từng hoá đơn MỚI; tổng đổi mà không có hoá đơn mới (FedEx sửa số) → bắn lại hoá đơn cuối.
  if (batTachDuty()) {
    const canBan = moi.length > 0 ? moi : dong.slice(-1);
    for (const d of canBan) {
      await emitShipHoEvent(o, 'order.duty_charged', {
        dutyVnd: tong, addedVnd: d.dutyVnd, fedexInvoiceNumber: d.billNumber, invoiceDate: d.issueDate,
        shippedAt: o.shippedAt, trackingNumber: o.trackingNumber, note: GHI_CHU_DUTY,
      });
    }
  }
  return { daGhi: true, tong, moi: moi.length };
}
```

(Nếu `shipHoOrders` không có `updatedAt`, bỏ trường đó khỏi `set`.)

Run: `npx vitest run features/ship-ho/duty.test.ts && npx tsc --noEmit` → PASS, sạch.

- [ ] **Bước 4: Commit**

```bash
git add features/ship-ho/carrier-invoice-lookup.ts features/ship-ho/duty.ts features/ship-ho/duty.test.ts
git commit -m "feat(ship-ho): ghi duty cột riêng theo số hoá đơn FedEx, bắn order.duty_charged

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Đối soát ghi cước riêng, gọi duty, payload MMP mới

**Files:**
- Modify: `features/ship-ho/reconcile-actions.ts:119-135` (select), `:150-160` (vòng lặp đầu), `:230-245` (sellBreakdown), `:283-300` (payload)
- Modify: `features/ship-ho/reconcile-decision-actions.ts:39-70`, `:107-135` và `loadOrderForDecision`

**Interfaces:**
- Consumes: `ghiDutyChoDon` (Task 3), `giaCuoiChoMmp` (Task 2).

- [ ] **Bước 1: `reconcile-actions.ts` — select thêm cột**: trong `db.select({...})` của `reconcileShipHoFromCarrierBillsCore` thêm `trackingNumber` (đã có), `actualDutyVnd: schema.shipHoOrders.actualDutyVnd`, `dutyBillNumbers: schema.shipHoOrders.dutyBillNumbers`.

- [ ] **Bước 2: Gọi duty cho MỌI đơn có tracking, TRƯỚC các `continue`** — ngay sau `const billed = await getBilledByTracking(o.trackingNumber ?? '');` chèn:

```ts
    // Duty độc lập với cước (spec 21/09): ghi kể cả khi bill cước chưa về hay đơn đã đóng băng.
    const duty = await ghiDutyChoDon({ id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef,
      trackingNumber: o.trackingNumber, shippedAt: o.shippedAt, actualDutyVnd: o.actualDutyVnd, dutyBillNumbers: o.dutyBillNumbers });
    if (duty.daGhi) summary.dutyGhi = (summary.dutyGhi ?? 0) + 1;
```

Thêm `dutyGhi?: number` vào `RebillSummary`. Import `ghiDutyChoDon` từ `./duty`, `giaCuoiChoMmp` từ `./gia-cuoi-mmp`.

- [ ] **Bước 3: sellBreakdown và payload** — `sellBreakdown.chargedVnd: rc.chargedVnd` giờ tự là cước (Task 2). Thay khối bắn `order.reconciled`:

```ts
    const finalCuoc = actualChargedVnd ?? quotedCharged;
    if (shouldEmitCharge && finalCuoc != null) {
      await banGiaCuoiNeuDoi(
        { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
        {
          ...giaCuoiChoMmp({ cuocVnd: finalCuoc, dutyVnd: duty.tong, shippedAt: o.shippedAt }),
          previousChargedVnd: quotedCharged,
          deltaVnd: quotedCharged == null ? null : finalCuoc - quotedCharged,
          billedWeightKg: kgToStore,
          scaleWeightKg: billed.weightKg,
        },
        daGuiTheoDon.get(o.id) ?? null,
      );
    }
```

`nenBanGiaCuoi` so `finalChargedVnd` → khi công tắc tắt, số không đổi so với trước → không bắn lại; khi bật, số giảm → bắn lại (đúng ý §5 chuyển tiếp).

- [ ] **Bước 4: `reconcile-decision-actions.ts`** — `loadOrderForDecision` select thêm `actualDutyVnd`, `shippedAt`. Ở `acceptShipHoDiscrepancy` và `resolveShipHoClaim`, thay object payload:

```ts
      {
        ...giaCuoiChoMmp({ cuocVnd: finalChargedVnd, dutyVnd: o.actualDutyVnd == null ? null : Number(o.actualDutyVnd), shippedAt: o.shippedAt }),
        previousChargedVnd: quoted,
        deltaVnd: quoted == null ? null : finalChargedVnd - quoted,
        reconcileResolution: 'internal_error', // hoặc `decision` ở resolveShipHoClaim
      },
```

- [ ] **Bước 5: Kiểm**

Run: `npx tsc --noEmit && npx vitest run features/ship-ho` → sạch/PASS. Chạy thử cron core một lượt trên prod với công tắc TẮT để chắc không bắn `order.reconciled` mới cho đơn đã gửi (số không đổi):

```ts
// scripts/_thu.ts (tạm, xoá sau)
import { reconcileShipHoFromCarrierBillsCore } from '@/features/ship-ho/reconcile-actions';
async function main() { console.log(await reconcileShipHoFromCarrierBillsCore()); process.exit(0); }
main();
```

Run: `railway run --service Shopify-Management-System npx tsx scripts/_thu.ts` → kỳ vọng `requoted` bằng lượt trước, `dutyGhi ≈ 61`, và `select count(*) from ship_ho_order_events where event='order.reconciled' and occurred_at > now() - interval '10 minutes'` = 0. Ghi số vào báo cáo. Xoá `scripts/_thu.ts`.

- [ ] **Bước 6: Commit**

```bash
git add features/ship-ho/reconcile-actions.ts features/ship-ho/reconcile-decision-actions.ts
git commit -m "feat(ship-ho): đối soát ghi cước và duty hai cột riêng; payload MMP qua giaCuoiChoMmp

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Bảng kê hai loại — luật gom, tính lại, sự kiện cấp brand

**Files:**
- Modify: `features/ship-ho/statement-logic.ts` (+test), `statement-core.ts`, `statement-actions.ts`, `statement-queries.ts`
- Create: `features/ship-ho/statement-push.ts`, `features/ship-ho/statement-push.test.ts`

**Interfaces:**
- Produces:

```ts
export type LoaiBangKe = 'freight' | 'duty';
export function giaThuBangKe(o: { actualChargedVnd: string|number|null; reconcileStatus: string|null }): number | null; // chỉ giá thực
export async function generateStatement(partnerBrandSlug: string, type: LoaiBangKe, periodStart: string, periodEnd: string, opts?: { dryRun?: boolean }): Promise<{ ok; error?; statementId?; orderCount; totalChargedVnd; dryRun; choHoaDon: number }>;
export async function tinhLaiTongBangKe(id: string): Promise<{ ok; error?; orderCount; totalChargedVnd; truoc? }>; // theo type
export async function getShipHoStatement(id: string): Promise<{ statement; orders: DongBangKe[]; choHoaDon: DongChoHoaDon[] } | null>;
export function payloadStatementIssued(st, dong): Record<string, unknown>;  // statement-push.ts
export async function pushStatementEvent(event: 'statement.issued'|'statement.paid', brandSlug: string, data: Record<string, unknown>): Promise<{ ok: boolean; detail: string }>;
```

- [ ] **Bước 1: Test đỏ `statement-logic.test.ts`** — thay describe `giaThuBangKe` bằng:

```ts
describe('giaThuBangKe — bảng kê CHỈ thu giá thực đã chốt (CEO 21/09, bỏ luật 08/09)', () => {
  it('reconciled + có giá thực → giá thực', () => {
    expect(giaThuBangKe({ actualChargedVnd: '3021319', reconcileStatus: 'reconciled' })).toBe(3021319);
  });
  it('chưa reconciled → null dù có actualChargedVnd sót', () => {
    expect(giaThuBangKe({ actualChargedVnd: '3021319', reconcileStatus: null })).toBeNull();
  });
  it('reconciled nhưng chưa tính được giá thực → null (không lấy giá báo)', () => {
    expect(giaThuBangKe({ actualChargedVnd: null, reconcileStatus: 'reconciled' })).toBeNull();
  });
});
```

Run → FAIL.

- [ ] **Bước 2: `statement-logic.ts`**

```ts
export type LoaiBangKe = 'freight' | 'duty';

/** THUẦN: giá đưa vào bảng kê CƯỚC — chỉ giá thực đã chốt đối soát (CEO 21/09/2026). Chưa chốt → null → đơn ở mục "Chờ hoá đơn". */
export function giaThuBangKe(o: { actualChargedVnd: string | number | null; reconcileStatus: string | null }): number | null {
  if (o.reconcileStatus !== 'reconciled' || o.actualChargedVnd == null) return null;
  const v = Number(o.actualChargedVnd);
  return Number.isFinite(v) ? v : null;
}
```

Giữ `summarizeStatement`. Sửa mọi caller còn truyền `chargedVnd` (tsc chỉ ra).

- [ ] **Bước 3: `statement-actions.ts` — `generateStatement`** thay toàn bộ phần chọn đơn:

```ts
export async function generateStatement(
  partnerBrandSlug: string, type: LoaiBangKe, periodStart: string, periodEnd: string, opts?: { dryRun?: boolean },
): Promise<{ ok: boolean; error?: string; statementId?: string; orderCount: number; totalChargedVnd: number; dryRun: boolean; choHoaDon: number }> {
  const dryRun = opts?.dryRun ?? false;
  const rong = { orderCount: 0, totalChargedVnd: 0, dryRun, choHoaDon: 0 };
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e), ...rong }; }
  if (!partnerBrandSlug) return { ok: false, error: 'Thiếu partner', ...rong };
  if (!periodStart || !periodEnd) return { ok: false, error: 'Thiếu kỳ', ...rong };

  let ids: string[] = []; let tien: number[] = []; let choHoaDon = 0;
  if (type === 'freight') {
    // Kỳ theo NGÀY GỬI; vào kê khi Đức đã chốt đối soát. shipped_at ≤ end (không chặn start) để đơn kỳ trước chốt muộn rơi vào kỳ này.
    const rows = await db.execute<{ id: string; gia: string | null; cho: boolean }>(sql`
      SELECT id, CASE WHEN reconcile_status = 'reconciled' THEN actual_charged_vnd END AS gia,
             (reconcile_status IS DISTINCT FROM 'reconciled' AND shipped_at >= ${periodStart}) AS cho
        FROM ship_ho_orders
       WHERE partner_brand_slug = ${partnerBrandSlug} AND statement_id IS NULL
         AND status IN ('shipped','delivered') AND shipped_at IS NOT NULL AND shipped_at <= ${periodEnd}
         AND NOT (COALESCE(ly_do_cham,'') = 'khong_gui_hang' AND COALESCE(ly_do_doi_chieu,'') = 'xac_nhan')`);
    for (const r of rows.rows) {
      if (r.gia != null) { ids.push(r.id); tien.push(Number(r.gia)); }
      else if (r.cho) choHoaDon++;
    }
  } else {
    // Kỳ theo NGÀY HOÁ ĐƠN FedEx: đơn có dòng duty của hoá đơn trong kỳ, chưa vào kê duty.
    const rows = await db.execute<{ id: string; gia: string }>(sql`
      SELECT o.id, o.actual_duty_vnd AS gia
        FROM ship_ho_orders o
       WHERE o.partner_brand_slug = ${partnerBrandSlug} AND o.duty_statement_id IS NULL AND o.actual_duty_vnd > 0
         AND EXISTS (SELECT 1 FROM carrier_bill_lines l JOIN carrier_bills b ON b.id = l.bill_id
                      WHERE l.tracking_number = o.tracking_number AND l.duty > 0
                        AND COALESCE(b.issue_date, b.period_start) BETWEEN ${periodStart} AND ${periodEnd})`);
    for (const r of rows.rows) { ids.push(r.id); tien.push(Number(r.gia)); }
  }
  const sums = summarizeStatement(tien);
  if (dryRun || ids.length === 0) return { ok: true, ...sums, dryRun, choHoaDon };

  const [st] = await db.insert(schema.shipHoStatements).values({
    partnerBrandSlug, type, periodStart, periodEnd, orderCount: sums.orderCount, totalChargedVnd: String(sums.totalChargedVnd), status: 'draft',
  }).returning({ id: schema.shipHoStatements.id });
  if (type === 'freight') {
    await db.update(schema.shipHoOrders).set({ statementId: st.id, status: 'billed' }).where(inArray(schema.shipHoOrders.id, ids));
  } else {
    await db.update(schema.shipHoOrders).set({ dutyStatementId: st.id }).where(inArray(schema.shipHoOrders.id, ids));
  }
  revalidatePath('/f/ship-ho/statements');
  return { ok: true, statementId: st.id, ...sums, dryRun, choHoaDon };
}
```

Bỏ import `giaThuBangKe` nếu không còn dùng ở đây.

- [ ] **Bước 4: `statement-core.ts` — `tinhLaiTongBangKe` theo type**

```ts
export async function tinhLaiTongBangKe(id: string) {
  const [st] = await db.select({ status: schema.shipHoStatements.status, type: schema.shipHoStatements.type, total: schema.shipHoStatements.totalChargedVnd })
    .from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
  if (!st) return { ok: false, error: 'Không tìm thấy bảng kê', orderCount: 0, totalChargedVnd: 0 };
  if (st.status !== 'draft') return { ok: false, error: 'Bảng kê đã gửi/đã thu — không tính lại', orderCount: 0, totalChargedVnd: 0 };
  const tien: number[] = [];
  if (st.type === 'freight') {
    const orders = await db.select({ actualChargedVnd: schema.shipHoOrders.actualChargedVnd, reconcileStatus: schema.shipHoOrders.reconcileStatus })
      .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.statementId, id));
    for (const o of orders) { const g = giaThuBangKe(o); if (g != null) tien.push(g); }
  } else {
    const orders = await db.select({ duty: schema.shipHoOrders.actualDutyVnd }).from(schema.shipHoOrders).where(eq(schema.shipHoOrders.dutyStatementId, id));
    for (const o of orders) if (o.duty != null) tien.push(Number(o.duty));
  }
  const sums = summarizeStatement(tien);
  await db.update(schema.shipHoStatements).set({ orderCount: sums.orderCount, totalChargedVnd: String(sums.totalChargedVnd) }).where(eq(schema.shipHoStatements.id, id));
  return { ok: true, orderCount: sums.orderCount, totalChargedVnd: sums.totalChargedVnd, truoc: Number(st.total) };
}
```

- [ ] **Bước 5: `statement-queries.ts`** — `listShipHoStatements` thêm `type`; `arByPartner` thêm `type` vào select + groupBy (UI cộng hai loại và hiện tách); `getShipHoStatement` trả theo type:

```ts
export async function getShipHoStatement(id: string) {
  const [st] = await db.select().from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
  if (!st) return null;
  if (st.type === 'duty') {
    const { rows } = await db.execute<{ code: string; brandReference: string | null; trackingNumber: string | null; shippedAt: string | null; dutyVnd: string; billNumber: string | null; issueDate: string | null }>(sql`
      SELECT o.code, o.brand_reference AS "brandReference", o.tracking_number AS "trackingNumber", o.shipped_at::text AS "shippedAt", o.actual_duty_vnd AS "dutyVnd",
             (SELECT string_agg(b.bill_number, ' + ') FROM carrier_bill_lines l JOIN carrier_bills b ON b.id = l.bill_id WHERE l.tracking_number = o.tracking_number AND l.duty > 0) AS "billNumber",
             (SELECT max(COALESCE(b.issue_date, b.period_start))::text FROM carrier_bill_lines l JOIN carrier_bills b ON b.id = l.bill_id WHERE l.tracking_number = o.tracking_number AND l.duty > 0) AS "issueDate"
        FROM ship_ho_orders o WHERE o.duty_statement_id = ${id} ORDER BY o.shipped_at`);
    return { statement: st, orders: rows.map((r) => ({ ...r, giaThuVnd: Number(r.dutyVnd) })), choHoaDon: [] };
  }
  const orders = await db.select({
      code: schema.shipHoOrders.code, brandReference: schema.shipHoOrders.brandReference, trackingNumber: schema.shipHoOrders.trackingNumber,
      shippedAt: schema.shipHoOrders.shippedAt, country: schema.shipHoOrders.country,
      chargedVnd: schema.shipHoOrders.chargedVnd, actualChargedVnd: schema.shipHoOrders.actualChargedVnd, reconcileStatus: schema.shipHoOrders.reconcileStatus,
      actualCarrierCostVnd: schema.shipHoOrders.actualCarrierCostVnd, marginVnd: schema.shipHoOrders.marginVnd, actualDutyVnd: schema.shipHoOrders.actualDutyVnd,
    }).from(schema.shipHoOrders).where(eq(schema.shipHoOrders.statementId, id)).orderBy(schema.shipHoOrders.shippedAt);
  // Chờ hoá đơn: gửi trong kỳ, chưa chốt, chưa vào kê nào — chỉ hiển thị.
  const choHoaDon = await db.select({ code: schema.shipHoOrders.code, brandReference: schema.shipHoOrders.brandReference, shippedAt: schema.shipHoOrders.shippedAt, chargedVnd: schema.shipHoOrders.chargedVnd })
    .from(schema.shipHoOrders)
    .where(and(eq(schema.shipHoOrders.partnerBrandSlug, st.partnerBrandSlug), isNull(schema.shipHoOrders.statementId),
      sql`${schema.shipHoOrders.reconcileStatus} IS DISTINCT FROM 'reconciled'`,
      sql`${schema.shipHoOrders.shippedAt} BETWEEN ${st.periodStart} AND ${st.periodEnd}`,
      inArray(schema.shipHoOrders.status, ['shipped', 'delivered'] as const)));
  return { statement: st, orders: orders.map((o) => ({ ...o, giaThuVnd: giaThuBangKe(o), theoBill: true })), choHoaDon };
}
```

(Import `and`, `isNull`, `inArray` từ drizzle-orm.)

- [ ] **Bước 6: `statement-push.ts` + test** — mẫu `ratecard-push.ts` (không outbox vì outbox gắn đơn):

```ts
// features/ship-ho/statement-push.test.ts
import { describe, it, expect } from 'vitest';
import { payloadStatementIssued } from './statement-push';

describe('payloadStatementIssued', () => {
  it('tổng orders[].amountVnd = totalVnd; periodBasis theo loại', () => {
    const st = { id: 's1', type: 'freight' as const, periodStart: '2026-07-01', periodEnd: '2026-07-31', partnerBrandSlug: 'kalisa' };
    const p = payloadStatementIssued(st, [
      { code: '26-INSLG-SV-0002', mmpRef: '26-INSLG-SV-0002', brandReference: '#KLS1990', trackingNumber: '873968744599', shippedAt: '2026-07-06', amountVnd: 1_567_050 },
      { code: '26-INSLG-SV-0003', mmpRef: null, brandReference: '#KLS1989', trackingNumber: '873913098571', shippedAt: '2026-07-03', amountVnd: 1_704_470 },
    ]);
    expect(p.totalVnd).toBe(3_271_520);
    expect(p.orderCount).toBe(2);
    expect(p.periodBasis).toBe('shipped_at');
    expect((p.orders as Array<{ mmpRef: string }>)[1].mmpRef).toBe('26-INSLG-SV-0003'); // thiếu mmpRef → dùng code
  });
  it('duty → periodBasis fedex_invoice_date, dòng kèm hoá đơn', () => {
    const p = payloadStatementIssued({ id: 's2', type: 'duty', periodStart: '2026-09-01', periodEnd: '2026-09-30', partnerBrandSlug: 'kalisa' },
      [{ code: 'x', mmpRef: 'x', brandReference: null, trackingNumber: 't', shippedAt: '2026-07-20', amountVnd: 682_298, fedexInvoiceNumber: '736059786', invoiceDate: '2026-08-20' }]);
    expect(p.periodBasis).toBe('fedex_invoice_date');
    expect((p.orders as Array<{ fedexInvoiceNumber: string }>)[0].fedexInvoiceNumber).toBe('736059786');
  });
});
```

```ts
// features/ship-ho/statement-push.ts
/**
 * Sự kiện cấp brand `statement.issued` / `statement.paid` — BẢN ĐỐI SOÁT cho MMP (phương án B,
 * CEO 21/09/2026): MMP so với bảng kê của mình theo (mã đơn, loại) và báo lệch, KHÔNG render cho
 * brand. Không qua outbox (outbox gắn đơn) — best-effort như ratecard-push; kết quả ghi log.
 */
import { signMmpPayload } from '@/features/mmp/hmac';
import type { LoaiBangKe } from './statement-logic';

export interface DongBangKeMmp {
  code: string; mmpRef: string | null; brandReference: string | null; trackingNumber: string | null;
  shippedAt: string | null; amountVnd: number; fedexInvoiceNumber?: string | null; invoiceDate?: string | null;
}
export interface BangKeMmp { id: string; type: LoaiBangKe; periodStart: string; periodEnd: string; partnerBrandSlug: string }

export function payloadStatementIssued(st: BangKeMmp, dong: readonly DongBangKeMmp[]): Record<string, unknown> {
  const orders = dong.map((d) => ({
    code: d.code, mmpRef: d.mmpRef ?? d.code, brandReference: d.brandReference, trackingNumber: d.trackingNumber,
    shippedAt: d.shippedAt, amountVnd: Math.round(d.amountVnd),
    ...(st.type === 'duty' ? { fedexInvoiceNumber: d.fedexInvoiceNumber ?? null, invoiceDate: d.invoiceDate ?? null } : {}),
  }));
  return {
    statementId: st.id, type: st.type, periodStart: st.periodStart, periodEnd: st.periodEnd,
    periodBasis: st.type === 'freight' ? 'shipped_at' : 'fedex_invoice_date',
    orders, orderCount: orders.length, totalVnd: orders.reduce((s, o) => s + o.amountVnd, 0),
  };
}

export async function pushStatementEvent(event: 'statement.issued' | 'statement.paid', brandSlug: string, data: Record<string, unknown>): Promise<{ ok: boolean; detail: string }> {
  const url = process.env.MMP_SHIP_HO_WEBHOOK_URL; const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!url || !secret) return { ok: false, detail: 'chưa cấu hình MMP webhook' };
  const rawBody = JSON.stringify({ event, mmpRef: brandSlug, code: brandSlug, origin: 'sms', occurredAt: new Date().toISOString(), data });
  const ts = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mean-signature': signMmpPayload(secret, ts, rawBody), 'x-mean-timestamp': String(ts) }, body: rawBody, signal: AbortSignal.timeout(10_000) });
    return res.ok ? { ok: true, detail: `http ${res.status}` } : { ok: false, detail: `MMP trả http ${res.status}` };
  } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : 'fetch failed' }; }
}
```

- [ ] **Bước 7: `setStatementStatus` bắn sự kiện** — sau khi update status, với `issued`: đọc `getShipHoStatement(id)`, dựng dòng `DongBangKeMmp` (freight: `amountVnd = giaThuVnd`; duty: `amountVnd = dutyVnd`, kèm `billNumber → fedexInvoiceNumber`, `issueDate`), gọi `pushStatementEvent('statement.issued', st.partnerBrandSlug, payloadStatementIssued(...))`; với `paid`: `pushStatementEvent('statement.paid', slug, { statementId: id, type, paidAt })`. Kết quả push đưa vào return `{ ok: true, mmp: detail }`; lỗi push không chặn đổi trạng thái. Với `paid` loại `freight` giữ luật cũ chuyển đơn sang `settled`; loại `duty` không đổi status đơn.

- [ ] **Bước 8: Kiểm + commit**

Run: `npx tsc --noEmit && npx vitest run features/ship-ho` → sạch/PASS (sửa mọi caller `generateStatement` cũ mà tsc chỉ ra — UI sửa ở Task 6, tạm truyền `'freight'`).

```bash
git add features/ship-ho/statement-logic.ts features/ship-ho/statement-logic.test.ts features/ship-ho/statement-core.ts features/ship-ho/statement-actions.ts features/ship-ho/statement-queries.ts features/ship-ho/statement-push.ts features/ship-ho/statement-push.test.ts
git commit -m "feat(ship-ho): bảng kê hai loại — cước theo ngày gửi (chỉ đơn đã chốt), duty theo ngày hoá đơn FedEx; statement.issued/paid cho MMP

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Giao diện bảng kê + xuất Excel hai loại

**Files:**
- Modify: `app/(dashboard)/f/ship-ho/statements/StatementsManager.tsx`
- Modify: `features/ship-ho/statement-export-action.ts` (giữ; trả kiểu mới từ Task 5)

Đọc `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` trước khi sửa (component là client, gọi server action).

- [ ] **Bước 1: State + form** — thêm `const [loai, setLoai] = useState<'freight' | 'duty'>('freight');` và select trước ô Từ/Đến:

```tsx
          <label className="text-sm">Loại
            <select className="block border rounded px-2 py-1 mt-1" value={loai} onChange={(e) => setLoai(e.target.value as 'freight' | 'duty')}>
              <option value="freight">Cước vận chuyển (kỳ theo ngày gửi)</option>
              <option value="duty">Thuế/phí nhập khẩu thu hộ (kỳ theo ngày hoá đơn FedEx)</option>
            </select>
          </label>
```

`gen`: `generateStatement(partner, loai, from, to, { dryRun })`; thông báo thêm `· ${r.choHoaDon} đơn chờ hoá đơn` khi `loai === 'freight'`.

- [ ] **Bước 2: Danh sách** — kiểu `Statement` thêm `type: 'freight' | 'duty'`; cột "Loại" hiện `Cước` / `Thuế-phí`; tiêu đề cột kỳ đổi title: freight "theo ngày gửi", duty "theo ngày hoá đơn FedEx"; cột Tổng thu bỏ title cũ 08/09, thay "Chỉ đơn đã chốt đối soát (CEO 21/09)". Công nợ: `Ar` thêm `type`; hiển thị mỗi partner một dòng: tổng, kèm `(cước X · thuế-phí Y)`.

- [ ] **Bước 3: Xuất Excel theo loại**

```tsx
  const exportXlsx = (id: string, label: string) =>
    start(async () => {
      const data = await fetchStatementForExport(id);
      if (!data) return;
      const wb = utils.book_new();
      if (data.statement.type === 'duty') {
        const rows = data.orders.map((o) => ({
          'Mã đơn brand': o.brandReference ?? '', 'Mã hệ thống': o.code, 'Mã vận đơn': o.trackingNumber ?? '', 'Ngày gửi': o.shippedAt ?? '',
          'Số hoá đơn FedEx': o.billNumber ?? '', 'Ngày hoá đơn': o.issueDate ?? '', 'Thuế/phí NK thu hộ (VND)': o.giaThuVnd,
        }));
        utils.book_append_sheet(wb, utils.json_to_sheet(rows), 'Thuế-phí thu hộ');
      } else {
        const rows = data.orders.map((o) => ({
          'Mã đơn brand': o.brandReference ?? '', 'Mã hệ thống': o.code, 'Mã vận đơn': o.trackingNumber ?? '', 'Ngày gửi': o.shippedAt ?? '', 'Nước': o.country,
          'Cước thu (VND)': o.giaThuVnd ?? '', 'Giá báo (VND)': o.chargedVnd == null ? '' : Number(o.chargedVnd),
        }));
        utils.book_append_sheet(wb, utils.json_to_sheet(rows), 'Cước');
        if (data.choHoaDon.length) {
          utils.book_append_sheet(wb, utils.json_to_sheet(data.choHoaDon.map((o) => ({
            'Mã đơn brand': o.brandReference ?? '', 'Mã hệ thống': o.code, 'Ngày gửi': o.shippedAt ?? '', 'Giá báo tham khảo (VND)': o.chargedVnd == null ? '' : Number(o.chargedVnd), 'Ghi chú': 'Chờ hoá đơn FedEx — thu ở kỳ sau',
          }))), 'Chờ hoá đơn');
        }
      }
      writeFile(wb, `bang-ke-${data.statement.type === 'duty' ? 'thue-phi' : 'cuoc'}-${label}.xlsx`);
    });
```

(Cột nội bộ Cước thực/Margin bỏ khỏi file gửi brand — brand không được thấy giá vốn; giữ trên màn hình nếu muốn.)

- [ ] **Bước 4: Kiểm bằng mắt** — `npm run dev`, vào `/f/ship-ho/statements`: tạo Xem trước loại Cước cho Kalisa 01–31/07 → kỳ vọng ~36 đơn trừ chưa chốt; loại Thuế-phí 01–30/09 → kỳ vọng vài chục đơn (hoá đơn duty nhập 04–18/09). Không bấm "Tạo" trên prod ở bước này.

Run: `npx tsc --noEmit && npx vitest run` → sạch.

- [ ] **Bước 5: Commit + push**

```bash
git add app/(dashboard)/f/ship-ho/statements/StatementsManager.tsx features/ship-ho/statement-export-action.ts
git commit -m "feat(ship-ho): trang bảng kê chọn loại cước/thuế-phí, mục chờ hoá đơn, xuất Excel theo loại

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

---

### Task 7: Hợp đồng MMP (docs)

**Files:**
- Modify: `docs/integrations/mmp-ship-ho-api.md` (bảng sự kiện dòng ~291–297)

- [ ] **Bước 1: Sửa dòng `order.reconciled`** — thêm vào `data`: `dutyVnd` (0 nếu chưa có hoá đơn duty), `totalWithDutyVnd`, `shippedAt` (mốc xếp kỳ cước — MMP dùng thay `occurredAt`). Ghi: "**Từ ngày bật tách duty (báo trước 1 ngày): `finalChargedVnd` = cước, không gồm duty.** Sự kiện không có `dutyVnd` là bản cũ đã gộp duty."

- [ ] **Bước 2: Thêm ba dòng** sau `order.reconciled` (kết luận claim):

```markdown
| Tài chính | `order.duty_charged` 🆕 | Thuế/phí nhập khẩu FedEx ứng hộ — thu NGUYÊN GIÁ (không markup/nhiên liệu/VAT). Mỗi hoá đơn FedEx một event. `data: { dutyVnd (tổng hiện tại của đơn), addedVnd (khoản của hoá đơn này), fedexInvoiceNumber, invoiceDate (mốc xếp kỳ thuế-phí), shippedAt, trackingNumber, note }`. **Khoá idempotent `(mmpRef, fedexInvoiceNumber)`** — cùng khoá gửi lại là ghi đè (kể cả về 0). Sự kiện tài chính, KHÔNG đổi trạng thái đơn (về sau delivered/reconciled, có thể sau khi MMP đã khoá kỳ). Không có `dutyUsd`/`fxRate`: hoá đơn FedEx VN phát hành bằng VND. |
| Tài chính | `order.shipped_at` 🆕 (một lần) | Backfill mốc kỳ cho đơn đã `reconciled` trước khi `order.reconciled` mang `shippedAt`. `data: { shippedAt }`. Không đổi trạng thái đơn. |
| Bảng kê | `statement.issued` / `statement.paid` | **Bản đối soát nội bộ** (phương án B, 21/09/2026): SMS phát hành bảng kê của mình → MMP so với bảng kê MMP theo `(mã đơn, loại)`, lệch thì báo; **không render cho brand**. `code = mmpRef = brandSlug`. `issued.data: { statementId, type: "freight"|"duty", periodStart, periodEnd, periodBasis: "shipped_at"|"fedex_invoice_date", orders: [{ code, mmpRef, brandReference, trackingNumber, shippedAt, amountVnd, fedexInvoiceNumber?, invoiceDate? }], orderCount, totalVnd }`. `paid.data: { statementId, type, paidAt }`. |
```

- [ ] **Bước 3: Mục "Luật kỳ (21/09/2026)"** ngay dưới bảng:

```markdown
**Luật kỳ bảng kê (CEO chốt 21/09/2026, hai bên áp chung):** Cước xếp kỳ theo **`shippedAt`** và chỉ gồm đơn đã `reconciled` (đã có `order.reconciled`); đơn chốt muộn rơi vào kỳ kế tiếp, giữ `shippedAt` gốc. Thuế/phí xếp kỳ theo **`invoiceDate`** của hoá đơn FedEx. `occurredAt` của event KHÔNG dùng để xếp kỳ.
```

- [ ] **Bước 4: Commit + push**

```bash
git add docs/integrations/mmp-ship-ho-api.md
git commit -m "docs(mmp): tách duty — order.duty_charged, order.shipped_at, statement.issued, luật kỳ theo shippedAt/invoiceDate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

---

### Task 8: Chuyển đổi dữ liệu — bóc duty khỏi 61 đơn, làm lại bảng kê nháp

**Files:**
- Create: `scripts/chuyen-doi/tach-duty.ts`

**Interfaces:**
- Consumes: `ghiDutyChoDon` (Task 3), `tinhLaiTongBangKe` (Task 5).

- [ ] **Bước 1: Script**

```ts
/**
 * Một lần (spec 21/09 §7): bóc duty ra khỏi actual_charged_vnd của các đơn đã đối soát,
 * ghi actual_duty_vnd + duty_bill_numbers; tính lại bảng kê nháp; tách bảng kê Kalisa
 * 03/07–12/08 thành T7 và T8 loại freight. Chạy: npx tsx --env-file=.env scripts/chuyen-doi/tach-duty.ts [--dry]
 * Bất biến kiểm cuối: actual_charged_vnd(mới) + actual_duty_vnd = actual_charged_vnd(cũ) trên từng đơn.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ghiDutyChoDon } from '@/features/ship-ho/duty';
import { tinhLaiTongBangKe } from '@/features/ship-ho/statement-core';

const DRY = process.argv.includes('--dry');
const KE_KALISA_CU = '0dcc5f5c-8653-4c75-b6ca-17df243c0135';

async function main() {
  const { rows } = await db.execute<{ id: string; code: string; source: string; mmp_ref: string | null; tracking_number: string | null; shipped_at: string | null; actual_charged_vnd: string; duty: string; sell: Record<string, number> | null }>(sql`
    SELECT id, code, source, mmp_ref, tracking_number, shipped_at::text, actual_charged_vnd,
           (actual_bill_breakdown->>'duty') AS duty, actual_bill_breakdown->'sell' AS sell
      FROM ship_ho_orders
     WHERE (actual_bill_breakdown->>'duty')::numeric > 0 AND actual_duty_vnd IS NULL AND actual_charged_vnd IS NOT NULL`);
  console.log(`Đơn cần bóc duty: ${rows.length}${DRY ? ' (dry)' : ''}`);
  let tongDuty = 0;
  for (const r of rows) {
    const cu = Number(r.actual_charged_vnd), duty = Math.round(Number(r.duty));
    if (duty <= 0 || duty >= cu) { console.log(`  BỎ QUA ${r.code}: duty ${duty} bất thường so cước ${cu}`); continue; }
    const moi = cu - duty; tongDuty += duty;
    console.log(`  ${r.code}: ${cu} → cước ${moi} + duty ${duty}`);
    if (DRY) continue;
    const sell = r.sell ? { ...r.sell, chargedVnd: moi } : null;
    await db.execute(sql`UPDATE ship_ho_orders SET actual_charged_vnd = ${String(moi)},
      actual_bill_breakdown = CASE WHEN ${sell}::jsonb IS NULL THEN actual_bill_breakdown ELSE jsonb_set(actual_bill_breakdown, '{sell}', ${JSON.stringify(sell)}::jsonb) END
      WHERE id = ${r.id} AND actual_charged_vnd = ${r.actual_charged_vnd}`);
    // Ghi cột duty theo hoá đơn thật (công tắc MMP tắt → không bắn duty_charged ở bước này).
    await ghiDutyChoDon({ id: r.id, code: r.code, source: r.source, mmpRef: r.mmp_ref, trackingNumber: r.tracking_number, shippedAt: r.shipped_at, actualDutyVnd: null, dutyBillNumbers: null });
  }
  console.log(`Tổng duty bóc ra: ${tongDuty}`);

  if (!DRY) {
    // Bất biến.
    const k = await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM ship_ho_orders WHERE actual_duty_vnd IS NOT NULL AND (actual_bill_breakdown->>'duty')::numeric <> actual_duty_vnd`);
    console.log('Đơn duty cột ≠ duty breakdown (phải 0):', k.rows[0].n);
    // Bảng kê Kalisa cũ (mốc quoted_at) → gỡ đơn, xoá, tạo lại T7/T8 freight qua UI (Task 9 bước 2) để có đúng luật gom.
    await db.execute(sql`UPDATE ship_ho_orders SET statement_id = NULL, status = CASE WHEN status = 'billed' THEN 'shipped' ELSE status END WHERE statement_id = ${KE_KALISA_CU}`);
    await db.execute(sql`DELETE FROM ship_ho_statements WHERE id = ${KE_KALISA_CU} AND status = 'draft'`);
    const drafts = await db.execute<{ id: string }>(sql`SELECT id FROM ship_ho_statements WHERE status = 'draft'`);
    for (const d of drafts.rows) console.log('tính lại nháp', d.id, await tinhLaiTongBangKe(d.id));
  }
  process.exit(0);
}
main();
```

- [ ] **Bước 2: Chạy dry rồi thật**

Run: `npx tsx --env-file=.env scripts/chuyen-doi/tach-duty.ts --dry` → 61 dòng, tổng duty ≈ 39.434.728 (36.393.613 + 2.526.481 + 514.634). Rồi chạy thật. Kiểm `SELECT sum(actual_charged_vnd), sum(actual_duty_vnd) FROM ship_ho_orders WHERE actual_duty_vnd IS NOT NULL` và bất biến in ra = 0.

- [ ] **Bước 3: Tạo lại bảng kê Kalisa** qua UI `/f/ship-ho/statements`: loại Cước, Kalisa, 01/07–31/07 → Tạo; 01/08–31/08 → Tạo. Ghi số đơn/tổng vào báo cáo. Chưa Gửi.

- [ ] **Bước 4: Commit**

```bash
git add scripts/chuyen-doi/tach-duty.ts
git commit -m "chore(ship-ho): script bóc duty khỏi cước 61 đơn đã đối soát, làm lại bảng kê nháp

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Backfill `order.shipped_at` cho MMP

**Files:**
- Create: `scripts/chuyen-doi/backfill-shipped-at-mmp.ts`

- [ ] **Bước 1: Script** — nhận file danh sách `mmpRef` (một mã một dòng) từ MMP; không có file → mọi đơn đã có `order.reconciled` gửi thành công:

```ts
/** Một lần: bắn order.shipped_at { shippedAt } cho danh sách đơn MMP yêu cầu (21/09/2026).
 *  Chạy: railway run --service Shopify-Management-System npx tsx scripts/chuyen-doi/backfill-shipped-at-mmp.ts [danh-sach.txt] [--dry] */
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { emitShipHoEvent } from '@/features/ship-ho/mmp-events';

const args = process.argv.slice(2); const DRY = args.includes('--dry'); const file = args.find((a) => !a.startsWith('--'));
async function main() {
  const refs = file ? readFileSync(file, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : null;
  const { rows } = await db.execute<{ id: string; code: string; source: string; mmp_ref: string | null; shipped_at: string | null }>(refs
    ? sql`SELECT id, code, source, mmp_ref, shipped_at::text FROM ship_ho_orders WHERE COALESCE(mmp_ref, code) IN ${refs}`
    : sql`SELECT o.id, o.code, o.source, o.mmp_ref, o.shipped_at::text FROM ship_ho_orders o WHERE EXISTS (SELECT 1 FROM ship_ho_order_events e WHERE e.order_id = o.id AND e.event = 'order.reconciled' AND e.delivery_status = 'delivered')`);
  console.log(`Đơn: ${rows.length}${DRY ? ' (dry)' : ''}; thiếu ngày gửi: ${rows.filter((r) => !r.shipped_at).length}`);
  if (refs) { const co = new Set(rows.map((r) => r.mmp_ref ?? r.code)); console.log('MMP gửi mà SMS không có:', refs.filter((r) => !co.has(r))); }
  if (DRY) return process.exit(0);
  for (const r of rows) if (r.shipped_at) await emitShipHoEvent({ id: r.id, code: r.code, source: r.source, mmpRef: r.mmp_ref }, 'order.shipped_at', { shippedAt: r.shipped_at });
  const k = await db.execute<{ ok: string; loi: string }>(sql`SELECT count(*) FILTER (WHERE delivery_status='delivered') ok, count(*) FILTER (WHERE delivery_status<>'delivered') loi FROM ship_ho_order_events WHERE event='order.shipped_at'`);
  console.log(k.rows[0]); process.exit(0);
}
main();
```

- [ ] **Bước 2: Chạy** `--dry` với file MMP gửi (nếu có) → soát danh sách lệch; chạy thật qua `railway run` (cần secret MMP). Ghi `ok/loi` vào báo cáo.

- [ ] **Bước 3: Commit**

```bash
git add scripts/chuyen-doi/backfill-shipped-at-mmp.ts
git commit -m "chore(ship-ho): backfill order.shipped_at cho MMP

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Bật công tắc — bắn lại 57 đơn, ghi sổ

**Files:**
- Create: `scripts/chuyen-doi/ban-lai-tach-duty.ts`
- Modify: `.env.example`; Second Brain `Decisions.md`, `Activity Log.md`

- [ ] **Bước 1: `.env.example`**

```
# Tách duty khỏi cước trong sự kiện gửi MMP (spec 21/09/2026): 1 = finalChargedVnd chỉ còn cước, kèm dutyVnd + order.duty_charged; trống = nghĩa cũ (cước+duty). Bật sau khi MMP xác nhận.
MMP_TACH_DUTY=
```

- [ ] **Bước 2: Script bắn lại**

```ts
/** Khi bật MMP_TACH_DUTY=1: bắn lại order.reconciled (cước riêng + dutyVnd + shippedAt) và order.duty_charged cho đơn đã gửi MMP kiểu gộp.
 *  Chạy: MMP_TACH_DUTY=1 railway run --service Shopify-Management-System npx tsx scripts/chuyen-doi/ban-lai-tach-duty.ts [--dry] */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { banGiaCuoiNeuDoi } from '@/features/ship-ho/final-charge-emit';
import { giaCuoiChoMmp, batTachDuty } from '@/features/ship-ho/gia-cuoi-mmp';
import { ghiDutyChoDon } from '@/features/ship-ho/duty';

const DRY = process.argv.includes('--dry');
async function main() {
  if (!batTachDuty()) { console.log('MMP_TACH_DUTY chưa = 1 — dừng.'); return process.exit(1); }
  const { rows } = await db.execute<{ id: string; code: string; source: string; mmp_ref: string | null; tracking_number: string | null; shipped_at: string | null; charged_vnd: string | null; actual_charged_vnd: string; actual_duty_vnd: string; reconcile_decision: string | null; duty_bill_numbers: string[] | null }>(sql`
    SELECT o.id, o.code, o.source, o.mmp_ref, o.tracking_number, o.shipped_at::text, o.charged_vnd, o.actual_charged_vnd, o.actual_duty_vnd, o.reconcile_decision, o.duty_bill_numbers
      FROM ship_ho_orders o
     WHERE o.actual_duty_vnd > 0 AND o.reconcile_status = 'reconciled'
       AND EXISTS (SELECT 1 FROM ship_ho_order_events e WHERE e.order_id = o.id AND e.event = 'order.reconciled' AND e.delivery_status = 'delivered')`);
  console.log(`Đơn bắn lại: ${rows.length}${DRY ? ' (dry)' : ''}`);
  if (DRY) return process.exit(0);
  let ban = 0;
  for (const r of rows) {
    const cuoc = Number(r.actual_charged_vnd), duty = Number(r.actual_duty_vnd), quoted = r.charged_vnd == null ? null : Number(r.charged_vnd);
    const kl = r.reconcile_decision === 'accepted' ? 'internal_error' : (r.reconcile_decision === 'claim_credited' || r.reconcile_decision === 'claim_rejected') ? r.reconcile_decision : null;
    const ok = await banGiaCuoiNeuDoi({ id: r.id, code: r.code, source: r.source, mmpRef: r.mmp_ref },
      { ...giaCuoiChoMmp({ cuocVnd: cuoc, dutyVnd: duty, shippedAt: r.shipped_at }), previousChargedVnd: quoted, deltaVnd: quoted == null ? null : cuoc - quoted, ...(kl ? { reconcileResolution: kl } : {}) });
    if (ok) ban++;
    // duty_charged: xoá dấu "đã cộng" để ghiDutyChoDon coi mọi hoá đơn là mới và bắn từng cái.
    await ghiDutyChoDon({ id: r.id, code: r.code, source: r.source, mmpRef: r.mmp_ref, trackingNumber: r.tracking_number, shippedAt: r.shipped_at, actualDutyVnd: null, dutyBillNumbers: [] });
  }
  console.log(`order.reconciled bắn lại: ${ban}/${rows.length}`);
  process.exit(0);
}
main();
```

- [ ] **Bước 3: Thứ tự bật (làm khi MMP xác nhận đã deploy)**
  1. `railway variables --service Shopify-Management-System --set MMP_TACH_DUTY=1` và cùng biến cho `cron-sync-orders` (cron `ship-ho-reconcile` chạy ở đó).
  2. `MMP_TACH_DUTY=1 railway run --service Shopify-Management-System npx tsx scripts/chuyen-doi/ban-lai-tach-duty.ts --dry` → ~57 đơn bắn lại `order.reconciled` + danh sách đơn `order.duty_charged`; chạy thật. **Script PHẢI chạy ngay sau khi bật công tắc, và nó phủ cả đơn CHƯA có `order.reconciled`**: trong lúc công tắc còn tắt, `ghiDutyChoDon` đã ghi cột duty + đánh dấu số hoá đơn vào `duty_bill_numbers` mà KHÔNG bắn event, nên cron sau đó coi là "không có hoá đơn mới" và duty của những đơn ấy sẽ không bao giờ tới MMP nếu không bắn lại ở đây (vòng 2 của script lấy MỌI đơn `actual_duty_vnd > 0`, không đòi đã reconciled).
  3. Kiểm outbox: `select event, count(*), count(*) filter (where last_http_status=200) from ship_ho_order_events where occurred_at > now() - interval '30 minutes' group by 1`.

- [ ] **Bước 4: Ghi sổ** — `Decisions.md` append:

```markdown
## D-091 · Tách duty khỏi cước ship hộ; kỳ bảng kê cước theo ngày gửi, duty theo ngày hoá đơn FedEx; phương án B với MMP (2026-09-21)
- `actual_charged_vnd` = cước; `actual_duty_vnd` + `duty_bill_numbers` riêng, cộng dồn theo số hoá đơn, thu nguyên giá. Bảng kê `type` freight/duty; cước gom `shipped_at ≤ end` và chỉ đơn `reconciled` (bỏ luật 08/09 "chưa bill thu giá báo"); đơn chốt muộn rơi kỳ sau, giữ ngày gửi gốc.
- MMP: `order.reconciled` thêm `dutyVnd`, `totalWithDutyVnd`, `shippedAt`; `order.duty_charged` khoá `(mmpRef, fedexInvoiceNumber)`; `order.shipped_at` backfill; `statement.issued/paid` là bản đối soát — MMP phát hành cho brand, xếp kỳ theo `shippedAt`/`invoiceDate`. Công tắc `MMP_TACH_DUTY`.
- Bằng chứng: Kalisa T7 — 17/26 đơn khớp ba bên; 9/9 lệch là duty; #KLS1990/#KLS1993 thu thiếu 1.065.043đ vì hoá đơn duty chưa nhập.
- Thay thế: duty gộp trong `actual_charged_vnd` (reconciledBrandCharge 21/07); bảng kê theo `quoted_at`.
```

`Activity Log.md`: ngày, số đơn bóc duty, tổng duty, bảng kê Kalisa T7/T8 mới (số đơn/tổng), kết quả backfill và bắn lại (ok/lỗi), commit cuối.

- [ ] **Bước 5: Commit + push**

```bash
git add scripts/chuyen-doi/ban-lai-tach-duty.ts .env.example
git commit -m "chore(ship-ho): script bắn lại order.reconciled + duty_charged khi bật MMP_TACH_DUTY

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

---

## Tự soát

- **Phủ spec:** §2.1–2.2 → T5 (gom `shipped_at ≤ end`, reconciled-only, chờ hoá đơn) + T6; §2.3 → T3 (`issueDate`), T5 (gom duty); §2.4 → T2/T3 (không markup); §2.5 → T5 (`statement-push`), T7; §3 → T1; §4.1 → T2; §4.2 → T3, T4 (gọi trước `continue`, không đụng đóng băng); §4.3–4.4 → T5; §5 → T2 (`giaCuoiChoMmp`), T3 (`duty_charged`), T4, T5, T7, T9 (`shipped_at`), T10 (chuyển tiếp); §6 → T6; §7 → T8 (+ tạo lại kê Kalisa), T10; §9 kiểm thử → test từng task; Đức nhập 2 hoá đơn duty (#KLS1990/#KLS1993) là việc người, ghi ở Activity Log.
- **Chữ ký:** `giaCuoiChoMmp`/`batTachDuty` (T2) dùng ở T3, T4, T10; `ghiDutyChoDon`/`DonChoDuty` (T3) dùng ở T4, T8, T10; `getDutyLinesByTracking` (T3) dùng ở T3; `LoaiBangKe`, `giaThuBangKe` mới (T5) dùng ở T5, T6; `generateStatement(brand, type, start, end)` (T5) dùng ở T6; `getShipHoStatement` trả `{statement, orders, choHoaDon}` (T5) dùng ở T6 export; `payloadStatementIssued`/`pushStatementEvent` (T5) dùng ở T5.
- **Rủi ro ghi nhận:** (1) `nenBanGiaCuoi` so `finalChargedVnd` — khi công tắc tắt số không đổi nên không bắn thừa; khi bật, cron sẽ tự bắn lại dần cả khi chưa chạy T10 — T10 chỉ để bắn ngay một lượt. (2) `statement.issued` không qua outbox → lỗi mạng không retry; chấp nhận vì là bản đối soát, có nút Gửi lại (bấm "Gửi" lần nữa không đổi trạng thái nhưng đẩy lại — nếu cần, T5 bước 7 cho phép gọi khi đã `issued`). (3) Hoá đơn duty của kiện MEAN BLVD nhà (74 dòng) ngoài phạm vi.
