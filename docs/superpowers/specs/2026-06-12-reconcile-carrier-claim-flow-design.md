# Spec: Flow lỗi carrier theo khoản + đòi lại NCC (đối soát ship)

**Ngày:** 2026-06-12
**Module:** Shipping reconcile (`/f/shipping-reconcile`)
**Specs nền:** reconcile-carrier-error-approval (status `carrier_error` + report), reconcile-invoice-diagnosis (chẩn đoán theo khoản)

## 0. Bối cảnh & quyết định (cùng operator, 2026-06-12)

Đã có nút "Duyệt (lỗi carrier)" gộp + loại lỗi thô (weight/zone/surcharge/fuel/
ratecard/other). Operator cần:
1. Chọn **lỗi cụ thể theo từng khoản** (không gộp "surcharge").
2. **Ẩn nút "Đã xử lý"** ở đơn lệch; chỉ thao tác sau khi chọn loại lỗi cụ thể.
3. Khoản **NCC thu vượt (billed > engine)** phải **đòi lại NCC**: đơn sang trạng
   thái *đang đòi*, **vẫn mở**, chỉ **Duyệt** được khi NCC sửa & gửi bill mới làm
   billed **khớp** engine.

Quyết định (operator chốt):
- Danh sách lỗi: **8 loại theo khoản + Khác**, **auto-gợi ý** từ chẩn đoán engine.
- **billed > engine** → chỉ cho **"Đối soát lại với NCC"** (→ `disputing`); Duyệt
  **khoá** tới khi khớp. **billed ≤ engine** → cho **"Duyệt chênh lệch"** thẳng.
- `disputing` có **filter riêng** + **chốt số lệch gốc** (số đang/đã đòi) cho report.

## 1. Loại lỗi cụ thể + biện pháp (`features/shipments/carrier-error-kinds.ts`)

Mở rộng `CARRIER_ERROR_KINDS` thành 9 mục `{ value, label, remediation }`:

| value | label | remediation (1 dòng gợi ý) |
|---|---|---|
| `weight` | Sai cân | Đối chiếu cân thực/dim; nếu NCC cân sai → yêu cầu cân lại & điều chỉnh bill. |
| `zone` | Sai zone | Đối chiếu zone trên rate card NCC; nếu NCC sai → đòi sửa zone & gửi bill mới. |
| `fuel` | Sai phụ phí xăng dầu (fuel) | Đối chiếu % fuel tuần label; nếu NCC áp sai → đòi điều chỉnh. |
| `remote` | Sai phụ phí vùng xa (remote) | Kiểm tra ODA/postcode; nếu NCC tính remote sai → đòi gỡ/điều chỉnh. |
| `demand` | Sai phụ phí nhu cầu (demand) | Đối chiếu biểu demand theo ngày; nếu sai mốc → đòi điều chỉnh. |
| `signature` | Sai phụ phí ký nhận | Xác nhận có yêu cầu ký nhận không; nếu NCC thu nhầm → đòi gỡ. |
| `vat` | Sai VAT | Kiểm VAT 8% trên đúng cơ sở; nếu NCC tính sai gốc → đòi tính lại. |
| `ratecard` | Sai rate card / chiết khấu | Đối chiếu rate/chiết khấu hợp đồng; nếu NCC áp sai card → đòi áp đúng. |
| `other` | Khác | Ghi rõ ở ô lý do; làm việc trực tiếp với NCC. |

- `carrierErrorKindLabel(v)`: thêm **legacy map** để loại cũ `surcharge` vẫn hiển
  thị ("Phụ phí sai") — không vào danh sách chọn.
- Thêm `carrierErrorKindRemediation(v): string` trả dòng biện pháp (fallback '').

## 2. Helper flow thuần (`features/shipments/carrier-error-flow.ts`, TDD)

```ts
import type { ReconcileDiagnosis, DiagnosisSeverity } from './reconcile-diagnose';

/** Gợi ý loại lỗi từ khoản lệch LỚN NHẤT (|delta|) khác KHOP. '' nếu không rõ. */
export function suggestCauseKind(diagnosis: ReconcileDiagnosis | null | undefined): string;

/** billed > engine ⇒ NCC thu vượt ⇒ phải đòi. deltaVnd = billed − engine. */
export function needsCarrierClaim(deltaVnd: number | null): boolean; // deltaVnd != null && deltaVnd > 0

/** Đơn đang đòi chỉ DUYỆT được khi bill mới đã khớp. */
export function isApprovableMatch(severity: DiagnosisSeverity | null | undefined): boolean; // 'match' | 'rounding'
```

