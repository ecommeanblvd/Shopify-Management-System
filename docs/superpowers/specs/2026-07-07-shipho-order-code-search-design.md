# Ship-hộ: mã đơn MMP + cột mã đơn gốc + search — Design

**Goal:** Đơn ship-hộ từ MMP hiển thị **đúng mã MMP tạo** (`26-INSLG-SV-XXXX`, đã gửi qua `mmpRef`) thay cho `SH{seq}` SMS tự sinh; thêm cột **"Mã đơn gốc"** (mã đơn gốc của khách, field mới MMP gửi); thêm **search** trên danh sách ship-hộ.

**Bối cảnh (đã xác minh):**
- Intake MMP: `features/ship-ho/brand-order-intake.ts` nhận `mmpRef` (bắt buộc, = mã MMP `26-INSLG-SV-XXXX`, dùng làm khoá chống trùng) rồi **SMS tự sinh `code = SH{seq}`** qua `nextBrandOrderCode()` (`brand-order-code.ts`, sequence `ship_ho_mmp_order_seq`).
- Đơn nội bộ: `features/ship-ho/orders-actions.ts` — operator **tự nhập `code`** (vd `#KLS1983`).
- Schema `ship_ho_orders`: `code` (notNull unique), `mmpRef` (nullable), `mmpOrderSeq` (bigint), `trackingNumber`, `source` ('internal'|'mmp').
- List: `app/(dashboard)/f/ship-ho/page.tsx` (server component, đọc `searchParams`, gọi `listShipHoOrders()`), cột: Mã, Đối tác, Đến, Cân, Carrier, Cước gốc, Giá thu, Trạng thái. Có nút lọc "Chỉ đơn MMP" (`?source=mmp`), CHƯA có search.

## Global Constraints
- MMP làm chủ format mã (`26-INSLG-SV-XXXX`) — SMS chỉ LƯU & HIỂN THỊ, KHÔNG sinh/parse format.
- `code` phải unique (giữ ràng buộc). `mmpRef` đã unique (idempotency) → dùng làm `code` an toàn.
- KHÔNG đổi cách sinh code của đơn NỘI BỘ (operator tự nhập).
- Search server-side (page là server component).
- tsc + vitest xanh trước push.

## Components

### A. Mã đơn MMP = `mmpRef` (bỏ SH{seq})
- **Intake mới** (`brand-order-intake.ts`): đơn MMP set `code = input.mmpRef` thay cho `nextBrandOrderCode().code`. Vẫn lấy `seq` từ sequence cho `mmpOrderSeq` (giữ thứ tự thời gian ổn định) — chỉ **thôi dùng chuỗi `SH{seq}` làm code**.
- `brand-order-code.ts`: đổi `nextBrandOrderCode()` → chỉ trả `seq` (rename `nextMmpOrderSeq(): Promise<number>`); bỏ `formatBrandOrderCode` (không còn dùng). Cập nhật mọi nơi gọi.
- **Backfill đơn MMP cũ** (script `scripts/backfill-shipho-code-from-mmpref.ts`, dry-run mặc định + `--apply`): `UPDATE ship_ho_orders SET code = mmp_ref WHERE source='mmp' AND mmp_ref IS NOT NULL AND code <> mmp_ref`. Kiểm trùng trước khi ghi (nếu mmp_ref nào trùng code đơn khác → báo, bỏ qua dòng đó, không vỡ).
- Đơn nội bộ: KHÔNG đụng.
- Event (`emitShipHoEvent`) sau đổi sẽ gửi `code == mmpRef` (cùng giá trị) — MMP nhận lại chính mã của nó, đúng ý.

### B. Cột "Mã đơn gốc" = `customerRef` (field mới)
- **Migration** `0099_shipho-customer-ref.sql` (kế tiếp sau 0098; đăng ký journal idx 99): `ALTER TABLE ship_ho_orders ADD COLUMN customer_ref text;` (+ đăng ký journal).
- **Schema**: thêm `customerRef: text('customer_ref')`.
- **Intake**: `BrandOrderInput` thêm `customerRef?: string`; lưu `customerRef: input.customerRef || null`.
- **List**: thêm cột **"Mã đơn gốc"** hiển thị `customerRef` (— nếu null). `listShipHoOrders()` trả thêm `customerRef`.
- **Contract MMP** (`docs/integrations/mmp-ship-ho-api.md` — endpoint tạo đơn): request thêm `customerRef` (mã đơn gốc của khách/brand). Optional; đơn cũ chưa có → cột hiện "—".
- Đơn nội bộ: `customerRef` null → "—".

### C. Search
- **List** (`page.tsx`): thêm form GET với input `q` (giữ `source` filter). Hiển thị ô "Tìm mã đơn / mã gốc / tracking…".
- **Query** (`listShipHoOrders(opts?: { q?: string })`): khi `q` có, filter `WHERE` (ILIKE `%q%`) trên: `code`, `customer_ref`, `tracking_number`, `recipient_name`, và tên brand (`mmp_brands.name`)/`partner_brand_slug`. Trim; rỗng → không lọc.
- Kết hợp với filter `source=mmp` sẵn có (AND).

## Data Flow
MMP tạo đơn → POST intake (`mmpRef` = `26-INSLG-SV-XXXX`, `customerRef` = mã gốc khách) → SMS lưu `code=mmpRef`, `customerRef`, `mmpRef` → list hiển thị cột Mã (code) + Mã đơn gốc (customerRef) → operator search theo `?q=`.

## Error Handling
- Backfill: dòng nào `mmp_ref` trùng `code` đơn khác → log + skip (không đổi), không vỡ script.
- Intake thiếu `customerRef`: cho phép (optional) → null.
- Search `q` rỗng/space → bỏ lọc.

## Testing
- `nextMmpOrderSeq` / bỏ format: unit (seq tăng).
- Intake: đơn MMP → `code === mmpRef`, `customerRef` lưu đúng (test thuần logic map, mock DB nếu cần — theo tiền lệ brand-estimate).
- Search filter: hàm thuần lọc theo `q` (nếu tách được) hoặc test query.
- Backfill: pure function tính dòng cần update + phát hiện trùng.
- Full tsc + vitest xanh.

## Deploy
- Migration `customer_ref` chạy prod (`railway run npm run db:migrate`).
- Backfill code chạy prod (script `--apply`) + verify.
- Contract doc cho MMP gửi `customerRef`.

## Open (chốt lúc plan)
- Đơn nội bộ có cần cột "Mã đơn gốc" điền tay không — v1 để null ("—"), thêm sau nếu cần.
