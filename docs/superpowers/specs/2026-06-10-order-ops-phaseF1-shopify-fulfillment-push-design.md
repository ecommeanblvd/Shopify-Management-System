# Spec: Order Operations — Push Fulfillment + Tracking to Shopify (Sub-project F1)

**Ngày:** 2026-06-10
**Module:** Vận hành đơn (`/f/fulfillment`) — đóng vòng ship ↔ Shopify
**Specs nền:** [Phase 1](./2026-06-08-order-ops-fulfillment-phase1-design.md), [Sub-project D](./2026-06-09-order-ops-phaseD-pick-pack-design.md)

## 0. Bối cảnh & phạm vi

Sub-project D xây pick→pack→ship với tracking trên `shipments`, nhưng **Shopify không được cập nhật** — store/khách không thấy đơn đã giao. F1 đóng điểm cụt đó: khi ship một kiện, **tạo Shopify fulfillment** cho các line của kiện kèm tracking + carrier, gửi email tracking cho khách.

**Phạm vi F1:** đẩy fulfillment + tracking lên Shopify khi `shipPack`, theo dõi trạng thái push (retry tay khi lỗi). **Ngoài phạm vi:** return/refund (F2), đa kho/transfer (C), finance (E), CX email riêng (Phase 3).

## 1. Quyết định đã chốt

- **Tự đẩy khi ship** (sau commit), **theo dõi trạng thái** push trên `shipments`, **retry tay** bằng nút "Push lại". Không cron.
- **`notifyCustomer: true`** — Shopify gửi email tracking cho khách.
- **Chặn theo scope:** nếu store thiếu `write_fulfillments` → `shipPack` **chặn** (pre-flight, không ship gì). Lỗi push *runtime* (scope có nhưng API lỗi) thì **vẫn ship nội bộ** + đánh dấu `failed` để retry (đã giao thật, không rollback).
- **Partial per kiện:** mỗi kiện = 1 Shopify fulfillment; map line theo `shopifyLineId` qua `fulfillmentOrders` của đơn.
- **Carrier:** `fedex→'FedEx'`, `dhl→'DHL'`, khác → viết hoa key. URL để Shopify tự suy theo company.
- **Permission:** dùng lại `manage_fulfillment` (ship + push retry); không thêm scope RBAC.
- **Mutation:** `fulfillmentCreateV2` (API `2025-01`); xác minh field chính xác lúc viết plan.
- Tầng Shopify: writer fulfillment chuyên dụng `lib/shopify/fulfillment.ts` (qua `graphqlCall`+`getStoreToken`) — KHÔNG dùng `connector.runQuery` (read-only + feature-flag gate) hay `writer.runMutation` (cổng settings-sync).

## 2. Mô hình dữ liệu (`db/schema.ts`)

Thêm vào `shipments`:

| Cột | Kiểu | Ghi chú |
|----|------|--------|
| `shopifyFulfillmentId` | text | gid fulfillment Shopify trả về (null tới khi push ok) |
| `shopifyPushStatus` | enum `shopify_push_status` `['pending','pushed','failed']` (nullable) | null = chưa ship; set khi ship |
| `shopifyPushError` | text | lỗi push gần nhất |
| `shopifyPushedAt` | timestamp | mốc push thành công |

Migration: enum + 4 cột.

## 3. Luồng (mở rộng `shipPack` — features/packing/actions.ts)

1. **Pre-flight scope (chặn):** trước transaction, load store của đơn (`shopifyOrders.storeId → stores.scopes`); nếu `!scopes.includes('write_fulfillments')` → throw `'Store chưa cấp scope write_fulfillments — cần re-install'`. Không ship.
2. **Ship nội bộ** (transaction D hiện có) + set `shopifyPushStatus='pending'` trên kiện.
3. **Sau commit → `pushPackFulfillment(packId)`** (không throw ra ngoài; ghi nhận lỗi):
   - Load kiện + lines (`shopifyLineId`, qty) + đơn (`shopifyOrderId`) + store (domain/apiVersion/token).
   - Nếu `shopifyFulfillmentId` đã có → bỏ qua (idempotent).
   - Query `fulfillmentOrders` của đơn (qua `lib/shopify/fulfillment.ts`).
   - `buildFulfillmentLineItems(fulfillmentOrders, packLines)` (pure) → input `lineItemsByFulfillmentOrder`; nếu không khớp FO line nào → set `failed` + error rõ, dừng.
   - Mutation `fulfillmentCreateV2` với `trackingInfo {company, number}` + `notifyCustomer:true`.
   - OK: `shopifyFulfillmentId`=id, `shopifyPushStatus='pushed'`, `shopifyPushedAt=now`. Lỗi: `shopifyPushStatus='failed'`, `shopifyPushError`=msg.
