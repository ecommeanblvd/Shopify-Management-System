# Mã vạch theo ID Shopify cho khâu nhận & kiểm hàng — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kho quét mã để mở đơn và nhảy đúng món trên màn "Nhận & kiểm hàng", in tem dán lên từng món, làm được cả trên máy tính (máy quét cầm tay) lẫn điện thoại (camera).

**Architecture:** Mở rộng hệ mã tem sẵn có (`features/receiving/ma-tem.ts`, mã có tiền tố, từ chối chuỗi trần) thêm `V:` và `O:`. Dòng đơn Shopify lưu thêm mã biến thể để hết phải suy từ mã hàng; món Lark lưu thêm mã dòng đơn đã nối. Màn thêm ô quét luôn giữ con trỏ, một hàm thuần quyết định quét xong làm gì. Tem in từ trang in sẵn có.

**Tech Stack:** Next.js (đọc `node_modules/next/dist/docs/` trước khi viết page/route/server action), Drizzle + Postgres, vitest, Shopify GraphQL, `BarcodeDetector` của trình duyệt.

**Spec:** `docs/superpowers/specs/2026-09-23-ma-vach-nhan-kiem-hang-design.md` (CEO duyệt 23/09/2026).

## Global Constraints

- **Bốn loại mã:** `L:<shopifyLineId>` (món của một đơn) · `V:<shopifyVariantId>` (loại hàng, không gắn đơn) · `O:<shopifyOrderId>` (cả đơn) · `WH-<8 số>` (mã kho tự cấp, giữ nguyên).
- **Không nhận chuỗi trần.** Quét nhầm mã vạch của vendor phải ra `null`, KHÔNG đoán — nguyên tắc đã có trong `ma-tem.ts`, giữ nguyên.
- **Luật chọn mã tem cho một món:** có mã dòng đơn → `L:`; không có nhưng có mã biến thể → `V:`; không có cả hai → `WH-`. Không món nào bị bỏ lại không tem.
- **Tem sinh theo TỪNG DÒNG ĐƠN**, không theo mã hàng — đơn có hai dòng cùng mã hàng (ví dụ thật `#MBLVD29928` × `SemiSense-TM26-D20-L-WADM-PLA`) phải ra hai mã khác nhau.
- **Tem in ra gồm mã vạch + phần chữ người đọc được**: mã đơn, mã hàng, tên hàng, kho. Mã mờ hoặc mất mạng thì mắt người vẫn đọc được.
- **Quét mã thuộc đơn khác:** hỏi "chuyển sang đơn #X?", KHÔNG tự nhảy. Quét mã lạ: báo "không nhận ra mã này".
- **KHÔNG ghi gì lên Lark trong cả kế hoạch này.** `WH_GHI_LARK=dry` đang bật trên mọi service và job `day-nhan-kcs-lark` đang nằm ngoài mọi nhóm cron (`features/jobs/groups.ts`, nhóm `chua-bat`) — để nguyên.
- **Chế độ danh sách cho phép:** `WH_GHI_LARK=chon:<định danh món>,<định danh món>` — chỉ món khai tên mới ghi thật, còn lại vẫn chỉ lưu SMS.
- **Quy ước repo:** tiếng Việt cho tên hàm/ghi chú/chữ trên màn; `sql` template với mảng JS dùng `IN ${arr}` không `= ANY`; file `'use server'` chỉ export hàm async; không top-level await trong `scripts/`; migration = file SQL trong `db/migrations/` áp bằng script tạm `sql.raw` (journal drizzle không cập nhật từ 0139); `npx tsc --noEmit && npx vitest run` xanh và **`npx next build` xanh trước khi push**; commit kết bằng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`; làm trên `main`; **KHÔNG** `git checkout/stash/reset` (cây làm việc dùng chung).

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `features/shopify-orders/shopify-types.ts`, `sync/order-fields.ts`, `sync/shopify-mapper.ts`, `backfill/submit-bulk-query.ts` (sửa) | lấy mã biến thể và mã sản phẩm từ Shopify |
| `db/migrations/0157_ma-vach.sql`, `db/schema.ts` | cột `shopify_variant_id`/`shopify_product_id` trên dòng đơn, `shopify_line_id` trên món Lark, `tem_in_luc` trên việc kho |
| `features/receiving/ma-tem.ts` (sửa) | đọc/sinh bốn loại mã |
| `features/kho-nhan/noi-mon-dong-don.ts` (mới) | THUẦN: nối món Lark ↔ dòng đơn, chọn mã tem cho món |
| `features/kho-nhan/sync-line-id.ts` (mới) | điền `lark_mon_don.shopify_line_id`, gọi trong cron sync Lark |
| `features/kho-nhan/quet.ts` (mới) | THUẦN: quét xong thì làm gì |
| `features/kho-nhan/queries.ts` (sửa) | trả mã tem cho từng món |
| `components/kho-nhan/OQuet.tsx` (mới) | ô quét + camera |
| `components/kho-nhan/TemMon.tsx` (mới), `app/(dashboard)/f/warehouse/nhan-kcs/tem/page.tsx` (mới) | in tem |
| `components/kho-nhan/BangNhanKcs.tsx` (sửa) | gắn ô quét, tô sáng món, nút in tem, bố cục điện thoại |
| `features/kho-nhan/day-lark.ts` (sửa) | chế độ danh sách cho phép |
| `docs/integrations/lark-wh-inventory.md` (sửa) | ghi chế độ `chon:` |

---

### Task 1: Lấy mã biến thể Shopify về dòng đơn

**Files:**
- Modify: `features/shopify-orders/shopify-types.ts`, `features/shopify-orders/sync/order-fields.ts`, `features/shopify-orders/sync/shopify-mapper.ts`, `features/shopify-orders/backfill/submit-bulk-query.ts`
- Modify: `db/schema.ts`; Create: `db/migrations/0157_ma-vach.sql`
- Test: `features/shopify-orders/sync/shopify-mapper.test.ts`

**Interfaces:**
- Produces: `MappedOrder['lines'][number]` thêm `shopifyVariantId: string | null`, `shopifyProductId: string | null`; cột `shopify_order_lines.shopify_variant_id`, `.shopify_product_id`; cột `lark_mon_don.shopify_line_id`; cột `wh_nhan_kcs.tem_in_luc`.

- [ ] **Bước 1: Migration** `db/migrations/0157_ma-vach.sql`:

```sql
-- Mã vạch theo ID Shopify (spec 23/09/2026). Dòng đơn CHƯA lưu mã biến thể nên đang phải suy
-- từ mã hàng: nối món Lark sang dòng đơn chỉ được 6.253/7.713 = 81%.
ALTER TABLE shopify_order_lines ADD COLUMN IF NOT EXISTS shopify_variant_id text;
ALTER TABLE shopify_order_lines ADD COLUMN IF NOT EXISTS shopify_product_id text;
CREATE INDEX IF NOT EXISTS shopify_order_lines_variant_idx ON shopify_order_lines (shopify_variant_id);

