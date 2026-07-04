# Customer Account Builder — quản lý UI/UX trang Customer Account đa store — Design

> SMS làm hub cấu hình + dữ liệu cho trang **New Customer Account** của nhiều store Shopify Plus.
> 1 Shopify Customer Account UI Extension (codebase chung) đọc config per-store từ SMS và render:
> profile, store credit + loyalty tier, order tracking (tái dùng lifecycle), wishlist (tái dùng
> storefront API), return center. Chuẩn thời trang luxury; assets PNG không nền fit mọi branding.

**Ngày:** 2026-07-05
**Trạng thái:** CHẾ ĐỘ TỰ ĐỘNG QUA ĐÊM — user pre-authorized toàn bộ quyết định (chỉ thị 2026-07-05);
thiết kế tự chốt theo YAGNI, mọi quyết định ghi tại đây.
**Nhánh:** `feat/customer-account-builder` (P1) → P2 → P3.

## 1. Bối cảnh & khảo sát (đã chạy)

- **SMS sẵn có:** `resolveActiveStore()` pattern cho storefront API (`?shop=` + feature flag + CORS);
  `stores` (id, shopDomain unique, encryptedToken…); `getLifecycle`/`buildTimeline` (lifecycle);
  wishlist storefront API public (identity email/deviceId); `lib/storage/s3.ts` (putObject/getSignedDownloadUrl,
  pattern upload từ rate-card); **CHƯA có** loyalty/credit, return request, customer↔order mapping
  (customer id/email nằm trong `shopifyOrders.rawPayload` jsonb).
- **Shopify extension platform (verify từ shopify.dev, 2025-10+):** api_version **2026-04**;
  **Preact + Polaris web components `s-*`** (KHÔNG React legacy, KHÔNG DOM/CSS tự do — theo branding
  merchant); global `shopify` (authenticatedAccount, settings, sessionToken). Targets dùng:
  `customer-account.page.render` (full page + menu item), `customer-account.profile.block.render`,
  `customer-account.order-status.block.render`. Customer Account GraphQL qua
  `fetch('shopify://customer-account/api/<ver>/graphql.json')` (auth tự động) — orders + `storeCreditAccounts`
  (implementer verify field trên schema version khi code). Backend ngoài: `network_access = true` +
  `shopify.sessionToken.get()` (JWT HS256 ký bằng app client secret, exp 5', claims `aud`=client_id,
  `dest`=shop domain, `sub`=customer GID khi app có scope `read_customers`) + CORS cho
  `https://extensions.shopifycdn.com`. Settings toml (field `url` `backend_url`) chỉnh trong
  Checkout & Accounts Editor.

## 2. Quyết định (tự chốt — lý do kèm)

| # | Quyết định | Lý do |
|---|---|---|
| Q1 | **Config-driven, 1 extension codebase chung mọi store** — SMS lưu config per-store, extension fetch config lúc render | Đúng đề bài "quản lý từ SMS"; tránh N codebase; per-store chỉ là data |
| Q2 | Extension viết theo **platform mới 2026-04 (Preact + `s-*`)** | React remote-ui đã legacy ≤2025-07 |
| Q3 | Auth extension→SMS = **verify session token JWT** (env `CUSTOMER_ACCOUNT_APP_SECRETS` — list secret, hỗ trợ nhiều app), resolve store bằng claim `dest`↔`stores.shopDomain`, customer bằng `sub` | Chuẩn Shopify, chống giả mạo; nhiều secret để không khoá vào 1 app |
| Q4 | **Store credit đọc trực tiếp Customer Account API trong extension** (không sync về SMS) | Dữ liệu Shopify-native, realtime, đỡ 1 pipeline |
| Q5 | **Loyalty tier v1 = bảng SMS, admin gán tay** (không points engine) | YAGNI; SMS chưa có loyalty; đủ hiển thị tier luxury |
| Q6 | **Wishlist: extension gọi thẳng storefront wishlist API sẵn có** (`?shop=` + email) | API public đang phục vụ theme; zero backend mới |
| Q7 | **Order↔customer mapping bằng expression index trên `rawPayload`** (`store_id, raw_payload->'customer'->>'id'`), KHÔNG denorm cột + sửa sync | Additive, không đụng upsertOrder/webhook; đủ nhanh cho tra cứu per-customer |
| Q8 | **RBAC tái dùng `view_functions` / `manage_functions`** | Cùng scope "storefront functions"; không churn seed-roles |
| Q9 | Assets: **upload PNG lên S3 (lib/storage), validate `image/png` + magic bytes**, serve qua route public `GET /api/customer-account/assets/[id]` → 302 signed URL | D-008; PNG không nền fit mọi background; signed URL ngắn hạn vẫn ổn vì load lúc render |
| Q10 | Return center v1 = **bảng request + queue admin** (requested→approved/rejected→received→refunded, admin đổi tay); KHÔNG tự gọi Shopify refund | An toàn tiền bạc; D-005 (không thêm Admin API write mới) |
| Q11 | Extension source ở **`shopify-extension/` trong repo** (package riêng, EXCLUDE khỏi tsconfig/eslint/vitest root; Railway không build nó) | 1 repo dễ quản; không ảnh hưởng deploy SMS |
| Q12 | App Shopify cần scope **`read_customers`** (để JWT có `sub`) — ghi trong deploy guide | Không có sub thì không map được customer |

