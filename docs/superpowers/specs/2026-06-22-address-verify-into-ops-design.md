# Verify địa chỉ FedEx vào luồng vận hành (hệ #1) — Design

> Sub-project #1 của chương trình vận hành đơn (verify địa chỉ → báo brand → follow-up →
> KCS → đóng gói → label FedEx/DHL → theo dõi). Các hệ #2–#5 là spec riêng sau.

**Ngày:** 2026-06-22
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.

## 1. Mục tiêu

FedEx Address Validation **đã build sẵn** nhưng chỉ chạy dạng **batch script tay**
(`scripts/verify-shopify-addresses.ts`). Trang vận hành đơn có `AddressVerifyCard` **chỉ
hiển thị** kết quả có sẵn → đơn chưa chạy script thì "Chưa verify".

Cần **gắn verify vào luồng vận hành**: đơn mới **tự verify** khi sync; operator có **nút
"Verify lại"** per-đơn để chạy lại sau khi sửa địa chỉ.

## 2. Đã có sẵn (tái dùng, KHÔNG đụng)

- `lib/fedex/address.ts`: `verifyAddress(AddressInput) → AddressVerification {classification,
  deliverable, issue, standardized}` (gọi FedEx `/address/v1/addresses/resolve`).
- Schema `shopify_orders`: `addrClass, addrDeliverable, addrIssue, addrStandardized,
  addrVerifiedAt` (đã có).
- `components/fulfillment/AddressVerifyCard.tsx`: hiển thị class/giao-được/issue/chuẩn-hoá,
  viền đỏ khi `addrDeliverable=false`.
- `scripts/verify-shopify-addresses.ts`: batch verify đơn chưa verify (rate-limit 300ms).

## 3. Quyết định đã chốt

- **Trigger: CẢ HAI** — auto khi sync đơn mới (cron) + nút "Verify lại" per-đơn.

## 4. Kiến trúc & component

### `features/shopify-orders/address-verify.ts` (mới — lõi dùng chung)
- `buildAddressInput(order): AddressInput` — **THUẦN**: map field đơn (shipAddress1/2, city,
  provinceCode, postcode, country) → `AddressInput`. Test thuần.
- `verifyAndStoreOrderAddress(orderId): Promise<{ ok: boolean; deliverable?: boolean; issue?: string | null; error?: string }>` —
  đọc đơn → `buildAddressInput` → `verifyAddress` → update `addrClass/addrDeliverable/
  addrIssue/addrStandardized/addrVerifiedAt`. Lõi per-đơn (dùng bởi nút + batch).
  - Đơn không có `shipAddress1` hoặc `shipCountry` → trả `{ ok:false, error:'no address' }`,
    không gọi API.
- `verifyUnverifiedAddresses(opts?: { limit?: number }): Promise<{ verified: number; undeliverable: number; failed: number }>` —
  batch: chọn đơn `addrVerifiedAt IS NULL AND shipAddress1 IS NOT NULL AND shipCountry IS NOT NULL`,
  order theo `processedAtShopify` desc, limit (mặc định cron 100). Loop
  `verifyAndStoreOrderAddress`, **rate-limit 300ms**, lỗi từng đơn → đếm `failed`, không
  chặn đơn khác.

### `features/shopify-orders/address-verify-actions.ts` (mới — server action)
- `verifyOrderAddressAction(orderId): Promise<{ ok: boolean; deliverable?: boolean; issue?: string | null; error?: string }>` —
  `'use server'`, gate `manage_fulfillment` (pattern requireUser cục bộ như các action khác),
  gọi `verifyAndStoreOrderAddress`, `revalidatePath` trang vận hành. **Nút verify lại bất kể
  đã verify** (re-verify sau khi sửa địa chỉ).

### UI — nút "Verify lại"
- Component client nhỏ (vd `AddressVerifyButton.tsx`) cạnh/within `AddressVerifyCard` khu vực
  trang vận hành đơn: `useTransition` → `verifyOrderAddressAction(orderId)` → hiện kết quả
  ngắn (✓ giao được / ⚠ + issue / lỗi) → `router.refresh()`. `import` action ('use server')
  an toàn cho client.

### Cron — auto-verify đơn mới
- Chain `verifyUnverifiedAddresses({ limit: 100 })` vào `scripts/cron/sync-shopify-orders.ts`
  (sau ingest, cạnh retry-mmp / push-unsent), try/catch + log `addr-verify: verified X,
  undeliverable Y, failed Z`. Cap 100/giờ + rate-limit để không đụng giới hạn FedEx API.

### Refactor (DRY)
- `scripts/verify-shopify-addresses.ts` gọi `verifyUnverifiedAddresses({limit, refresh})`
  thay vì lặp code (giữ flag `--limit`/`--refresh`; `--refresh` = bỏ điều kiện chưa-verify).
  Để `refresh` hoạt động, `verifyUnverifiedAddresses` nhận thêm `opts.includeVerified?: boolean`.

## 5. Guard / lỗi

- **Lỗi FedEx API per-đơn**: catch trong lõi/batch → `{ok:false,error}` / đếm `failed`, KHÔNG
  ném ra ngoài (batch không dừng giữa chừng; nút hiện lỗi nhẹ).
- **Rate-limit 300ms** giữa các call (giữ như script hiện tại).
- **Auto chỉ đơn chưa verify** (bounded). Nút re-verify bất kể.
- **Thiếu địa chỉ** → không gọi API, trả `no address`.
- Không đổi `AddressVerifyCard` (đã cảnh báo không-giao-được).

## 6. Test (TDD)

- `buildAddressInput` (thuần): map đầy đủ field; thiếu address2 → bỏ dòng rỗng; thiếu
  address1/country → (lõi xử lý: no address).
- `verifyAddress`/`parseAddressVerification` (lib) — đã có test, không đụng.
- `verifyAndStoreOrderAddress` / `verifyUnverifiedAddresses` / action / cron = integration
  (repo không có test DB) → verify tsc/build + lib đã test.

## 7. Ngoài phạm vi (hệ #1)

- Báo brand + follow-up ngày giao (hệ #2), KCS (#3), Track API (#4), Label FedEx/DHL (#5).
- Tự sửa/ghi đè địa chỉ theo FedEx chuẩn-hoá (chỉ gợi ý hiển thị, không auto-apply).
- Chặn ship khi không-giao-được (chỉ cảnh báo; quyết định ship vẫn của ops).
- Field Lark (verify chạy trên địa chỉ Shopify đã sync).
