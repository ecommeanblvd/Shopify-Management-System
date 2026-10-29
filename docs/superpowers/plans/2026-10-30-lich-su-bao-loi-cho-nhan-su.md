# Lịch sử báo lỗi cho nhân sự — kế hoạch thi công

> **Cho người/agent thi công:** BẮT BUỘC dùng `superpowers:subagent-driven-development` (khuyến nghị)
> hoặc `superpowers:executing-plans` để làm từng task. Các bước dùng checkbox `- [ ]` để theo dõi.

**Mục tiêu:** Nhân sự xem được báo lỗi thuộc phạm vi công việc của mình kèm trạng thái, và bấm vào
một lỗi thì mở modal nói rõ lỗi ở đâu và đã xử lý thế nào.

**Kiến trúc:** Một hàm THUẦN quyết toàn bộ "ai thấy được gì" (`features/issue-report/pham-vi.ts`),
suy quyền của từng module từ `NAV` + `SETTINGS_ITEMS` nên không có bảng ánh xạ phải bảo trì. Mọi lối
vào — tab trong panel Báo lỗi, trang rộng `/f/bao-loi`, route ảnh — đều gọi đúng hàm đó. Không
migration: hai bảng `issue_reports` / `issue_report_events` đã đủ cột.

**Nền tảng:** Next.js 16.2.6 · React 19.2.4 · Tailwind 4 · Drizzle + Postgres · vitest 4

**Thiết kế:** `docs/superpowers/specs/2026-10-30-lich-su-bao-loi-cho-nhan-su-design.md`

## Ràng buộc chung

- vitest **CHỈ bắt `.test.ts`, KHÔNG bắt `.test.tsx`** — mọi logic phải kiểm được nằm trong `.ts`.
- `vi.mock` bị kéo lên đầu tệp: dùng khai báo `function` cho hàm "chạm là ném", dựng Proxy `schema`
  ngay trong factory.
- `ACTIONS` trong `lib/auth/permissions.ts` là **tập đóng** — không thêm action mới.
- Gác quyền bằng `hasPermission(roleKey, '<tên cũ>')` như mọi màn khác, **không** gọi khoá mới trực
  tiếp: `hasPermission` dùng `OLD_TO_NEW` rồi `.every()`.
- `DialogContent` phải đặt bề rộng bằng **`sm:max-w-*`**, không phải `max-w-*` — `components/ui/dialog-max-w.test.ts` chặn việc này.
- Tương phản ≥ 4.5:1 ở **cả** light và dark mode.
- `npm run build` **bắt buộc** trước khi kết thúc: diff chạm `app/**` và `'use server'`.
- Không migration. Không đụng `/admin/issues`. Không sửa chỗ đóng cứng người thực hiện ở
  `PATCH /api/issues`.
- Mọi chữ hiện cho người dùng viết **tiếng Việt có dấu**.

## Review Focus

Năm ca thiết kế hàm ý mà không task nào tự nhiên kiểm tới — mỗi dòng đã được gắn test vào task sở hữu mã:

1. **Người báo đã bị xoá khỏi `user`** (`reporterId` là `set null`): modal tra tên người báo phải không nổ, hiện `reporterEmail` rồi tới "ẩn danh". → Task 4.
2. **`?bl=` không phải số nguyên dương** (`abc`, `-1`, `1e9`, rỗng): trả "không tìm thấy", không nổ, không truy vấn với `NaN`. → Task 6.
3. **Báo lỗi mang `module` không còn trong `DANH_SACH_MODULE`** (module bị bỏ/đổi tên): phải fail-closed về nhóm chỉ-`tat_ca`, KHÔNG thành "ai cũng thấy". → Task 2.
4. **`prUrl` không phải `https://`** (vd `javascript:`): không render thành liên kết. → Task 4.
5. **Panel mở ở trang không thuộc module nào** (Dashboard ⇒ `khac`, mà `khac` chỉ `tat_ca` thấy): nhân sự phải thấy câu giải thích + báo lỗi của chính mình, không phải một bảng trống vô nghĩa. → Task 5.

