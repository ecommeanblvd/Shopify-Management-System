# Spec: Users & Permissions — Role × Module × Action RBAC

**Ngày:** 2026-06-09
**Phạm vi:** Thiết kế lại hệ phân quyền từ 3-role-phẳng thành **Role × Scope × Action**, hybrid (catalog trong code, role+quyền lưu DB, sửa qua UI).

## 1. Mục tiêu
- Định nghĩa **scope** (module / sub-module) và **action** (View/Create/Edit/Delete + vài action đặc thù) cho từng phần của app.
- Role là **dữ liệu** (lưu DB), admin tạo/sửa role + tick quyền qua UI ma trận — thêm role mới (vd Logistics) **không cần deploy**.
- **Mở rộng được**: mỗi khi thêm module/function mới, chỉ cần khai báo scope+action trong catalog (code) — role matrix UI tự hiện. Quy ước ở §8.
- Giữ nguyên hành vi của `admin/operator/viewer` hiện tại (seed từ MATRIX cũ), không vỡ enforcement đang chạy.

## 2. Kiến trúc (hybrid)
- **Catalog trong code** (`lib/auth/permissions.ts`): nguồn chân lý cho danh sách scope + action áp dụng. Type-safe. Mỗi `(scope, action)` = một **permission key** chuỗi `"<scope>:<action>"` (vd `fulfillment.logistics:create`).
- **DB** (3 phần):
  - `app_roles` — định nghĩa role (key, name, description, is_system).
  - `role_permissions` — junction (role_id → permission_key). Quyền của một role = tập key.
  - `roles` (bảng user→role hiện tại) — đổi sang **user→role_id** (FK `app_roles`).
- **Resolve**: `getUserRole(userId) → { roleId, roleKey }`; `getRolePermissions(roleId) → Set<PermissionKey>` (đọc DB, cache theo roleId trong request/process). Gác quyền: `can(perms, key)`.
- **UI**: `/admin/roles` (ma trận role × scope×action) + `/admin/users` (gán role — đã có, đổi sang role_id).

## 3. Catalog permission (đã duyệt)

Định dạng key: `"<scope>:<action>"`. Action chuẩn: `view | create | edit | delete`; action đặc thù khai báo riêng cho scope cần.

| Scope | view | create | edit | delete | đặc thù | Module/route gắn vào |
|------|:--:|:--:|:--:|:--:|---|---|
| `dashboard` | ✓ | | | | | `/` (luôn cho phép — xem §6) |
| `orders` | ✓ | | ✓ | | | `/f/orders*` (edit = cost/weight override, sku cost) |
| `fulfillment.operations` | ✓ | | ✓ | | | `/f/fulfillment*` (check tồn, pick/pack/ship) |
| `fulfillment.logistics` | ✓ | ✓ | ✓ | ✓ | | tracking number / thông tin shipment |
| `fulfillment.warehouse` | ✓ | ✓ | ✓ | ✓ | | `/f/fulfillment/warehouse` (tồn kho MEAN) |
| `fulfillment.brand_requests` | ✓ | | ✓ | | | `/f/fulfillment/brand-requests` (gửi lại brand) |
| `carrier_rates` | ✓ | ✓ | ✓ | ✓ | | `/f/carrier-rates*` (rate card, zone, matrix, surcharge) |
| `carrier_rates.invoices` | ✓ | ✓ | ✓ | | | import hoá đơn NCC (shipping invoices) |
| `shipping_reconcile` | ✓ | | ✓ | | | `/f/shipping-reconcile` (đánh dấu đã đối soát) |
| `mmp_products` | ✓ | ✓ | ✓ | ✓ | `push` | `/f/mmp*` (curate + push to Shopify) |
| `functions` | ✓ | | ✓ | | | `/f/functions*` (wishlist, gift-registry…) |
| `markets` | ✓ | | ✓ | | `apply` | `/f/markets*` |
| `settings_sync` | ✓ | | ✓ | | `apply` | `/f/settings-sync*`, `/f/settings-viewer` |
| `stores` | ✓ | ✓ | ✓ | ✓ | | `/stores/connect`, `/admin/shopify-sync-health` |
| `users_roles` | ✓ | ✓ | ✓ | ✓ | | `/admin/users`, `/admin/roles`, feature-flags |

> **Lưu ý hoá đơn NCC**: theo mô tả của bạn, đặt dưới `carrier_rates.invoices` (Logistics staff thêm hoá đơn ở khu carrier-rate). Permission cũ `manage_shipping_invoices` map sang `carrier_rates.invoices:create/edit`.

## 4. Role "Logistics staff" (seed mẫu)
Quyền: `fulfillment.operations:view`; `fulfillment.logistics:{view,create,edit,delete}`; `carrier_rates:{view,create}`; `carrier_rates.invoices:{view,create}`. Không có warehouse / pick-pack-ship-edit / module khác.

## 5. Mô hình dữ liệu (Drizzle, `db/schema.ts`)
```
app_roles:        id uuid pk · key text unique notNull · name text notNull · description text · is_system boolean notNull default false · created_at · updated_at
role_permissions: id uuid pk · role_id uuid → app_roles cascade notNull · permission_key text notNull · (unique(role_id, permission_key))
-- đổi bảng user→role hiện tại:
roles (giữ tên):  user_id text pk → user.id · role_id uuid → app_roles notNull   (thay cột `role` enum cũ)
```
- `permission_key` lưu chuỗi tự do, **validate theo catalog code** lúc ghi (chỉ nhận key có thật) — không dùng enum DB để giữ tính mở rộng (thêm scope mới không cần migrate enum).
- Migration: tạo `app_roles`+`role_permissions`; seed admin/operator/viewer (map từ MATRIX cũ qua bảng §7) + logistics; thêm cột `role_id` vào `roles`, backfill từ cột `role` cũ (map enum→app_roles.key), rồi để cột `role` cũ lại tạm (drop ở migration sau khi code đã chuyển hẳn).

