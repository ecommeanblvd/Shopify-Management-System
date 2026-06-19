# Đối soát — Lọc/phân trang phía server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Chỉ gửi dòng của trang đang xem (~100) xuống client; lọc + summary + phân trang phía server trên tập cache → cắt payload 10.81 MB → ~0.5 MB.

**Architecture:** Tách logic lọc/summary/effStatus/isAutoReconciled (đang trong `ReconcileTable`) ra module thuần `reconcile-filter.ts`. `page.tsx` đọc filter+page từ URL searchParams, lọc+summary+slice phía server, truyền trang xuống. `ReconcileTable` đổi filter/page → cập nhật URL (router.replace) → server re-render.

**Tech Stack:** Next.js App Router (searchParams, server components), React (useTransition), Vitest.

## Global Constraints
- Spec: `docs/superpowers/specs/2026-06-19-reconcile-server-pagination-design.md`.
- **GIỮ NGUYÊN semantics** lọc/summary/effStatus/isAutoReconciled (chỉ DI CHUYỂN, không đổi hành vi). `MATCH_TOLERANCE_VND = 1000`.
- `PAGE_SIZE = 100`. `safePage` kẹp [0, totalPages-1]. `totalPages = max(1, ceil(n/PAGE_SIZE))`.
- Sort dòng theo `|deltaVnd|` giảm dần (như hiện tại).
- `reconcile-filter.ts` chỉ `import type` từ reconcile-view (KHÔNG kéo db/client vào client bundle — như bài học reconcile-cells).
- URL params: `carrier, status, country, minPct, q, page`. Đổi filter → page về 0.
- `router.replace` (không push) + `useTransition`; debounce ô q/minPct 300ms.
- Commands: `npx vitest run <path>`, `npx tsc --noEmit`, `npx eslint <files>`, `npm run build`. Commit body kết thúc `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure
- `features/shipments/reconcile-filter.ts` (create) — pure: `MATCH_TOLERANCE_VND`, `isAutoReconciled`, `effStatus`, `filterReconcileRows`, `reconcileSummary`, `paginate`, types `ReconcileFilters`/`ReconcileSummaryStat`.
- `features/shipments/reconcile-filter.test.ts` (create) — tests.
- `app/(dashboard)/f/shipping-reconcile/page.tsx` (modify) — đọc searchParams, lọc/summary/slice server-side, truyền page.
- `components/shipping-reconcile/ReconcileTable.tsx` (modify) — nhận page+summary+filters, filter/page → URL, bỏ lọc client.

---

## Task 1: Pure module `reconcile-filter.ts`

**Files:** Create `features/shipments/reconcile-filter.ts` + `.test.ts`.

**Interfaces — Produces:**
```ts
export const MATCH_TOLERANCE_VND = 1000;
export function isAutoReconciled(r: ReconcileViewRow): boolean
export function effStatus(r: ReconcileViewRow): ReconcileStatus
export interface ReconcileFilters { carrier: 'all'|'fedex'|'dhl'; status: 'all'|'pending'|'reconciled'|'ignored'|'carrier_error'|'disputing'|'internal_error'; country: string; minPct: string; q: string }
export function filterReconcileRows(rows: ReconcileViewRow[], f: ReconcileFilters): ReconcileViewRow[]
export interface ReconcileSummaryStat { billed: number; engine: number; delta: number; pct: number; over10: number; pendingCount: number; disputingCount: number; n: number }
export function reconcileSummary(rows: ReconcileViewRow[]): ReconcileSummaryStat
export function paginate<T>(rows: T[], page: number, size: number): { pageRows: T[]; totalPages: number; safePage: number }
```

- [ ] **Step 1: Write failing test** `features/shipments/reconcile-filter.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isAutoReconciled, effStatus, filterReconcileRows, reconcileSummary, paginate } from './reconcile-filter';
import type { ReconcileViewRow } from './reconcile-view';

