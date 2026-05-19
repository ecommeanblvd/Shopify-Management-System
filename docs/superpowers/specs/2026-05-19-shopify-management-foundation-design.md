# Shopify Management System — Spec #1: Foundation + Settings Viewer (read-only)

- **Ngày:** 2026-05-19
- **Trạng thái:** Design — chờ user review
- **Sub-project:** #1 / 6 (xem Lộ trình ở cuối)

## 1. Bối cảnh & mục tiêu

Người dùng quản lý 2–5 Shopify store (tất cả gói **Shopify Plus**, số lượng ổn định).
Mục tiêu dài hạn: một hệ thống trung tâm để đồng bộ và quản lý nhiều store —
settings, theme, debug, các feature module bật/tắt theo store, và customer service.

Toàn bộ tầm nhìn quá lớn cho một spec, nên được tách thành 6 sub-project độc lập,
mỗi cái có spec → plan → implementation riêng. **Tài liệu này chỉ đặc tả
sub-project #1.**

### Phạm vi spec #1

Foundation (hạ tầng dùng chung) **cộng** một feature đọc-thuần đầu tiên:

- App OAuth trên Shopify Dev Dashboard + luồng install/callback vào store.
- Lưu access token mỗi store, mã hoá at-rest.
- Auth nhiều người dùng + RBAC ba vai: `admin`, `operator`, `viewer`.
- Các bảng dữ liệu lõi: `stores`, `users`, `roles`, `feature_flags`,
  `audit_log`, `settings_snapshots`.
- Connector `lib/shopify` — cổng duy nhất ra Shopify, **chỉ mở query đọc**.
- Shell dashboard + registry feature-module.
- Feature `settings-viewer`: xem shipping + checkout branding của tất cả store
  ở một màn hình, chụp snapshot mỗi lần xem.
- Hạ tầng Railway: service dashboard + Postgres.
- Setup GitHub: branch protection, CI, CODEOWNERS, PR template.

### Ngoài phạm vi spec #1 (để các spec sau)