## 6. Enforcement
- `lib/auth/permissions.ts`: catalog + types `Scope`, `Action`, `PermissionKey`, hàm `allPermissionKeys()`, `isValidKey()`.
- `lib/auth/access.ts`: `getUserPermissions(userId) → Set<PermissionKey>` (resolve role_id → role_permissions, cache); `can(perms, key)`.
- **Gác 3 chỗ** chuyển sang key mới:
  - Server pages: `if (!can(perms, 'orders:view')) redirect('/')`.
  - Server actions: `requirePerm('fulfillment.logistics:create')`.
  - Nav (`lib/nav.ts`): trường `requires` đổi từ permission cũ sang permission key mới.
- **Shim tương thích**: `hasPermission(role, oldPerm)` giữ lại tạm, ánh xạ qua bảng §7 (old perm → key mới) để các chỗ chưa kịp đổi vẫn chạy. Xoá shim khi đã chuyển hết.
- `dashboard`/route không gate vẫn để `requires: null`.

## 7. Bảng ánh xạ 28 permission cũ → key mới (dùng cho seed + shim)
Một vài ví dụ (đầy đủ trong plan):
`view_orders→orders:view` · `manage_sku_costs→orders:edit` · `view_fulfillment→fulfillment.operations:view` · `manage_fulfillment→fulfillment.operations:edit + fulfillment.brand_requests:edit` · `manage_warehouse→fulfillment.warehouse:{view,create,edit,delete}` · `view_carrier_rates→carrier_rates:view` · `manage_carrier_rates→carrier_rates:{create,edit,delete}` · `manage_shipping_invoices→carrier_rates.invoices:{view,create,edit}` · `view_mmp_products→mmp_products:view` · `manage_mmp_products→mmp_products:{create,edit,delete,push}` · `manage_stores→stores:{view,create,edit,delete}` · `manage_users→users_roles:{view,create,edit,delete}` · `view_markets_history→markets:view` · `apply_markets→markets:apply` · `run_feature→settings_sync:{view,edit}` · `apply_settings→settings_sync:apply` · `view_settings_history→settings_sync:view` · `view_functions→functions:view` · `manage_functions→functions:edit` · `reconcile_store→settings_sync:apply` · `manage_settings_template→settings_sync:edit` · `manage_markets_template→markets:edit`.
Seed admin = tất cả key; operator/viewer = map tập permission cũ của họ qua bảng này.

## 8. Quy ước THÊM MODULE/FUNCTION MỚI (yêu cầu mở rộng)
Khi deploy module mới, làm đúng 4 bước — không động DB schema, không deploy lại để tạo role:
1. **Khai báo scope + action** trong `lib/auth/permissions.ts` (thêm entry vào catalog: scope key + danh sách action áp dụng). Key tự xuất hiện trong `/admin/roles` matrix.
2. **Gác** ở page/action/nav của module mới bằng `can(perms, '<scope>:<action>')` / `requirePerm(...)`.
3. **(Tuỳ chọn) seed mặc định**: nếu muốn role hệ thống có sẵn quyền mới, thêm key vào seed của role tương ứng (migration seed nhỏ) — hoặc để admin tự tick qua UI.
4. **Test**: thêm scope vào test "catalog đầy đủ + key hợp lệ".
> Vì `permission_key` là chuỗi validate theo catalog (không phải enum DB), thêm scope mới **không cần migration DB**. Role đã có sẽ không tự nhận quyền mới (an toàn — phải tick rõ).

## 9. UI quản lý
- **`/admin/roles`** (gate `users_roles:view`; sửa cần `users_roles:edit`): liệt kê role; tạo role mới (key+tên); ma trận **scope × action** tick on/off; lưu → ghi `role_permissions`. Role `is_system` (admin) không cho xoá; chặn tự khoá quyền `users_roles` của chính mình (giữ guard self-lockout hiện có).
- **`/admin/users`** (đã có): đổi gán `role` enum → chọn `app_roles` (role_id). Giữ guard admin không tự hạ quyền.

## 10. Test
- Catalog: mọi key hợp lệ, không trùng; `isValidKey` đúng.
- Seed: admin có đủ key; operator/viewer khớp tập cũ (so qua bảng §7); logistics ra đúng §4.
- `can()`: đúng/sai theo tập quyền.
- Shim: mỗi old perm map ra đúng key.
- Migration: backfill `roles.role_id` đúng từ `role` cũ.

## 11. Edge cases
- User chưa có role → mặc định `viewer` (giữ hành vi cũ).
- Role bị xoá khi còn user gán → chặn xoá (hoặc reset user về viewer) — chọn **chặn xoá** nếu còn user.
- `is_system` roles (admin/operator/viewer): không cho xoá; admin luôn = full (không cho bỏ tick `users_roles` cuối cùng → tránh khoá toàn hệ).
- `permission_key` trong DB không còn trong catalog (sau khi gỡ module) → bỏ qua khi resolve (không lỗi), và UI ẩn.

## 12. Ngoài phạm vi (YAGNI v1)
- Per-user permission override ngoài role.
- Permission theo store/brand (scope theo tài nguyên cụ thể).
- Audit log riêng cho thay đổi quyền (có thể thêm sau, tái dùng `auditLog`).
- Lời mời user (invite) — vẫn signup + gán role như hiện tại.