---

## Cấu trúc tệp

| Tệp | Trách nhiệm |
|---|---|
| `features/issue-report/pham-vi.ts` | **THUẦN.** Toàn bộ luật "ai thấy được gì": quyền của từng module, thấy chữ, thấy ảnh. |
| `features/issue-report/pham-vi.test.ts` | Test của luật trên — cổng quyền nên bắt buộc có ca chặn. |
| `features/issue-report/trinh-bay.ts` | **THUẦN.** Nhãn người trong dòng thời gian, liên kết an toàn, câu cho trạng thái chưa xử lý. |
| `features/issue-report/doc-tham-so.ts` | **THUẦN.** Đọc `?bl=` / `?trangThai=` / `?module=` của trang rộng. |
| `features/issue-report/queries.ts` | *(sửa)* thêm ba truy vấn theo phạm vi. |
| `components/issue-report/ModalChiTietBaoLoi.tsx` | Modal chi tiết, dùng ở cả hai lối vào. |
| `components/issue-report/BangLichSuBaoLoi.tsx` | Danh sách + mở modal. Dùng cho cả tab panel và trang rộng. |
| `components/issue-report/NutBaoLoi.tsx` | *(sửa)* thêm tab "Lịch sử". |
| `app/(dashboard)/f/bao-loi/page.tsx` | Trang xem rộng. |
| `app/(dashboard)/f/bao-loi/[id]/anh/[n]/route.ts` | Ảnh, gác bằng luật ảnh riêng, trả 404. |
| `lib/auth/permissions.ts` · `rbac.ts` · `permission-map.ts` | *(sửa)* hai phạm vi quyền mới. |

---

## Task 1: Hai quyền mới

**Tệp:**
- Sửa: `lib/auth/permissions.ts` (`CATALOG`), `lib/auth/rbac.ts` (union `Permission` + `MATRIX`),
  `lib/auth/permission-map.ts` (`OLD_TO_NEW`, `OPERATOR_OLD`, `VIEWER_OLD`, `QUYEN_MOI_VAI_TRO`,
  `QUYEN_THEO_VAI_NGOAI_HAT_GIONG`)
- Test: `lib/auth/permission-map.test.ts`

**Giao diện:**
- Sản xuất: tên cũ `'view_bao_loi'` và `'view_bao_loi_tat_ca'` trong union `Permission`; khoá mới
  `'bao_loi:view'` và `'bao_loi.tat_ca:view'`.

**Luật đặt:** làm **y hệt cách `view_nhat_ky` đang xuất hiện** ở bốn chỗ đó — đó là tiền lệ đã chạy
trong production. `view_bao_loi` theo đúng khuôn `view_nhat_ky` (mọi vai);
`view_bao_loi_tat_ca` thì **chỉ** `MATRIX.admin` + `QUYEN_THEO_VAI_NGOAI_HAT_GIONG.OC`, KHÔNG vào
`QUYEN_MOI_VAI_TRO`, KHÔNG vào `OPERATOR_OLD`/`VIEWER_OLD`.

- [ ] **Bước 1: Viết test đỏ** trong `lib/auth/permission-map.test.ts`

```ts
it('bao_loi:view cấp cho MỌI vai trò, cùng khuôn nhat_ky:view', () => {
  expect(QUYEN_MOI_VAI_TRO).toContain('bao_loi:view');
});
it('bao_loi.tat_ca:view KHÔNG cấp cho mọi vai', () => {
  expect(QUYEN_MOI_VAI_TRO).not.toContain('bao_loi.tat_ca:view');
});
it('vai OC có bao_loi.tat_ca:view', () => {
  expect(QUYEN_THEO_VAI_NGOAI_HAT_GIONG.OC).toContain('bao_loi.tat_ca:view');
});
it('hạt giống admin có cả hai khoá', () => {
  expect(SYSTEM_ROLE_SEEDS.admin.keys).toContain('bao_loi:view');
  expect(SYSTEM_ROLE_SEEDS.admin.keys).toContain('bao_loi.tat_ca:view');
});
it('tên cũ ánh xạ sang đúng một khoá mới', () => {
  expect(OLD_TO_NEW.view_bao_loi).toEqual(['bao_loi:view']);
  expect(OLD_TO_NEW.view_bao_loi_tat_ca).toEqual(['bao_loi.tat_ca:view']);
});
```

