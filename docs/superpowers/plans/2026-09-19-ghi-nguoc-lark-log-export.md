# Ghi ngược trạng thái giao, ngày giao, chi phí hãng lên Lark LOG-Export — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi giờ, SMS điền lên đúng dòng Lark LOG-Export 13 ô mà Ops đang gõ tay: trạng thái giao (2 ô chọn), ngày giao thực tế, ngày giao dự kiến, và 11 khoản chi phí hãng — để Ops ngừng gõ nhóm C + D.

**Architecture:** Bốn hàm thuần (map trạng thái, ngày Lark, nguồn hãng, dựng patch) không đụng DB; một hàm điều phối `ghiNguocLark` đọc kiện 60 ngày + `shipment_charges`, khớp dòng Lark theo `Log Unique code`, ghi qua `updateLogRecordFields` (đường ghi duy nhất, D-045). Chạy lồng trong cron `sync-lark`, dùng lại record đã tải. Chiều Lark → SMS (khối freeze) sửa để không đè kiện đã có nguồn hãng — tránh vòng lặp.

**Tech Stack:** Next.js (đọc `node_modules/next/dist/docs/` trước khi viết code Next — không có page/action mới trong kế hoạch này), Drizzle + Postgres (Supabase), vitest 4 (environment node), Lark Bitable REST (`features/lark/client.ts`), Railway cron `sync Lark operation`.

## Global Constraints

- **Hãng là sự thật cho trạng thái và ngày giao thực tế** (spec §3.1): ghi đè `LOG-EP-Dispatch Category (Final)`, `LOG-EP-Dispatch Status`, `Ngày giao thực tế` khi khác giá trị hiện có.
- **Chỉ ghi khi nguồn phía SMS là hãng** (spec §3.2): `delivery_source ∈ {fedex, dhl, ups, trackingmore, carrier_bill}`. Nguồn `lark` hoặc null → **không ghi gì**, kể cả chi phí.
- **Chi phí và `Ngày giao dự kiến` chỉ điền ô trống** (spec §3.3, §3.4). Ô đã có số mà khác → ghi nhật ký "lệch", không sửa.
- **Không tạo, không xoá dòng Lark** (spec §3.5). Chỉ `updateLogRecordFields(recordId, fields)`.
- **Chỉ ghi ô KHÁC giá trị hiện có** (spec §3.6). Patch rỗng → không gọi Lark.
- **Khớp dòng theo `Log Unique code`** (spec §4) = `shipments.log_unique_code`. Không khớp → bỏ qua. Phạm vi: `label_created_at` trong 60 ngày.
- **Giá trị ô chọn phải khớp CHÍNH XÁC** danh sách Lark (spec §5.1): Category ∈ {Shipment Created, In Transit, Shipping Exceptions, Delivered, Lost by Carrier, Shipping Failed}; Status ∈ {Ready for Carrier, On Delivery, Delayed, Customs Clearance, Forward to Third-party, Hold by Unavoidable Reason, Delivery Attempt Failed, Additional Information Required, Held for Pickup, Delivery Completed, Return-Processing, Package Lost, On Hold, Cancel at Cnee Country}.
- **Ngày ghi dạng epoch ms nửa đêm giờ VN** (spec §5.2), nghịch đảo của `larkEpochToVnMidnight`.
- **Chi phí VND, chỉ khi `total_amount > 0`; thành phần bằng 0 không ghi** (spec §5.3). Map cột đúng bảng §5.3.
- **Công tắc env `LARK_GHI_NGUOC`**: `dry` = tính patch + nhật ký, không gọi Lark; `1` = ghi thật; trống/khác = không chạy (spec §7).
- **Tên việc nền `ghi-nguoc-lark`**, nhóm `sync-lark` (D-051; test `groups.test.ts` canh "mọi tác vụ đều thuộc một nhóm").
- **Tên cột Lark khai MỘT chỗ** (`features/lark/ghi-nguoc/cot.ts`), không rải chuỗi.
- **Quy ước repo:** tiếng Việt cho tên hàm/ghi chú mới; không top-level await trong script; `sql` template với mảng JS dùng `IN ${arr}` (không `= ANY`); `npx tsc --noEmit` + `npx vitest run` xanh trước mỗi `git push` (hook `.githooks/pre-push`); commit kết bằng `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; trên `main` (CEO làm việc trực tiếp trên main, không mở nhánh).

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `features/lark/nguon-hang.ts` (+test) | Thuần: `NGUON_HANG`, `laNguonHang(source)` — dùng chung cho dựng patch và khối freeze |
| `features/lark/ghi-nguoc/cot.ts` | Hằng số tên cột Lark + danh sách lựa chọn hợp lệ của hai ô chọn |
| `features/lark/ghi-nguoc/map-trang-thai.ts` (+test) | Thuần: `DeliveryStatus` → `{ category, status }` hoặc null |
| `features/lark/ghi-nguoc/ngay-lark.ts` (+test) | Thuần: Date → epoch nửa đêm VN; ngày dự kiến = label + SLA nước |
| `features/lark/ghi-nguoc/dung-patch.ts` (+test) | Thuần: kiện SMS + charge + ô Lark hiện có → patch + danh sách lệch + đếm theo nhóm |
| `features/lark/ghi-nguoc/ghi-nguoc.ts` | Điều phối: đọc DB, khớp record, gọi `dungPatch`, ghi Lark, trả tóm tắt |
| `features/lark/can-freeze.ts` (+test) | Ba hàm `can…` bỏ qua kiện có nguồn hãng |
| `features/lark/sync.ts` | Freeze thêm WHERE nguồn; `syncLarkPacks` trả `records` khi được yêu cầu |
| `scripts/cron/sync-lark.ts` | Gọi `chayMotJob('ghi-nguoc-lark', …)` với records đã tải |
| `features/jobs/registry.ts`, `features/jobs/groups.ts` | Khai việc `ghi-nguoc-lark` |
| `.env.example` | Khai `LARK_GHI_NGUOC` |
| `scripts/_kiem-base.ts` (tạm, xoá sau) | Bước 0: đối chiếu quy ước `Mức giá cơ sở` |

---

### Task 1: Bước 0 — xác nhận quy ước "Mức giá cơ sở" trên Lark

Spec §5.3 chưa chắc Ops gõ giá **niêm yết** (`base`) hay giá **sau chiết khấu** (`base + discount`, vì `discount` âm). Kết quả quyết định map cột ở Task 5.

**Files:**
- Create (tạm): `scripts/_kiem-base.ts`
- Modify: `/Users/macos/Obsidian/Le Minh Tiep Second Brain/Shared/Projects/Shopify-Management-System/Decisions.md` (ghi kết quả)

**Interfaces:**
- Produces: quyết định `QUY_UOC_BASE: 'niem_yet' | 'sau_chiet_khau'` ghi trong Decisions, Task 5 đọc để chọn map.

- [ ] **Bước 1: Viết script đối chiếu**

```ts
// scripts/_kiem-base.ts — chạy: railway run --service "sync Lark operation" npx tsx scripts/_kiem-base.ts
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { listAllRecords } from '@/features/lark/client';
import { larkText } from '@/features/lark/parse-pack-row';

