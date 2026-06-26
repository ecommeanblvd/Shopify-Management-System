# Gửi ngày nhận hàng (per-sản-phẩm) sang MMP để tính công nợ — Design

> MMP cần ngày hàng về kho theo TỪNG sản phẩm (để tự phân về brand đối soát công nợ). Hiện payload
> đẩy MMP chỉ có `placedAt` (ngày đặt đơn), không có ngày nhận. Bổ sung `receivedAt` per line + re-push
> khi nhận hàng.

**Ngày:** 2026-06-25
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.
**Nhánh:** `feat/mmp-line-received-date`

## 1. Bối cảnh

Payload đơn đẩy MMP (`buildMmpOrderPayload`) gồm `orderNumber, store, recipientName, shipCountry,
placedAt, lines[{sku,title,qty,vendor}]`. Không có ngày nhận hàng. Hệ thống CÓ ngày nhận:
`goods_receipts.received_at`, nối tới line qua `goods_receipt_items.fulfillment_line_id`. MMP push đã
idempotent theo **hash payload** (`hashOrderPayload` + `shouldPushOrder`: re-push khi hash đổi).

## 2. Quyết định đã chốt

- Gửi ngày nhận **per-sản-phẩm** (mỗi line 1 `receivedAt`) — KHÔNG phải 1 mốc cấp đơn. MMP tự phân về brand.
- 1 line nhận nhiều lần → gửi ngày **mới nhất** (max `received_at`) của line đó.
- Chỉ tính item **đã allocate cho đơn** (`disposition='allocate_to_order'`) — hàng thực giữ cho đơn (công nợ).
- Re-push tự động nhờ **hash đổi**; trigger gọi `pushOrderToMmp(orderId)` **khi recordQc allocate item vào đơn**.
- Line chưa nhận → `receivedAt: null` (như placedAt khi thiếu).

## 3. Kiến trúc & luồng

```
recordQc(item) — disposition='allocate_to_order' (item nhận-cho-đơn, QC pass)
  └─ sau tx: void pushOrderToMmp(item.orderId)   (best-effort, fire-and-forget)
       └─ buildOrderMmpBody: mỗi brand line → receivedAt = max(goods_receipts.received_at)
            qua goods_receipt_items (fulfillment_line_id, disposition allocate_to_order)
       └─ hash đổi (line có receivedAt) → shouldPushOrder=true → POST MMP bản cập nhật
```

## 4. Components

### 4.1 `features/mmp/order-push-logic.ts`
- `MmpOrderLine` thêm `receivedAt: string | null` (ISO ngày nhận của sản phẩm, null nếu chưa nhận).
- `buildMmpOrderPayload`: map `receivedAt` từ `input.brandLines[].receivedAt` vào mỗi line output.
- (Comment: `receivedAt` = ngày hàng về kho cho line, để MMP đối soát công nợ theo brand.)

### 4.2 `features/mmp/order-push-logic.test.ts` (cập nhật)
- Test hiện assert bộ key line `['qty','sku','title','vendor']` → đổi thành `['qty','receivedAt','sku','title','vendor']`.
- Thêm case: line có `receivedAt` (ISO) giữ nguyên; line thiếu → `null`.

### 4.3 `features/mmp/order-outbound.ts` (`buildOrderMmpBody`)
- Sau khi lấy `fLines` (brand fulfillment lines), query aggregate ngày nhận per line:
  ```sql
  SELECT gri.fulfillment_line_id AS line_id, max(gr.received_at) AS received_at
  FROM goods_receipt_items gri
  JOIN goods_receipts gr ON gr.id = gri.receipt_id
  WHERE gri.fulfillment_line_id IN (<brand line ids>)
    AND gri.disposition = 'allocate_to_order'
  GROUP BY 1
  ```
  → `Map<lineId, Date>`. Mỗi brand line cần `id` (orderFulfillmentLines.id) trong fLines select để join map.
- `brandLines` map thêm `receivedAt: receivedMap.get(line.id)?.toISOString() ?? null`.
- Nếu không có brand line nào → giữ logic 'no brand lines' như cũ.

### 4.4 `features/receiving/actions.ts` (`recordQc`) — trigger re-push
- Sau khi transaction commit, nếu `disposition === 'allocate_to_order'` và `item.orderId` → fire-and-forget:
  ```ts
  void import('@/features/mmp/order-outbound').then(({ pushOrderToMmp }) =>
    pushOrderToMmp(item.orderId!).catch((e) => console.error('[mmp] re-push sau nhận hàng lỗi:', e)),
  );
  ```
  (best-effort; KHÔNG chặn/blow up recordQc. Dùng dynamic import tránh vòng phụ thuộc nếu có.)

## 5. Guard / lỗi

- Line chưa nhận / item chưa allocate → `receivedAt: null`.
- Re-push best-effort: lỗi push KHÔNG làm fail recordQc (đã ghi DB nhận hàng).
- Hash idempotency: payload không đổi → không re-push thừa; có receivedAt mới → re-push 1 lần.
- Item QC fail / return vendor (disposition khác allocate_to_order) → không tính vào receivedAt.

## 6. Test (TDD)

- `buildMmpOrderPayload` (thuần): line có receivedAt / null; cập nhật key-set assertion.
- aggregate per-line / trigger recordQc / re-push = integration → verify tsc + vitest + build.

## 7. Ngoài phạm vi

- Per-UNIT (mỗi đơn vị 1 dòng + ngày riêng) — dùng per-line (mới nhất) như đã chốt.
- Cron sweep re-push đơn đã sent (dựa trigger recordQc + hash là đủ).
- Đổi `placedAt` (giữ nguyên).
- Thay đổi phía MMP nhận (chỉ gửi field; MMP tự xử lý).