`suggestCauseKind` mapping (component key + cause → value), chọn component
`cause !== 'KHOP'` có `|delta|` lớn nhất:
- `base` + `SAI_CAN` → `weight`; `base` + `SAI_ZONE` → `zone`;
  `base`/`discount` + `LECH_RATE_CARD`/`LECH_CHIET_KHAU`/`LECH_FUEL_BASE` → `ratecard`.
- `fuel` → `fuel`; `remote` → `remote`; `demand` → `demand`;
  `signature` → `signature`; `vat` → `vat`.
- còn lại (`gogreen`/`elevatedRisk`/`residual`/không khớp nhánh trên) → `other`.

## 3. Schema (`db/schema.ts` + migration)

- `reconcileStatusEnum`: thêm `'disputing'` → `['reconciled','ignored','carrier_error','disputing']`.
- Tái dùng cột sẵn có: `disputing` lưu `carrierErrorKind` (loại lỗi), `note`,
  `deltaVndAtReview` (**số lệch gốc đang đòi**), `billedTotalAtReview`, `reconciledBy`,
  `reconciledAt`. KHÔNG thêm cột.
- Migration `scripts/migrate-reconcile-disputing.ts`:
  `ALTER TYPE reconcile_status ADD VALUE IF NOT EXISTS 'disputing'` (tách statement).

## 4. Actions (`features/shipments/reconcile-status-actions.ts`)

```ts
export interface DisputeCarrierInput {
  shipmentId: string; kind: string; note: string;
  billedTotal: number; deltaVnd: number; // lệch gốc (snapshot)
}
/** Mở đòi NCC: đơn sang 'disputing', chốt loại lỗi + số lệch gốc. */
export async function disputeWithCarrier(input: DisputeCarrierInput): Promise<void>;
```
- Validate như `approveCarrierError`: note bắt buộc + `isCarrierErrorKind(kind)`.
- Upsert status `disputing` + snapshot (giống approve, khác `status`).
- `approveCarrierError` **giữ nguyên**. Khi duyệt đơn đang `disputing`, UI truyền
  `deltaVnd = số lệch gốc` (row.deltaVndAtReview) + `kind = row.carrierErrorKind`
  → report giữ đúng số đã đòi (không bị 0 do bill đã khớp).
- `clearReconcileStatus` (Hoàn tác) dùng chung — gỡ cả `disputing`.

## 5. View (`features/shipments/reconcile-view.ts`)

- `ReconcileStatus` += `'disputing'`.
- `ReconcileViewRow` += `deltaVndAtReview: number | null` (đã có `carrierErrorKind`).
- `mergeStatus`: truyền thêm `deltaVndAtReview: rec?.deltaVndAtReview ?? null`.
- `disputing` `!== 'pending'` ⇒ rời pending & openIssues (đã triage) — đúng ý: có
  filter riêng để theo dõi.

## 6. UI panel (`components/shipping-reconcile/ReconcileDetailPanel.tsx`)

`ReconcileActions` theo trạng thái:

**A. Đơn KHỚP (isClean):** giữ nguyên — "✓ Xác nhận khớp" + "Bỏ qua".

**B. Đơn LỆCH, pending:**
- Ô lý do (bắt buộc) + `<select>` **loại lỗi cụ thể** (mặc định = `suggestCauseKind`).
- Dưới select: dòng **biện pháp** `carrierErrorKindRemediation(kind)`.
- Hành động hiện **sau khi có loại lỗi** (`kind` set), rẽ theo `needsCarrierClaim(row.deltaVnd)`:
  - **true (billed > engine):** nút **"Đối soát lại với NCC"** (amber) →
    `disputeWithCarrier({…, deltaVnd: row.deltaVnd ?? 0})`. KHÔNG có "Duyệt chênh lệch".
  - **false (billed ≤ engine):** nút **"✓ Duyệt chênh lệch"** →
    `approveCarrierError({…, deltaVnd: row.deltaVnd ?? 0})`.
