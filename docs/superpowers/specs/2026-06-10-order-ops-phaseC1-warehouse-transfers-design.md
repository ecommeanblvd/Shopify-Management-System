# Spec: Order Operations — Warehouse Registry + Transfer Log (Sub-project C1)

**Ngày:** 2026-06-10
**Module:** Vận hành đơn — đa kho (mức log)
**Specs nền:** [Phase 1](./2026-06-08-order-ops-fulfillment-phase1-design.md), [Sub-project A](./2026-06-09-order-ops-phaseA-goods-receiving-qc-design.md)

## 0. Bối cảnh & phạm vi

Sheet kho theo dõi chuyển hàng giữa hub (HN↔SG): mã `HN-SG-LGDOM-…`, trạng thái, ngày gửi/nhận, đầu gửi/nhận. Hệ thống chưa có khái niệm kho hay transfer. Tồn kho hiện là **một bể gộp, key theo SKU duy nhất** (Phase 1 check/reserve/pick + receiving + F1 đều dựa vào).

**Phạm vi C1:** registry kho + **log phiếu chuyển kho** (visibility), **không** tách số dư theo kho và **không** mutate tồn (single pool). Tách bạch số dư theo kho (đổi key tồn → (kho, SKU), refactor Phase 1) là **C2 — ngoài phạm vi**, nên gộp với sub-project B (unit-level) thành một lần refactor.

## 1. Quyết định đã chốt

- **Log thuần:** transfer không thay đổi tồn (một bể gộp). Chỉ ghi nhận hàng di chuyển giữa hub.
- **Trạng thái:** `draft → in_transit → received`, có `cancelled` (từ draft/in_transit).
- **Dòng transfer:** nhập **SKU + qty** tự do (+ productTitle tùy chọn).
- **Permission:** scope mới `warehouse.transfers` (`view/create/edit`).
- **Registry kho:** bảng `warehouses`, seed **HN, SG**. `goods_receipts.warehouseCode`/`shipments.originHub` giữ nguyên text (không đụng).
- **Mã transfer:** sequence `transfer_code_seq` (start 100000) → `<fromCode>-<toCode>-<seq>` (vd `HN-SG-100001`).
- **UI:** một trang list `/f/transfers` (không tách `[id]`).

## 2. Mô hình dữ liệu (`db/schema.ts`)

### 2.1 Enum
```
transfer_status: 'draft' | 'in_transit' | 'received' | 'cancelled'
```

### 2.2 `warehouses`
| Cột | Kiểu | Ghi chú |
|----|------|--------|
| `id` | uuid PK | |
| `code` | text **unique notNull** | 'HN','SG' |
| `name` | text notNull | |
| `isActive` | boolean notNull default true | |
| `createdAt` | timestamp defaultNow notNull | |

Seed HN + SG: `INSERT ... ON CONFLICT (code) DO NOTHING` trong migration.

### 2.3 `inventory_transfers` (header)
| Cột | Kiểu | Ghi chú |
|----|------|--------|
| `id` | uuid PK | |
| `code` | text **unique notNull** | tự sinh `HN-SG-100001` |
| `fromWarehouseId` | uuid FK→`warehouses.id` notNull | |
| `toWarehouseId` | uuid FK→`warehouses.id` notNull | |
| `status` | `transfer_status` notNull default `'draft'` | |
| `note` | text | |
| `createdBy` | text FK→`user.id` set null | |
| `sentAt` | timestamp (nullable) | set khi in_transit |
| `receivedAt` | timestamp (nullable) | set khi received |
| `createdAt`/`updatedAt` | timestamp defaultNow notNull | |

Index: `inventory_transfers_status_idx` trên `status`.

### 2.4 `inventory_transfer_lines`
| Cột | Kiểu | Ghi chú |
|----|------|--------|
| `id` | uuid PK | |
| `transferId` | uuid FK→`inventory_transfers.id` cascade notNull | |
| `sku` | text notNull | |
| `productTitle` | text | tùy chọn |
| `qty` | integer notNull | >0 (validate ở action) |