const row = (o: Partial<ReconcileViewRow> = {}): ReconcileViewRow => ({
  shipmentId: 's', trackingNumber: 't', orderNumber: '#1', storeName: 'S', carrierKey: 'dhl',
  shipCountry: 'SA', shipCity: null, shipPostcode: null, addrClass: null, addrDeliverable: null, addrIssue: null,
  shopifyWeightKg: 1, weightKg: 1, chargeableKg: 1, billedWeightKg: 2, labelDate: null,
  billedTotal: 1000000, billedBase: null, billedFuel: null, billedRemote: null, billedDemand: null, billedSignature: null,
  billedResidential: null, billedAddressCorrection: null, residentialClass: null, billedVat: null, billedGogreen: null,
  billedNonConveyable: null, billedDiscount: null, billedElevatedRisk: null, billedImportHandling: null,
  engineCountryFixed: 0, engineTotal: 900000, engineBase: null, engineFuel: null, engineFuelPercent: null, billedFuelPercent: null,
  engineRemote: null, engineDemand: null, engineResidential: null, enginePeak: null, engineAddons: null, enginePerStep: null,
  engineVat: null, engineDiscount: null, engineReason: null, deltaVnd: 100000, deltaPct: 10, diagnosis: null,
  status: 'pending', staleDispute: false, note: null, billedTotalAtReview: null, carrierErrorKind: null,
  deltaVndAtReview: null, fedexQuote: null, billedBaseNet: null, engineBaseNet: null,
  ...o,
} as ReconcileViewRow);

