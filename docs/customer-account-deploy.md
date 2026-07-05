# Customer Account Builder — Deploy Guide (cơ bản)

Hướng dẫn deploy **Customer Account Hub** cho một store Shopify: 1 UI extension chung (Preact, `api_version 2026-04`) đọc config + data từ SMS API, render các module (profile, store credit + loyalty, order tracking, wishlist, returns) trên trang customer account của khách.

> Kiến trúc: **config-hub trên SMS** (bật/tắt + cấu hình module + upload asset qua `/f/customer-account`) + **1 extension chung** dùng lại cho mọi store. Mỗi store cần 1 **Custom App** riêng (để có Client ID / secret cho session-token auth) nhưng dùng chung codebase extension.
>
> Làm **tuần tự** các bước 1 → 6. Bước 7 là các lưu ý thực tế **bắt buộc đọc**.

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

## 2. Tạo Custom App per store

Mỗi store một Custom App (lấy Client ID + API secret key để verify session token):

1. Admin store → **Settings → Apps and sales channels → Develop apps**.
2. **Create an app** → đặt tên (vd `MEAN Customer Account Hub`).
3. **Configuration → Admin API integration → Configure**: bật scope **`read_customers`** → Save.
4. **Install app** vào store.
5. Tab **API credentials**: copy **API key (Client ID)** và **API secret key**.
   - `read_customers` là scope tối thiểu cần cho hub. Giữ secret an toàn — chỉ nhập vào env Railway (bước 3), không commit.

---

## 3. Cấu hình SMS env (Railway)

Trên Railway service của SMS backend, thêm/cập nhật env (SMS verify session token JWT HS256, thử lần lượt nhiều secret):

| Env | Giá trị | Ghi chú |
| --- | --- | --- |
| `CUSTOMER_ACCOUNT_APP_SECRETS` | **API secret key** của Custom App | Nhiều store/app → phân cách bằng **dấu phẩy** (`secretA,secretB`). Bắt buộc. |
| `CUSTOMER_ACCOUNT_APP_CLIENT_IDS` | **Client ID(s)** | Optional — nếu set, token verify thêm ràng buộc `aud`. Nhiều → phân cách dấu phẩy. |

Sau khi lưu env → **Redeploy** service để áp dụng.

> Secret/Client ID rỗng bị lọc tự động; nếu không set secret nào, endpoint customer-account sẽ từ chối mọi request (verify fail).

---

## 4. Build + deploy extension

```bash
cd shopify-extension
```

1. Mở `shopify.app.toml`, thay 2 placeholder:
   - `client_id` = **Client ID** (Custom App bước 2).
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

---

## Checklist nhanh

- [ ] Custom App tạo, scope `read_customers`, có Client ID + secret.
- [ ] Railway: `CUSTOMER_ACCOUNT_APP_SECRETS` (+ optional `CUSTOMER_ACCOUNT_APP_CLIENT_IDS`) → Redeploy.
- [ ] `shopify.app.toml`: điền `client_id` + `application_url`.
- [ ] `npm install` → `shopify app dev` (verify UI/fetch) → `shopify app deploy`.
- [ ] Checkout & Accounts Editor: thêm extension + nhập `backend_url` → Publish.
- [ ] `/f/customer-account`: chọn store → bật + cấu hình module + upload PNG.