Index: `inventory_transfer_lines_transfer_idx` trên `transferId`.

## 3. Luồng & state machine (không mutate tồn)

- `createTransfer({ fromWarehouseId, toWarehouseId, note, lines })` — gate `manage_transfers`; validate `from≠to`, ≥1 dòng, mỗi dòng sku non-empty + qty>0; tx: sinh code (`nextval('transfer_code_seq')` + codes từ warehouses), insert header (`draft`) + lines. Trả id. Audit.
- `markInTransit(id)` — `draft→in_transit`, set `sentAt`.
- `markReceived(id)` — `in_transit→received`, set `receivedAt`.
- `cancelTransfer(id)` — `draft|in_transit → cancelled`.
- Mọi transition validate bằng `canTransitionTransfer(from,to)` (pure). **Không** đụng `warehouse_inventory`.

## 4. Pure logic (`features/transfers/logic.ts`)

- `canTransitionTransfer(from: TransferStatus, to: TransferStatus): boolean` — hợp lệ: draft→in_transit, in_transit→received, draft→cancelled, in_transit→cancelled.
- `nextTransferCode(fromCode: string, toCode: string, seq: number): string` → `${fromCode}-${toCode}-${seq}`.
- `validateTransfer(input: { fromWarehouseId; toWarehouseId; lines: {sku;qty}[] }): { ok: true } | { ok: false; error }` — from≠to, ≥1 dòng, mỗi dòng sku.trim() != '' + qty>0.

## 5. Permission / UI

- **CATALOG** (`lib/auth/permissions.ts`): `{ key: 'warehouse.transfers', label: 'Kho — Chuyển kho', actions: ['view','create','edit'] }`.
- **rbac.ts** Permission union: `view_transfers`, `manage_transfers`.
- **permission-map.ts** `OLD_TO_NEW`: `view_transfers→['warehouse.transfers:view']`, `manage_transfers→['warehouse.transfers:view','warehouse.transfers:create','warehouse.transfers:edit']`. Thêm cả hai vào `OPERATOR_OLD`. Admin tự có.
- **Nav** (`lib/nav.ts`): "Chuyển kho" → `/f/transfers`, requires `view_transfers`.
- **UI** `/f/transfers`: form tạo phiếu (chọn from/to từ warehouses, danh sách dòng SKU+qty động, note) + danh sách phiếu (mã, from→to, status badge, ngày gửi/nhận, số dòng) + nút theo trạng thái (Đánh dấu đã gửi / Đã nhận / Hủy) gate `manage_transfers`.

## 6. Files

- `db/schema.ts` — enum + 3 bảng + migration (gồm seed HN/SG + `CREATE SEQUENCE transfer_code_seq`).
- `lib/auth/{permissions.ts, rbac.ts, permission-map.ts}` — scope/permission transfers.
- `lib/nav.ts` — mục Chuyển kho.
- `features/transfers/{logic.ts, logic.test.ts, queries.ts, actions.ts}`.
- `app/(dashboard)/f/transfers/page.tsx`.

## 7. Testing

- **Pure** (`logic.test.ts`): `canTransitionTransfer` (các cặp hợp lệ/không hợp lệ), `nextTransferCode` format, `validateTransfer` (from=to → error, 0 dòng → error, qty≤0 → error, ok).
- **Manual** (sau): tạo phiếu HN→SG với 2 dòng (mã `HN-SG-100001`) → Đánh dấu đã gửi (sentAt) → Đã nhận (receivedAt); tạo phiếu khác rồi Hủy.

## 8. Lưu ý

- C1 **không** đổi tồn kho — single pool, transfer là log logistics. Khi nào cần số dư theo kho thì làm C2 (gộp với B unit-level): đổi key `warehouse_inventory` → (warehouse, sku) và warehouse-aware check/reserve/pick.
- Mã transfer encode tuyến (`HN-SG-…`) như sheet; uniqueness từ sequence (không lexicographic/race).