- [ ] **Bước 2: Chạy, xác nhận ĐỎ** — `npx vitest run lib/auth/permission-map.test.ts`
- [ ] **Bước 3: Thêm hai `ScopeDef` vào `CATALOG`** — `key: 'bao_loi'` và `key: 'bao_loi.tat_ca'`,
      mỗi cái `actions: ['view']`, có `nhanHanhDong.view` (lưới `/admin/roles` là module × action
      nên thiếu nhãn là ô hiện ra vô nghĩa):
      - `bao_loi` → `'Xem báo lỗi của các màn mình mở được, và báo lỗi của chính mình'`
      - `bao_loi.tat_ca` → `'Xem báo lỗi của MỌI bộ phận, kèm ảnh đính kèm'`
- [ ] **Bước 4: Thêm hai tên cũ** vào union `Permission` và vào `OLD_TO_NEW`; thêm `view_bao_loi`
      vào `MATRIX.admin`/`operator`/`viewer` và `OPERATOR_OLD`/`VIEWER_OLD`; `view_bao_loi_tat_ca`
      **chỉ** vào `MATRIX.admin`; cập nhật `QUYEN_MOI_VAI_TRO` và
      `QUYEN_THEO_VAI_NGOAI_HAT_GIONG.OC`.
- [ ] **Bước 5: Chạy lại, xác nhận XANH** + `npx tsc --noEmit`
- [ ] **Bước 6: Commit**

```bash
git add lib/auth/permissions.ts lib/auth/rbac.ts lib/auth/permission-map.ts lib/auth/permission-map.test.ts
git commit -m "feat(bao-loi): hai pham vi quyen bao_loi:view va bao_loi.tat_ca:view"
```

> **Bước triển khai, KHÔNG phải mã:** sau khi nhánh lên production phải chạy **một lượt**
> `npm run db:seed-roles`. `seedRoles()` là THÊM-KHÔNG-XOÁ (`onConflictDoNothing`) nên chạy lại bao
> nhiêu lần cũng không đụng quyền đã cấp tay. **Không chạy thì tab "Lịch sử" vô hình với tất cả.**

---

## Task 2: Luật phạm vi (thuần)

**Tệp:**
- Tạo: `features/issue-report/pham-vi.ts`
- Test: `features/issue-report/pham-vi.test.ts`

**Giao diện:**
- Tiêu thụ: `NAV`, `SETTINGS_ITEMS` (`lib/nav.ts`); `moduleTuDuongDan` (`features/issue-report/phan-loai.ts`); `hasPermission`, `type Permission` (`lib/auth/rbac.ts`).
- Sản xuất:
  - `export function quyenCuaModule(): ReadonlyMap<string, readonly Permission[]>`
  - `export function moduleXemDuoc(roleKey: string): { tatCa: boolean; module: ReadonlySet<string> }`
  - `export function xemDuocChu(a: { roleKey: string; module: string; laNguoiBao: boolean }): boolean`
  - `export function xemDuocAnh(a: { roleKey: string; laNguoiBao: boolean }): boolean`

**Luật, chép từ thiết kế §6.2 / §6.2b / §11:**
1. `quyenCuaModule()` đi qua **cả** `NAV` và `SETTINGS_ITEMS`; với mỗi mục, khoá là
   `moduleTuDuongDan(item.href).ma`, giá trị là `item.requires` chuẩn hoá thành mảng.
   **`requires === null` ⇒ bỏ qua, không dựng khoá** (nếu không, `canSeeNavItem` trả `true` cho
   `null` ⇒ `settings` và `khac` thành "ai cũng thấy", phá fail-closed).
