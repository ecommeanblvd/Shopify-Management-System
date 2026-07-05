# Customer Account Builder — Deploy Guide (cơ bản)

Hướng dẫn deploy **Customer Account Hub** cho một store Shopify: 1 UI extension chung (Preact, `api_version 2026-04`) đọc config + data từ SMS API, render các module (profile, store credit + loyalty, order tracking, wishlist, returns) trên trang customer account của khách.

> Kiến trúc: **config-hub trên SMS** (bật/tắt + cấu hình module + upload asset qua `/f/customer-account`) + **1 extension chung** dùng lại cho mọi store.
>
> **Auth token dùng app Shopify — TÁI DÙNG app SMS sẵn có** (app đã kết nối các store, tạo trên Dev/Partner Dashboard, có `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`). KHÔNG cần tạo custom app mới per store. Extension được thêm vào chính app đó qua Shopify CLI. SMS verify session token bằng secret của app này (đã tự fallback về `SHOPIFY_API_SECRET`/`SHOPIFY_API_KEY`).
>
> Làm **tuần tự** các bước 1 → 6. Bước 7 là các lưu ý thực tế **bắt buộc đọc** (đặc biệt (f) về scope `read_customers`).

---

## 1. Chuẩn bị

- Tài khoản **Shopify Partners** (partners.shopify.com) — để chạy `shopify app dev`/`deploy`.
- **Node 18+** (`node -v`).
- Shopify CLI:
  ```bash
  npm i -g @shopify/cli
  ```
- Quyền admin store cần deploy + quyền chỉnh env trên Railway (SMS backend).

---

## 2. Dùng lại app SMS sẵn có (KHÔNG tạo app mới)

App SMS (đã kết nối các store, tạo trên Dev/Partner Dashboard) chính là app chứa extension. Chỉ cần:

1. **Thêm scope `read_customers`** vào app (nếu chưa có — hiện `SHOPIFY_SCOPES` của SMS **chưa** gồm nó; cần cho token mang customer id — xem §7(f)). Trong app config (Partner Dashboard / `shopify.app.toml` của app SMS) thêm `read_customers` → các store phải **re-install** app để cấp scope mới (theo D-005).
2. Ghi lại **Client ID** = `SHOPIFY_API_KEY` và **API secret** = `SHOPIFY_API_SECRET` (SMS đã có sẵn trong env Railway).

> Không cần tạo Custom App per store. 1 app Shopify duy nhất phục vụ mọi store; extension + Admin API đều trên app đó.

---

## 3. Cấu hình SMS env (Railway) — thường KHÔNG cần thêm

SMS verify session token bằng secret của app. Code **tự fallback** về `SHOPIFY_API_SECRET`/`SHOPIFY_API_KEY` (SMS đã có), nên **không bắt buộc set env mới**.

Chỉ set 2 env dưới nếu muốn dùng app/secret RIÊNG cho customer-account (tách khỏi app Admin API):

| Env | Giá trị | Ghi chú |
| --- | --- | --- |
| `CUSTOMER_ACCOUNT_APP_SECRETS` | API secret key | Override `SHOPIFY_API_SECRET`. Nhiều app → phân cách **dấu phẩy**. |
| `CUSTOMER_ACCOUNT_APP_CLIENT_IDS` | Client ID(s) | Override `SHOPIFY_API_KEY`. Nếu set → token verify ràng buộc `aud`. |

> Mặc định (không set): dùng `SHOPIFY_API_SECRET`/`SHOPIFY_API_KEY`. Secret rỗng bị lọc; không có secret nào → endpoint từ chối mọi request.

---

## 4. Build + deploy extension

```bash
cd shopify-extension
```

1. **Link vào app SMS sẵn có** (khuyến nghị, thay vì điền tay): `shopify app config link` → chọn app SMS. Lệnh này điền `client_id` đúng bằng `SHOPIFY_API_KEY`. Hoặc điền tay `shopify.app.toml`:
   - `client_id` = **Client ID** = `SHOPIFY_API_KEY` (app SMS).
   - `application_url` = **SMS URL** (vd `https://shopify-management-system-production.up.railway.app`).
2. Cài dependency (package RIÊNG, tách khỏi tooling root của SMS):
   ```bash
   npm install
   ```
3. Preview trên dev store — **verify UI + fetch config trước khi deploy**:
   ```bash
   shopify app dev
   ```
   Đăng nhập Partners, chọn store preview. Mở trang customer account, kiểm: extension render, gọi được SMS config/orders, không lỗi console. (Xem lưu ý §7 về store credit + component runtime-verify.)