async function main() {
  const records = await listAllRecords();
  const theoCode = new Map<string, Record<string, unknown>>();
  for (const r of records) {
    const code = larkText(r.fields['Log Unique code']);
    const base = r.fields['Mức giá cơ sở'];
    if (code && typeof base === 'number' && base > 0) theoCode.set(code, r.fields);
  }
  const { rows } = await db.execute<{ code: string; base: string; discount: string | null; fuel: string; total: string }>(sql`
    SELECT s.log_unique_code AS code, c.base, c.discount, c.fuel, c.total_amount AS total
      FROM shipment_charges c JOIN shipments s ON s.id = c.shipment_id
     WHERE s.carrier_key = 'fedex' AND s.log_unique_code IS NOT NULL AND c.total_amount > 0
     ORDER BY s.created_at DESC LIMIT 400`);
  let niemYet = 0, sauCk = 0, khac = 0; const viDu: string[] = [];
  for (const r of rows) {
    const f = theoCode.get(r.code); if (!f) continue;
    const opsBase = f['Mức giá cơ sở'] as number;
    const base = Number(r.base), sau = Number(r.base) + Number(r.discount ?? 0);
    const gan = (a: number, b: number) => Math.abs(a - b) <= 1000;
    if (gan(opsBase, base)) niemYet++; else if (gan(opsBase, sau)) sauCk++; else { khac++; if (viDu.length < 5) viDu.push(`${r.code}: ops ${opsBase} · niêm yết ${base} · sau CK ${sau} · tổng ${r.total}`); }
    if (niemYet + sauCk + khac >= 20) break;
  }
  console.log({ niemYet, sauCk, khac, viDu });
}
main().then(() => process.exit(0));
```

- [ ] **Bước 2: Chạy và đọc kết quả**

Run: `railway run --service "sync Lark operation" npx tsx scripts/_kiem-base.ts`
Expected: một object `{ niemYet, sauCk, khac, viDu }`. Quy ước = nhóm lớn nhất trong `niemYet` / `sauCk`. Nếu `khac` chiếm đa số → dừng, báo CEO kèm 5 ví dụ (có thể Ops gõ theo hoá đơn giấy khác số FBO).

- [ ] **Bước 3: Ghi quyết định**

Append vào `Decisions.md` (Shared/, không đụng Private/):

```markdown
## D-0XX · Ghi ngược Lark: quy ước "Mức giá cơ sở" (2026-09-19)
Đối chiếu 20 dòng Ops gõ tay với `shipment_charges`: <niemYet> khớp giá niêm yết (`base`), <sauCk> khớp giá sau chiết khấu (`base + discount`), <khac> không khớp.
**Chốt:** `Mức giá cơ sở` ← `base` (niêm yết) | `base + discount` (sau chiết khấu) — <gạch một>. `Giá chiết khấu` trên Lark là công thức, không ghi.
```

- [ ] **Bước 4: Xoá script tạm**

```bash
rm scripts/_kiem-base.ts
```

Không commit gì ở task này (Decisions nằm ngoài repo).

---

### Task 2: Nguồn hãng — hằng số dùng chung

**Files:**
- Create: `features/lark/nguon-hang.ts`
- Test: `features/lark/nguon-hang.test.ts`

**Interfaces:**
- Produces: `export const NGUON_HANG: readonly string[]`; `export function laNguonHang(source: string | null | undefined): boolean`.

- [ ] **Bước 1: Viết test đỏ**

```ts
// features/lark/nguon-hang.test.ts
import { describe, it, expect } from 'vitest';
import { NGUON_HANG, laNguonHang } from './nguon-hang';