-- Món Lark nối sang dòng đơn Shopify — tem mang mã dòng đơn nên phải biết dòng nào.
ALTER TABLE lark_mon_don ADD COLUMN IF NOT EXISTS shopify_line_id text;
CREATE INDEX IF NOT EXISTS lark_mon_don_line_idx ON lark_mon_don (shopify_line_id);

-- Biết món nào đã dán tem.
ALTER TABLE wh_nhan_kcs ADD COLUMN IF NOT EXISTS tem_in_luc timestamp;
```

- [ ] **Bước 2: `db/schema.ts`** — trong `shopifyOrderLines` sau `shopifyLineId`:

```ts
  /** gid biến thể/sản phẩm Shopify — khoá để quét mã vạch và nối món kho (23/09/2026). */
  shopifyVariantId: text('shopify_variant_id'),
  shopifyProductId: text('shopify_product_id'),
```

Trong `larkMonDon` thêm `shopifyLineId: text('shopify_line_id'),`; trong `whNhanKcs` thêm `temInLuc: timestamp('tem_in_luc'),`. Thêm `index('shopify_order_lines_variant_idx').on(t.shopifyVariantId)` vào danh sách index của `shopifyOrderLines` và `index('lark_mon_don_line_idx').on(t.shopifyLineId)` vào `larkMonDon`.

- [ ] **Bước 3: Test thất bại** — thêm vào `features/shopify-orders/sync/shopify-mapper.test.ts`:

```ts
describe('mapLine lấy mã biến thể và sản phẩm', () => {
  const node = {
    id: 'gid://shopify/LineItem/111', sku: 'A-1', vendor: 'V', title: 'Áo', variantTitle: 'M',
    quantity: 1,
    originalUnitPriceSet: { shopMoney: { amount: '10.00', currencyCode: 'USD' } },
    discountAllocations: [],
    variant: { id: 'gid://shopify/ProductVariant/222', product: { id: 'gid://shopify/Product/333' } },
  };
  it('đọc id biến thể và id sản phẩm', () => {
    const l = mapOrder(donCoLine(node)).lines[0];
    expect(l.shopifyVariantId).toBe('gid://shopify/ProductVariant/222');
    expect(l.shopifyProductId).toBe('gid://shopify/Product/333');
  });
  it('hàng tuỳ biến không có biến thể → null, KHÔNG nổ', () => {
    const l = mapOrder(donCoLine({ ...node, variant: null })).lines[0];
    expect(l.shopifyVariantId).toBeNull();
    expect(l.shopifyProductId).toBeNull();
  });
});
```

*Người làm:* file test này đã có sẵn helper dựng payload đơn — dùng lại helper đó thay cho `donCoLine`/`mapOrder` nếu tên khác; đọc đầu file trước khi viết.

- [ ] **Bước 4: Chạy** `npx vitest run features/shopify-orders/sync/shopify-mapper.test.ts` — FAIL.

- [ ] **Bước 5: Sửa 4 file lấy dữ liệu:**

`shopify-types.ts` — trong `ShopifyLineItem` thêm:

```ts
  /** Hàng tuỳ biến (customize) không gắn biến thể → null. */
  variant?: { id: string; product?: { id: string } | null } | null;
```

`sync/order-fields.ts` — trong `lineItems(first: 250) { nodes { … } }` thêm `variant { id product { id } }` ngay sau dòng `id sku vendor title variantTitle quantity`.

`backfill/submit-bulk-query.ts` — thêm đúng dòng đó vào khối `lineItems { edges { node { … } } }`.

`sync/shopify-mapper.ts` — trong `MappedOrder['lines']` thêm hai trường, và trong `mapLine`:

```ts
    shopifyVariantId: node.variant?.id ?? null,
    shopifyProductId: node.variant?.product?.id ?? null,
```

- [ ] **Bước 6:** `npx vitest run features/shopify-orders && npx tsc --noEmit` — xanh.

- [ ] **Bước 7: Áp migration** — script tạm `scripts/_mig.ts` (xoá sau khi chạy):

```ts
import { readFileSync } from 'node:fs';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
async function main() {
  await db.execute(sql.raw(readFileSync('db/migrations/0157_ma-vach.sql', 'utf8')));
  const r = await db.execute(sql`select table_name, column_name from information_schema.columns where (table_name='shopify_order_lines' and column_name like 'shopify_%_id') or (table_name='lark_mon_don' and column_name='shopify_line_id') or (table_name='wh_nhan_kcs' and column_name='tem_in_luc') order by 1,2`);
  console.log((r as { rows: unknown[] }).rows);
  process.exit(0);
}
main();
```

Chạy `npx tsx --env-file=.env scripts/_mig.ts`. Xoá script. Ghi kết quả vào report.

- [ ] **Bước 8: Commit** `feat(shopify): dòng đơn lưu mã biến thể và mã sản phẩm; cột cho mã vạch kho`

---

### Task 2: Hệ mã bốn loại

**Files:**
- Modify: `features/receiving/ma-tem.ts`
- Test: `features/receiving/ma-tem.test.ts`

**Interfaces:**
- Produces:

```ts
export type MaTem =
  | { loai: 'mon'; unitCode: string }
  | { loai: 'dong'; shopifyLineId: string }
  | { loai: 'bien_the'; shopifyVariantId: string }
  | { loai: 'don'; shopifyOrderId: string };