2. Một module gộp quyền của **nhiều mục**, nghĩa **OR**.
3. `xemDuocChu` đúng khi: `laNguoiBao`, **hoặc** có `view_bao_loi_tat_ca`, **hoặc**
   (có `view_bao_loi` **và** có ít nhất một quyền trong `quyenCuaModule().get(module)`).
   Module không có trong map ⇒ chỉ `tat_ca`. **Fail-closed.**
4. `xemDuocAnh` đúng khi: `laNguoiBao`, **hoặc** có `view_bao_loi_tat_ca`. Hết.

- [ ] **Bước 1: Viết test đỏ** `features/issue-report/pham-vi.test.ts` — dùng `primeRoleCache`
      (`lib/auth/role-cache.ts`) để nạp quyền cho từng vai giả, không mock DB.

Chín ca bắt buộc (tên test ghi đúng như dưới):

```
'dựng quyền từ cả NAV và SETTINGS_ITEMS'            — can-san-pham có view_kpi_logistics
'module có hai mục NAV thì nhận cả hai quyền'        — ship-report: view_carrier_rates + view_kpi_logistics
'requires null thì KHÔNG dựng quyền'                 — map không có khoá 'settings', không có 'khac'
'settings và khac không thành ai-cũng-thấy'          — vai chỉ có view_bao_loi: xemDuocChu(...'khac')===false
'tat_ca thấy mọi module kể cả khac và module lạ'     — kể cả module 'module-khong-ton-tai'
'chỉ view_bao_loi + quyền một màn thì KHÔNG thấy màn khác'   ← CA CHẶN
'module không có trong map thì chỉ tat_ca thấy'      ← fail-closed, Review Focus #3
'người báo luôn thấy lỗi của mình, kể cả module ngoài phạm vi'
'không có view_bao_loi thì không thấy gì và KHÔNG ném'
'ảnh: cùng module mà không phải người báo và không tat_ca thì KHÔNG xem được ảnh'  ← CA CHẶN
```

- [ ] **Bước 2: Chạy, xác nhận ĐỎ** — `npx vitest run features/issue-report/pham-vi.test.ts`
- [ ] **Bước 3: Viết `features/issue-report/pham-vi.ts`** theo bốn luật trên. Đầu tệp phải ghi vì
      sao `requires: null` bị bỏ qua và vì sao fail-closed — kèm ngày đo (30/10/2026).
- [ ] **Bước 4: Chạy lại, xác nhận XANH (10 test)**
- [ ] **Bước 5: Chạy ĐỘT BIẾN THẬT và báo số đỏ**, rồi hoàn nguyên. Ba đột biến bắt buộc:
      (a) bỏ nhánh fail-closed (module không có trong map ⇒ cho xem);
      (b) đổi OR thành AND ở bước 2;
      (c) cho `requires: null` dựng mảng rỗng rồi coi "mảng rỗng ⇒ ai cũng thấy".
      Ghi số đỏ của từng đột biến vào thân commit.
- [ ] **Bước 6: Commit**

```bash
git add features/issue-report/pham-vi.ts features/issue-report/pham-vi.test.ts
git commit -m "feat(bao-loi): luat pham vi thuan, suy quyen tu NAV va SETTINGS_ITEMS"
```

---

## Task 3: Ba truy vấn theo phạm vi

**Tệp:**
- Sửa: `features/issue-report/queries.ts`

**Giao diện:**
- Tiêu thụ: `moduleXemDuoc` (Task 2).
- Sản xuất:
  - `baoLoiTrongPhamVi(a: { roleKey: string; userId: string; module?: string; trangThai?: string; gioiHan?: number }): Promise<BaoLoi[]>`
  - `baoLoiTheoSo(a: { so: number; roleKey: string; userId: string }): Promise<BaoLoi | null>`
  - `demTrangThaiTrongPhamVi(a: { roleKey: string; userId: string }): Promise<Record<string, number>>`

**Luật:** điều kiện SQL là `(reporter_id = userId) OR (module IN (...))`; có `tatCa` ⇒ bỏ hẳn điều
kiện. `module` truyền vào chỉ **thu hẹp thêm**, không mở rộng. `gioiHan` kẹp như `danhSachBaoLoi`
đang làm (1..500, mặc định 100). Sắp `createdAt` giảm dần.