## 3. Kiến trúc

```
[SMS admin /f/customer-account]  ←RBAC view/manage_functions
   ├─ Config editor per-store (branding, modules bật/tắt + thứ tự, tiêu đề, icon PNG)
   ├─ Assets (upload PNG không nền → S3)
   ├─ Returns queue (duyệt yêu cầu đổi/trả)
   └─ Loyalty tiers (gán tier theo customer)
        │  Postgres (customer_account_configs, customer_account_assets,
        │            customer_return_requests, customer_loyalty)
        ▼
[Public API /api/customer-account/*]  ←Bearer session-token JWT (aud/dest/exp) + CORS extensions.shopifycdn.com
   config · orders · orders/:id/timeline · loyalty · returns (GET/POST) · assets/:id
        ▲
[Shopify Customer Account UI Extension — 1 codebase Preact]
   ├─ Full page `customer-account.page.render` "Account Hub": render modules theo config
   │    profile (authenticatedAccount + Customer Account API)
   │    credit+loyalty (storeCreditAccounts + SMS loyalty)
   │    tracking (SMS timeline — stepper các mốc lifecycle)
   │    wishlist (storefront API sẵn có)
   │    returns (form + list trạng thái)
   ├─ Block `profile.block.render`: mini credit/tier
   └─ Block `order-status.block.render`: timeline tracking của đơn đang xem
   Settings toml: `backend_url` (merchant nhập URL SMS per store)
```

## 4. Data model (migration 0089 — 4 bảng + 1 expression index)

- **`customer_account_configs`**: id uuid PK · storeId FK unique → stores · enabled bool default false ·
  config jsonb (shape TS: `{ branding: { logoAssetId?, heroAssetId?, supportEmail?, announcement? },
  modules: Array<{ key: 'profile'|'credit'|'tracking'|'wishlist'|'returns'; enabled: boolean;
  title?: string; iconAssetId?: string }> }`) · updatedAt.
- **`customer_account_assets`**: id uuid PK · storeId FK · kind text ('logo'|'hero'|'icon') ·
  filename · fileKey (S3) · contentType · createdAt. Chỉ nhận `image/png` (+ magic bytes `\x89PNG`).
- **`customer_return_requests`**: id uuid PK · storeId FK · orderId FK → shopifyOrders ·
  shopifyCustomerId text · orderNumber text · reason text · note text ·
  status text ('requested'|'approved'|'rejected'|'received'|'refunded') default 'requested' ·
  adminNote text · createdAt · updatedAt. Index (storeId, status), (storeId, shopifyCustomerId).
- **`customer_loyalty`**: id uuid PK · storeId FK · shopifyCustomerId text · tier text ·
  note text · updatedAt. UNIQUE (storeId, shopifyCustomerId).
- **Expression index**: `shopify_orders (store_id, (raw_payload->'customer'->>'id'))` — tra đơn theo customer.

## 5. API cho extension (`app/api/customer-account/*`)

Chung: `verifyCustomerAccountToken(req)` (lib thuần + route helper): parse Bearer JWT, verify HS256 với
MỘT TRONG các secret trong env `CUSTOMER_ACCOUNT_APP_SECRETS` (phân cách dấu phẩy), check `exp`,
`aud` ∈ client IDs cho phép (env `CUSTOMER_ACCOUNT_APP_CLIENT_IDS`, optional — nếu rỗng bỏ qua check aud),
`dest` → resolve `stores.shopDomain` → storeId; `sub` → shopifyCustomerId (GID → numeric id).
Sai → 401. CORS: `Access-Control-Allow-Origin: https://extensions.shopifycdn.com` + OPTIONS preflight.