- Luôn có **"Bỏ qua"**. KHÔNG còn nút "Đã xử lý".
- Khoá nút chính khi `noteEmpty || !kind`; nhắc lý do/loại lỗi.

**C. Đơn `disputing`:** băng "⏳ Đang đòi NCC — `<label kind>` · lệch gốc
`fmtVnd(deltaVndAtReview)`đ · `note` · `ai/khi nào`". Kèm:
- Nếu `isApprovableMatch(row.diagnosis?.severity)` (bill mới đã khớp): nút
  **"✓ Duyệt chênh lệch"** mở khoá →
  `approveCarrierError({ shipmentId, kind: row.carrierErrorKind!, note: row.note ?? '',
   billedTotal: row.billedTotal, deltaVnd: row.deltaVndAtReview ?? 0 })`.
- Nếu chưa khớp: nút disabled + chú thích "Chờ NCC sửa bill cho khớp mới duyệt được".
- Luôn có **"Hoàn tác"** (`clearReconcileStatus`).

**D. `carrier_error` / `reconciled` / `ignored`:** băng đóng như hiện có (thêm nhánh
`disputing` ở chỗ render nhãn nếu cần).

## 7. Bảng (`components/shipping-reconcile/ReconcileTable.tsx`)

- `StatusFilter` += `'disputing'`; thêm `<option value="disputing">Đang đòi NCC</option>`.
- `OPERATOR_STATUS` += `disputing: { label: 'Đang đòi NCC', className: sky/blue }`.
- Thêm 1 Stat "Đang đòi NCC" = đếm `status==='disputing'` (không gộp vào pending).
- openIssues/pendingCount: không đổi (disputing tự loại do `!== 'pending'`).

## 8. Report (`features/shipments/carrier-error-report.ts` + modal)

- `CarrierErrorRow` += `state: 'disputing' | 'approved'`.
- `listCarrierErrors`: đọc `status IN ('carrier_error','disputing')`; map
  `state = status==='disputing' ? 'disputing' : 'approved'`. `deltaVnd` = `deltaVndAtReview`
  (số lệch gốc).
- Modal tab "Lỗi carrier": tách **2 mục** — "⏳ Đang đòi NCC (n · Σ lệch gốc)" và
  "✓ Đã duyệt (n · Σ)". Mỗi đơn badge state. `summariseCarrierErrors` dùng cho mục
  "đã duyệt" (lọc `state==='approved'`); mục đang đòi liệt kê trực tiếp.
- CSV (`carrier-errors.csv`): thêm cột `state` (đang đòi/đã duyệt).
- `page.tsx`: truyền rows (đã gồm cả 2 state) + groups (approved).

## 9. Kiểm thử (TDD)

- `carrier-error-flow`: (a) suggestCauseKind chọn |delta| lớn nhất → đúng value cho
  từng key/cause; (b) base+SAI_CAN→weight, base+SAI_ZONE→zone, ratecard, fuel/remote/
  demand/signature/vat, fallback other; (c) diagnosis null → ''; (d) needsCarrierClaim:
  >0 true, ≤0/null false; (e) isApprovableMatch: match/rounding true, khác false.
- `carrier-error-kinds`: 9 value, remediation có cho từng loại, legacy `surcharge` label.
- `reconcile-view` mergeStatus: dòng `disputing` mang status + carrierErrorKind +
  deltaVndAtReview; dòng khác null.
- `carrier-error-report` summarise + state: lọc approved đúng; disputing có state.
- UI/route: không unit test; tsc + eslint sạch; suite xanh; build pass.

## 10. Migration & vận hành

- Chạy `scripts/migrate-reconcile-disputing.ts` (enum add value, ngoài transaction).
- Không ảnh hưởng dữ liệu cũ; `carrier_error` đã duyệt giữ nguyên (state='approved').

## 11. Ngoài phạm vi

- Không tự gửi email/claim cho NCC (chỉ theo dõi trạng thái + report).
- Không tự phát hiện "bill mới đã khớp" để auto-duyệt — operator bấm Duyệt khi nút mở.
- Không đụng engine định giá / cách import (đã có upsert 1:1).
- Chưa thêm lịch sử nhiều vòng đòi (1 lần đòi → khớp → duyệt; đòi lại thì Hoàn tác rồi mở lại).