- [ ] **Bước 1: Viết test đỏ** `features/issue-report/queries.pham-vi.test.ts` — mock `db` bằng
      `vi.mock` (nhớ: factory chạy TRƯỚC khi `const` khởi tạo ⇒ dùng khai báo `function`), chỉ
      khẳng định **hình dạng điều kiện**: có `tatCa` thì không có mệnh đề lọc module; không có
      `tatCa` thì mệnh đề chứa cả `reporter_id` và `module`.
- [ ] **Bước 2: Chạy, xác nhận ĐỎ**
- [ ] **Bước 3: Viết ba hàm** trong `features/issue-report/queries.ts`
- [ ] **Bước 4: Chạy lại, xác nhận XANH** + `npx tsc --noEmit`
- [ ] **Bước 5: Commit**

---

## Task 4: Modal chi tiết

**Tệp:**
- Tạo: `components/issue-report/ModalChiTietBaoLoi.tsx`
- Tạo: `features/issue-report/trinh-bay.ts` *(ba hàm thuần — phải ở `.ts`, vitest không bắt `.tsx`)*
- Test: `features/issue-report/trinh-bay.test.ts`

**Giao diện:**
- Tiêu thụ: `BaoLoi`, `SuKienBaoLoi` (`queries.ts`); `xemDuocAnh` (Task 2); `maBaoLoi`,
  `nhanModule`, `nhanMucDo`, `nhanTrangThai`.
- Sản xuất: `ModalChiTietBaoLoi({ baoLoi, suKien, xemAnh, tenNguoi, mo, onMoChange })`;
  và ba hàm thuần trong `features/issue-report/trinh-bay.ts`:
  - `nhanNguoiSuKien(nguoi: string, ten: Map<string, string>): string`
  - `laLienKetAnToan(url: string | null): boolean`
  - `cauChuaXuLy(trangThai: string): string`

**Bốn phần của modal (thiết kế §6.6):** đầu (mã · tiêu đề · 3 chip) → "Lỗi ở đâu" (mô tả
`whitespace-pre-wrap`, ảnh, liên kết `pagePath`, người báo, thời điểm) → "Đã xử lý thế nào"
(`ghiChuXuLy` + `xuLyLanCuoi` + liên kết PR) → dòng thời gian (cũ trước, mới sau).

**Ba luật trình bày:**
- `nguoi === 'tác vụ tự động'` ⇒ hiện **"ghi qua đường tự động"**. KHÔNG hiện "Hệ thống tự động" —
  nhãn đó *khẳng định* bot đã làm, mà có dòng như thế thực ra do người làm tay (thiết kế §7).
  Cuối dòng thời gian có câu *"Đường tự động không ghi lại ai thực hiện."*
- Người thật: hiện `user.name`; không có thì `reporterEmail`; không có nữa thì `"ẩn danh"`.
- `xemAnh === false` ⇒ thay khung ảnh bằng *"Báo lỗi này có N ảnh. Chỉ người báo và quản lý xem
  được."*

- [ ] **Bước 1: Viết test đỏ** `features/issue-report/trinh-bay.test.ts`

```
'dòng của bot ghi "ghi qua đường tự động", không ghi "Hệ thống tự động"'
'người báo đã bị xoá khỏi user thì không ném, trả email rồi tới ẩn danh'   ← Review Focus #1
'prUrl không phải https thì không coi là liên kết an toàn'                  ← Review Focus #4
'mỗi trạng thái chưa có ghi chú xử lý đều có câu riêng, không trả chuỗi rỗng'
```

- [ ] **Bước 2: Chạy, xác nhận ĐỎ**
- [ ] **Bước 3: Viết `features/issue-report/trinh-bay.ts`** (ba hàm thuần). Câu cho `moi`:
      *"Chưa ai xử lý. Tác vụ tự động chạy mỗi đêm khoảng 1:41."*
- [ ] **Bước 4: Viết `ModalChiTietBaoLoi.tsx`** — `DialogContent` đặt bề rộng bằng
      **`sm:max-w-2xl`** (không phải `max-w-2xl`).
