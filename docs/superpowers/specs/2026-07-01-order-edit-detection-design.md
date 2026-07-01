# Phát hiện đơn bị chỉnh sửa (Sub-project C) — Design

> Phần C của "tối ưu bảng Vận hành đơn". Hệ thống tự sync đơn khi Shopify bắn `orders/updated`
> nhưng **ghi đè ngầm, không cờ**: không biết đơn đã bị sửa, đặc biệt **sửa sau khi đã lên vận
> đơn** (rủi ro giao theo dữ liệu cũ đã in). C thêm phát hiện + cảnh báo.

**Ngày:** 2026-07-01 · **Nhánh:** stack trên B (`feat/order-lifecycle-status`).

## 1. Cách phát hiện — "content fingerprint" (không dùng timestamp thô)
Shopify bump `updated_at` cho cả thay đổi vô hại (tag, trạng thái fulfill) → so timestamp báo
"đã sửa" nhiễu. Thay vào đó hash các field **quan trọng cho fulfill**: địa chỉ giao
(name/address1/address2/city/postcode/country) + line items `{sku, qty}` (sắp xếp, độc lập thứ tự).
Mỗi lần `upsertOrder` so hash mới với hash đã lưu:
- Khác → **có chỉnh sửa thật** → `editedAt = now`.
- Nếu lúc đó đơn **đã lên vận đơn** (tồn tại `shipments` với `tracking_number` hoặc
  `label_created_at`) → `editedAfterFulfilledAt = now` → **cảnh báo đỏ**.

Forward-looking: bắt sửa từ khi deploy (đơn đã có `content_fingerprint` làm baseline). Sửa quá khứ
không có baseline → không cờ (không đụng dữ liệu cũ).

## 2. Migration `0082_order-edit-detection.sql` (+ journal idx 82)
`ALTER TABLE shopify_orders ADD COLUMN`:
- `updated_at_shopify timestamp` — `updatedAt` từ Shopify (hiển thị "cập nhật lúc").
- `content_fingerprint text` — hash fulfill-relevant hiện tại.
- `edited_at timestamp` — lần cuối phát hiện sửa nội dung.
- `edited_after_fulfilled_at timestamp` — sửa khi đã lên vận đơn (cảnh báo).

Schema drizzle (`shopifyOrders`): thêm 4 cột tương ứng.

## 3. Bắt `updatedAt` từ Shopify
- `features/shopify-orders/sync/order-fields.ts`: thêm `updatedAt` vào GraphQL (dòng `id name createdAt processedAt cancelledAt`).
- `shopify-types.ts` `ShopifyOrderPayload`: thêm `updatedAt: string`.
- `shopify-mapper.ts`: `MappedOrder.order.updatedAtShopify: Date`; map `new Date(payload.updatedAt)`.

## 4. Hàm thuần `features/shopify-orders/sync/order-fingerprint.ts` (MỚI)
```ts
export interface FingerprintInput {
  shipName: string | null; shipAddress1: string | null; shipAddress2: string | null;
  shipCity: string | null; shipPostcode: string | null; shipCountry: string | null;
  lines: Array<{ sku: string | null; quantity: number }>;
}
export function orderContentFingerprint(i: FingerprintInput): string; // sha256 hex, THUẦN
export interface EditFlags { editedAt: Date | null; editedAfterFulfilledAt: Date | null }
export function detectEdit(args: {
  prevFingerprint: string | null; nextFingerprint: string;
  isFulfilled: boolean; now: Date;
  prevEditedAt: Date | null; prevEditedAfterFulfilledAt: Date | null;
}): EditFlags;
```
- Fingerprint: chuẩn hoá (trim/lower địa chỉ; lines sort theo sku rồi `sku:qty` nối) → sha256.
  Đổi thứ tự line KHÔNG đổi hash; đổi qty/địa chỉ ĐỔI hash.
- `detectEdit`: `prevFingerprint==null` (mới/chưa baseline) → giữ nguyên cờ cũ (không set).
  `prev==next` → giữ cờ cũ. `prev!=next` → `editedAt=now`; `isFulfilled` → `editedAfterFulfilledAt=now`,
  ngược lại giữ `prevEditedAfterFulfilledAt`. (Cờ chỉ tiến, không xoá.)

## 5. `upsertOrder` (SỬA)
- Mở rộng `prev` select (đang đọc `cancelledAtShopify`) thêm `id, contentFingerprint, editedAt,
  editedAfterFulfilledAt`.
- `isFulfilled` = có `shipments` của `prev.id` với `tracking_number IS NOT NULL OR label_created_at
  IS NOT NULL` (1 query khi có prev; insert mới → false).
- `next = orderContentFingerprint(mapped)`; `flags = detectEdit({...})`.
- Ghi vào cả `insert.values` lẫn `onConflictDoUpdate.set`: `updatedAtShopify`, `contentFingerprint`,
  và (nếu có) `editedAt`, `editedAfterFulfilledAt` từ flags. Insert mới: fingerprint set, cờ null.

## 6. UI bảng Vận hành (SỬA — stack trên B)
- `worklist-status-queries.ts`: base select thêm `updatedAtShopify, editedAt, editedAfterFulfilledAt`;
  đưa vào `WorklistStatusRow`.
- `page.tsx`: map xuống `WorklistRow`.
- `WorklistTable.tsx` cột **Đơn**: dưới store thêm badge:
  - `editedAfterFulfilledAt != null` → **⚠️ Sửa sau khi ship** (đỏ) + ngày.
  - else `editedAt != null` → **✏️ Đã sửa** (amber) + ngày.
  - hiển thị "Cập nhật: dd/MM" từ `updatedAtShopify` khi có.

## 7. Testing (Vitest, thuần) — `order-fingerprint.test.ts`
- fingerprint: đổi thứ tự line → hash GIỐNG; đổi qty / địa chỉ → hash KHÁC; input rỗng ổn định.
- detectEdit: prevNull→không cờ; prev==next→giữ cờ; khác + !fulfilled→editedAt, khác + fulfilled→cả hai;
  cờ afterFulfilled cũ không bị xoá khi sửa lần sau lúc chưa fulfilled.

## 8. Ngoài phạm vi
- Diff chi tiết "cái gì đổi" (chỉ cờ + ngày). Sửa quá khứ trước deploy. Không đụng logic sync khác.
