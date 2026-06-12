# Spec: Duyệt lỗi carrier trong đối soát ship (Logistics) + report tổng hợp

**Ngày:** 2026-06-12
**Module:** Shipping reconcile (`/f/shipping-reconcile`)
**Specs nền:** shipping-reconcile-module, shipping-reconcile-invoice-diagnosis

## 0. Bối cảnh & quyết định (cùng operator, 2026-06-12)

Đối soát ship hiện có 2 quyết định cấp đơn ở `shipment_reconcile_status`:
**"Đã đối soát"** (`reconciled` — thường do MÌNH sửa: sai zone map, cân…) và
**"Bỏ qua"** (`ignored`). Vắng dòng = pending. Riêng cấp *nhóm vấn đề* có
`reconcile_issue_reports` (audit theo class lỗi).

Có một số khoản **lệch THẬT do FedEx/DHL tính sai** (carrier overbill). Cần một
quyết định riêng để Logistics staff **duyệt** "đây là lỗi carrier", ghi **loại
lỗi + lý do**, rồi **tổng hợp thành report** (để theo dõi / đòi/claim carrier).

Quyết định:
1. **"Duyệt" = trạng thái thứ 3 cấp đơn** `carrier_error`, ngang hàng
   `reconciled`/`ignored`. Duyệt là quyết định cuối → đơn **rời pending** (rời cả
   "Vấn đề đang mở"). Lý do **bắt buộc**.
2. Lý do gồm **dropdown loại lỗi** (phân loại để tổng hợp) + **ô ghi chú text**
   bắt buộc.
3. Report hiện ở **2 nơi**: tab thứ 3 trong modal "Vấn đề & Report" + **nút xuất
   CSV**.
4. **Không thêm bảng mới**: mở rộng `shipment_reconcile_status`; report là truy
   vấn sống các dòng `carrier_error` ⇒ "Hoàn tác" tự gỡ khỏi report.
5. **Chốt số lệch tại lúc duyệt** (`delta_vnd_at_review`) để report đúng kể cả
   khi bill import lại (giống `billed_total_at_review` đang có).

## 1. Schema (`db/schema.ts`)

- `reconcileStatusEnum`: `['reconciled','ignored']` → thêm `'carrier_error'`.
  (Postgres `ALTER TYPE reconcile_status ADD VALUE 'carrier_error'` — migration.)
- `shipmentReconcileStatus` thêm 2 cột (nullable):
  - `carrierErrorKind text('carrier_error_kind')` — chỉ set khi `carrier_error`.
  - `deltaVndAtReview numeric('delta_vnd_at_review', { precision: 16, scale: 2 })`
    — snapshot `deltaVnd` lúc duyệt.

## 2. Loại lỗi carrier (`features/shipments/carrier-error-kinds.ts`, mới)

Danh sách cố định nhỏ, dùng chung UI + validate:

```ts
export const CARRIER_ERROR_KINDS = [
  { value: 'weight',    label: 'Sai cân' },
  { value: 'zone',      label: 'Sai zone' },
  { value: 'surcharge', label: 'Phụ phí sai (demand/ký nhận/remote)' },
  { value: 'fuel',      label: 'Lệch % fuel' },
  { value: 'ratecard',  label: 'Sai rate card / chiết khấu' },
  { value: 'other',     label: 'Khác' },
] as const;
export type CarrierErrorKind = (typeof CARRIER_ERROR_KINDS)[number]['value'];
export function isCarrierErrorKind(v: string): v is CarrierErrorKind;
export function carrierErrorKindLabel(v: string): string; // value→label, fallback v
```

## 3. Hành động duyệt (`features/shipments/reconcile-status-actions.ts`)

Thêm action mới (giữ nguyên `setReconcileStatus`/`clearReconcileStatus`):

```ts
export interface ApproveCarrierErrorInput {
  shipmentId: string;
  kind: string;        // phải ∈ CARRIER_ERROR_KINDS
  note: string;        // bắt buộc
  billedTotal: number; // snapshot (như cũ)
  deltaVnd: number;    // snapshot số lệch
}
export async function approveCarrierError(input: ApproveCarrierErrorInput): Promise<void>;
```

