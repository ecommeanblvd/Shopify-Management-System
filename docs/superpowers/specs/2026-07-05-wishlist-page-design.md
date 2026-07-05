# Wishlist Page — Customer Account full-page (spec)

**Ngày:** 2026-07-05 · **Trạng thái:** CEO đã duyệt brainstorm (thứ tự B trước C; recommendation rule-based; quiz admin soạn — C spec riêng)
**Phạm vi:** Sub-project B của Customer Account nâng cao. Nền tảng catalog + recommendation engine xây ở đây sẽ TÁI DÙNG cho C (Style Quiz).

## 1. Mục tiêu

Trang full-page **Wishlist** trong customer account: khách xem các sản phẩm đã lưu (thu thập bởi function wishlist sẵn có trên theme), bỏ item, và nhận **gợi ý sản phẩm tương tự** (rule-based). Menu account có mục "Wishlist" riêng, cạnh "Customer Account Hub".

## 2. Hiện trạng tận dụng (recon 2026-07-05)

- `wishlists` (db/schema.ts L1195): identity 3 kênh — `customerEmail` (chính), `shopifyCustomerId` (đối chiếu), `deviceId` (guest). Unique theo (storeId, customerEmail).
- `wishlistItems` (L1229): SNAPSHOT đầy đủ lúc add — `shopifyProductId/VariantId`, `productTitle`, `variantTitle`, `productHandle`, `imageUrl`, `priceAmount/Currency`, `availableForSale` → trang hiển thị KHÔNG cần catalog.
- `wishlistEvents`: log add/remove/merge/share/view — ghi tiếp sự kiện remove từ account page.
- Thu thập qua theme embed (`features/functions/wishlist/embed/source.ts` + `app/api/storefront/wishlist/*`) — KHÔNG ĐỤNG.
- Admin `/f/functions/wishlist` — KHÔNG ĐỤNG.
- `MODULE_KEYS` đã có `'wishlist'` (giữ chỗ từ Order Journey).
- SMS **chưa có catalog sản phẩm đầy đủ** (shopify_variants chỉ có sku/title/weight — thiếu vendor/tags/type/image) → §3.
- `authenticateExtension` trả `{ store: {id}, customerId }` — pattern route như Order Journey.

## 3. Nền catalog mới: bảng `shopify_products` + sync

- Bảng `shopify_products`: `id` uuid PK, `storeId` fk stores cascade, `shopifyProductId` text (unique cùng storeId), `title`, `handle`, `vendor`, `productType`, `tags` text[], `imageUrl`, `priceMin` numeric(14,2), `currency`, `availableForSale` boolean, `status` text (ACTIVE/ARCHIVED/DRAFT), `syncedAt`. Index (storeId, status), (storeId, vendor).
- Sync: Admin GraphQL `products` paginated (scope `read_products` — cả 4 store đã có), field: title handle vendor productType tags status featuredImage{url} priceRangeV2{minVariantPrice{amount currencyCode}} availableForSale (qua variants/tổng hợp — lấy theo khả năng schema thật, xác minh introspection khi implement). Viết theo pattern `scripts/sync-shopify-variants.ts` + thêm **cron daily** (route `app/api/cron/` + script pattern hiện có, bearer CRON_SECRET).
- Migration kế tiếp (0093).

## 4. Identity resolve: customerId → email

- Token extension chỉ có `customerId`. Wishlist match theo **email HOẶC shopifyCustomerId**.
- SMS resolve email qua Admin GraphQL `customer(id:)` (scope `read_customers`) với **cache trong bảng mới `customer_identities`**: `storeId`, `shopifyCustomerId` (unique cùng storeId), `email`, `resolvedAt` (TTL 7 ngày — quá hạn resolve lại). Store thiếu read_customers → resolve fail → chỉ match theo shopifyCustomerId (degrade, không lỗi).
- Match wishlist: `(storeId, customerEmail = email)` HOẶC `(storeId, shopifyCustomerId = customerId)` — union, ưu tiên wishlist có email.

## 5. Recommendation engine (thuần — tái dùng cho C)

`features/customer-account/recommend.ts` — hàm thuần:
```
scoreProducts(seed: SeedSignals, candidates: CatalogProduct[]): ScoredProduct[]
SeedSignals = { vendors: string[], productTypes: string[], tags: string[], excludeProductIds: string[] }
Điểm: cùng vendor +2, cùng productType +2, mỗi tag chung +1. Loại: excludeProductIds, !availableForSale, status != ACTIVE, điểm 0.
Trả top N (mặc định 8), tie-break: syncedAt mới hơn trước.
```
Seed từ wishlist items (join shopify_products theo shopifyProductId để lấy vendor/type/tags của seed). Unit test đủ nhánh.

## 6. API extension (Bearer session token, pattern _shared hiện có)

| Endpoint | Việc |
|---|---|
| `GET /api/customer-account/wishlist` | resolve identity (§4) → `{ items: [{shopifyProductId, variantId, productTitle, variantTitle, productHandle, imageUrl, price, currency, availableForSale, addedAt}], recommendations: [{shopifyProductId, title, handle, vendor, imageUrl, price, currency, score}] }`. Chưa có wishlist → items [], recommendations từ catalog phổ biến? KHÔNG — v1 trả recommendations [] khi không có seed. |
| `POST /api/customer-account/wishlist/remove` | body `{shopifyProductId, shopifyVariantId?}` → xóa item khỏi wishlist của khách (chỉ wishlist đã match identity) + ghi `wishlistEvents` kind 'remove'. |

Link sản phẩm phía khách: `https://{storefront domain}/products/{handle}` — lấy primary domain qua config? V1 dùng `https://{shopDomain}/products/{handle}` (myshopify domain redirect về primary) — đơn giản, chấp nhận.

## 7. Extension mới: `customer-account-wishlist`

- Thư mục riêng `shopify-extension/extensions/customer-account-wishlist/` (full-page KHÔNG chung extension khác — bài học Order Journey), target `customer-account.page.render`, settings `backend_url` (single_line_text_field) + DEFAULT_BACKEND_URL fallback như hub.
- UI (English): heading "Wishlist"; grid card sản phẩm — ảnh **object-fit contain** không crop, title, variant, giá, badge "Sold out" khi !availableForSale, nút **Remove** (confirm inline), link "View product" (mở tab mới `s-link`/button href); khối **"You may also like"** (recommendations, card tương tự, không có Remove); trạng thái rỗng: "Your wishlist is empty" + hint dùng nút tim trên shop.
- Lỗi API → `s-banner tone="critical"` (không im lặng). Loading spinner.
- Module `wishlist` trong config per-store: `enabled` gate — extension gọi `getConfig()`; nếu module wishlist tắt → thông báo "not enabled".

## 8. Testing & gates

- recommend.ts: unit test đủ nhánh (điểm, loại trừ, tie-break, N).
- Identity resolve: hàm thuần tách phần chọn-wishlist (match email/customerId, ưu tiên email) + test.
- Route: auth test pattern `routes-data-auth.test.ts` (OPTIONS 204 + 401 no bearer).
- Gates bắt buộc trước push: root `tsc` + `vitest` + **next build thật**; extension `typecheck` + `test`. Pattern 3 file cho mọi phần admin/client (không inline 'use server').

## 9. Ngoài phạm vi (v1)

- AI/embedding recommendation (v2); popular-products fallback khi wishlist rỗng; add-to-wishlist từ account page (thu thập vẫn qua theme); đồng bộ real-time (cron daily đủ); primary domain lookup; sub-project C (spec riêng — sẽ tái dùng §3+§5).