4. **Retry tay:** `pushPackFulfillment(packId)` cũng là server action cho nút "Push lại" (gate `manage_fulfillment`), chỉ chạy khi `failed`/chưa có fulfillment id.

**Bất biến/edge:**
- Idempotent: đã có `shopifyFulfillmentId` → không tạo lần 2.
- Kiện đã shipped nhưng push `failed` → "Push lại" được; ship không bị lặp.
- Không có FO line khớp (vd line đã fulfilled ngoài app) → `failed` với lý do, không crash.

## 4. Tầng Shopify (`lib/shopify/fulfillment.ts`)

Writer fulfillment chuyên dụng (qua `graphqlCall` + `getStoreToken`):
- `getOrderFulfillmentOrders({ store, orderGid })` → trả `fulfillmentOrders` (id + lineItems: `{ id, lineItem: { id }, remainingQuantity }`).
- `createFulfillment({ store, input })` → chạy `fulfillmentCreateV2`, trả `{ fulfillmentId }` hoặc ném lỗi (gồm userErrors).
Cả hai nhận `store {shopDomain, apiVersion, token}`; token lấy qua `getStoreToken(storeId)` ở caller.

## 5. Pure logic (`features/packing/shopify-push.ts`)

Thuần, test không DB/không mạng:
- `trackingCompany(carrierKey: string | null): string` — fedex→'FedEx', dhl→'DHL', null→'Other', khác→viết hoa chữ đầu.
- `hasWriteFulfillmentsScope(scopes: string[]): boolean`.
- `buildFulfillmentLineItems(fulfillmentOrders, packLineShopifyIds: string[]): { ok: true; lineItemsByFulfillmentOrder } | { ok: false; error: string }` — với mỗi FO, chọn các lineItem có `lineItem.id ∈ packLineShopifyIds` & `remainingQuantity>0`, gom theo FO; nếu rỗng → `{ ok:false, error:'Không có dòng nào khớp fulfillment order (có thể đã fulfilled)' }`.

## 6. Permission / UI / Env

- **Permission:** `shipPack` + `pushPackFulfillment` gate `manage_fulfillment` (đã có). Không thêm.
- **UI (`PackPanel.tsx`):** mỗi kiện thêm badge push (`pending`/`pushed`/`failed`); khi `failed` hiện tooltip lỗi + nút **"Push lại"** (gọi `pushPackFulfillment`). Kiện `pushed` hiện "Đã đồng bộ Shopify".
- **Env:** thêm `write_fulfillments` vào `SHOPIFY_SCOPES` trong `.env.example` + ghi chú **re-install store** (prerequisite; store cũ phải cấp lại scope, nếu không `shipPack` sẽ chặn).

## 7. Files

- `db/schema.ts` — enum + 4 cột vào `shipments` + migration.
- `lib/shopify/fulfillment.ts` — `getOrderFulfillmentOrders`, `createFulfillment`.
- `features/packing/shopify-push.ts` + `shopify-push.test.ts` — pure logic.
- `features/packing/shopify-actions.ts` — `pushPackFulfillment(packId)`.
- `features/packing/actions.ts` — `shipPack`: pre-flight scope + gọi `pushPackFulfillment` sau commit.
- `components/fulfillment/PackPanel.tsx` — badge push + nút "Push lại".
- `.env.example` — `write_fulfillments` + ghi chú re-install.

## 8. Testing

- **Pure** (`shopify-push.test.ts`): `trackingCompany` (fedex/dhl/null/khác), `hasWriteFulfillmentsScope` (có/không), `buildFulfillmentLineItems` (khớp 1 FO, nhiều FO, rỗng→error, lọc remainingQuantity=0).
- **Manual/E2E** (sau khi re-install store có `write_fulfillments`): ship 1 kiện → Shopify hiện fulfillment + tracking + khách nhận email; ship kiện thứ 2 của cùng đơn → fulfillment thứ 2 (partial); mô phỏng lỗi (vd token sai) → status `failed`, nút "Push lại" hoạt động.

## 9. Lưu ý / tích hợp

- `shopifyOrderId`/`shopifyLineId` lưu dạng gid (khớp `fulfillmentOrders.lineItems[].lineItem.id`). Plan sẽ xác minh format thực tế trước khi map.
- Field/shape của `fulfillmentCreateV2` + `fulfillmentOrders` theo API `2025-01` (`shopifyOrders` đang pin version này) — plan dùng tài liệu Shopify để chốt mutation/field cuối cùng.
- Pre-flight scope đọc `stores.scopes` (đã cập nhật khi install/re-install). Sau khi re-install với scope mới, push chạy được ngay.