- **Ghi** bất kỳ settings nào lên store (spec #2).
- Quản lý/tối ưu theme (spec #3).
- Khung feature-module nâng cao cho collaborator (spec #4).
- Debug & monitoring (spec #5).
- Customer service (spec #6).
- Worker nền / queue / webhook xử lý bất đồng bộ — chưa cần ở spec #1.

### Tiêu chí thành công

- Kết nối được cả 2–5 store qua một lần cài app OAuth mỗi store.
- Mọi user đăng nhập được và bị giới hạn đúng theo vai.
- Màn hình settings-viewer hiển thị shipping + checkout branding của tất cả store.
- Mỗi lần xem tạo một bản ghi `settings_snapshots` và một bản ghi `audit_log`.
- **Không tồn tại đường code nào ghi lên store** — bảo đảm ở tầng type.
- CI xanh: typecheck + lint + test + build.

## 2. Quyết định công nghệ

| Hạng mục   | Lựa chọn | Lý do |
|------------|----------|-------|
| App Shopify | Một app trên Dev Dashboard, unlisted, cài OAuth vào từng store | Quản lý scope/version/webhook một chỗ; onboard store mới = một install link |
| Framework  | Next.js (App Router) + TypeScript | Một codebase UI + API; dễ cho collaborator web |
| Host       | Railway (service dashboard + Postgres; worker thêm sau khi cần) | Một nền tảng, bao được worker nền về sau |
| Database   | Postgres trên Railway | Cùng nền tảng host |
| Auth       | Auth.js (NextAuth) hoặc Better-Auth + bảng `roles` | RBAC tự kiểm ở lớp server |
| Shopify SDK | `@shopify/shopify-api` (Node, chính chủ) | Lo sẵn OAuth, đổi token, verify HMAC/webhook |
| Mã hoá token | AES-256-GCM, khoá ở env Railway | Token là tài sản nhạy cảm nhất |

## 3. Kiến trúc & mô hình module

```
┌─────────────── Next.js app (Railway service) ───────────────┐
│  Shell dashboard  →  điều hướng + chọn store                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Feature Module Registry                                │ │
│  │   • settings-viewer  (spec #1)                          │ │
│  │   • [theme] [debug] [cs] ...           (spec sau)       │ │
│  └────────────────────────────────────────────────────────┘ │
│  lib/shopify  →  connector duy nhất ra Shopify (chỉ đọc)     │
│  lib/audit · lib/flags · lib/auth · lib/crypto               │
└──────────────┬───────────────────────────┬───────────────────┘
               │                           │
        Postgres (Railway)         Shopify Admin GraphQL API
                                    (mỗi store 1 token OAuth)
```

### Hợp đồng của một Feature Module

Đây là cơ chế cho phép "trước mắt đơn giản, sau này mỗi feature cô lập riêng".
Mỗi feature là một thư mục `features/<key>/` tự chứa:

- **Route namespace riêng** `/f/<key>` — mỗi feature có sub-dashboard riêng.
- **Schema DB riêng** — bảng của feature đặt prefix theo `key`; không đụng bảng
  của Foundation hay feature khác.
- **Chỉ chạm Shopify qua `lib/shopify`** — cấm gọi thẳng API.
- **Một `manifest`** khai báo: `key`, `name`, `version`, `requiredScopes`,
  có thao tác ghi hay không. Manifest được đăng ký vào registry.
- **Bật/tắt độc lập theo từng store** qua `feature_flags`.

Nhờ hợp đồng này, hôm nay tất cả nằm trong một app; về sau một feature có thể
nhấc nguyên thư mục thành package riêng — hoặc service Railway riêng — mà không
phá feature khác. Lỗi của một feature bị cô lập trong namespace của nó.

### Tổ chức thư mục (dự kiến)

```
app/                      # route Next.js — shell + /f/<key>
features/
  settings-viewer/        # feature spec #1: manifest, route, UI, query đọc
lib/
  shopify/                # connector duy nhất ra Shopify (read-only ở spec #1)
  auth/                   # đăng nhập + RBAC
  crypto/                 # mã hoá/giải mã token
  audit/                  # ghi audit_log
  flags/                  # đọc/ghi feature_flags
  registry/               # đăng ký & nạp feature module
db/                       # schema + migration
docs/superpowers/specs/   # các spec
```

## 4. App OAuth & bảo mật token

### Mô hình app

- Một app tạo trên Shopify Dev Dashboard → có `client_id` + `client_secret`.
- Khai báo scopes một chỗ. Spec #1 chỉ cần scope **đọc**:
  `read_shipping`, `read_checkout_branding` (và `read_products`, `read_shop`
  cho thông tin cơ bản). Scope ghi (`write_*`) chỉ thêm ở spec #2.
- App để **unlisted** (không lên App Store) — chỉ chủ store tự cài qua install link.
- Dashboard trên Railway (có URL public) đóng vai trò app backend: xử lý
  OAuth install + callback + verify HMAC.

### Luồng cài vào mỗi store (OAuth offline token)

1. `admin` bấm "Connect store" → nhập `myshop.myshopify.com`.
2. Dashboard redirect tới Shopify OAuth authorize URL.
3. Chủ store approve trong admin Shopify.
4. Shopify callback về dashboard kèm `code`; dashboard verify HMAC, đổi `code`
   lấy **offline access token** của store đó.
5. Token được mã hoá AES-256-GCM rồi lưu vào `stores.encrypted_token`.

### Bảo mật token

- Mã hoá at-rest bằng AES-256-GCM; khoá ở env Railway `ENCRYPTION_KEY`,
  không bao giờ commit.
- Token chỉ giải mã trong bộ nhớ server khi gọi API; **không gửi xuống client,
  không ghi log**.
- RBAC quanh token:
  - `viewer` — xem store và settings; không thấy token.
  - `operator` — chạy thao tác của feature đã bật; không thấy token thô.
  - `admin` — thêm/xoá store, cài lại app, xoay token.

### Connector `lib/shopify` — cổng duy nhất

- Mọi feature gọi store qua connector, không gọi thẳng API.
- Connector lo: chọn token đúng store, gắn header `X-Shopify-Access-Token`,
  cố định `api_version`, xử lý **rate limit** (Shopify tính cost theo điểm —
  connector tự backoff + retry khi gần cạn), và **ghi `audit_log`** mỗi lời gọi.
- Trước mỗi lời gọi connector kiểm tra `feature_flags`: feature chưa bật cho
  store đó → chặn. Thiếu `requiredScopes` → chặn trước khi gọi Shopify.
- **Spec #1 connector chỉ export `query()` (đọc). Không có `mutate()`.**
  Thao tác ghi bị chặn ở tầng TypeScript; muốn ghi cũng không compile được.
- Mỗi store có chức năng "test connection": gọi query nhẹ (`shop { name }`)
  xác nhận token còn sống, scope đủ, version API hợp lệ.

## 5. Mô hình dữ liệu

Postgres trên Railway. Các bảng lõi của Foundation:

**`stores`**
`id · name · shop_domain · plan · encrypted_token · scopes[] · api_version
· status(active|disconnected|error) · connected_at`

**`users`**
`id · email · name · created_at` (+ trường do thư viện auth yêu cầu)

**`roles`**
Gán vai cho user: `admin | operator | viewer`. Quyền được kiểm ở lớp server
cho mọi route và mọi lời gọi connector.

**`feature_flags`** — bật/tắt feature theo từng store
`id · feature_key · store_id · enabled · config(jsonb) · updated_by · updated_at`
Một feature có thể bật ở store A, tắt ở store B. Đây là "công tắc" chống lỗi lan.
`config` để jsonb nên mỗi feature tự định nghĩa cấu hình mà không đổi schema chung.

**`audit_log`** — append-only, không UPDATE/DELETE
`id · user_id · store_id · feature_key · action · target · request_summary
· result(success|error) · error_detail · created_at`
Mọi lời gọi connector tự ghi vào đây. Spec #1 toàn bản ghi `read`.

**`settings_snapshots`** — append-only
`id · store_id · domain(shipping|checkout|...) · payload(jsonb)
· captured_at · captured_by`
Spec #1 chụp snapshot mỗi lần xem settings. Tác dụng: (a) xem lịch sử settings
đổi thế nào, (b) làm sẵn điểm khôi phục để spec #2 rollback khi ghi đè.

**`feature_registry`** *(tuỳ chọn — có thể chỉ để trong code)*
Manifest các feature: `feature_key · name · version · required_scopes[]`.

Hai nguyên tắc thiết kế: `audit_log` và `settings_snapshots` **append-only** —
không bao giờ sửa/xoá, luôn truy được nguyên nhân sự cố.

## 6. Cơ chế an toàn — tránh làm hỏng store

1. **Spec #1 read-only ở tầng type.** Connector chỉ có `query()`, không có
   `mutate()`. TypeScript chặn ghi lúc compile. Rủi ro hỏng store ở spec #1 ≈ 0.

2. **Mỗi feature bị đóng hộp.** Feature chỉ chạm store qua connector; connector
   kiểm `feature_flags` (chưa bật → chặn) và `requiredScopes` (thiếu → chặn).
   Lỗi của một feature bị bắt gọn trong namespace của nó, không sập shell hay
   feature khác.

3. **Quy trình ghi cho spec #2 (đặc tả trước để kiến trúc spec #1 chừa chỗ):**
   trước mỗi lần ghi phải đủ 4 bước — snapshot trước → dry-run + diff →
   confirmation gate → có nút rollback từ snapshot gần nhất.

4. **Staged rollout.** Thao tác ghi: làm một store thử trước, kiểm tra, rồi mới
   nhân ra các store còn lại. Không bao giờ ghi đồng loạt mọi store một cú.

5. **Dev/staging store.** Tạo một development store miễn phí trên Dev Dashboard;
   mọi feature mới test ở đây trước. Production store chỉ kết nối khi feature
   đã ổn.

6. **Bảo vệ ở quy trình GitHub.** Branch protection trên `main` (bắt buộc PR,
   user approve, CI xanh). Preview deploy mỗi PR chỉ trỏ dev store. Token thật
   chỉ ở env production; preview/CI dùng token dev store. `CODEOWNERS` đặt user
   làm reviewer bắt buộc cho `lib/shopify`, `lib/auth`, schema DB.

7. **Kill-switch toàn cục.** Cờ `maintenance_mode` mỗi store: bật lên thì mọi
   thao tác ghi tới store đó bị treo, chỉ còn đọc. Dùng khi nghi có sự cố.

## 7. Feature spec #1 — `settings-viewer`

- Route `/f/settings-viewer` — sub-dashboard riêng của feature.
- Hiển thị, cho tất cả store đã kết nối:
  - **Shipping:** delivery profiles, zones, rates (đọc qua connector).
  - **Checkout branding:** cấu hình branding của Checkout Extensibility (đọc).
- Mỗi lần xem: connector đọc dữ liệu → ghi một `audit_log` (action `read`) →
  lưu một `settings_snapshots` (`domain` = `shipping` hoặc `checkout`).
- Chỉ đọc — không có nút ghi nào.
- `requiredScopes`: `read_shipping`, `read_checkout_branding`.

## 8. Xử lý lỗi

- **OAuth thất bại** (HMAC sai, user từ chối, đổi token lỗi): không lưu store,
  hiện thông báo rõ, ghi `audit_log` kết quả `error`.
- **Token chết / scope thiếu:** "test connection" phát hiện → đánh dấu store
  `status = error`, hướng dẫn admin cài lại app.
- **Shopify rate limit:** connector backoff + retry; quá ngưỡng thì trả lỗi
  thân thiện, ghi audit, không làm sập trang.
- **Feature lỗi runtime:** error boundary theo namespace `/f/<key>`; shell và
  các feature khác vẫn chạy.
- **Lỗi DB:** thao tác đọc store vẫn cố hoàn tất; lỗi ghi `audit_log`/snapshot
  được log lại nhưng không chặn người dùng xem dữ liệu (degraded, không sập).

## 9. Kiểm thử

- **Unit:** `lib/crypto` (mã hoá/giải mã token), `lib/flags` (logic bật/tắt),
  RBAC (mỗi vai chặn/cho đúng), parser dữ liệu shipping/checkout.
- **Integration:** luồng OAuth callback (verify HMAC + đổi token, mock Shopify);
  connector ghi `audit_log` + `settings_snapshots` đúng; connector chặn khi
  feature tắt cờ hoặc thiếu scope.
- **E2E:** đăng nhập theo từng vai; kết nối một store (mock OAuth); xem
  settings-viewer; xác nhận có bản ghi audit + snapshot; xác nhận `viewer`
  không thấy token và không thấy chức năng của admin.
- Mục tiêu coverage ≥ 80%. Connector dùng mock Shopify API trong test, không
  gọi store thật.

## 10. Lộ trình các sub-project

Mỗi sub-project có spec → plan → implementation riêng.

1. **Foundation + settings viewer (read-only)** — *spec này*.
2. **Ghi settings (shipping + checkout)** — kèm snapshot/dry-run/rollback/staged
   rollout; thêm scope `write_*`.
3. **Theme control & tối ưu tốc độ** — không bao giờ ghi lên theme đang publish;
   chỉnh trên bản copy unpublished, preview rồi mới publish; đo Core Web Vitals,
   dọn script thừa, lazy-load ảnh, preload hero + font, giảm JS chặn render.
4. **Khung feature-module cho collaborator** — chuẩn hoá, có thể nâng thành
   package riêng.
5. **Debug & monitoring** — log, health check, lỗi từng store.
6. **Customer service**.

## 11. Câu hỏi mở

- Chọn cụ thể thư viện auth: Auth.js hay Better-Auth (quyết định ở bước
  writing-plans).
- API version Shopify cố định sẽ chốt khi bắt đầu implement (dùng bản stable
  mới nhất tại thời điểm đó).