- `requireUser()` như các action khác (perm `view_carrier_rates`).
- Validate: `note.trim()` không rỗng (throw "Cần ghi rõ lý do lỗi carrier");
  `isCarrierErrorKind(kind)` (throw "Loại lỗi không hợp lệ").
- Upsert `shipment_reconcile_status` (`onConflictDoUpdate` theo `shipmentId`):
  `status='carrier_error'`, `note`, `carrierErrorKind=kind`,
  `billedTotalAtReview=billedTotal`, `deltaVndAtReview=deltaVnd`,
  `reconciledBy=userId`, `reconciledAt=now()`.
- `revalidatePath('/f/shipping-reconcile')`.
- `clearReconcileStatus` đã xoá nguyên dòng → tái dùng để Hoàn tác (số
  `carrier_error` cũng được gỡ). Khi đổi từ `carrier_error` sang
  `reconciled`/`ignored` qua `setReconcileStatus`: phải **xoá** `carrierErrorKind`
  + `deltaVndAtReview` về null trong nhánh `set` (tránh sót snapshot cũ).

## 4. View layer (`features/shipments/reconcile-view.ts`)

- `ReconcileStatus` += `'carrier_error'`.
- `StatusRecord`: `status: 'reconciled'|'ignored'|'carrier_error'`; thêm
  `carrierErrorKind: string | null`, `deltaVndAtReview: number | null`.
- `ReconcileViewRow` += `carrierErrorKind: string | null`.
- `reconcileShipmentsWithStatus`: select thêm `carrier_error_kind`,
  `delta_vnd_at_review`; `mergeStatus` truyền `carrierErrorKind` xuống row.
- Pending derivation **không đổi**: `status !== 'pending'` ⇒ rời pending &
  openIssues (carrier_error tự rời — đúng yêu cầu).

## 5. Report (`features/shipments/carrier-error-report.ts`, mới)

Hàm thuần để TDD + 1 reader DB.

```ts
export interface CarrierErrorRow {
  shipmentId: string;
  carrierKey: string | null;
  orderName: string | null;   // join shipments/orders nếu có
  tracking: string | null;
  shipCountry: string | null;
  labelDate: Date | null;
  kind: string;               // carrierErrorKind
  note: string;               // resolution/lý do
  billedVnd: number | null;   // billedTotalAtReview
  deltaVnd: number | null;    // deltaVndAtReview
  approvedByName: string | null;
  approvedAt: Date;
}
export interface CarrierErrorGroup {
  carrierKey: string | null;
  count: number;
  sumDeltaVnd: number;
  byKind: Array<{ kind: string; count: number; sumDeltaVnd: number }>;
}
// PURE — gom theo carrier rồi theo kind, cộng deltaVnd (bỏ null).
export function summariseCarrierErrors(rows: CarrierErrorRow[]): CarrierErrorGroup[];
// DB reader: select shipment_reconcile_status WHERE status='carrier_error'
//   join shipments (tracking, carrier, ship_country, label_date, order ref),
//   left join user (approvedByName); order by approvedAt desc.
export async function listCarrierErrors(): Promise<CarrierErrorRow[]>;
```

- `summariseCarrierErrors`: ổn định thứ tự (carrier theo lần xuất hiện đầu;
  kind theo `CARRIER_ERROR_KINDS`). `deltaVnd=null` → cộng 0.
- Cột join shipments lấy đúng tên thực tế (xác minh khi code). Nếu thiếu order
  name thì để null — không chặn report.

## 6. UI cấp đơn (`components/shipping-reconcile/ReconcileDetailPanel.tsx`)

`ReconcileActions`:
- Giữ note textarea dùng chung. Thêm `<select>` **Loại lỗi carrier** (options từ
  `CARRIER_ERROR_KINDS`, mặc định rỗng "— chọn loại —").
- Thêm nút thứ 3 **"Duyệt (lỗi carrier)"** (màu hổ phách/amber) cạnh "Đã đối
  soát"/"Bỏ qua". Khoá khi `note` rỗng **hoặc** chưa chọn kind; title nhắc lý do.
  Bấm → `approveCarrierError({ shipmentId, kind, note, billedTotal, deltaVnd: row.deltaVnd ?? 0 })`.