describe('laNguonHang', () => {
  it('năm nguồn hãng đúng spec §3.2', () => {
    expect([...NGUON_HANG].sort()).toEqual(['carrier_bill', 'dhl', 'fedex', 'trackingmore', 'ups']);
    for (const n of NGUON_HANG) expect(laNguonHang(n)).toBe(true);
  });
  it('lark / null / lạ → không phải hãng', () => {
    expect(laNguonHang('lark')).toBe(false);
    expect(laNguonHang(null)).toBe(false);
    expect(laNguonHang(undefined)).toBe(false);
    expect(laNguonHang('manual')).toBe(false);
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `npx vitest run features/lark/nguon-hang.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Bước 3: Viết code**

```ts
// features/lark/nguon-hang.ts
/**
 * Nguồn trạng thái giao được coi là CỦA HÃNG (spec ghi ngược Lark §3.2). Chỉ những kiện này
 * mới được SMS ghi lên Lark, và ngược lại Lark không được đè lên chúng (chống vòng lặp).
 */
export const NGUON_HANG: readonly string[] = ['fedex', 'dhl', 'ups', 'trackingmore', 'carrier_bill'];

export function laNguonHang(source: string | null | undefined): boolean {
  return !!source && NGUON_HANG.includes(source);
}
```

- [ ] **Bước 4: Chạy test, phải xanh**

Run: `npx vitest run features/lark/nguon-hang.test.ts`
Expected: PASS (2 test).

- [ ] **Bước 5: Commit**

```bash
git add features/lark/nguon-hang.ts features/lark/nguon-hang.test.ts
git commit -m "feat(lark): hằng số nguồn trạng thái giao của hãng

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Tên cột Lark và map trạng thái

**Files:**
- Create: `features/lark/ghi-nguoc/cot.ts`
- Create: `features/lark/ghi-nguoc/map-trang-thai.ts`
- Test: `features/lark/ghi-nguoc/map-trang-thai.test.ts`

**Interfaces:**
- Produces: `COT` (tên cột), `LUA_CHON_CATEGORY`, `LUA_CHON_STATUS` (danh sách chuỗi hợp lệ), `COT_CHI_PHI` (map khoá charge → tên cột), `mapTrangThai(deliveryStatus: string | null | undefined): { category: string; status: string } | null`.

- [ ] **Bước 1: Viết test đỏ**

```ts
// features/lark/ghi-nguoc/map-trang-thai.test.ts
import { describe, it, expect } from 'vitest';
import { mapTrangThai } from './map-trang-thai';
import { LUA_CHON_CATEGORY, LUA_CHON_STATUS } from './cot';

describe('mapTrangThai', () => {
  it('đủ 6 trạng thái có nghĩa (spec §5.1)', () => {
    expect(mapTrangThai('label_created')).toEqual({ category: 'Shipment Created', status: 'Ready for Carrier' });
    expect(mapTrangThai('in_transit')).toEqual({ category: 'In Transit', status: 'On Delivery' });
    expect(mapTrangThai('out_for_delivery')).toEqual({ category: 'In Transit', status: 'On Delivery' });
    expect(mapTrangThai('delivered')).toEqual({ category: 'Delivered', status: 'Delivery Completed' });
    expect(mapTrangThai('exception')).toEqual({ category: 'Shipping Exceptions', status: 'Delayed' });
    expect(mapTrangThai('returning')).toEqual({ category: 'Shipping Failed', status: 'Return-Processing' });
  });
  it('unknown / null / lạ → null (không ghi)', () => {
    expect(mapTrangThai('unknown')).toBeNull();
    expect(mapTrangThai(null)).toBeNull();
    expect(mapTrangThai('gì đó')).toBeNull();
  });
  it('mọi chuỗi ra đều nằm trong danh sách lựa chọn Lark — giá trị lạ sẽ đẻ lựa chọn mới', () => {
    for (const s of ['label_created', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returning']) {
      const m = mapTrangThai(s)!;
      expect(LUA_CHON_CATEGORY).toContain(m.category);
      expect(LUA_CHON_STATUS).toContain(m.status);
    }
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `npx vitest run features/lark/ghi-nguoc/map-trang-thai.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Bước 3: Viết `cot.ts`**

```ts
// features/lark/ghi-nguoc/cot.ts
/**
 * Tên cột bảng Lark LOG-Export mà SMS ghi ngược (spec 2026-09-19 §5). Đổi tên cột bên Lark là
 * hỏng — nên để MỘT chỗ. Hai ô chọn kèm danh sách giá trị hợp lệ kiểm 19/09/2026 qua API fields:
 * ghi chuỗi lạ vào ô chọn là Lark đẻ lựa chọn mới (bài học cột Couriers, D-045).
 */
export const COT = {
  logUniqueCode: 'Log Unique code',
  category: 'LOG-EP-Dispatch Category (Final)',
  status: 'LOG-EP-Dispatch Status',
  ngayGiaoThucTe: 'Ngày giao thực tế',
  ngayGiaoDuKien: 'Ngày giao dự kiến',
} as const;

export const LUA_CHON_CATEGORY: readonly string[] = [
  'Shipment Created', 'In Transit', 'Shipping Exceptions', 'Delivered', 'Lost by Carrier', 'Shipping Failed',
];
export const LUA_CHON_STATUS: readonly string[] = [
  'Ready for Carrier', 'On Delivery', 'Delayed', 'Customs Clearance', 'Forward to Third-party',
  'Hold by Unavoidable Reason', 'Delivery Attempt Failed', 'Additional Information Required', 'Held for Pickup',
  'Delivery Completed', 'Return-Processing', 'Package Lost', 'On Hold', 'Cancel at Cnee Country',
];

/** Khoá `shipment_charges` → cột tiền trên Lark (VND). `discount` không ghi: Lark có công thức
 *  "Giá chiết khấu". `address_correction`, `non_conveyable` không có cột. */
export const COT_CHI_PHI: Record<string, string> = {
  totalAmount: 'INS | Chi phí Tổng (đ)',
  base: 'Mức giá cơ sở',
  fuel: 'Phụ phí nhiên liệu',
  remote: 'Phụ phí vùng sâu xa',
  demand: 'EES / Theo nhu cầu',
  directSignature: 'Phí kí nhận trực tiếp',
  vat: 'VAT/Thuế phí khác',
  gogreen: 'GoGreen Plus-Basic',
  elevatedRisk: 'Phí rủi ro gia tăng',
  importHandling: 'Phí xử lý hàng nhập',
  residential: 'Phụ Phí Residential',
};
```

- [ ] **Bước 4: Viết `map-trang-thai.ts`**

```ts
// features/lark/ghi-nguoc/map-trang-thai.ts
/** THUẦN: trạng thái giao của SMS → hai ô chọn trên Lark (spec §5.1). null = không ghi. */
const BANG: Record<string, { category: string; status: string }> = {
  label_created: { category: 'Shipment Created', status: 'Ready for Carrier' },
  in_transit: { category: 'In Transit', status: 'On Delivery' },
  out_for_delivery: { category: 'In Transit', status: 'On Delivery' },
  delivered: { category: 'Delivered', status: 'Delivery Completed' },
  exception: { category: 'Shipping Exceptions', status: 'Delayed' },
  returning: { category: 'Shipping Failed', status: 'Return-Processing' },
};

export function mapTrangThai(deliveryStatus: string | null | undefined): { category: string; status: string } | null {
  return deliveryStatus ? BANG[deliveryStatus] ?? null : null;
}
```

- [ ] **Bước 5: Chạy test, phải xanh**

Run: `npx vitest run features/lark/ghi-nguoc/map-trang-thai.test.ts`
Expected: PASS (3 test).

- [ ] **Bước 6: Commit**

```bash
git add features/lark/ghi-nguoc/cot.ts features/lark/ghi-nguoc/map-trang-thai.ts features/lark/ghi-nguoc/map-trang-thai.test.ts
git commit -m "feat(lark): tên cột LOG-Export và map trạng thái giao sang ô chọn Lark

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Ngày dạng Lark

**Files:**
- Create: `features/lark/ghi-nguoc/ngay-lark.ts`
- Test: `features/lark/ghi-nguoc/ngay-lark.test.ts`

**Interfaces:**
- Consumes: `larkEpochToVnMidnight(ms)` từ `features/lark/parse-pack-row.ts`; `larkDateField(v)` từ `features/lark/parse-brand-received.ts`; `slaCuaNuoc(cc)` từ `features/shipments/sop-giao-hang.ts`.
- Produces: `ngayLark(d: Date): number` (epoch ms nửa đêm VN của ngày-lịch VN chứa `d`); `docNgayLark(v: unknown): number | null` (ô Lark → epoch, null nếu trống); `ngayDuKien(labelCreatedAt: Date, shipCountry: string): number`.

- [ ] **Bước 1: Viết test đỏ**

```ts
// features/lark/ghi-nguoc/ngay-lark.test.ts
import { describe, it, expect } from 'vitest';
import { ngayLark, docNgayLark, ngayDuKien } from './ngay-lark';
import { larkEpochToVnMidnight } from '../parse-pack-row';

describe('ngayLark', () => {
  it('nửa đêm VN = 17:00 UTC hôm trước', () => {
    // 2026-09-19 10:30 giờ VN = 03:30Z → ngày-lịch VN 19/09 → epoch = 2026-09-18T17:00Z
    expect(ngayLark(new Date('2026-09-19T03:30:00Z'))).toBe(Date.UTC(2026, 8, 18, 17));
  });
  it('mốc 23:30 giờ VN vẫn là ngày hôm đó, không nhảy sang hôm sau', () => {
    expect(ngayLark(new Date('2026-09-19T16:30:00Z'))).toBe(Date.UTC(2026, 8, 18, 17));
    // 00:30 giờ VN ngày 20 (= 17:30Z ngày 19) → ngày 20
    expect(ngayLark(new Date('2026-09-19T17:30:00Z'))).toBe(Date.UTC(2026, 8, 19, 17));
  });
  it('đọc ngược qua larkEpochToVnMidnight ra đúng ngày-lịch', () => {
    const e = ngayLark(new Date('2026-09-19T03:30:00Z'));
    expect(larkEpochToVnMidnight(e).toISOString()).toBe('2026-09-19T00:00:00.000Z');
  });
  it('ngày "giờ-treo VN" của label_created_at (UTC nửa đêm) giữ nguyên ngày', () => {
    expect(larkEpochToVnMidnight(ngayLark(new Date('2026-09-19T00:00:00Z'))).toISOString()).toBe('2026-09-19T00:00:00.000Z');
  });
});

describe('docNgayLark', () => {
  it('số → chính nó; lookup {value:[n]} → n; trống → null', () => {
    expect(docNgayLark(1758214800000)).toBe(1758214800000);
    expect(docNgayLark({ value: [1758214800000] })).toBe(1758214800000);
    expect(docNgayLark(undefined)).toBeNull();
    expect(docNgayLark('')).toBeNull();
  });
});

describe('ngayDuKien', () => {
  it('label + SLA nước (HK = 3 ngày)', () => {
    const e = ngayDuKien(new Date('2026-09-10T00:00:00Z'), 'HK');
    expect(larkEpochToVnMidnight(e).toISOString()).toBe('2026-09-13T00:00:00.000Z');
  });
  it('nước lạ → SLA của miền cuối (không ném lỗi)', () => {
    expect(typeof ngayDuKien(new Date('2026-09-10T00:00:00Z'), 'ZZ')).toBe('number');
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `npx vitest run features/lark/ghi-nguoc/ngay-lark.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Bước 3: Viết code**

```ts
// features/lark/ghi-nguoc/ngay-lark.ts
/**
 * THUẦN: ngày dạng Lark cho ghi ngược (spec §5.2). Lark lưu ô ngày là epoch ms; bảng LOG-Export
 * dùng epoch của NỬA ĐÊM GIỜ VN (đọc vào bằng `larkEpochToVnMidnight`). Đây là chiều ngược lại.
 */
import { larkDateField } from '../parse-brand-received';
import { slaCuaNuoc } from '@/features/shipments/sop-giao-hang';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const NGAY_MS = 24 * 60 * 60 * 1000;

/** Epoch ms của nửa đêm giờ VN thuộc ngày-lịch VN chứa mốc `d`. */
export function ngayLark(d: Date): number {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  return Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - VN_OFFSET_MS;
}

/** Ô ngày trên Lark → epoch ms; trống/lạ → null. */
export function docNgayLark(v: unknown): number | null {
  return larkDateField(v);
}

/** Cam kết SOP: ngày tạo nhãn + số ngày cam kết của nước (cùng bảng KPI 1.2 dùng). */
export function ngayDuKien(labelCreatedAt: Date, shipCountry: string): number {
  return ngayLark(new Date(labelCreatedAt.getTime() + slaCuaNuoc(shipCountry) * NGAY_MS));
}
```

- [ ] **Bước 4: Chạy test, phải xanh**

Run: `npx vitest run features/lark/ghi-nguoc/ngay-lark.test.ts`
Expected: PASS (6 test). Nếu test "HK = 3 ngày" đỏ vì `slaCuaNuoc('HK')` không phải 3, đọc `CAM_KET_NUOC` trong `sop-giao-hang.ts` và sửa số trong test cho khớp — không sửa SOP.

- [ ] **Bước 5: Commit**

```bash
git add features/lark/ghi-nguoc/ngay-lark.ts features/lark/ghi-nguoc/ngay-lark.test.ts
git commit -m "feat(lark): ngày dạng Lark cho ghi ngược — nửa đêm VN, ngày dự kiến theo SLA nước

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Dựng patch — lõi luật ghi

**Files:**
- Create: `features/lark/ghi-nguoc/dung-patch.ts`
- Test: `features/lark/ghi-nguoc/dung-patch.test.ts`

**Interfaces:**
- Consumes: `mapTrangThai`, `COT`, `COT_CHI_PHI`, `ngayLark`, `docNgayLark`, `ngayDuKien`, `laNguonHang`, `larkText` (từ `../parse-pack-row`).
- Produces:

```ts
export interface KienGhiNguoc {
  deliveryStatus: string | null; deliverySource: string | null;
  deliveredAt: Date | null; labelCreatedAt: Date | null; shipCountry: string | null;
}
export interface ChargeGhiNguoc {
  totalAmount: number; base: number | null; discount: number | null; fuel: number | null; remote: number | null;
  demand: number | null; directSignature: number | null; vat: number | null; gogreen: number | null;
  elevatedRisk: number | null; importHandling: number | null; residential: number | null;
}
export interface KetQuaPatch {
  patch: Record<string, unknown>;
  /** Ô Ops gõ khác SMS: trạng thái/ngày thì ĐÃ nằm trong patch (ghi đè); chi phí thì không. */
  lech: string[];
  nhom: { trangThai: number; ngay: number; chiPhi: number };
}
export const QUY_UOC_BASE: 'niem_yet' | 'sau_chiet_khau';
export function dungPatch(kien: KienGhiNguoc, charge: ChargeGhiNguoc | null, oLark: Record<string, unknown>): KetQuaPatch;
```

- [ ] **Bước 1: Viết test đỏ**

```ts
// features/lark/ghi-nguoc/dung-patch.test.ts
import { describe, it, expect } from 'vitest';
import { dungPatch, type KienGhiNguoc, type ChargeGhiNguoc } from './dung-patch';
import { COT, COT_CHI_PHI } from './cot';
import { ngayLark, ngayDuKien } from './ngay-lark';

const kien = (p: Partial<KienGhiNguoc> = {}): KienGhiNguoc => ({
  deliveryStatus: 'in_transit', deliverySource: 'fedex', deliveredAt: null,
  labelCreatedAt: new Date('2026-09-10T00:00:00Z'), shipCountry: 'US', ...p,
});
const charge = (p: Partial<ChargeGhiNguoc> = {}): ChargeGhiNguoc => ({
  totalAmount: 1438453, base: 2244600, discount: -1541142, fuel: 383043, remote: 0, demand: 0,
  directSignature: 92700, vat: 106552, gogreen: 0, elevatedRisk: 0, importHandling: 68300, residential: 84400, ...p,
});

describe('dungPatch — nguồn', () => {
  it('nguồn lark → patch rỗng dù có đủ dữ liệu, kể cả chi phí', () => {
    const r = dungPatch(kien({ deliverySource: 'lark', deliveryStatus: 'delivered', deliveredAt: new Date() }), charge(), {});
    expect(r.patch).toEqual({});
    expect(r.nhom).toEqual({ trangThai: 0, ngay: 0, chiPhi: 0 });
  });
  it('nguồn null → patch rỗng', () => {
    expect(dungPatch(kien({ deliverySource: null }), charge(), {}).patch).toEqual({});
  });
});

describe('dungPatch — trạng thái (ghi đè)', () => {
  it('ô trống → ghi cả hai ô chọn', () => {
    const r = dungPatch(kien(), null, {});
    expect(r.patch[COT.category]).toBe('In Transit');
    expect(r.patch[COT.status]).toBe('On Delivery');
    expect(r.nhom.trangThai).toBe(2);
    expect(r.lech).toEqual([]);
  });
  it('Ops gõ khác → vẫn ghi đè + một mục lệch mỗi ô', () => {
    const r = dungPatch(kien({ deliveryStatus: 'delivered', deliveredAt: new Date('2026-09-15T08:00:00Z') }), null,
      { [COT.category]: 'In Transit', [COT.status]: 'On Delivery' });
    expect(r.patch[COT.category]).toBe('Delivered');
    expect(r.patch[COT.status]).toBe('Delivery Completed');
    expect(r.lech.filter((l) => l.includes(COT.category))).toHaveLength(1);
    expect(r.lech.filter((l) => l.includes(COT.status))).toHaveLength(1);
  });
  it('ô đã đúng → không nằm trong patch', () => {
    const r = dungPatch(kien(), null, { [COT.category]: 'In Transit', [COT.status]: 'On Delivery' });
    expect(COT.category in r.patch).toBe(false);
    expect(COT.status in r.patch).toBe(false);
    expect(r.nhom.trangThai).toBe(0);
  });
  it('trạng thái unknown → không ghi ô chọn', () => {
    const r = dungPatch(kien({ deliveryStatus: 'unknown' }), null, {});
    expect(COT.category in r.patch).toBe(false);
  });
});

describe('dungPatch — ngày', () => {
  const giao = new Date('2026-09-15T08:00:00Z');
  it('delivered + có ngày → ghi Ngày giao thực tế dạng epoch nửa đêm VN', () => {
    const r = dungPatch(kien({ deliveryStatus: 'delivered', deliveredAt: giao }), null, {});
    expect(r.patch[COT.ngayGiaoThucTe]).toBe(ngayLark(giao));
    expect(r.nhom.ngay).toBeGreaterThanOrEqual(1);
  });
  it('in_transit → không ghi Ngày giao thực tế', () => {
    expect(COT.ngayGiaoThucTe in dungPatch(kien(), null, {}).patch).toBe(false);
  });
  it('Ngày giao thực tế Ops gõ khác → ghi đè + lệch; trùng ngày → bỏ qua', () => {
    const r = dungPatch(kien({ deliveryStatus: 'delivered', deliveredAt: giao }), null, { [COT.ngayGiaoThucTe]: ngayLark(new Date('2026-09-14T08:00:00Z')) });
    expect(r.patch[COT.ngayGiaoThucTe]).toBe(ngayLark(giao));
    expect(r.lech.some((l) => l.includes(COT.ngayGiaoThucTe))).toBe(true);
    const r2 = dungPatch(kien({ deliveryStatus: 'delivered', deliveredAt: giao }), null, { [COT.ngayGiaoThucTe]: ngayLark(giao) });
    expect(COT.ngayGiaoThucTe in r2.patch).toBe(false);
  });
  it('Ngày giao dự kiến: trống → label + SLA; đã có → giữ nguyên, không lệch', () => {
    const r = dungPatch(kien(), null, {});
    expect(r.patch[COT.ngayGiaoDuKien]).toBe(ngayDuKien(new Date('2026-09-10T00:00:00Z'), 'US'));
    const r2 = dungPatch(kien(), null, { [COT.ngayGiaoDuKien]: 1 });
    expect(COT.ngayGiaoDuKien in r2.patch).toBe(false);
    expect(r2.lech).toEqual([]);
  });
  it('thiếu label hoặc nước → không ghi dự kiến', () => {
    expect(COT.ngayGiaoDuKien in dungPatch(kien({ labelCreatedAt: null }), null, {}).patch).toBe(false);
    expect(COT.ngayGiaoDuKien in dungPatch(kien({ shipCountry: null }), null, {}).patch).toBe(false);
  });
});

describe('dungPatch — chi phí (chỉ điền ô trống)', () => {
  it('ô trống → điền tổng + mọi khoản > 0, bỏ khoản 0', () => {
    const r = dungPatch(kien(), charge(), {});
    expect(r.patch[COT_CHI_PHI.totalAmount]).toBe(1438453);
    expect(r.patch[COT_CHI_PHI.fuel]).toBe(383043);
    expect(r.patch[COT_CHI_PHI.directSignature]).toBe(92700);
    expect(r.patch[COT_CHI_PHI.vat]).toBe(106552);
    expect(r.patch[COT_CHI_PHI.importHandling]).toBe(68300);
    expect(r.patch[COT_CHI_PHI.residential]).toBe(84400);
    expect(COT_CHI_PHI.remote in r.patch).toBe(false);
    expect(COT_CHI_PHI.demand in r.patch).toBe(false);
    expect(COT_CHI_PHI.gogreen in r.patch).toBe(false);
    expect(r.nhom.chiPhi).toBe(7);
  });
  it('Mức giá cơ sở theo QUY_UOC_BASE', () => {
    const r = dungPatch(kien(), charge(), {});
    // Task 1 chốt quy ước; test canh cả hai nhánh để ai đổi hằng số phải nhìn thấy.
    expect([2244600, 2244600 - 1541142]).toContain(r.patch[COT_CHI_PHI.base]);
  });
  it('ô đã có số → không ghi; khác thì lệch', () => {
    const r = dungPatch(kien(), charge(), { [COT_CHI_PHI.totalAmount]: 1400000, [COT_CHI_PHI.fuel]: 383043 });
    expect(COT_CHI_PHI.totalAmount in r.patch).toBe(false);
    expect(COT_CHI_PHI.fuel in r.patch).toBe(false);
    expect(r.lech.filter((l) => l.includes(COT_CHI_PHI.totalAmount))).toHaveLength(1);
    expect(r.lech.filter((l) => l.includes(COT_CHI_PHI.fuel))).toHaveLength(0);
  });
  it('total_amount = 0 hoặc không có charge → không ghi khoản nào', () => {
    const r = dungPatch(kien(), charge({ totalAmount: 0 }), {});
    expect(Object.keys(r.patch).some((k) => Object.values(COT_CHI_PHI).includes(k))).toBe(false);
    expect(dungPatch(kien(), null, {}).nhom.chiPhi).toBe(0);
  });
  it('sai lệch làm tròn ≤ 1đ coi như bằng', () => {
    const r = dungPatch(kien(), charge(), { [COT_CHI_PHI.totalAmount]: 1438453.4 });
    expect(r.lech).toEqual([]);
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `npx vitest run features/lark/ghi-nguoc/dung-patch.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Bước 3: Viết code** — đặt `QUY_UOC_BASE` theo kết quả Task 1.

```ts
// features/lark/ghi-nguoc/dung-patch.ts
/**
 * THUẦN: dựng bản vá cho MỘT dòng Lark LOG-Export từ kiện SMS (spec 2026-09-19 §3, §5).
 *
 * Luật: nguồn không phải hãng → không ghi gì. Trạng thái + Ngày giao thực tế GHI ĐÈ (hãng là
 * sự thật). Ngày giao dự kiến + chi phí CHỈ ĐIỀN Ô TRỐNG. Mọi ô chỉ vào patch khi KHÁC giá trị
 * hiện có. Ô Ops gõ khác SMS được liệt kê ở `lech` để nhật ký — dù có ghi đè hay không.
 */
import { larkText } from '../parse-pack-row';
import { laNguonHang } from '../nguon-hang';
import { COT, COT_CHI_PHI } from './cot';
import { mapTrangThai } from './map-trang-thai';
import { ngayLark, docNgayLark, ngayDuKien } from './ngay-lark';

export interface KienGhiNguoc {
  deliveryStatus: string | null; deliverySource: string | null;
  deliveredAt: Date | null; labelCreatedAt: Date | null; shipCountry: string | null;
}
export interface ChargeGhiNguoc {
  totalAmount: number; base: number | null; discount: number | null; fuel: number | null; remote: number | null;
  demand: number | null; directSignature: number | null; vat: number | null; gogreen: number | null;
  elevatedRisk: number | null; importHandling: number | null; residential: number | null;
}
export interface KetQuaPatch {
  patch: Record<string, unknown>;
  lech: string[];
  nhom: { trangThai: number; ngay: number; chiPhi: number };
}

/** Task 1 (Decisions D-0XX) chốt Ops gõ giá niêm yết hay giá sau chiết khấu vào "Mức giá cơ sở". */
export const QUY_UOC_BASE: 'niem_yet' | 'sau_chiet_khau' = 'niem_yet';

const SAI_SO_DONG = 1;
const docSo = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function dungPatch(kien: KienGhiNguoc, charge: ChargeGhiNguoc | null, oLark: Record<string, unknown>): KetQuaPatch {
  const kq: KetQuaPatch = { patch: {}, lech: [], nhom: { trangThai: 0, ngay: 0, chiPhi: 0 } };
  if (!laNguonHang(kien.deliverySource)) return kq;

  // Trạng thái — ghi đè.
  const tt = mapTrangThai(kien.deliveryStatus);
  if (tt) {
    for (const [cot, moi] of [[COT.category, tt.category], [COT.status, tt.status]] as const) {
      const cu = larkText(oLark[cot]);
      if (cu === moi) continue;
      if (cu != null) kq.lech.push(`${cot}: Lark "${cu}" → hãng "${moi}"`);
      kq.patch[cot] = moi; kq.nhom.trangThai++;
    }
  }

  // Ngày giao thực tế — ghi đè, chỉ khi đã giao.
  if (kien.deliveryStatus === 'delivered' && kien.deliveredAt) {
    const moi = ngayLark(kien.deliveredAt);
    const cu = docNgayLark(oLark[COT.ngayGiaoThucTe]);
    if (cu !== moi) {
      if (cu != null) kq.lech.push(`${COT.ngayGiaoThucTe}: Lark ${new Date(cu).toISOString().slice(0, 10)} → hãng ${new Date(moi).toISOString().slice(0, 10)}`);
      kq.patch[COT.ngayGiaoThucTe] = moi; kq.nhom.ngay++;
    }
  }

  // Ngày giao dự kiến — chỉ điền ô trống.
  if (kien.labelCreatedAt && kien.shipCountry && docNgayLark(oLark[COT.ngayGiaoDuKien]) == null) {
    kq.patch[COT.ngayGiaoDuKien] = ngayDuKien(kien.labelCreatedAt, kien.shipCountry); kq.nhom.ngay++;
  }

  // Chi phí — chỉ điền ô trống, thành phần 0 không ghi.
  if (charge && charge.totalAmount > 0) {
    const base = QUY_UOC_BASE === 'niem_yet' ? charge.base : (charge.base == null ? null : charge.base + (charge.discount ?? 0));
    const khoan: Record<string, number | null> = { ...charge, base };
    for (const [khoa, cot] of Object.entries(COT_CHI_PHI)) {
      const moi = khoan[khoa];
      if (moi == null || moi <= 0) continue;
      const cu = docSo(oLark[cot]);
      if (cu != null) {
        if (Math.abs(cu - moi) > SAI_SO_DONG) kq.lech.push(`${cot}: Lark ${cu} ≠ hoá đơn ${moi} (không ghi đè)`);
        continue;
      }
      kq.patch[cot] = moi; kq.nhom.chiPhi++;
    }
  }
  return kq;
}
```

- [ ] **Bước 4: Chạy test, phải xanh**

Run: `npx vitest run features/lark/ghi-nguoc/dung-patch.test.ts`
Expected: PASS (14 test).

- [ ] **Bước 5: Commit**

```bash
git add features/lark/ghi-nguoc/dung-patch.ts features/lark/ghi-nguoc/dung-patch.test.ts
git commit -m "feat(lark): dựng patch ghi ngược — hãng thắng trạng thái/ngày, chi phí chỉ điền ô trống

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Chống vòng lặp — khối freeze Lark → SMS không đè nguồn hãng

**Files:**
- Modify: `features/lark/can-freeze.ts:22-44` (ba hàm `can…`)
- Modify: `features/lark/sync.ts:300-360` (ba lệnh UPDATE trong khối freeze)
- Test: `features/lark/can-freeze.test.ts`

**Interfaces:**
- Consumes: `laNguonHang` (Task 2).
- Produces: ba hàm giữ chữ ký cũ; thêm điều kiện "kiện có nguồn hãng thì không tính".

- [ ] **Bước 1: Thêm test đỏ vào `can-freeze.test.ts`** (append cuối file, trước dòng cuối)

```ts
describe('nguồn hãng thắng Lark (spec ghi ngược §6)', () => {
  it('canDongTrangThai: kiện nguồn fedex → không đè dù Lark nói khác', () => {
    expect(canDongTrangThai([sp({ deliveryStatus: 'in_transit', deliverySource: 'fedex', trackingNumber: 'x' })], true)).toBe(false);
    expect(canDongTrangThai([sp({ deliveryStatus: 'in_transit', deliverySource: 'carrier_bill', trackingNumber: 'x' })], false)).toBe(false);
  });
  it('canDongTrangThai: nguồn lark / null vẫn như cũ', () => {
    expect(canDongTrangThai([sp({ deliveryStatus: 'in_transit', deliverySource: 'lark', trackingNumber: 'x' })], true)).toBe(true);
    expect(canDongTrangThai([sp({ deliveryStatus: 'in_transit', trackingNumber: 'x' })], true)).toBe(true);
  });
  it('canLapNgay: delivered nguồn ups thiếu ngày → để hãng tự điền, Lark không lấp', () => {
    expect(canLapNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'ups' })])).toBe(false);
    expect(canLapNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'lark' })])).toBe(true);
  });
  it('canSuaNgay vốn chỉ nguồn lark — giữ nguyên', () => {
    expect(canSuaNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'fedex', deliveredAt: new Date('2026-05-01') })], new Date('2026-05-03'))).toBe(false);
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `npx vitest run features/lark/can-freeze.test.ts`
Expected: FAIL ở hai test đầu của describe mới (`canDongTrangThai` trả true, `canLapNgay` trả true).