- [ ] **Bước 5: Chạy test XANH** + `npx vitest run components/ui/dialog-max-w.test.ts` phải XANH
- [ ] **Bước 6: Commit**

---

## Task 5: Tab "Lịch sử" trong panel Báo lỗi

**Tệp:**
- Tạo: `components/issue-report/BangLichSuBaoLoi.tsx`
- Sửa: `components/issue-report/NutBaoLoi.tsx`
- Sửa: `features/issue-report/actions.ts` *(thêm server action đọc danh sách cho client)*

**Giao diện:**
- Tiêu thụ: `baoLoiTrongPhamVi`, `suKienCuaCacBaoLoi` (Task 3); `ModalChiTietBaoLoi` (Task 4).
- Sản xuất: `BangLichSuBaoLoi({ module, dangTrongPanel })`; server action
  `docLichSuBaoLoi(a: { module?: string }): Promise<{ ok: true; dong: ... } | { ok: false; loi: string }>`.

**Luật:**
- `NutBaoLoi` thành hai tab trong **cùng `Sheet`** đang có: "Báo lỗi" (form hiện tại, **không đổi
  gì**) và "Lịch sử". Giữ nguyên việc component **không nhận prop vị trí / className**.
- Tab "Lịch sử" lọc theo module suy từ **`usePathname`** (cùng `moduleTuDuongDan` form đang dùng),
  **không** theo ô chọn module trong form — hai thứ đó khác nhau khi người dùng tự đổi ô chọn.
- Không có `view_bao_loi` ⇒ **không hiện tab**; form vẫn chạy. Tab này sống trong panel của mọi
  module nên **tuyệt đối không ném** — theo đúng khuôn `components/nhat-ky/TabLichSu.tsx`.
- Cuối tab có liên kết **"Xem đầy đủ"** sang `/f/bao-loi`.
- Mỗi dòng: `BL-n` · tiêu đề · chip trạng thái · người báo · thời điểm. Bấm dòng ⇒ mở modal.

- [ ] **Bước 1: Viết test đỏ** — thêm vào `features/issue-report/pham-vi.test.ts`:

```
'module của trang Dashboard là khac, nên nhân sự chỉ thấy báo lỗi của chính mình ở đó'  ← Review Focus #5
```

- [ ] **Bước 2: Chạy, xác nhận ĐỎ**
- [ ] **Bước 3: Viết `BangLichSuBaoLoi.tsx`** + server action. Danh sách rỗng mà module nằm ngoài
      phạm vi ⇒ hiện *"Màn này thuộc nhóm chỉ quản lý xem được. Bạn vẫn thấy báo lỗi do chính bạn
      gửi."* — không hiện bảng trống.
- [ ] **Bước 4: Thêm hai tab vào `NutBaoLoi.tsx`** bằng `components/ui/tabs`
- [ ] **Bước 5: Chạy test XANH** + `npx tsc --noEmit` + `npx eslint`
- [ ] **Bước 6: Commit**

---

## Task 6: Trang rộng `/f/bao-loi`

**Tệp:**
- Tạo: `app/(dashboard)/f/bao-loi/page.tsx`
- Tạo: `features/issue-report/doc-tham-so.ts` *(hàm thuần đọc query string)*
- Test: `features/issue-report/doc-tham-so.test.ts`

**Giao diện:**
- Tiêu thụ: `baoLoiTrongPhamVi`, `baoLoiTheoSo`, `demTrangThaiTrongPhamVi` (Task 3);
  `BangLichSuBaoLoi` (Task 5); `moduleXemDuoc` (Task 2).

**Luật:**
- Gác bằng `hasPermission(role, 'view_bao_loi')`; thiếu ⇒ `redirect('/')`.
- **KHÔNG thêm mục vào `NAV`** — đó là hình CEO đã bỏ ở Nhật ký (`lib/nav.ts`). Vào từ liên kết
  "Xem đầy đủ" và từ link người khác gửi.
