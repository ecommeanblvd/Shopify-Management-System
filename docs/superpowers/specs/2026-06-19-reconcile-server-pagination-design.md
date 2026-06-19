# Đối soát ship — Lọc & phân trang phía server (perf) — Design

**Date:** 2026-06-19
**Status:** Approved (hướng đã chốt: server-side pagination), pending spec review

## Vấn đề (đã đo)

Trang Đối soát render chậm ~1-2 phút. Đo trên dữ liệu thật:
- `reconcileShipmentsWithStatus` trả **~4.573 dòng**, payload RSC **10.81 MB** gửi
  xuống client MỖI render (serialize + truyền + hydrate) → bottleneck chính.
- Engine compute: **nguội 23s** (cache miss), **nóng 548ms** (cache hit).

Hiện `ReconcileTable` (client) nhận TOÀN BỘ rows rồi lọc + phân trang **phía client**.

## Mục tiêu
Chỉ gửi **dòng của trang đang xem** (~100) xuống client. Lọc + phân trang + summary
tính **phía server** trên tập đã cache (548ms nóng). Payload 10.81 MB → ~0.5 MB.

## Kiến trúc

### Luồng mới
1. **`page.tsx`** đọc filter + trang từ **URL searchParams** (`carrier, status,
   country, minPct, q, page`).
2. Gọi `reconcileShipmentsWithStatus` (cache) → tập đầy đủ (server giữ, không gửi
   hết).
3. **Lọc + tính summary + openIssues + group lỗi** phía server trên tập đầy đủ.
4. **Slice trang hiện tại** (~100 dòng) → truyền xuống `ReconcileTable`.
5. `ReconcileTable` đổi filter/trang → cập nhật **URL** (router.replace với
   searchParams) → server re-render (cache nóng, nhanh) → trả trang mới + payload nhỏ.

### Đơn vị tách (pure, test được) — `features/shipments/reconcile-filter.ts` (mới)
Chuyển logic lọc/summary/openIssues (hiện nằm trong `ReconcileTable`) ra hàm thuần:
```ts
export interface ReconcileFilters {
  carrier: 'all' | 'fedex' | 'dhl';
  status: 'all' | 'pending' | 'reconciled' | 'ignored' | 'carrier_error' | 'disputing' | 'internal_error';
  country: string; minPct: string; q: string;
}
export function filterReconcileRows(rows: ReconcileViewRow[], f: ReconcileFilters): ReconcileViewRow[]
export function reconcileSummary(rows: ReconcileViewRow[]): {
  billed: number; engine: number; delta: number; pct: number; over10: number; pendingCount: number;
}
export function paginate<T>(rows: T[], page: number, size: number): { pageRows: T[]; totalPages: number; safePage: number }
```
Giữ NGUYÊN semantics lọc/summary hiện có (effStatus, isAutoReconciled, MATCH_TOLERANCE…)
— chỉ DI CHUYỂN, không đổi hành vi. `effStatus`/`isAutoReconciled` cũng move sang
module thuần này (hiện ở `ReconcileTable`) để cả server + client dùng chung.

### `page.tsx`
- `searchParams` → `ReconcileFilters` + `page` (mặc định all/0).
- `const all = reconcileShipmentsWithStatus(...)` (full, cached).
- `const filtered = filterReconcileRows(all.rows, filters)`.
- `const summary = reconcileSummary(filtered)`.
- `const { pageRows, totalPages, safePage } = paginate(filtered, page, PAGE_SIZE)`.
- `openIssues`/`carrierErrorGroups`/`internalErrorGroups` tính trên `all.rows` (giữ nguyên).
- Truyền xuống `ReconcileTable`: `pageRows`, `summary`, `totalPages`, `safePage`,
  `totalFiltered`, `filters` (giá trị hiện tại), + reports/carrierErrors/groups như cũ.

### `ReconcileTable` (client)
- BỎ lọc/phân trang client-side. Nhận `pageRows` (đã lọc+slice) + `summary` + `filters`.
- Filter inputs/pagination: `onChange` → `router.replace('?'+params)` (giữ scroll) →
  server trả trang mới. Dùng `useTransition` để hiện trạng thái "đang tải" mượt.
- Detail panel (expand) vẫn dùng row trong `pageRows` (đã gồm diagnosis của ~100 dòng
  đó — ~90KB, ổn).

## Error handling / edge
- `page` ngoài khoảng → `safePage` kẹp về [0, totalPages-1].
- Filter rỗng → trả trang đầu của toàn bộ.
- `router.replace` (không `push`) để không dồn history mỗi lần gõ filter; debounce ô
  search/minPct (vd 300ms) tránh round-trip mỗi ký tự.

## Ngoài phạm vi
- **Không** đụng engine compute / cache (23s nguội là việc riêng — có thể warm cache
  sau). Mục tiêu chỉ là cắt payload + chuyển lọc/phân trang sang server.
- Không đổi các action duyệt (đã có router.refresh).
- Không đổi cột/diagnosis/logic đối soát.

## Test
- `filterReconcileRows`: từng filter (carrier/status/country/minPct/q) + kết hợp; giữ
  đúng semantics effStatus (pending/reconciled…).
- `reconcileSummary`: tổng billed/engine/delta, over10, pendingCount đúng (auto-reconciled
  tính billed=engine như hiện tại).
- `paginate`: slice + totalPages + safePage kẹp biên.
- `effStatus`/`isAutoReconciled` move: test giữ kết quả như trước (vài case).