export function docMaTem(raw: string): MaTem | null;
export function maTemDong(shopifyLineId: string): string;   // đã có
export function maTemBienThe(shopifyVariantId: string): string;
export function maTemDon(shopifyOrderId: string): string;
```

- [ ] **Bước 1: Test thất bại** — thêm vào `features/receiving/ma-tem.test.ts`:

```ts
describe('mã biến thể và mã đơn', () => {
  it('V:<số> → tem biến thể', () => {
    expect(docMaTem('V:222333444')).toEqual({ loai: 'bien_the', shopifyVariantId: '222333444' });
    expect(docMaTem('v:222333444')).toEqual({ loai: 'bien_the', shopifyVariantId: '222333444' });
  });
  it('O:<số> → mã đơn', () => {
    expect(docMaTem('O:555666777')).toEqual({ loai: 'don', shopifyOrderId: '555666777' });
  });
  it('gid Shopify đầy đủ cũng đọc được (dán từ Shopify ra)', () => {
    expect(docMaTem('V:gid://shopify/ProductVariant/222')).toEqual({ loai: 'bien_the', shopifyVariantId: '222' });
    expect(docMaTem('L:gid://shopify/LineItem/111')).toEqual({ loai: 'dong', shopifyLineId: '111' });
    expect(docMaTem('O:gid://shopify/Order/999')).toEqual({ loai: 'don', shopifyOrderId: '999' });
  });
  it('vẫn từ chối chuỗi trần và mã lạ', () => {
    expect(docMaTem('222333444')).toBeNull();
    expect(docMaTem('V:abc')).toBeNull();
    expect(docMaTem('X:123')).toBeNull();
  });
  it('sinh mã in vào tem', () => {
    expect(maTemBienThe('gid://shopify/ProductVariant/222')).toBe('V:222');
    expect(maTemDon('gid://shopify/Order/999')).toBe('O:999');
    expect(maTemDong('gid://shopify/LineItem/111')).toBe('L:111');
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/receiving/ma-tem.test.ts` — FAIL.

- [ ] **Bước 3: Sửa `ma-tem.ts`:**

```ts
export type MaTem =
  | { loai: 'mon'; unitCode: string }
  | { loai: 'dong'; shopifyLineId: string }
  | { loai: 'bien_the'; shopifyVariantId: string }
  | { loai: 'don'; shopifyOrderId: string };

const MON = /^WH-(\d{8})$/i;
// Nhận cả số trần lẫn gid đầy đủ ("gid://shopify/ProductVariant/222") — người dán tay từ
// Shopify ra hay dán nguyên gid, bắt họ cắt chuỗi là mời gọi gõ nhầm.
const CO_TIEN_TO = /^([LVO]):(?:gid:\/\/shopify\/[A-Za-z]+\/)?(\d{6,20})$/i;

export function docMaTem(raw: string): MaTem | null {
  const s = raw.replace(/\s+/g, '');
  if (!s) return null;
  const m = MON.exec(s);
  if (m) return { loai: 'mon', unitCode: `WH-${m[1]}` };
  const c = CO_TIEN_TO.exec(s);
  if (!c) return null;
  const so = c[2];
  switch (c[1].toUpperCase()) {
    case 'L': return { loai: 'dong', shopifyLineId: so };
    case 'V': return { loai: 'bien_the', shopifyVariantId: so };
    default: return { loai: 'don', shopifyOrderId: so };
  }
}

/** Số cuối của một gid Shopify ("gid://shopify/Order/999" → "999"); số trần giữ nguyên. */
function soCuoi(id: string): string {
  const m = /(\d{6,20})$/.exec(id.trim());
  return m ? m[1] : id.trim();
}

/** Chuỗi in vào mã vạch tem dòng đơn. */
export function maTemDong(shopifyLineId: string): string {
  return `L:${soCuoi(shopifyLineId)}`;
}

/** Chuỗi in vào mã vạch tem hàng lưu kho (một loại hàng, không gắn đơn). */
export function maTemBienThe(shopifyVariantId: string): string {
  return `V:${soCuoi(shopifyVariantId)}`;
}

/** Chuỗi mã vạch của cả đơn — quét để mở đơn trên màn. */
export function maTemDon(shopifyOrderId: string): string {
  return `O:${soCuoi(shopifyOrderId)}`;
}
```

- [ ] **Bước 4:** `npx vitest run features/receiving && npx tsc --noEmit` — xanh. (Test cũ `maTemDong('18158666023207')` vẫn phải pass.)

- [ ] **Bước 5: Commit** `feat(kho): hệ mã tem nhận thêm mã biến thể và mã đơn, đọc được cả gid Shopify`

---

### Task 3: Nối món Lark ↔ dòng đơn, chọn mã tem

**Files:**
- Create: `features/kho-nhan/noi-mon-dong-don.ts`, `features/kho-nhan/sync-line-id.ts`
- Modify: `features/lark/sync-brand-received.ts`
- Test: `features/kho-nhan/noi-mon-dong-don.test.ts`

**Interfaces:**
- Consumes: `maTemDong`, `maTemBienThe` (Task 2); `schema.larkMonDon`, `schema.shopifyOrderLines`, `schema.shopifyOrders`, `schema.whNhanKcs`.
- Produces:

```ts
export interface DongDonToiThieu { shopifyLineId: string; sku: string | null; daDung: boolean }
/** THUẦN: chọn dòng đơn cho một món (đơn có 2 dòng cùng SKU → mỗi món một dòng). */
export function chonDongChoMon(sku: string | null, dsDong: readonly DongDonToiThieu[]): string | null;
/** THUẦN: mã in vào tem của một món. */
export function maTemChoMon(x: { shopifyLineId?: string | null; shopifyVariantId?: string | null; unitCode?: string | null }): string | null;
export async function noiLineIdChoMon(): Promise<{ xet: number; noiDuoc: number }>;
```

- [ ] **Bước 1: Test thất bại** `features/kho-nhan/noi-mon-dong-don.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { chonDongChoMon, maTemChoMon, type DongDonToiThieu } from './noi-mon-dong-don';

const d = (id: string, sku: string | null, daDung = false): DongDonToiThieu => ({ shopifyLineId: id, sku, daDung });

describe('chonDongChoMon', () => {
  it('khớp theo mã hàng', () => {
    expect(chonDongChoMon('A-1', [d('L1', 'B-2'), d('L2', 'A-1')])).toBe('L2');
  });
  it('đơn có HAI dòng cùng mã hàng → lấy dòng chưa ai dùng', () => {
    expect(chonDongChoMon('A-1', [d('L1', 'A-1', true), d('L2', 'A-1')])).toBe('L2');
  });
  it('mọi dòng cùng mã hàng đều đã dùng → null, không gán trùng', () => {
    expect(chonDongChoMon('A-1', [d('L1', 'A-1', true)])).toBeNull();
  });
  it('món không có mã hàng hoặc đơn không có dòng khớp → null', () => {
    expect(chonDongChoMon(null, [d('L1', 'A-1')])).toBeNull();
    expect(chonDongChoMon('X-9', [d('L1', 'A-1')])).toBeNull();
  });
});

describe('maTemChoMon', () => {
  it('ưu tiên dòng đơn, rồi biến thể, rồi mã kho', () => {
    expect(maTemChoMon({ shopifyLineId: '111', shopifyVariantId: '222', unitCode: 'WH-00000001' })).toBe('L:111');
    expect(maTemChoMon({ shopifyVariantId: '222', unitCode: 'WH-00000001' })).toBe('V:222');
    expect(maTemChoMon({ unitCode: 'WH-00000001' })).toBe('WH-00000001');
  });
  it('không có gì → null (màn phải cấp mã kho trước khi in)', () => {
    expect(maTemChoMon({})).toBeNull();
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/kho-nhan/noi-mon-dong-don.test.ts` — FAIL.

- [ ] **Bước 3: Viết `features/kho-nhan/noi-mon-dong-don.ts`:**

```ts
/**
 * Nối MÓN trên Lark với DÒNG ĐƠN Shopify, và chọn mã in vào tem.
 *
 * Vì sao cần: tem dán lên hàng về theo đơn mang mã dòng đơn, nên phải biết món ấy là dòng nào.
 * Đơn có thể mua hai cái giống hệt (thật: #MBLVD29928 × SemiSense-TM26-D20-L-WADM-PLA) nên
 * nối theo mã hàng thôi là nhập nhằng — phải "dòng nào chưa ai dùng thì lấy".
 */
import { maTemDong, maTemBienThe } from '@/features/receiving/ma-tem';

export interface DongDonToiThieu {
  shopifyLineId: string;
  sku: string | null;
  /** Đã gán cho một món khác trong lượt nối này. */
  daDung: boolean;
}

/** THUẦN: chọn dòng đơn cho một món. Hết dòng chưa dùng → null, KHÔNG gán trùng. */
export function chonDongChoMon(sku: string | null, dsDong: readonly DongDonToiThieu[]): string | null {
  const s = sku?.trim();
  if (!s) return null;
  return dsDong.find((d) => d.sku?.trim() === s && !d.daDung)?.shopifyLineId ?? null;
}

/** THUẦN: mã in vào tem — dòng đơn trước, rồi biến thể, cuối cùng mã kho tự cấp. */
export function maTemChoMon(x: { shopifyLineId?: string | null; shopifyVariantId?: string | null; unitCode?: string | null }): string | null {
  if (x.shopifyLineId) return maTemDong(x.shopifyLineId);
  if (x.shopifyVariantId) return maTemBienThe(x.shopifyVariantId);
  return x.unitCode?.trim() || null;
}
```

- [ ] **Bước 4:** `npx vitest run features/kho-nhan/noi-mon-dong-don.test.ts` — PASS.

- [ ] **Bước 5: Viết `features/kho-nhan/sync-line-id.ts`:**

```ts
/**
 * Điền `lark_mon_don.shopify_line_id` cho các món chưa nối. Chạy sau mỗi lượt đồng bộ bảng
 * món (mỗi giờ) — best-effort, hỏng thì chỉ log.
 */
import { eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { chonDongChoMon, type DongDonToiThieu } from './noi-mon-dong-don';

const MOI_LUOT = 2000;

export async function noiLineIdChoMon(): Promise<{ xet: number; noiDuoc: number }> {
  const chua = await db
    .select({ dinhDanh: schema.larkMonDon.dinhDanh, orderNumber: schema.larkMonDon.orderNumber, sku: schema.larkMonDon.sku })
    .from(schema.larkMonDon)
    .where(isNull(schema.larkMonDon.shopifyLineId))
    .limit(MOI_LUOT);
  if (chua.length === 0) return { xet: 0, noiDuoc: 0 };

  // Gom theo đơn: một đơn nhiều món, và phải biết dòng nào đã gán để không gán trùng.
  const theoDon = new Map<string, typeof chua>();
  for (const m of chua) theoDon.set(m.orderNumber, [...(theoDon.get(m.orderNumber) ?? []), m]);

  let noiDuoc = 0;
  for (const [don, dsMon] of theoDon) {
    const dong = await db
      .select({ shopifyLineId: schema.shopifyOrderLines.shopifyLineId, sku: schema.shopifyOrderLines.sku })
      .from(schema.shopifyOrderLines)
      .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shopifyOrderLines.orderId))
      .where(sql`replace(${schema.shopifyOrders.shopifyOrderNumber}, '#', '') = ${don}`);
    if (dong.length === 0) continue;

    // Dòng đã gán cho món khác từ lượt trước cũng phải tính là đã dùng.
    const daGan = await db
      .select({ lineId: schema.larkMonDon.shopifyLineId })
      .from(schema.larkMonDon)
      .where(eq(schema.larkMonDon.orderNumber, don));
    const dung = new Set(daGan.map((x) => x.lineId).filter((x): x is string => !!x));
    const ds: DongDonToiThieu[] = dong.map((x) => ({ shopifyLineId: x.shopifyLineId, sku: x.sku, daDung: dung.has(x.shopifyLineId) }));

    for (const m of dsMon) {
      const lineId = chonDongChoMon(m.sku, ds);
      if (!lineId) continue;
      await db.update(schema.larkMonDon).set({ shopifyLineId: lineId }).where(eq(schema.larkMonDon.dinhDanh, m.dinhDanh));
      const d = ds.find((x) => x.shopifyLineId === lineId);
      if (d) d.daDung = true;
      noiDuoc++;
    }
  }
  return { xet: chua.length, noiDuoc };
}
```

- [ ] **Bước 6: Gọi trong `features/lark/sync-brand-received.ts`** — trong `syncBrandReceived`, sau `const monHuy = await luuMonDon(records);`:

```ts
  // Nối món sang dòng đơn Shopify để tem mang mã dòng đơn (best-effort, không chặn sync).
  let noiLine = { xet: 0, noiDuoc: 0 };
  try { noiLine = await noiLineIdChoMon(); }
  catch (e) { console.error('[kho-nhan] nối line id lỗi (bỏ qua):', e instanceof Error ? e.message : e); }
```

và trả về `{ fetched: records.length, inserted, monHuy, noiLine }`; thêm `noiLine?: { xet: number; noiDuoc: number }` vào `BrandReceivedSyncResult`; import `noiLineIdChoMon` từ `@/features/kho-nhan/sync-line-id`.

- [ ] **Bước 7:** `npx vitest run features/kho-nhan features/lark && npx tsc --noEmit` — xanh.

- [ ] **Bước 8: Chạy thật một lượt** — script tạm `scripts/_noi.ts`:

```ts
import { noiLineIdChoMon } from '@/features/kho-nhan/sync-line-id';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
async function main() {
  console.log('lượt 1:', await noiLineIdChoMon());
  const r = await db.execute(sql`select count(*)::int tong, count(shopify_line_id)::int noi from lark_mon_don`);
  console.log('tổng/nối được:', (r as { rows: unknown[] }).rows[0]);
  process.exit(0);
}
main();
```

Chạy `npx tsx --env-file=.env scripts/_noi.ts` (chạy lại vài lượt nếu còn món chưa nối, mỗi lượt 2.000 món). Ghi tỉ lệ vào report. Xoá script.

- [ ] **Bước 9: Commit** `feat(kho-nhan): nối món Lark với dòng đơn Shopify, luật chọn mã tem cho món`

---

### Task 4: Luật quét

**Files:**
- Create: `features/kho-nhan/quet.ts`
- Test: `features/kho-nhan/quet.test.ts`

**Interfaces:**
- Consumes: `docMaTem` (Task 2).
- Produces:

```ts
export interface MonDeQuet { dinhDanh: string; sku: string | null; shopifyLineId: string | null; shopifyVariantId: string | null }
export type KetQuaQuet =
  | { loai: 'mo_don'; shopifyOrderId: string }
  | { loai: 'chon_mon'; dinhDanh: string }
  | { loai: 'don_khac'; shopifyOrderId: string }      // mã thuộc đơn khác → hỏi trước khi nhảy
  | { loai: 'tim_bien_the'; shopifyVariantId: string } // chưa mở đơn mà quét hàng
  | { loai: 'khong_hieu'; raw: string };
export function xuLyQuet(raw: string, mon: readonly MonDeQuet[]): KetQuaQuet;
```

- [ ] **Bước 1: Test thất bại** `features/kho-nhan/quet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { xuLyQuet, type MonDeQuet } from './quet';

const m = (dinhDanh: string, o: Partial<MonDeQuet> = {}): MonDeQuet =>
  ({ dinhDanh, sku: null, shopifyLineId: null, shopifyVariantId: null, ...o });

describe('xuLyQuet', () => {
  it('quét mã đơn → mở đơn', () => {
    expect(xuLyQuet('O:999', [])).toEqual({ loai: 'mo_don', shopifyOrderId: '999' });
  });
  it('quét tem món của đơn ĐANG MỞ → chọn đúng món', () => {
    const ds = [m('dd1', { shopifyLineId: '111' }), m('dd2', { shopifyLineId: '222' })];
    expect(xuLyQuet('L:222', ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd2' });
  });
  it('quét tem món KHÔNG thuộc đơn đang mở → báo đơn khác, không tự nhảy', () => {
    expect(xuLyQuet('L:999', [m('dd1', { shopifyLineId: '111' })]))
      .toEqual({ loai: 'don_khac', shopifyOrderId: '' });
  });
  it('quét mã hàng khi đang mở đơn → chọn món khớp', () => {
    expect(xuLyQuet('V:222', [m('dd1', { shopifyVariantId: '222' })])).toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
  });
  it('quét mã hàng khi chưa mở đơn → đi tìm đơn đang chờ', () => {
    expect(xuLyQuet('V:222', [])).toEqual({ loai: 'tim_bien_the', shopifyVariantId: '222' });
  });
  it('mã vendor / chuỗi trần / rỗng → không hiểu, KHÔNG đoán', () => {
    expect(xuLyQuet('8938505974194', [])).toEqual({ loai: 'khong_hieu', raw: '8938505974194' });
    expect(xuLyQuet('SKU-ABC-XL', [])).toEqual({ loai: 'khong_hieu', raw: 'SKU-ABC-XL' });
    expect(xuLyQuet('  ', [])).toEqual({ loai: 'khong_hieu', raw: '  ' });
  });
  it('quét mã kho cũ → không hiểu ở màn này (màn phiếu cũ mới dùng WH-)', () => {
    expect(xuLyQuet('WH-00009890', []).loai).toBe('khong_hieu');
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/kho-nhan/quet.test.ts` — FAIL.

- [ ] **Bước 3: Viết `features/kho-nhan/quet.ts`:**

```ts
/**
 * THUẦN: quét một mã trong màn "Nhận & kiểm hàng" thì làm gì.
 *
 * Nguyên tắc giữ từ hệ tem cũ: KHÔNG đoán. Mã vendor hay chuỗi trần phải ra 'khong_hieu', và
 * mã thuộc đơn khác thì hỏi người dùng chứ không tự nhảy — kho đang dở tay nhập một đơn mà
 * màn tự đổi đơn là mất dữ liệu đang gõ.
 */
import { docMaTem } from '@/features/receiving/ma-tem';

export interface MonDeQuet {
  dinhDanh: string;
  sku: string | null;
  shopifyLineId: string | null;
  shopifyVariantId: string | null;
}

export type KetQuaQuet =
  | { loai: 'mo_don'; shopifyOrderId: string }
  | { loai: 'chon_mon'; dinhDanh: string }
  | { loai: 'don_khac'; shopifyOrderId: string }
  | { loai: 'tim_bien_the'; shopifyVariantId: string }
  | { loai: 'khong_hieu'; raw: string };

export function xuLyQuet(raw: string, mon: readonly MonDeQuet[]): KetQuaQuet {
  const ma = docMaTem(raw);
  if (!ma || ma.loai === 'mon') return { loai: 'khong_hieu', raw };

  if (ma.loai === 'don') return { loai: 'mo_don', shopifyOrderId: ma.shopifyOrderId };

  if (ma.loai === 'dong') {
    const m = mon.find((x) => x.shopifyLineId === ma.shopifyLineId);
    if (m) return { loai: 'chon_mon', dinhDanh: m.dinhDanh };
    // Biết là tem hợp lệ nhưng không thuộc đơn đang mở — màn tra đơn của dòng này rồi hỏi.
    return { loai: 'don_khac', shopifyOrderId: '' };
  }

  const m = mon.find((x) => x.shopifyVariantId === ma.shopifyVariantId);
  if (m) return { loai: 'chon_mon', dinhDanh: m.dinhDanh };
  return { loai: 'tim_bien_the', shopifyVariantId: ma.shopifyVariantId };
}
```

- [ ] **Bước 4:** `npx vitest run features/kho-nhan && npx tsc --noEmit` — xanh.

- [ ] **Bước 5: Commit** `feat(kho-nhan): luật quét mã — mở đơn, chọn món, hỏi khi mã thuộc đơn khác`

---

### Task 5: Truy vấn phục vụ quét và tem

**Files:**
- Modify: `features/kho-nhan/queries.ts`
- Create: `features/kho-nhan/quet-queries.ts`
- Test: không thêm (thuần đã phủ ở Task 3–4); kiểm bằng script thật ở Bước 4

**Interfaces:**
- Consumes: `maTemChoMon` (Task 3).
- Produces:
  - `MonCuaDon` thêm `shopifyLineId: string | null`, `shopifyVariantId: string | null`, `maTem: string | null`, `temInLuc: string | null`.
  - `timMonCuaDon` nhận thêm `{ theoOrderId?: string }` để mở đơn theo mã đơn Shopify.
  - `quet-queries.ts`: `export async function donCuaDong(shopifyLineId: string): Promise<{ orderNumber: string } | null>`, `export async function donChoCoBienThe(shopifyVariantId: string): Promise<Array<{ orderNumber: string; sku: string | null }>>`.

- [ ] **Bước 1: `features/kho-nhan/queries.ts`** — trong select của `timMonCuaDon` thêm `shopifyLineId: m.shopifyLineId`, và join sang dòng đơn để lấy mã biến thể:

```ts
    .leftJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, m.shopifyLineId))
```

chọn thêm `shopifyVariantId: schema.shopifyOrderLines.shopifyVariantId`, `temInLuc: w.temInLuc`. Trong phần `map`, thêm:

```ts
    shopifyLineId: r.shopifyLineId,
    shopifyVariantId: r.shopifyVariantId,
    maTem: maTemChoMon({ shopifyLineId: r.shopifyLineId, shopifyVariantId: r.shopifyVariantId }),
    temInLuc: r.temInLuc ? r.temInLuc.toISOString() : null,
```

Cho phép mở đơn theo mã đơn Shopify: đổi chữ ký thành `timMonCuaDon(orderNumber: string, opts?: { theoOrderId?: string })`; khi `opts.theoOrderId` có thì tra `shopify_orders.shopify_order_id` (so khớp cả dạng gid và số trần: `where sql\`regexp_replace(${schema.shopifyOrders.shopifyOrderId}, '^.*/', '') = ${opts.theoOrderId}\``) để lấy `shopifyOrderNumber`, rồi chạy tiếp như cũ.

- [ ] **Bước 2: Viết `features/kho-nhan/quet-queries.ts`:**

```ts
/** Tra cứu phục vụ ô quét: mã thuộc đơn nào, hàng này đang nằm ở đơn chờ nào. */
import { desc, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/** Dòng đơn này thuộc đơn nào — để hỏi "chuyển sang đơn #X?". */
export async function donCuaDong(shopifyLineId: string): Promise<{ orderNumber: string } | null> {
  const [r] = await db
    .select({ orderNumber: schema.shopifyOrders.shopifyOrderNumber })
    .from(schema.shopifyOrderLines)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shopifyOrderLines.orderId))
    .where(sql`regexp_replace(${schema.shopifyOrderLines.shopifyLineId}, '^.*/', '') = ${shopifyLineId}`)
    .limit(1);
  return r ?? null;
}

/** Các đơn CHƯA nhận xong đang có loại hàng này — kho quét hàng lúc chưa mở đơn nào. */
export async function donChoCoBienThe(shopifyVariantId: string): Promise<Array<{ orderNumber: string; sku: string | null }>> {
  const rows = await db
    .select({ orderNumber: schema.shopifyOrders.shopifyOrderNumber, sku: schema.shopifyOrderLines.sku })
    .from(schema.shopifyOrderLines)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shopifyOrderLines.orderId))
    .leftJoin(schema.whNhanKcs, eq(schema.whNhanKcs.sku, schema.shopifyOrderLines.sku))
    .where(sql`regexp_replace(${schema.shopifyOrderLines.shopifyVariantId}, '^.*/', '') = ${shopifyVariantId}`)
    .orderBy(desc(schema.shopifyOrders.processedAtShopify))
    .limit(20);
  return rows;
}
```

- [ ] **Bước 3:** `npx tsc --noEmit && npx vitest run features/kho-nhan` — xanh.

- [ ] **Bước 4: Kiểm bằng dữ liệu thật** — script tạm `scripts/_q.ts`:

```ts
import { timMonCuaDon } from '@/features/kho-nhan/queries';
import { donCuaDong, donChoCoBienThe } from '@/features/kho-nhan/quet-queries';
async function main() {
  const { mon } = await timMonCuaDon('MBLVD30426');
  console.log('món của đơn:', mon.map((m) => ({ sku: m.sku, line: m.shopifyLineId, variant: m.shopifyVariantId, tem: m.maTem })));
  const line = mon.find((m) => m.shopifyLineId)?.shopifyLineId;
  if (line) console.log('dòng này thuộc đơn:', await donCuaDong(line.replace(/^.*\//, '')));
  const v = mon.find((m) => m.shopifyVariantId)?.shopifyVariantId;
  if (v) console.log('đơn chờ có hàng này:', (await donChoCoBienThe(v.replace(/^.*\//, ''))).slice(0, 3));
  process.exit(0);
}
main();
```

Chạy `npx tsx --env-file=.env scripts/_q.ts`; mọi món phải có `maTem` khác null. Ghi kết quả vào report. Xoá script.

- [ ] **Bước 5: Commit** `feat(kho-nhan): truy vấn mã tem cho món và tra cứu phục vụ ô quét`

---

### Task 6: Ô quét trên màn (máy tính + điện thoại)

**Files:**
- Create: `components/kho-nhan/OQuet.tsx`
- Create: `features/kho-nhan/quet-actions.ts` ('use server')
- Modify: `components/kho-nhan/BangNhanKcs.tsx`, `app/(dashboard)/f/warehouse/nhan-kcs/page.tsx`

**Interfaces:**
- Consumes: `xuLyQuet`, `MonDeQuet`, `KetQuaQuet` (Task 4); `donCuaDong`, `donChoCoBienThe` (Task 5).
- Produces: `quet-actions.ts`: `export async function traDonCuaDong(shopifyLineId: string)`, `export async function traDonCoBienThe(shopifyVariantId: string)` (hai hàm async, không export gì khác).

- [ ] **Bước 1: `features/kho-nhan/quet-actions.ts`:**

```ts
'use server';

import { requirePerm } from '@/features/receiving/perm';
import { donCuaDong, donChoCoBienThe } from './quet-queries';

export async function traDonCuaDong(shopifyLineId: string): Promise<{ orderNumber: string } | null> {
  await requirePerm('view_receiving');
  return donCuaDong(shopifyLineId);
}

export async function traDonCoBienThe(shopifyVariantId: string): Promise<Array<{ orderNumber: string; sku: string | null }>> {
  await requirePerm('view_receiving');
  return donChoCoBienThe(shopifyVariantId);
}
```

- [ ] **Bước 2: `components/kho-nhan/OQuet.tsx`** (`'use client'`). Yêu cầu:
  - Ô nhập `autoFocus`, `placeholder="Quét mã đơn hoặc tem món…"`, `onKeyDown` bắt `Enter` → gọi `onQuet(giaTri)` rồi xoá ô. Máy quét cầm tay gõ như bàn phím nên không cần nút.
  - Nút "Quét bằng camera" chỉ hiện khi `typeof window !== 'undefined' && 'BarcodeDetector' in window`. Bấm thì mở `<video>` với `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`, dùng `new BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] })`, quét mỗi 300 ms bằng `setInterval`, bắt được thì gọi `onQuet`, dừng `interval`, gọi `track.stop()` cho mọi track và đóng video.
  - Dọn dẹp trong `useEffect` cleanup: luôn `clearInterval` và `track.stop()` khi component rời màn — không để camera sáng mãi.
  - Lỗi mở camera (người dùng từ chối) → hiện chữ "Không mở được camera, gõ tay hoặc dùng máy quét" chứ không nổ.
  - Khai `declare global { interface Window { BarcodeDetector?: new (o: { formats: string[] }) => { detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>> } } }` ngay trong file để TypeScript không phàn nàn.

- [ ] **Bước 3: Gắn vào `BangNhanKcs.tsx`:**
  - Thêm `<OQuet onQuet={xuLy} />` ngay trên ô tìm đơn.
  - `xuLy(raw)` gọi `xuLyQuet(raw, mon.map(m => ({ dinhDanh: m.dinhDanh, sku: m.sku, shopifyLineId: m.shopifyLineId, shopifyVariantId: m.shopifyVariantId })))` rồi:
    - `mo_don` → `router.push('/f/warehouse/nhan-kcs?donId=' + shopifyOrderId)`.
    - `chon_mon` → đặt state `monSang = dinhDanh`, cuộn tới thẻ món đó bằng `document.getElementById('mon-' + dinhDanh)?.scrollIntoView({ block: 'center' })`, và tô sáng bằng lớp `ring-2 ring-amber-500` trong 3 giây.
    - `don_khac` → gọi `traDonCuaDong(shopifyLineId)`; có kết quả thì hiện dải hỏi "Mã này thuộc đơn #X — chuyển sang đơn đó?" với nút Chuyển (đổi URL) và nút Bỏ qua. Không tự nhảy.
    - `tim_bien_the` → gọi `traDonCoBienThe(...)`, hiện danh sách tối đa 5 đơn để bấm chọn; rỗng thì báo "không thấy đơn nào đang chờ có hàng này".
    - `khong_hieu` → dải đỏ "Không nhận ra mã: {raw}" tự tắt sau 4 giây.
  - Mỗi thẻ món thêm `id={'mon-' + m.dinhDanh}`.
  - **Bố cục điện thoại:** bọc bảng nhiều cột trong `hidden md:block`; thêm bản thẻ dọc `md:hidden` cho mỗi món (mã hàng, tên, các ô nhập xếp dọc, nút Lưu `w-full py-3`).

- [ ] **Bước 4: `page.tsx`** — nhận thêm `donId` từ `searchParams`; khi có thì gọi `timMonCuaDon('', { theoOrderId: donId })`, không có thì dùng `don` như cũ.

- [ ] **Bước 5:** `npx tsc --noEmit`, `npx vitest run`, `npx next build` xanh. Mở dev server (`preview_start` theo `.claude/launch.json`), vào `/f/warehouse/nhan-kcs?don=MBLVD30426`, gõ vào ô quét chuỗi `O:` + mã đơn Shopify thật và `L:` + mã dòng thật (lấy bằng script ở Task 5) rồi Enter, xác nhận mở đơn và nhảy đúng món. Nếu vướng đăng nhập Google thì dừng, ghi rõ trong report, KHÔNG tạo tài khoản.

- [ ] **Bước 6: Commit** `feat(kho-nhan): ô quét mã trên màn nhận hàng, đọc bằng máy quét hoặc camera; bố cục cho điện thoại`

---

### Task 7: In tem

**Files:**
- Create: `components/kho-nhan/TemMon.tsx`, `app/(dashboard)/f/warehouse/nhan-kcs/tem/page.tsx`
- Create: `features/kho-nhan/tem-actions.ts` ('use server')
- Modify: `components/kho-nhan/BangNhanKcs.tsx`
- Test: không thêm (luật mã đã phủ ở Task 2–3)

**Interfaces:**
- Consumes: `maTemChoMon` (Task 3), `timMonCuaDon` (Task 5).
- Produces: `tem-actions.ts`: `export async function danhDauDaInTem(dinhDanhs: string[]): Promise<{ da: number }>`.

- [ ] **Bước 1: Thư viện mã vạch** — repo CHƯA có (kiểm 23/09/2026: `npm ls bwip-js` rỗng). Cài `npm i bwip-js` — đây là phụ thuộc MỚI, ghi rõ trong report để CEO biết. Chọn bwip-js vì vẽ được cả QR lẫn Code128 từ một hàm, và chạy được ở trình duyệt. Vẽ mã bằng canvas phía client:

```ts
import bwipjs from 'bwip-js';
bwipjs.toCanvas(canvasEl, { bcid: 'qrcode', text: maTem, scale: 3, includetext: false });
```

- [ ] **Bước 2: `components/kho-nhan/TemMon.tsx`** (`'use client'`): một tem = khối `w-[50mm] h-[30mm]` gồm canvas mã vạch bên trái (`22mm`), bên phải là chữ: mã đơn (đậm), mã hàng, tên hàng cắt 2 dòng, kho. Có `@media print { .khong-in { display: none } }` để ẩn mọi thứ ngoài tem.

- [ ] **Bước 3: `app/(dashboard)/f/warehouse/nhan-kcs/tem/page.tsx`** — nhận `?don=` và `?mon=` (nhiều `mon` = in nhiều tem), guard `view_receiving`, gọi `timMonCuaDon`, lọc theo danh sách `mon` nếu có, render lưới tem, kèm nút "In" gọi `window.print()` và nút "Xong" gọi `danhDauDaInTem`.

- [ ] **Bước 4: `features/kho-nhan/tem-actions.ts`:**

```ts
'use server';

import { inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';

/** Ghi mốc đã in tem để biết món nào chưa dán. */
export async function danhDauDaInTem(dinhDanhs: string[]): Promise<{ da: number }> {
  await requirePerm('manage_qc');
  if (dinhDanhs.length === 0) return { da: 0 };
  const r = await db.update(schema.whNhanKcs)
    .set({ temInLuc: new Date() })
    .where(inArray(schema.whNhanKcs.monDinhDanh, dinhDanhs))
    .returning({ id: schema.whNhanKcs.id });
  return { da: r.length };
}
```

- [ ] **Bước 5: `BangNhanKcs.tsx`** — sau khi lưu một món thành công, hiện nút "In tem" mở `/f/warehouse/nhan-kcs/tem?don={don}&mon={dinhDanh}` ở tab mới; đầu danh sách thêm nút "In tem cả đơn" mở cùng trang với `?don=` (không có `mon`). Món đã có `temInLuc` hiện chữ nhỏ "đã in tem {giờ}".

- [ ] **Bước 6:** `npx tsc --noEmit`, `npx vitest run`, `npx next build` xanh. Mở trang tem trên dev server, xem bản in bằng hộp thoại in của trình duyệt (không cần máy in thật), chụp màn hình vào report.

- [ ] **Bước 7: Commit** `feat(kho-nhan): in tem mã vạch cho món, đánh dấu đã in`

---

### Task 8: Chế độ danh sách cho phép + tài liệu

**Files:**
- Modify: `features/kho-nhan/day-lark.ts`
- Modify: `docs/integrations/lark-wh-inventory.md`
- Test: `features/kho-nhan/day-lark.test.ts`

**Interfaces:**
- Produces: `export type CheDoGhi = { kieu: 'dry' } | { kieu: 'that' } | { kieu: 'chon'; dinhDanhs: string[] }`, `export function docCheDoGhi(env: string | undefined): CheDoGhi`, `export function duocGhi(cheDo: CheDoGhi, monDinhDanh: string): boolean`.

- [ ] **Bước 1: Test thất bại** — thêm vào `features/kho-nhan/day-lark.test.ts`:

```ts
import { docCheDoGhi, duocGhi } from './day-lark';

describe('chế độ ghi Lark', () => {
  it('dry / trống / chon:', () => {
    expect(docCheDoGhi('dry')).toEqual({ kieu: 'dry' });
    expect(docCheDoGhi(undefined)).toEqual({ kieu: 'that' });
    expect(docCheDoGhi('')).toEqual({ kieu: 'that' });
    expect(docCheDoGhi('chon:dd1,dd2')).toEqual({ kieu: 'chon', dinhDanhs: ['dd1', 'dd2'] });
    expect(docCheDoGhi(' CHON: dd1 , dd2 ')).toEqual({ kieu: 'chon', dinhDanhs: ['dd1', 'dd2'] });
  });
  it('chỉ món khai tên mới ghi thật', () => {
    const c = docCheDoGhi('chon:dd1');
    expect(duocGhi(c, 'dd1')).toBe(true);
    expect(duocGhi(c, 'dd2')).toBe(false);
    expect(duocGhi({ kieu: 'dry' }, 'dd1')).toBe(false);
    expect(duocGhi({ kieu: 'that' }, 'dd2')).toBe(true);
  });
  it('chon: rỗng → coi như dry, KHÔNG ghi gì', () => {
    expect(duocGhi(docCheDoGhi('chon:'), 'dd1')).toBe(false);
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/kho-nhan/day-lark.test.ts` — FAIL.

- [ ] **Bước 3: Sửa `day-lark.ts`** — XOÁ `laDry` và thay bằng bộ ba dưới. `laDry` chỉ còn một chỗ gọi (`dayMotDong`) và một khối test cũ trong `day-lark.test.ts` — xoá luôn khối `describe('laDry', …)` đó vì các trường hợp của nó đã nằm trong test mới:

```ts
export type CheDoGhi = { kieu: 'dry' } | { kieu: 'that' } | { kieu: 'chon'; dinhDanhs: string[] };

/**
 * THUẦN: đọc env ra chế độ ghi Lark.
 *
 * 'chon:<định danh>,<định danh>' là chế độ nằm GIỮA chạy thử và chạy thật (CEO 23/09/2026):
 * kiểm từng bản ghi một mà không sợ lỡ tay ghi hàng loạt lên bảng 9.007 dòng của kho.
 */
export function docCheDoGhi(env: string | undefined): CheDoGhi {
  const s = (env ?? '').trim();
  if (!s) return { kieu: 'that' };
  if (s.toLowerCase() === 'dry') return { kieu: 'dry' };
  if (s.toLowerCase().startsWith('chon:')) {
    return { kieu: 'chon', dinhDanhs: s.slice(5).split(',').map((x) => x.trim()).filter(Boolean) };
  }
  return { kieu: 'that' };
}

/** Món này có được ghi thật lên Lark không. */
export function duocGhi(cheDo: CheDoGhi, monDinhDanh: string): boolean {
  if (cheDo.kieu === 'that') return true;
  if (cheDo.kieu === 'dry') return false;
  return cheDo.dinhDanhs.includes(monDinhDanh);
}
```

Trong `dayMotDong`, thay chỗ kiểm dry:

```ts
  const cheDo = docCheDoGhi(process.env.WH_GHI_LARK);
  if (!duocGhi(cheDo, d.monDinhDanh)) {
    console.log('[kho-nhan] KHÔNG gửi Lark (chế độ %s):', cheDo.kieu, { don: d.orderNumber, sku: d.sku, mon: d.monDinhDanh });
    return { ok: true, dry: true };
  }
```

- [ ] **Bước 4:** `npx vitest run features/kho-nhan && npx tsc --noEmit` — xanh.

- [ ] **Bước 5: `docs/integrations/lark-wh-inventory.md`** — trong mục Env, thay phần `WH_GHI_LARK` bằng:

```markdown
- `WH_GHI_LARK` — điều khiển việc ghi sang Lark:
  - `dry` — chỉ lưu ở SMS, KHÔNG gọi Lark (đang bật trên mọi service).
  - `chon:<định danh món>,<định danh món>` — chỉ những món khai tên mới ghi thật; dùng để kiểm từng bản ghi một.
  - bỏ trống — ghi thật mọi món.
```

Thêm mục "Trình tự bật" với 5 bước của spec §6, và ghi rõ job `day-nhan-kcs-lark` đang ở nhóm `chua-bat` trong `features/jobs/groups.ts`, bật bằng cách chuyển khoá sang `moi-15-phut`.

- [ ] **Bước 6:** `npx vitest run && npx next build` xanh.

- [ ] **Bước 7: Commit** `feat(kho-nhan): chế độ ghi Lark theo danh sách cho phép để kiểm từng bản ghi`

---

## Sau khi xong (người điều phối)

1. Push `main`; nếu Railway không tự deploy thì `railway up --detach --service Shopify-Management-System` (auto-deploy từ GitHub đang trục trặc từ 22/09).
2. Chạy lại đồng bộ Lark để điền `shopify_line_id` cho món (hoặc chờ cron mỗi giờ), kiểm tỉ lệ nối.
3. Nhờ CEO test màn: quét mã đơn, quét tem món, in thử một tem rồi quét lại bằng điện thoại.
4. Kiểm ghi Lark từng bản ghi theo spec §6, bắt đầu bằng một món chưa có dòng Lark.
