# Module Đối soát phí ship — Thiết kế

**Ngày:** 2026-06-08
**Trạng thái:** Đã duyệt thiết kế, chờ implementation plan

## 1. Vấn đề

Hệ thống đã có `reconcileShipments()` ([features/shipments/reconcile.ts](../../../features/shipments/reconcile.ts)) so giá carrier billed (từ `shipment_charges`) với giá engine tính. Nhưng nó **chỉ chạy dưới dạng script CLI** — không có giao diện.

Order detail hiện tại ([components/shopify-orders/OrdersTable.tsx](../../../components/shopify-orders/OrdersTable.tsx) dòng ~500-527) hiển thị **loại trừ nhau**: nếu có invoice khớp tracking thì chỉ hiện số invoice và **bỏ qua engine**; nếu chưa có invoice thì hiện breakdown engine. Không bao giờ hiện cả hai cạnh nhau, không có cột chênh lệch. Vì vậy không thể đối soát engine-vs-invoice tại order detail.

**Kết luận audit gần nhất** (2204 đơn): tổng lệch +255,6M VND (6,23%), gần như toàn bộ là FedEx (+220M). Nguyên nhân lớn nhất: thiếu lịch sử phụ phí xăng dầu FedEx trước 2026-03-09 (132M, ~52% tổng lệch). Module này giúp ops/kế toán nhìn và xử lý các lệch đó một cách hệ thống.

## 2. Mục tiêu

Một module global "Đối soát phí ship" cho phép:
- Xem mọi đơn với giá **Billed** vs **Hệ thống tính** vs **Lệch (VND, %)**.
- Drill xuống từng đơn để thấy **lệch ở khoản phí nào** (base/fuel/remote/demand/VAT/signature).
- Đánh dấu trạng thái đối soát ("đã đối soát" / "bỏ qua") lưu DB.
- Export CSV để gửi kế toán.

**Không trong phạm vi (YAGNI v1):** tự sửa rate, tự áp residential/signature, export Excel định dạng đẹp (CSV trước), precompute/cache.

## 3. Kiến trúc

### 3.1 Chiến lược tính toán: on-the-fly
Mỗi lần mở trang, server gọi `reconcileShipments()` rồi join trạng thái. Luôn dữ liệu mới, ít hạ tầng. ~2,2k quote chạy vài giây — chấp nhận được cho công cụ nội bộ. (Đã cân nhắc precompute-vào-bảng và lai; loại vì over-engineer ở v1.)

### 3.2 Route & menu
- Route mới: `app/(dashboard)/f/shipping-reconcile/page.tsx` (server component).
- Thêm 1 `NavItem` vào [lib/nav.ts](../../../lib/nav.ts): `{ href: '/f/shipping-reconcile', label: 'Đối soát phí ship', icon: <Receipt/Truck>, requires: 'view_carrier_rates' }`.
- Gate bằng quyền `view_carrier_rates` đã có — **không cần** migration RBAC.

### 3.3 Lưu trạng thái đối soát (DB)
Bảng mới `shipment_reconcile_status`:

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid pk | |
| `shipment_id` | uuid, **unique**, FK → shipments(id) on delete cascade | 1 đơn 1 trạng thái |
| `status` | text enum `'reconciled' \| 'ignored'` | **Không có record = "chưa đối soát"** |
| `note` | text nullable | ghi chú tùy chọn |
| `billed_total_at_review` | numeric(14,2) | chụp `total_amount` lúc tick → cảnh báo nếu invoice đổi sau đó |
| `reconciled_by` | text/uuid | user đánh dấu |
| `reconciled_at` | timestamp | |

Migration drizzle theo pattern các bảng hiện có trong [db/schema.ts](../../../db/schema.ts).

### 3.4 Tầng server
- `reconcileShipments()` — **giữ nguyên**, đã trả per-component billed + engine (đã bổ sung ở phiên này). Thuần tính toán, không biết status.
- Module mới `features/shipments/reconcile-view.ts`:
  - Gọi `reconcileShipments(opts)` → lấy rows.
  - Query `shipment_reconcile_status` → map theo `shipment_id` (cần `reconcileShipments` trả thêm `shipmentId` trên mỗi row — **bổ sung field này vào `ReconcileRow`**).
  - Trả `ReconcileViewRow[]` = ReconcileRow + `{ status: 'pending' | 'reconciled' | 'ignored', note, billedChangedSinceReview: boolean }`.