4. Khi UI OK → deploy:
   ```bash
   shopify app deploy
   ```

---

## 5. Kích hoạt extension trong store

1. Admin store → **Settings → Checkout → Customize** → mở **Checkout and Accounts Editor**.
2. Chuyển sang layout trang **customer account**.
3. Thêm extension:
   - **Full-page** (`customer-account.page.render`) — trang hub chính (5 module).
   - **Block** (`customer-account.profile.block.render`, `customer-account.order-status.block.render`) — thêm vào profile / order status nếu muốn.
4. Chọn extension → trong **settings** của extension, nhập field **`backend_url`** = **SMS URL** (bước 4.1).
5. **Save / Publish**.

---

## 6. Bật config trong SMS

1. Vào SMS: **`/f/customer-account`**.
2. Chọn **store** vừa deploy.
3. **Bật** hub cho store đó.
4. Cấu hình **module** (thứ tự, bật/tắt, tiêu đề tuỳ chỉnh) + branding (logo/hero/announcement/support email).
5. **Upload PNG không nền** cho logo / icon module (lưu S3; extension đọc qua `iconUrl`/`logoUrl` trong config).

Xong: khách đăng nhập vào customer account sẽ thấy hub theo đúng config.

---

## 7. Lưu ý thực tế (bắt buộc đọc)

- **(a) Store credit field** — module credit đọc trực tiếp **Customer Account API** field `storeCreditAccounts`. Field này phụ thuộc **API version thực tế** của Customer Account API khi chạy. Khi `shopify app dev`, **verify field tồn tại**; nếu thiếu ở version đang dùng, module degrade an toàn (ẩn phần store credit, không vỡ trang).
- **(b) Order-status block** — block `customer-account.order-status.block.render` **chỉ hiển thị khi khách đã đăng nhập** (getOrders cần `customer` trong session token). Khách vãng lai / order-status không đăng nhập sẽ không thấy.
- **(c) Component chưa runtime-verify** — các component UI (Page + 5 module + 2 block) mới build tĩnh, **chưa chạy thật**. Bắt buộc dùng `shopify app dev` để kiểm UI/fetch **trước khi** `shopify app deploy`.
- **(d) CORS + token verify** — SMS đã set CORS cho `extensions.shopifycdn.com` (origin của extension). Auth **tự động**: extension gọi `shopify.sessionToken.get()` → gửi `Authorization: Bearer <token>` → SMS verify (JWT HS256, multi-secret từ `CUSTOMER_ACCOUNT_APP_SECRETS`). Không cần cấu hình CORS thêm.
- **(e) SMS API endpoints** — extension gọi các path **tương đối với `backend_url`**:
  - `GET /api/customer-account/config`
  - `GET /api/customer-account/orders`
  - `GET /api/customer-account/orders/:id/timeline`
  - `GET /api/customer-account/loyalty`
  - `GET /api/customer-account/returns` · `POST /api/customer-account/returns`

  (Wishlist dùng API storefront sẵn có, không qua session token.)
- **(f) Scope `read_customers` — QUAN TRỌNG.** SMS xác định khách bằng claim `sub` (customer GID) trong session token; `sub` chỉ có khi app có scope **`read_customers`**. App SMS hiện **chưa** có scope này → các endpoint dữ liệu (`/orders`, `/loyalty`, `/returns`) sẽ trả **403 `no customer in token`** (module config/branding vẫn chạy, nhưng dữ liệu theo khách thì không). Cách xử lý: thêm `read_customers` vào scope app SMS → **re-install app trên từng store** (D-005: đổi scope phải cài lại). Khi `shopify app dev`, kiểm token có `sub` chưa; nếu đã có (không cần scope) thì bỏ qua bước này.

---

## Checklist nhanh

- [ ] **Tái dùng app SMS** (không tạo app mới); thêm scope `read_customers` → re-install trên các store (§7f).
- [ ] Railway: **thường không cần thêm env** (fallback về `SHOPIFY_API_SECRET`/`SHOPIFY_API_KEY`); chỉ set `CUSTOMER_ACCOUNT_APP_SECRETS`/`CLIENT_IDS` nếu muốn app riêng.
- [ ] `shopify app config link` (chọn app SMS) → điền `application_url` trong `shopify.app.toml`.
- [ ] `cd shopify-extension && npm install` → `shopify app dev` (verify UI/fetch + token có `sub`) → `shopify app deploy`.
- [ ] Checkout & Accounts Editor: thêm extension + nhập `backend_url` → Publish.
- [ ] `/f/customer-account`: chọn store → bật + cấu hình module + upload PNG.