- [ ] **Bước 3: Sửa `can-freeze.ts`**

Thêm import đầu file:

```ts
import { laNguonHang } from './nguon-hang';
```

Thay hai hàm:

```ts
/** Lệnh 1 — đóng trạng thái giao. WHERE: chưa 'delivered' (+ đã ship nếu đánh delivered).
 *  Kiện đã có nguồn HÃNG thì Lark không đè (spec ghi ngược 19/09/2026 §6 — chống vòng lặp). */
export function canDongTrangThai(dsShipment: ShipmentHienTai[], laDelivered: boolean): boolean {
  return dsShipment.some((s) => {
    if (s.deliveryStatus === 'delivered') return false;
    if (laNguonHang(s.deliverySource)) return false;
    if (!laDelivered) return true;
    return s.trackingNumber != null || s.labelCreatedAt != null;
  });
}

/** Lệnh 2 — lấp ngày giao còn trống. WHERE: đã 'delivered' và deliveredAt NULL, nguồn không phải hãng. */
export function canLapNgay(dsShipment: ShipmentHienTai[]): boolean {
  return dsShipment.some((s) => s.deliveryStatus === 'delivered' && s.deliveredAt == null && !laNguonHang(s.deliverySource));
}
```

`canSuaNgay` đã lọc `deliverySource === 'lark'` — giữ nguyên.