- Khi `row.status === 'carrier_error'`: banner amber
  "✓ Đã duyệt — lỗi carrier (`<label kind>`)" + "Ghi chú: …" + nút Hoàn tác
  (`clearReconcileStatus`). Gộp chung nhánh `status !== 'pending'` hiện có, render
  nhãn theo status.

## 7. Bảng (`components/shipping-reconcile/ReconcileTable.tsx`)

- `StatusFilter` += `'carrier_error'`; thêm `<option value="carrier_error">Lỗi
  carrier</option>`.
- `OPERATOR_STATUS` += `carrier_error: { label: 'Lỗi carrier', className: amber }`.
- Badge dòng dùng map đó (đã general theo `OPERATOR_STATUS[r.status]`).
- openIssues/pendingCount: không đổi (carrier_error `!== 'pending'` nên tự loại).
- Truyền `carrierErrors` + `carrierErrorGroups` xuống `ReconcileIssuesModal`.

## 8. Report UI (`components/shipping-reconcile/ReconcileIssuesModal.tsx`)

- Thêm tab thứ 3 **"Lỗi carrier (đã duyệt)"** với badge tổng số đơn.
- Nội dung: mỗi `CarrierErrorGroup` → header carrier (FedEx/DHL/—) + `count` đơn
  + `Σ lệch` đ + dòng con theo kind. Dưới đó list `CarrierErrorRow`: order/tracking,
  nước, loại (label), lý do, người duyệt · thời gian, billed/delta.
- Nút **"Xuất CSV"** trỏ `/f/shipping-reconcile/carrier-errors.csv` (link `<a download>`).
- Props mới: `carrierErrors: CarrierErrorRow[]`, `carrierErrorGroups: CarrierErrorGroup[]`.

## 9. CSV (`app/(dashboard)/f/shipping-reconcile/carrier-errors.csv/route.ts`, mới)

- `requireUser` qua `listCarrierErrors()` (action đã chặn quyền) — cùng pattern
  route export.csv hiện có.
- Cột: `order`, `tracking`, `carrier`, `country`, `label_date`, `kind` (label),
  `reason`, `billed_vnd`, `delta_vnd`, `approved_by`, `approved_at`.
- Escape CSV như route export.csv hiện có (tái dùng helper nếu tách được, nếu
  không thì lặp tối thiểu). `Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="carrier-errors.csv"`.

## 10. Page wiring (`app/(dashboard)/f/shipping-reconcile/page.tsx`)

- `Promise.all` thêm `listCarrierErrors()`; tính `summariseCarrierErrors(rows)`;
  truyền xuống `ReconcileTable` → modal.

## 11. Kiểm thử (TDD)

- `carrier-error-kinds`: `isCarrierErrorKind` đúng/sai; `carrierErrorKindLabel`
  value→label + fallback.
- `carrier-error-report` `summariseCarrierErrors`: (a) gom 2 carrier riêng;
  (b) cộng delta đúng, null→0; (c) byKind theo thứ tự `CARRIER_ERROR_KINDS`;
  (d) rỗng → `[]`.
- `reconcile-view` `mergeStatus`: dòng `carrier_error` set `status` +
  `carrierErrorKind` đúng; dòng khác `carrierErrorKind=null`.
- UI/route: không unit test (đọc JSX/route); `tsc` + `eslint` sạch; suite hiện
  hành xanh; `next build` pass.

## 12. Migration & vận hành

- Migration: `ALTER TYPE reconcile_status ADD VALUE IF NOT EXISTS 'carrier_error';`
  + `ALTER TABLE shipment_reconcile_status ADD COLUMN carrier_error_kind text,
  ADD COLUMN delta_vnd_at_review numeric(16,2);` — theo luồng migration dự án
  (drizzle generate/push hoặc script SQL có `.env` consent). Enum add value
  **không** chạy trong transaction cùng lệnh dùng giá trị mới — tách bước.

## 13. Ngoài phạm vi

- Không claim/đòi carrier tự động (chỉ report + CSV để con người dùng).
- Không sửa engine định giá / cách diagnose.
- Không gộp carrier_error vào `reconcile_issue_reports` (2 cơ chế song song:
  issue-class vs per-đơn lỗi carrier).
- Không thêm trạng thái claim (đã đòi/đã hoàn tiền) đợt này — có thể mở rộng sau.