- Ô đếm theo trạng thái (bấm được để lọc) · bộ lọc trạng thái + module (ô chọn module **chỉ liệt kê
  module người đọc thấy được**).
- **`?bl=<số>`** mở thẳng modal của báo lỗi đó. Số không thuộc phạm vi ⇒ **"không tìm thấy"**,
  KHÔNG nói "không có quyền" (đừng tiết lộ nó tồn tại).
- Có `view_bao_loi_tat_ca` ⇒ mỗi dòng hiện thêm nhãn module.

- [ ] **Bước 1: Viết test đỏ** `features/issue-report/doc-tham-so.test.ts`

```
'?bl= không phải số nguyên dương thì trả null, không trả NaN'   ← Review Focus #2
   các giá trị: 'abc' · '-1' · '0' · '' · '1.5' · '1e9' · ' 7 '
'?bl=7 trả 7'
'trangThai lạ thì bỏ qua, không lọc'
```

- [ ] **Bước 2: Chạy, xác nhận ĐỎ**
- [ ] **Bước 3: Viết `docThamSoBaoLoi(sp: URLSearchParams)`** trong
      `features/issue-report/doc-tham-so.ts`, trả `{ so: number | null; trangThai: string | null; module: string | null }`
- [ ] **Bước 4: Viết `page.tsx`**
- [ ] **Bước 5: Chạy test XANH** + `npx tsc --noEmit`
- [ ] **Bước 6: Commit**

---

## Task 7: Route ảnh gác riêng

**Tệp:**
- Tạo: `app/(dashboard)/f/bao-loi/[id]/anh/[n]/route.ts`

**Giao diện:**
- Tiêu thụ: `xemDuocAnh` (Task 2); `phucVuAnh` (`features/issue-report/doc-anh.ts`, dùng lại nguyên).

**Luật:**
- Lấy khuôn từ `app/(dashboard)/admin/issues/[id]/anh/[n]/route.ts` nhưng **đổi cổng**: chưa đăng
  nhập ⇒ 401; không thoả `xemDuocAnh` ⇒ **404**, KHÔNG 403 — 403 là xác nhận ảnh đó tồn tại cho
  người không được xem.
- Phải đọc `reporterId` của báo lỗi để biết `laNguoiBao` **trước** khi gọi `phucVuAnh`.
- **KHÔNG** dùng lại route của admin (route đó gác bằng `manage_users`).

- [ ] **Bước 1: Viết test đỏ** — thêm vào `features/issue-report/pham-vi.test.ts`:

```
'xemDuocAnh: tat_ca xem được'
'xemDuocAnh: người báo xem được dù không có quyền module'
'xemDuocAnh: cùng module nhưng không phải người báo thì KHÔNG'   ← CA CHẶN
```

- [ ] **Bước 2: Chạy, xác nhận ĐỎ** *(nếu Task 2 đã phủ thì ghi rõ "đã phủ ở Task 2" và bỏ qua)*
- [ ] **Bước 3: Viết `route.ts`**
- [ ] **Bước 4: Kiểm sống** — mở một báo lỗi có ảnh bằng tài khoản không phải người báo và không có
      `tat_ca`: route phải trả **404**, và modal phải hiện câu *"Chỉ người báo và quản lý xem được"*.
- [ ] **Bước 5: Cổng cuối** — `npx tsc --noEmit` · `npx eslint .` · `npm test` · **`npm run build`**
      (bắt buộc: diff chạm `app/**` và `'use server'`)
- [ ] **Bước 6: Commit**

---

## Sau khi xong

1. Chạy **một lượt** `npm run db:seed-roles` trên production (xem ghi chú ở Task 1).
2. Kiểm sống bằng **ba tài khoản thật**: `bduc13922@` (vai `logistics`), `minhtu.event@` (vai
   `operator`), `fulfillmentmeanblvd@` (vai `OC`). Mỗi tài khoản phải thấy đúng phạm vi của nó, và
   `OC` phải thấy cả hai báo lỗi cũ kèm ảnh.
3. Ghi `Decisions.md` (D-267) + `Activity Log.md` trong Second Brain.