- [ ] **Bước 4: Sửa WHERE trong `sync.ts`** — bộ nhớ và SQL phải cùng luật (kiện có thể đổi nguồn giữa lúc nạp và lúc ghi).

Thêm vào import từ `./can-freeze` không đổi; thêm import:

```ts
import { NGUON_HANG } from './nguon-hang';
```

Lệnh 1 (`if (canDongTrangThai(mot, laDelivered))`): thêm điều kiện vào `and(...)`:

```ts
              const res = await tx.update(schema.shipments).set(patch).where(and(
                eq(schema.shipments.id, kien.id!),
                or(isNull(schema.shipments.deliveryStatus), ne(schema.shipments.deliveryStatus, 'delivered')),
                // Nguồn hãng thắng Lark (spec ghi ngược §6).
                or(isNull(schema.shipments.deliverySource), sql`${schema.shipments.deliverySource} NOT IN ${NGUON_HANG}`),
                ...notYetShippedGuard,
              ));
```

Lệnh 2 (`if (laDelivered && canLapNgay(mot))`): thêm cùng điều kiện:

```ts
                .where(and(
                  eq(schema.shipments.id, kien.id!),
                  eq(schema.shipments.deliveryStatus, 'delivered'),
                  isNull(schema.shipments.deliveredAt),
                  or(isNull(schema.shipments.deliverySource), sql`${schema.shipments.deliverySource} NOT IN ${NGUON_HANG}`),
                ));
```