- Server action `setReconcileStatus(shipmentId, status, note)`:
  - Upsert vào `shipment_reconcile_status` (status `'reconciled'`/`'ignored'`), set `billed_total_at_review`, `reconciled_by` (từ session), `reconciled_at`.
  - Hỗ trợ "bỏ tick" (xóa record → về pending).
  - Kiểm tra quyền `view_carrier_rates` trước khi ghi (v1 dùng chung quyền này cho cả đọc lẫn ghi trạng thái — không tạo quyền mới).

### 3.5 Giao diện (client)
`components/shipping-reconcile/ReconcileTable.tsx`:
- **Thanh tổng**: Σ Billed · Σ Hệ thống · Σ Lệch (VND + %) · số đơn lệch >10% · số đơn chưa đối soát.
- **Bộ lọc**: carrier (fedex/dhl/all) · nước · khoảng ngày (theo `label_created_at`) · ngưỡng lệch · trạng thái (chưa/đã/bỏ qua/tất cả) · ô tìm theo order/tracking.
- **Bảng**: cột `Order | Tracking | Carrier | Nước | KG | Billed | Hệ thống | Lệch (VND) | Δ% | Trạng thái`.
  - Sort mặc định theo |lệch| giảm dần.
  - Tô màu theo mức lệch (vd: cam >10%, đỏ >25%).
  - Định dạng tiền VND, ngày dd-mm-yyyy (theo convention dự án).
  - Cờ ⚠ nếu `billedChangedSinceReview`.
  - Nút **✓ Đã đối soát** / **Bỏ qua** mỗi dòng → gọi `setReconcileStatus`.
- **Click 1 đơn → panel chi tiết**: bảng billed-vs-engine **theo từng khoản phí**:
  - Hàng: Cước gốc (net) · Fuel · Remote · Demand · Signature · VAT.
  - Cột: Billed · Hệ thống · Lệch (VND).
  - Ghi chú nguyên nhân khi nhận diện được (vd "thiếu rate xăng dầu trước 09/03/2026").

### 3.6 Xử lý "ảo giác" base/discount ⚠ (quan trọng)
Invoice itemize **list base + discount âm**; engine lưu **net base** (đã gộp discount). Nếu hiện list base thô, bảng sẽ báo "lệch ~3,5 tỷ" ở base trong khi thực tế base khớp ~99,8%.

→ Trong panel chi tiết, hàng "Cước gốc" hiển thị **net base**:
- Billed net = `billedBase + billedDiscount` (discount lưu âm).
- Engine = `engineBase`.
Dòng discount để riêng làm thông tin tham khảo, không tính vào "lệch" của base.

### 3.7 Export
- Route `app/(dashboard)/f/shipping-reconcile/export.csv/route.ts` theo pattern [gift-registry export.csv](../../../app/(dashboard)/f/functions/gift-registry).
- Nhận cùng query params như bộ lọc; xuất CSV mỗi dòng kèm đủ cột billed/engine/lệch theo từng khoản phí + trạng thái.

## 4. Luồng dữ liệu

```
page.tsx (server)
  └─ reconcile-view.ts
       ├─ reconcileShipments(opts)        → ReconcileRow[] (per-component)
       └─ db: shipment_reconcile_status   → status map
     → ReconcileViewRow[]
  → ReconcileTable.tsx (client)
       ├─ filter/sort/summary (client-side trên tập đã tải)
       ├─ row click → ReconcileDetailPanel (per-component)
       └─ status button → server action setReconcileStatus → revalidate
export.csv/route.ts → reconcile-view.ts → CSV stream
```

## 5. Xử lý lỗi
- Đơn engine không quote được (`engineReason` ≠ null): hiển thị lý do trong cột Hệ thống, không tính vào Σ lệch.
- `setReconcileStatus` lỗi quyền/DB: trả lỗi rõ ràng, UI giữ trạng thái cũ + toast.
- `billedChangedSinceReview`: chỉ cảnh báo (⚠), không tự đổi status.

## 6. Testing
- `reconcile-view.test.ts`: join status đúng (pending khi không record; reconciled/ignored khi có); cờ `billedChangedSinceReview` đúng khi billed đổi.
- Test logic **net base** (base + discount) cho cả FedEx (discount âm) và DHL (không discount).
- Test server action: upsert, bỏ tick, chặn khi thiếu quyền.

## 7. Lưu ý implementation
- **Next.js phiên bản này khác bản thường** — đọc `node_modules/next/dist/docs/` trước khi viết route/server action (theo AGENTS.md).
- Theo convention dự án: ngày dd-mm-yyyy, tiền VND, sort mới→cũ ở các chỗ liên quan thời gian.
- Field `shipmentId` cần được thêm vào `ReconcileRow` (hiện chưa có) để join status.