| Endpoint | Trả |
|---|---|
| `GET /config` | `{ enabled, branding{logoUrl, heroUrl, supportEmail, announcement}, modules[] }` (assetId → URL `/assets/:id`) |
| `GET /orders` | list đơn của customer (match expression index): orderNumber, placedAt, total, currentStage + statusLabel |
| `GET /orders/[orderId]/timeline` | verify đơn thuộc (store, customer) → `buildTimeline` + stage/delay như trang lifecycle (KHÔNG lộ dữ liệu nội bộ: bỏ exceptionNote, delayHours nội bộ; chỉ mốc + nhãn) |
| `GET /loyalty` | `{ tier, note }` hoặc `{ tier: null }` |
| `GET /returns` · `POST /returns` | list request của customer · tạo request `{orderId, reason, note}` (verify đơn thuộc customer; chặn trùng request 'requested' cùng đơn) |
| `GET /assets/[id]` | 302 → signed URL S3 (public, không cần token — chỉ ảnh) |

Privacy: mọi endpoint data lọc theo (storeId từ `dest`, shopifyCustomerId từ `sub`) — không nhận
customer id từ query. Wishlist KHÔNG có endpoint mới (Q6).

## 6. Admin UI (`/f/customer-account`, RBAC `view_functions`/`manage_functions`)

- **Trang chính**: chọn store → form config: enabled toggle · branding (logo/hero upload PNG, supportEmail,
  announcement) · bảng modules (bật/tắt, đổi title, icon, thứ tự lên/xuống) · nút Lưu (server action).
- **Returns** (`/f/customer-account/returns`): bảng request (lọc store/status) → đổi status + adminNote.
- **Loyalty** (`/f/customer-account/loyalty`): bảng tier theo store; thêm/sửa (shopifyCustomerId, tier, note).
- Nav: thêm entry "Customer Account" (icon UserRound?) requires `view_functions`.

## 7. Extension (`shopify-extension/` — package riêng)

- `shopify.app.toml` (template: name, client_id placeholder, scopes `read_customers`) +
  `extensions/customer-account-hub/shopify.extension.toml` (api_version **2026-04**, 3 targeting §3,
  `network_access = true`, settings field `backend_url` type url).
- `src/` Preact + `s-*`: `Page.tsx` (full page — fetch config bằng sessionToken → render modules theo thứ tự);
  modules: `ProfileCard` (authenticatedAccount + Customer Account API address), `CreditCard`
  (storeCreditAccounts qua shopify:// + tier từ SMS), `TrackingList` (orders + timeline stepper),
  `WishlistCard` (storefront API `?shop=` + email), `ReturnCenter` (form + list); `ProfileBlock.tsx`,
  `OrderStatusBlock.tsx`; `lib/api.ts` (sessionToken fetch helper + types khớp API §5).
- Luxury tone: layout thoáng (s-stack spacing loose), heading serif theo brand store (tự động vì
  branding merchant), icon PNG không nền từ config, copy tiếng Anh trang nhã (store quốc tế).
- Verify: `npm install && npx tsc --noEmit` trong package (types `@shopify/ui-extensions` preact);
  logic thuần (map config → modules render list) tách `src/lib/config.ts` + vitest riêng trong package.

## 8. Test & lỗi

- Thuần SMS: verify JWT (đúng secret/sai secret/hết hạn/aud sai/dest không có store → từng reason),
  GID→numeric, config sanitize (module key lạ → bỏ), PNG magic bytes.
- Route: 401/400/CORS preflight (không chạm DB); data-path smoke prod sau merge.
- Returns: không cho tạo request cho đơn không thuộc customer (privacy test thuần trên guard logic).
- Extension: tsc + test thuần config mapper; render test bỏ (không có harness Shopify local).

## 9. YAGNI / không làm

- Không points engine/loyalty tự động; không gọi Shopify refund/return Admin API (queue tay);
  không sync store credit về SMS; không theme/CSS builder (platform không cho);
  không multi-language config v1 (copy extension EN); không webhook mới; không denorm cột customer.
- Không HMAC-tighten storefront wishlist API trong scope này (TODO sẵn có, giữ nguyên).

## 10. Phase

| Phase | Deliverable |
|---|---|
| **P1** | Migration 0089 + lib verify token (thuần, test) + API config/assets + admin config UI + upload PNG |
| **P2** | API orders/timeline/loyalty/returns + admin Returns queue + Loyalty editor + nav |
| **P3** | `shopify-extension/` package đầy đủ (toml + Preact modules + tsc/test) + `docs/customer-account-deploy.md` (deploy cực kỳ cơ bản) + cập nhật Second Brain |

Mỗi phase: plan riêng → subagent-driven (implementer Opus 4.8) → review từng task → final review → merge khi xanh.