Lệnh 3 đã có `eq(deliverySource, 'lark')` — giữ nguyên. (`NGUON_HANG` là mảng JS trong `sql` template → dùng `IN`/`NOT IN`, không `= ANY` — `lib/sql-mang.test.ts` quét.)

- [ ] **Bước 5: Chạy test + type-check**

Run: `npx vitest run features/lark && npx tsc --noEmit`
Expected: PASS toàn bộ `features/lark`; tsc không lỗi.

- [ ] **Bước 6: Commit**

```bash
git add features/lark/can-freeze.ts features/lark/can-freeze.test.ts features/lark/sync.ts
git commit -m "fix(lark): trạng thái giao có nguồn hãng không bị Lark đè — chặn vòng lặp ghi ngược

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Điều phối `ghiNguocLark` + `syncLarkPacks` trả records

**Files:**
- Modify: `features/lark/sync.ts:39-48` (`LarkSyncSummary`), `:74-77` (`syncLarkPacks` nhận opts), `:368` (summary)
- Create: `features/lark/ghi-nguoc/ghi-nguoc.ts`
- Test: `features/lark/ghi-nguoc/ghi-nguoc.test.ts` (phần thuần: chế độ env, khớp record)

**Interfaces:**
- Consumes: `dungPatch`, `KienGhiNguoc`, `ChargeGhiNguoc` (Task 5); `COT` (Task 3); `updateLogRecordFields`, `LarkRecord` (`../client`); `larkText` (`../parse-pack-row`).
- Produces:

```ts
export type CheDoGhiNguoc = 'tat' | 'dry' | 'ghi';
export function cheDoGhiNguoc(env?: string): CheDoGhiNguoc;
export function khopRecordTheoCode(records: readonly LarkRecord[]): Map<string, LarkRecord>;
export interface TomTatGhiNguoc {
  cheDo: CheDoGhiNguoc; soi: number; khopLark: number; boQuaNguon: number;
  dongGhi: number; oGhi: { trangThai: number; ngay: number; chiPhi: number };
  lech: number; viDuLech: string[]; loi: number; loiMau?: string;
}
export async function ghiNguocLark(records: readonly LarkRecord[]): Promise<TomTatGhiNguoc>;
```

Và `syncLarkPacks(opts?: { giuRecords?: boolean })` → `LarkSyncSummary & { records?: LarkRecord[] }`.

- [ ] **Bước 1: Viết test đỏ (phần thuần)**

```ts
// features/lark/ghi-nguoc/ghi-nguoc.test.ts
import { describe, it, expect } from 'vitest';
import { cheDoGhiNguoc, khopRecordTheoCode } from './ghi-nguoc';

describe('cheDoGhiNguoc', () => {
  it('"1" → ghi; "dry" → dry; trống/khác → tắt', () => {
    expect(cheDoGhiNguoc('1')).toBe('ghi');
    expect(cheDoGhiNguoc('dry')).toBe('dry');
    expect(cheDoGhiNguoc('')).toBe('tat');
    expect(cheDoGhiNguoc(undefined)).toBe('tat');
    expect(cheDoGhiNguoc('yes')).toBe('tat');
  });
});