describe('isAutoReconciled / effStatus', () => {
  it('pending + lệch nhỏ < tolerance → auto reconciled', () => {
    expect(isAutoReconciled(row({ deltaVnd: 500 }))).toBe(true);
    expect(effStatus(row({ deltaVnd: 500 }))).toBe('reconciled');
  });
  it('pending + diagnosis passthrough → auto', () => {
    expect(isAutoReconciled(row({ deltaVnd: 500000, diagnosis: { severity: 'passthrough' } as never }))).toBe(true);
  });
  it('pending + lệch to, không passthrough → vẫn pending', () => {
    expect(effStatus(row({ deltaVnd: 500000 }))).toBe('pending');
  });
  it('staleDispute → reconciled', () => {
    expect(effStatus(row({ status: 'disputing', staleDispute: true, deltaVnd: 500000 }))).toBe('reconciled');
  });
});
describe('filterReconcileRows', () => {
  const rows = [row({ carrierKey: 'dhl', shipCountry: 'SA', deltaPct: 12, orderNumber: '#AAA' }),
                row({ carrierKey: 'fedex', shipCountry: 'US', deltaPct: 3, orderNumber: '#BBB' })];
  const base = { carrier: 'all', status: 'all', country: '', minPct: '', q: '' } as const;
  it('lọc carrier', () => { expect(filterReconcileRows(rows, { ...base, carrier: 'fedex' }).length).toBe(1); });
  it('lọc country (không phân biệt hoa thường)', () => { expect(filterReconcileRows(rows, { ...base, country: 'sa' }).length).toBe(1); });
  it('lọc minPct (|deltaPct| ≥)', () => { expect(filterReconcileRows(rows, { ...base, minPct: '10' }).length).toBe(1); });
  it('lọc q theo order/tracking', () => { expect(filterReconcileRows(rows, { ...base, q: 'bbb' }).map(r=>r.orderNumber)).toEqual(['#BBB']); });
  it('sort theo |deltaVnd| giảm dần', () => {
    const r = filterReconcileRows([row({ orderNumber:'#lo', deltaVnd: 10 }), row({ orderNumber:'#hi', deltaVnd: 999 })], base);
    expect(r.map(x=>x.orderNumber)).toEqual(['#hi','#lo']);
  });
});
describe('reconcileSummary', () => {
  it('auto-reconciled fold engine=billed; pendingCount/over10 chỉ đếm pending', () => {
    const s = reconcileSummary([row({ deltaVnd: 500, billedTotal: 100, engineTotal: 80 }), // auto → engine fold 100
                                row({ deltaVnd: 500000, deltaPct: 20, billedTotal: 200, engineTotal: 150 })]); // pending, >10%
    expect(s.billed).toBe(300); expect(s.engine).toBe(250); expect(s.delta).toBe(50);
    expect(s.pendingCount).toBe(1); expect(s.over10).toBe(1); expect(s.n).toBe(2);
  });
});
describe('paginate', () => {
  it('slice + totalPages + kẹp safePage', () => {
    const r = Array.from({ length: 250 }, (_, i) => i);
    expect(paginate(r, 0, 100).pageRows.length).toBe(100);
    expect(paginate(r, 2, 100).pageRows).toEqual([200,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,224,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,248,249]);
    expect(paginate(r, 9, 100).safePage).toBe(2); // kẹp về trang cuối
    expect(paginate(r, 0, 100).totalPages).toBe(3);
  });
});
```

- [ ] **Step 2: Run → FAIL** `npx vitest run features/shipments/reconcile-filter.test.ts` (module chưa có).

- [ ] **Step 3: Implement** `features/shipments/reconcile-filter.ts` — DI CHUYỂN `MATCH_TOLERANCE_VND`, `isAutoReconciled`, `effStatus` từ `ReconcileTable.tsx` (verbatim, đổi sang `export`), thêm `filterReconcileRows`/`reconcileSummary`/`paginate` (logic verbatim từ các `useMemo` trong ReconcileTable: filter chain dòng 147-158, summary dòng 162-180, slice dòng 207-209). Header:
```ts
import type { ReconcileViewRow, ReconcileStatus } from './reconcile-view';
```
`filterReconcileRows` body = đúng chuỗi `.filter(...).sort(...)` hiện tại (carrier/status(effStatus)/country/minPct/q + sort |deltaVnd|). `reconcileSummary` body = đúng vòng for hiện tại (fold engine cho auto, đếm pending/over10/disputing). `paginate` = `totalPages = max(1, ceil(n/size)); safePage = min(max(0,page), totalPages-1); pageRows = rows.slice(safePage*size, (safePage+1)*size)`.

- [ ] **Step 4: Run → PASS**. `npx tsc --noEmit && npx eslint features/shipments/reconcile-filter.ts features/shipments/reconcile-filter.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add features/shipments/reconcile-filter.ts features/shipments/reconcile-filter.test.ts
git commit -m "feat(reconcile): tách module thuần lọc/summary/phân trang"
```

---

## Task 2: `page.tsx` lọc/phân trang server-side

**Files:** Modify `app/(dashboard)/f/shipping-reconcile/page.tsx`.

**Interfaces — Consumes:** `filterReconcileRows`, `reconcileSummary`, `paginate`, `ReconcileFilters` (T1).

- [ ] **Step 1: Đọc searchParams + lọc/slice server-side.** Trong `page.tsx`:
  - `searchParams` đã là `Promise<{...}>` — thêm các key: `carrier, status, country, minPct, q, page`.
  - Sau khi có `rows` từ `reconcileShipmentsWithStatus`:
```ts
const filters = {
  carrier: (sp.carrier as 'all'|'fedex'|'dhl') ?? 'all',
  status: (sp.status as ReconcileFilters['status']) ?? 'all',
  country: sp.country ?? '', minPct: sp.minPct ?? '', q: sp.q ?? '',
};
const filteredRows = filterReconcileRows(rows, filters);
const summary = reconcileSummary(filteredRows);
const { pageRows, totalPages, safePage } = paginate(filteredRows, Number(sp.page ?? 0) || 0, 100);
```
  - `openIssues`/`carrierErrorGroups`/`internalErrorGroups`: giữ tính trên `rows` đầy đủ (openIssues hiện tính trong ReconcileTable — CHUYỂN ra page hoặc giữ truyền `rows` cho modal? → để gọn: truyền `pageRows` cho bảng, nhưng modal "Vấn đề & Report" cần `openIssues` từ TOÀN BỘ → tính openIssues ở page bằng helper `computeOpenIssues(rows)` chuyển từ ReconcileTable, truyền xuống).
  - Truyền `<ReconcileTable rows={pageRows} summary={summary} totalPages={totalPages} safePage={safePage} totalFiltered={filteredRows.length} filters={filters} openIssues={openIssues} reports=... carrierErrors=... carrierErrorGroups=... internalErrorGroups=... />`.

- [ ] **Step 2: Verify** `npx tsc --noEmit` (sẽ báo Props ReconcileTable chưa khớp → Task 3 sửa). Build sau Task 3.

- [ ] **Step 3: Commit** (cùng Task 3 nếu tsc phụ thuộc — hoặc commit page riêng sau khi Task 3 khớp Props). Gộp commit ở Task 3.

---

## Task 3: `ReconcileTable` URL-driven + render page

**Files:** Modify `components/shipping-reconcile/ReconcileTable.tsx`.

**Interfaces — Consumes:** `ReconcileFilters`, `effStatus`, `isAutoReconciled`, `MATCH_TOLERANCE_VND` (T1); Props mới từ page (T2).

- [ ] **Step 1: Props mới + bỏ lọc client.** Đổi `Props`:
```ts
interface Props {
  rows: ReconcileViewRow[];            // ĐÃ là pageRows (đã lọc+slice)
  summary: ReconcileSummaryStat; totalPages: number; safePage: number; totalFiltered: number;
  filters: ReconcileFilters; openIssues: OpenIssue[];
  reports: IssueReportRecord[]; carrierErrors: CarrierErrorRow[];
  carrierErrorGroups: CarrierErrorGroup[]; internalErrorGroups: InternalErrorGroup[];
}
```
  - Import `effStatus`, `isAutoReconciled`, `MATCH_TOLERANCE_VND`, type `ReconcileSummaryStat`/`ReconcileFilters` từ `@/features/shipments/reconcile-filter` (BỎ định nghĩa local đã move). `deltaDirClass` giữ (dùng isAutoReconciled import).
  - BỎ: `useState` filter (carrier/status/country/minPct/q/page), `filtered`/`summary`/`openIssues`/`visible`/`totalPages`/`safePage` useMemo. Dùng thẳng props: `rows` (page), `summary`, `openIssues`, `totalPages`, `safePage`.
  - `expanded` (state mở chi tiết) GIỮ.

- [ ] **Step 2: Filter/page qua URL.** Thêm `useRouter`+`useSearchParams`+`useTransition`. Filter input value = `filters.*`; onChange → build searchParams mới (reset `page=0`) → `startTransition(() => router.replace('?'+params))`. Pagination buttons → set `page` param. Debounce `q`/`minPct` (setTimeout 300ms) trước khi replace. Hiện mờ/đang-tải khi `isPending`.
```ts
const router = useRouter(); const sp = useSearchParams();
function setParam(patch: Record<string,string>) {
  const p = new URLSearchParams(sp?.toString());
  for (const [k,v] of Object.entries(patch)) { if (v) p.set(k,v); else p.delete(k); }
  if (!('page' in patch)) p.delete('page'); // đổi filter → trang 0
  startTransition(() => router.replace(`?${p.toString()}`, { scroll: false }));
}
```
  - Carrier/status/country dropdown/input → `setParam({ carrier: v })`… `page` buttons → `setParam({ page: String(n) })`.

- [ ] **Step 3: Verify** `npx tsc --noEmit && npx eslint app/(dashboard)/f/shipping-reconcile/page.tsx components/shipping-reconcile/ReconcileTable.tsx && npx vitest run features/shipments && npm run build` → clean.

- [ ] **Step 4: Smoke** đảm bảo trang render: kiểm `npm run build` qua route `/f/shipping-reconcile` không lỗi. (Không chạy server.)

- [ ] **Step 5: Commit** (page + table)
```bash
git add app/(dashboard)/f/shipping-reconcile/page.tsx components/shipping-reconcile/ReconcileTable.tsx
git commit -m "perf(reconcile): lọc/phân trang server-side, table URL-driven (payload 10.81MB→~0.5MB)"
```

---

## Task 4: Verify toàn bộ + PR
- [ ] `npx tsc --noEmit && npx vitest run && npm run build` → pass/clean.
- [ ] Xác nhận: action duyệt (router.refresh) vẫn hoạt động; CSV export href giữ; modal "Vấn đề & Report" nhận openIssues.
- [ ] PR.

## Self-Review notes
- Spec coverage: module thuần (T1), server filter/paginate (T2), URL-driven table (T3), verify (T4).
- Semantics giữ nguyên (move verbatim) — test T1 chốt effStatus/summary/filter/paginate.
- Bundle-safe: reconcile-filter chỉ `import type` từ reconcile-view.
- Rủi ro: openIssues phải tính trên TOÀN BỘ rows (ở page), không phải pageRows — đã ghi rõ T2.