describe('khopRecordTheoCode', () => {
  it('khoá là Log Unique code; dạng chuỗi lẫn rich text; dòng không có code bị bỏ', () => {
    const m = khopRecordTheoCode([
      { record_id: 'a', fields: { 'Log Unique code': 'PK-1' } },
      { record_id: 'b', fields: { 'Log Unique code': [{ text: 'PK-2', type: 'text' }] } },
      { record_id: 'c', fields: {} },
    ]);
    expect(m.get('PK-1')?.record_id).toBe('a');
    expect(m.get('PK-2')?.record_id).toBe('b');
    expect(m.size).toBe(2);
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `npx vitest run features/lark/ghi-nguoc/ghi-nguoc.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Bước 3: Sửa `sync.ts` để trả records**

Trong `LarkSyncSummary` thêm:

```ts
  /** Record Lark đã tải — chỉ có khi gọi với `giuRecords` (ghi ngược dùng lại, khỏi đọc thêm). */
  records?: LarkRecord[];
```

Import type: đổi dòng `import { listAllRecords, listAllQcRecords } from './client';` thành `import { listAllRecords, listAllQcRecords, type LarkRecord } from './client';`.

Chữ ký: `export async function syncLarkPacks(opts?: { giuRecords?: boolean }): Promise<LarkSyncSummary> {`.

Chỗ dựng `summary` (dòng `const summary: LarkSyncSummary = { created: ... }`): thêm `...(opts?.giuRecords ? { records } : {})` vào object. Dòng ghi `larkSyncRuns` không đụng `records` nên không thay đổi.

- [ ] **Bước 4: Viết `ghi-nguoc.ts`**

```ts
// features/lark/ghi-nguoc/ghi-nguoc.ts
/**
 * Ghi ngược trạng thái giao, ngày giao, chi phí hãng lên bảng Lark LOG-Export (spec 2026-09-19).
 *
 * Chạy lồng trong cron sync-lark với record đã tải sẵn. Khớp dòng theo "Log Unique code"
 * (= shipments.log_unique_code). Một đường ghi duy nhất: updateLogRecordFields (D-045).
 * Công tắc LARK_GHI_NGUOC: 'dry' tính và ghi nhật ký nhưng không gọi Lark; '1' ghi thật.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { updateLogRecordFields, type LarkRecord } from '../client';
import { larkText } from '../parse-pack-row';
import { COT } from './cot';
import { dungPatch, type KienGhiNguoc, type ChargeGhiNguoc } from './dung-patch';

export type CheDoGhiNguoc = 'tat' | 'dry' | 'ghi';

export function cheDoGhiNguoc(env: string | undefined = process.env.LARK_GHI_NGUOC): CheDoGhiNguoc {
  if (env === '1') return 'ghi';
  if (env === 'dry') return 'dry';
  return 'tat';
}

/** THUẦN: record Lark theo Log Unique code. */
export function khopRecordTheoCode(records: readonly LarkRecord[]): Map<string, LarkRecord> {
  const m = new Map<string, LarkRecord>();
  for (const r of records) {
    const code = larkText(r.fields[COT.logUniqueCode]);
    if (code) m.set(code, r);
  }
  return m;
}

export interface TomTatGhiNguoc {
  cheDo: CheDoGhiNguoc; soi: number; khopLark: number; boQuaNguon: number;
  dongGhi: number; oGhi: { trangThai: number; ngay: number; chiPhi: number };
  lech: number; viDuLech: string[]; loi: number; loiMau?: string;
}

/** Chỉ soi kiện tạo nhãn trong 60 ngày — kiện cũ hơn đã xong việc (cùng cửa sổ courier-backfill). */
const SO_NGAY = 60;
const SO_VI_DU_LECH = 5;

interface DongKien extends KienGhiNguoc {
  code: string;
  totalAmount: string | null; base: string | null; discount: string | null; fuel: string | null; remote: string | null;
  demand: string | null; directSignature: string | null; vat: string | null; gogreen: string | null;
  elevatedRisk: string | null; importHandling: string | null; residential: string | null;
}

const so = (v: string | null): number | null => (v == null ? null : Number(v));

function chargeTu(r: DongKien): ChargeGhiNguoc | null {
  if (r.totalAmount == null) return null;
  return {
    totalAmount: Number(r.totalAmount), base: so(r.base), discount: so(r.discount), fuel: so(r.fuel), remote: so(r.remote),
    demand: so(r.demand), directSignature: so(r.directSignature), vat: so(r.vat), gogreen: so(r.gogreen),
    elevatedRisk: so(r.elevatedRisk), importHandling: so(r.importHandling), residential: so(r.residential),
  };
}

export async function ghiNguocLark(records: readonly LarkRecord[]): Promise<TomTatGhiNguoc> {
  const cheDo = cheDoGhiNguoc();
  const kq: TomTatGhiNguoc = { cheDo, soi: 0, khopLark: 0, boQuaNguon: 0, dongGhi: 0, oGhi: { trangThai: 0, ngay: 0, chiPhi: 0 }, lech: 0, viDuLech: [], loi: 0 };
  if (cheDo === 'tat') return kq;

  const theoCode = khopRecordTheoCode(records);
  // Kiện 60 ngày kèm nước và charge (một dòng shipment_charges mỗi kiện — kiểm 19/09: 1.002 kiện / 1.002 dòng).
  const { rows } = await db.execute<DongKien>(sql`
    SELECT s.log_unique_code AS code, s.delivery_status AS "deliveryStatus", s.delivery_source AS "deliverySource",
           s.delivered_at AS "deliveredAt", s.label_created_at AS "labelCreatedAt", o.ship_country AS "shipCountry",
           c.total_amount AS "totalAmount", c.base, c.discount, c.fuel, c.remote, c.demand,
           c.direct_signature AS "directSignature", c.vat, c.gogreen, c.elevated_risk AS "elevatedRisk",
           c.import_handling AS "importHandling", c.residential
      FROM shipments s
      JOIN shopify_orders o ON o.id = s.order_id
      LEFT JOIN LATERAL (SELECT * FROM shipment_charges x WHERE x.shipment_id = s.id ORDER BY x.imported_at DESC NULLS LAST LIMIT 1) c ON true
     WHERE s.log_unique_code IS NOT NULL
       AND s.label_created_at >= now() - (${SO_NGAY} || ' days')::interval`);

  for (const r of rows) {
    kq.soi++;
    const rec = theoCode.get(r.code);
    if (!rec) continue;
    kq.khopLark++;
    const kien: KienGhiNguoc = {
      deliveryStatus: r.deliveryStatus, deliverySource: r.deliverySource,
      deliveredAt: r.deliveredAt ? new Date(r.deliveredAt) : null,
      labelCreatedAt: r.labelCreatedAt ? new Date(r.labelCreatedAt) : null,
      shipCountry: r.shipCountry,
    };
    const p = dungPatch(kien, chargeTu(r), rec.fields);
    if (p.lech.length) {
      kq.lech += p.lech.length;
      for (const l of p.lech) if (kq.viDuLech.length < SO_VI_DU_LECH) kq.viDuLech.push(`${r.code} · ${l}`);
    }
    if (Object.keys(p.patch).length === 0) {
      if (kien.deliverySource == null || !['fedex', 'dhl', 'ups', 'trackingmore', 'carrier_bill'].includes(kien.deliverySource)) kq.boQuaNguon++;
      continue;
    }
    kq.oGhi.trangThai += p.nhom.trangThai; kq.oGhi.ngay += p.nhom.ngay; kq.oGhi.chiPhi += p.nhom.chiPhi;
    kq.dongGhi++;
    if (cheDo !== 'ghi') continue;
    try { await updateLogRecordFields(rec.record_id, p.patch); }
    catch (e) { kq.loi++; kq.loiMau ??= `${r.code}: ${(e as Error).message}`.slice(0, 200); }
  }
  return kq;
}
```

Sửa lại dòng đếm `boQuaNguon` cho gọn: thay biểu thức mảng chữ bằng `!laNguonHang(kien.deliverySource)` (import `laNguonHang` từ `../nguon-hang`) — không nhân bản danh sách nguồn.

- [ ] **Bước 5: Chạy test + type-check**

Run: `npx vitest run features/lark/ghi-nguoc && npx tsc --noEmit`
Expected: PASS; tsc không lỗi. Nếu tsc báo `db.execute<DongKien>` không khớp kiểu Date/string, đổi `deliveredAt`/`labelCreatedAt` trong `DongKien` thành `string | Date | null` và giữ `new Date(...)`.

- [ ] **Bước 6: Chạy thử dry thật (không ghi Lark)**

Tạo tạm `scripts/_dry.ts`:

```ts
import { listAllRecords } from '@/features/lark/client';
import { ghiNguocLark } from '@/features/lark/ghi-nguoc/ghi-nguoc';
async function main() { console.log(await ghiNguocLark(await listAllRecords())); }
main().then(() => process.exit(0));
```

Run: `LARK_GHI_NGUOC=dry railway run --service "sync Lark operation" npx tsx scripts/_dry.ts`
Expected: object có `cheDo: 'dry'`, `soi` ≈ 900–1.400, `khopLark` gần bằng `soi`, `dongGhi > 0`, `loi: 0`. Ghi 5 `viDuLech` vào báo cáo task. Xoá `scripts/_dry.ts`.

- [ ] **Bước 7: Commit**

```bash
git add features/lark/sync.ts features/lark/ghi-nguoc/ghi-nguoc.ts features/lark/ghi-nguoc/ghi-nguoc.test.ts
git commit -m "feat(lark): ghi ngược trạng thái/ngày giao/chi phí hãng lên LOG-Export — điều phối, công tắc dry/ghi

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Nối vào cron, khai việc nền, env

**Files:**
- Modify: `scripts/cron/sync-lark.ts:30-70`
- Modify: `features/jobs/registry.ts` (mảng `JOB_REGISTRY`)
- Modify: `features/jobs/groups.ts` (nhóm `'sync-lark'`)
- Modify: `.env.example`
- Test: `features/jobs/groups.test.ts` (đã có — canh mọi việc thuộc một nhóm; chỉ chạy lại)

**Interfaces:**
- Consumes: `syncLarkPacks({ giuRecords: true })`, `ghiNguocLark(records)` (Task 7), `chayMotJob(key, fn)` (`features/jobs/run.ts`).

- [ ] **Bước 1: Khai việc trong `registry.ts`** — thêm ngay sau mục `push-nhan-hang`:

```ts
  { key: 'ghi-nguoc-lark', ten: 'Ghi trạng thái giao + chi phí hãng lên Lark', chuKyPhut: CHU_KY_SYNC_LARK,
    hauQua: 'Ops phải gõ tay lại trạng thái giao, ngày giao, chi phí hãng trên LOG-Export' },
```

- [ ] **Bước 2: Xếp nhóm trong `groups.ts`**

```ts
  'sync-lark': ['sync-lark', 'push-nhan-hang', 'sync-lark-ship-ho', 'ghi-nguoc-lark'],
```

Sửa ghi chú phía trên dòng đó: thêm câu `// ghi-nguoc-lark cũng chạy LỒNG trong sync-lark.ts, dùng lại record đã tải.`

- [ ] **Bước 3: Chạy test nhóm, phải xanh**

Run: `npx vitest run features/jobs`
Expected: PASS (nếu có test đếm số việc thì cập nhật số).

- [ ] **Bước 4: Nối vào `scripts/cron/sync-lark.ts`**

Thêm import:

```ts
import { ghiNguocLark } from '@/features/lark/ghi-nguoc/ghi-nguoc';
```

Đổi `const s = await syncLarkPacks();` thành `const s = await syncLarkPacks({ giuRecords: true });`.

Thêm ngay TRƯỚC dòng `await chayMotJob('push-nhan-hang', backfillNhanHangLark);`:

```ts
  // Ghi ngược trạng thái giao, ngày giao, chi phí hãng lên LOG-Export (spec 19/09/2026). Dùng lại
  // record vừa tải — không đọc Lark thêm lượt nào. Gác env LARK_GHI_NGUOC ('dry' → chỉ báo cáo).
  await chayMotJob('ghi-nguoc-lark', () => ghiNguocLark(s.records ?? []), (tt) => {
    const t = tt as { loi: number; loiMau?: string };
    return t.loi > 0 ? `${t.loi} dòng ghi lỗi — ${t.loiMau ?? ''}` : null;
  });
```

- [ ] **Bước 5: `.env.example`** — thêm sau khối LARK hiện có:

```
# Ghi ngược LOG-Export (trạng thái giao, ngày giao, chi phí hãng): dry = chỉ báo cáo, 1 = ghi thật, trống = tắt.
LARK_GHI_NGUOC=
```

- [ ] **Bước 6: Type-check + toàn bộ test**

Run: `npx tsc --noEmit && npx vitest run`
Expected: cả hai xanh.

- [ ] **Bước 7: Commit và push**

```bash
git add scripts/cron/sync-lark.ts features/jobs/registry.ts features/jobs/groups.ts .env.example
git commit -m "feat(cron): việc ghi-nguoc-lark chạy lồng trong sync-lark, gác env LARK_GHI_NGUOC

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

---

### Task 9: Chạy dry trên Railway, bật thật, ghi sổ

**Files:**
- Modify: `/Users/macos/Obsidian/Le Minh Tiep Second Brain/Shared/Projects/Shopify-Management-System/Decisions.md`, `Activity Log.md`

**Interfaces:** không có.

- [ ] **Bước 1: Đặt env dry trên Railway**

```bash
railway variables --service "sync Lark operation" --set LARK_GHI_NGUOC=dry
```

Đợi deploy xong (`railway deployment list --service "sync Lark operation"` dòng đầu SUCCESS).

- [ ] **Bước 2: Đọc nhật ký hai lượt cron**

Run (sau ≥ 2 giờ, hoặc kích tay `railway run --service "sync Lark operation" npm run cron:sync-lark`):

```bash
railway logs --service "sync Lark operation" 2>&1 | grep "ghi-nguoc-lark"
```

Expected: dòng `✓ ghi-nguoc-lark (…ms) {"cheDo":"dry","soi":…,"khopLark":…,"dongGhi":…,"oGhi":{…},"lech":…,"loi":0…}`. Chép số `dongGhi`, `oGhi`, `lech`, `viDuLech` vào báo cáo cho CEO. **Dừng ở đây chờ CEO xem** nếu `lech` bất thường (> 20 % `dongGhi`).

- [ ] **Bước 3: Bật thật** (sau khi CEO gật)

```bash
railway variables --service "sync Lark operation" --set LARK_GHI_NGUOC=1
```

- [ ] **Bước 4: Kiểm bằng mắt sau lượt đầu**

Run: `railway logs --service "sync Lark operation" 2>&1 | grep "ghi-nguoc-lark"` → `cheDo: 'ghi'`, `loi: 0`. Rồi mở Lark LOG-Export, lọc 10 dòng `Log Unique code` mới nhất có tracking: hai ô chọn, ngày giao, cột chi phí đã có số, và `Final | Delivery Status` ra chữ có nghĩa (không "Đang xử lý" cho kiện đã giao).

- [ ] **Bước 5: Ghi sổ**

Append `Decisions.md`:

```markdown
## D-0XX · Ghi ngược Lark LOG-Export: hãng thắng trạng thái/ngày, chi phí chỉ điền ô trống (2026-09-19)
- **Mở rộng D-045.** Ngoài "chỉ điền ô trống", SMS được GHI ĐÈ ba ô `LOG-EP-Dispatch Category (Final)`, `LOG-EP-Dispatch Status`, `Ngày giao thực tế` khi kiện có nguồn hãng (`fedex|dhl|ups|trackingmore|carrier_bill`). Chi phí (11 cột, từ `shipment_charges`) và `Ngày giao dự kiến` (= tạo nhãn + SLA nước) vẫn chỉ điền ô trống.
- **Hai chiều cùng luật:** khối freeze Lark → SMS không đè kiện đã có nguồn hãng (`can-freeze.ts`, `sync.ts`). Không có luật này thì lượt sync sau đọc lại chính thứ SMS vừa ghi, đổi nguồn thành `lark`, và lượt ghi ngược kế tiếp bị chặn.
- **Khớp dòng theo `Log Unique code`**, không theo mã đơn (đơn tách kiện, D-086). Cửa sổ 60 ngày. Việc nền `ghi-nguoc-lark` chạy lồng trong `sync-lark`, dùng lại record đã tải. Công tắc `LARK_GHI_NGUOC` (dry/1).
- **Thay thế:** Ops gõ tay ~10 ô/kiện nhóm C + D trên LOG-Export (spec 2026-09-19 §1).
```

Append `Activity Log.md` (theo template `Shared/Templates/Activity Entry.md`): ngày, việc "Ghi ngược LOG-Export bước 1", số liệu lượt dry và lượt ghi đầu, commit cuối.

- [ ] **Bước 6: Báo Ops** (CEO làm): ngừng gõ 13 ô nhóm C + D; ô nào SMS chưa điền sau 2 giờ là kiện SMS chưa có dữ liệu — báo lại, không gõ.

---

## Tự soát

- **Phủ spec:** §3.1–3.6 → Task 5 (+6 cho chiều ngược); §4 → Task 7 (`khopRecordTheoCode`, cửa sổ 60 ngày); §5.1 → Task 3; §5.2 → Task 4, 5; §5.3 → Task 1, 3, 5; §6 → Task 6; §7 → Task 7, 8; §8 → cấu trúc file; §9 → test từng task + dry Task 7 bước 6 và Task 9; §10 → Task 1, 9.
- **Chữ ký nhất quán:** `laNguonHang`/`NGUON_HANG` (T2) dùng ở T5, T6, T7; `COT`, `COT_CHI_PHI`, `LUA_CHON_*` (T3) dùng ở T5, T7; `ngayLark`/`docNgayLark`/`ngayDuKien` (T4) dùng ở T5; `dungPatch`/`KienGhiNguoc`/`ChargeGhiNguoc` (T5) dùng ở T7; `ghiNguocLark`/`TomTatGhiNguoc` (T7) dùng ở T8; `syncLarkPacks({ giuRecords })` (T7) dùng ở T8.
- **Rủi ro đã ghi nhận:** kiện có nguồn hãng đang `in_transit` mà hãng chậm cập nhật `delivered` thì Lark không còn "cứu" được — chấp nhận theo spec §6; tra hãng chạy mỗi 6 giờ (`track-shipments`) và POD hoá đơn (`apply-pod`) mỗi giờ.
