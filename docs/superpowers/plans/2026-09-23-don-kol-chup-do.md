# Luồng đơn KOL & chụp đồ — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách hàng gửi KOL và hàng chụp đồ ra một luồng riêng trên SMS, không tạo đơn trên Shopify, có trừ tồn kho, theo dõi hàng mượn và ghi nhận chi phí theo giá vốn.

**Architecture:** Bốn bảng mới độc lập (`kol_nguoi_nhan`, `kol_don`, `kol_dong_don`, `kol_tra_ve`) theo khuôn `shipHoOrders` — không dẫn xuất từ `shopifyOrders`. Mọi luật nghiệp vụ nằm ở hàm THUẦN có test (`features/kol/*.ts`), tầng DB và tầng màn hình chỉ gọi lại. Tồn kho đổi qua đúng một cổng sẵn có là `applyMovement`, dùng lại lý do sẵn có và phân biệt bằng `refType`/`refId`, không thêm giá trị enum mới.

**Tech Stack:** Next.js (App Router, **bản phi tiêu chuẩn**), React 19, Drizzle ORM + Postgres, Vitest 4, Tailwind 4, shadcn/`@base-ui/react`.

**Spec:** `docs/superpowers/specs/2026-09-23-don-kol-chup-do-design.md` — đọc trước khi làm bất kỳ task nào.

## Global Constraints

- **Không đụng Shopify.** Luồng này tuyệt đối không tạo/sửa đơn hay tồn trên Shopify.
- **Không đụng MMP.** Không gọi `emitShipHoEvent` hay bất kỳ hàm nào trong `features/mmp/`, `features/ship-ho/mmp-*.ts`.
- **Không đụng KPI logistics.** Không sửa `features/kpi-logistics/`, `features/ship-report/`.
- **Không đụng màn Đóng hàng và Nhận & kiểm hàng.** Không sửa `components/dong-hang/`, `components/kho-nhan/`, `features/dong-hang/`, `features/kho-nhan/`.
- **Không đụng engine báo giá cước.** Không sửa `features/carrier-rates/`.
- **Không đụng `features/jobs/groups.ts`.** Job đẩy Lark `day-nhan-kcs-lark` phải ở nguyên nhóm `chua-bat`.
- **Tiếng Việt** cho tên biến, tên hàm, comment và mọi chữ hiện ra cho người dùng.
- **`sql` template với mảng JS dùng `IN ${arr}`, KHÔNG dùng `= ANY`.**
- **File `'use server'` chỉ được export hàm async.** Chỉ `next build` bắt được vi phạm này.
- **Next.js bản phi tiêu chuẩn:** đọc `node_modules/next/dist/docs/` trước khi viết route/page/server action. Đã biết: `searchParams` và `params` của page là **Promise**, phải `await`.
- **Drizzle trả cột `numeric` về dạng `string`**, không phải number. Phải `Number(...)` trước khi tính.
- **Migration là file SQL thô**, áp bằng script tạm dùng `sql.raw` rồi xoá script. **KHÔNG cập nhật drizzle journal** (nếp repo từ 0139).
- **`scripts/` không được dùng top-level await.**
- **NEVER** `git checkout` / `git stash` / `git reset` / `git clean` — cây làm việc dùng chung.
- Commit message kết thúc đúng dòng: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Không push.**

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `db/migrations/0159_kol.sql` | 3 enum, 4 bảng, 1 sequence, 1 index bổ sung |
| `db/schema.ts` | Khai báo Drizzle tương ứng |
| `features/kol/types.ts` | Kiểu dùng chung giữa các tầng |
| `features/kol/ma-don.ts` | THUẦN: dựng mã đơn từ số sequence |
| `features/kol/trang-thai.ts` | THUẦN: luật chuyển trạng thái |
| `features/kol/chi-phi.ts` | THUẦN: luật tính chi phí, quá hạn |
| `features/kol/tra-ve.ts` | THUẦN: luật trả từng phần |
| `features/kol/perm.ts` | Cổng quyền cho mọi server action |
| `features/kol/ton-kho.ts` | Cầu nối duy nhất sang `applyMovement` |
| `features/kol/queries.ts` | Đọc DB |
| `features/kol/actions.ts` | `'use server'` — mọi thao tác ghi |
| `components/kol/*.tsx` | Màn hình |
| `app/(dashboard)/f/kol/**` | Route |

---

### Task 1: Schema và migration

**Files:**
- Create: `db/migrations/0159_kol.sql`
- Modify: `db/schema.ts` (thêm vào cuối file, trước dòng cuối)

**Interfaces:**
- Consumes: `warehouseInventory`, `inventoryMovements` (đã có).
- Produces: `schema.kolNguoiNhan`, `schema.kolDon`, `schema.kolDongDon`, `schema.kolTraVe`; enum `kolMucDichEnum`, `kolDonTrangThaiEnum`, `kolHinhThucEnum`; sequence `kol_don_seq`.

- [ ] **Bước 1: Viết migration** `db/migrations/0159_kol.sql`

```sql
-- Luồng đơn KOL & chụp đồ (spec 2026-09-23). Bảng độc lập, KHÔNG dính shopify_orders.
CREATE TYPE kol_muc_dich AS ENUM ('kol', 'chup_do', 'khac');
CREATE TYPE kol_don_trang_thai AS ENUM ('nhap', 'da_chot', 'da_gui', 'huy');
CREATE TYPE kol_hinh_thuc AS ENUM ('tang', 'muon');

CREATE SEQUENCE IF NOT EXISTS kol_don_seq START 1;

CREATE TABLE IF NOT EXISTS kol_nguoi_nhan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ten text NOT NULL,
  kenh text,
  dien_thoai text,
  email text,
  quoc_gia text NOT NULL DEFAULT 'VN',
  dia_chi text,
  thanh_pho text,
  ghi_chu text,
  ngung_dung boolean NOT NULL DEFAULT false,
  tao_luc timestamp NOT NULL DEFAULT now(),
  tao_boi text,
  sua_luc timestamp NOT NULL DEFAULT now(),
  sua_boi text
);
CREATE INDEX IF NOT EXISTS kol_nguoi_nhan_ten_idx ON kol_nguoi_nhan (ten);

CREATE TABLE IF NOT EXISTS kol_don (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ma text NOT NULL UNIQUE,
  nguoi_nhan_id uuid NOT NULL REFERENCES kol_nguoi_nhan(id),
  muc_dich kol_muc_dich NOT NULL,
  trang_thai kol_don_trang_thai NOT NULL DEFAULT 'nhap',
  ten_nhan text NOT NULL,
  dien_thoai_nhan text,
  quoc_gia text NOT NULL DEFAULT 'VN',
  thanh_pho text,
  dia_chi text,
  hang_van_chuyen text,
  ma_van_don text,
  gui_luc timestamp,
  da_nhan_luc timestamp,
  ghi_chu text,
  tao_luc timestamp NOT NULL DEFAULT now(),
  tao_boi text,
  sua_luc timestamp NOT NULL DEFAULT now(),
  sua_boi text
);
CREATE INDEX IF NOT EXISTS kol_don_trang_thai_idx ON kol_don (trang_thai, tao_luc);
CREATE INDEX IF NOT EXISTS kol_don_nguoi_nhan_idx ON kol_don (nguoi_nhan_id);

CREATE TABLE IF NOT EXISTS kol_dong_don (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  don_id uuid NOT NULL REFERENCES kol_don(id) ON DELETE CASCADE,
  sku text NOT NULL,
  ten_hang text,
  kho text NOT NULL,
  so_luong integer NOT NULL CHECK (so_luong > 0),
  hinh_thuc kol_hinh_thuc NOT NULL,
  han_tra date,
  gia_von numeric(14,4),
  gia_von_tien_te text,
  gia_von_nguon text,
  so_luong_da_tra integer NOT NULL DEFAULT 0,
  so_luong_nhap_lai integer NOT NULL DEFAULT 0,
  CONSTRAINT kol_dong_don_tra_khong_vuot CHECK (so_luong_da_tra <= so_luong),
  CONSTRAINT kol_dong_don_nhap_lai_khong_vuot CHECK (so_luong_nhap_lai <= so_luong_da_tra)
);
CREATE INDEX IF NOT EXISTS kol_dong_don_don_idx ON kol_dong_don (don_id);
CREATE INDEX IF NOT EXISTS kol_dong_don_muon_idx ON kol_dong_don (hinh_thuc, han_tra);

CREATE TABLE IF NOT EXISTS kol_tra_ve (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dong_don_id uuid NOT NULL REFERENCES kol_dong_don(id) ON DELETE CASCADE,
  so_luong integer NOT NULL CHECK (so_luong > 0),
  nhap_lai_kho boolean NOT NULL,
  ly_do_khong_nhap text,
  tra_luc timestamp NOT NULL DEFAULT now(),
  ghi_chu text,
  tao_boi text NOT NULL
);
CREATE INDEX IF NOT EXISTS kol_tra_ve_dong_idx ON kol_tra_ve (dong_don_id);

-- Lọc movement theo bản ghi tham chiếu: hiện chỉ có index theo warehouse_inventory_id
-- và theo reason, nên báo cáo "hàng đã xuất cho KOL" sẽ quét toàn bảng nếu thiếu cái này.
CREATE INDEX IF NOT EXISTS inventory_movements_ref_idx ON inventory_movements (ref_type, ref_id);
```

- [ ] **Bước 2: Khai báo Drizzle** — thêm vào cuối `db/schema.ts`

```ts
/** ── Luồng đơn KOL & chụp đồ (spec 2026-09-23) ──────────────────────────────
 *  Bảng ĐỘC LẬP, không dẫn xuất từ shopify_orders: đơn nội bộ không được lẫn
 *  vào số liệu bán hàng. Khuôn theo shipHoOrders (địa chỉ là cột phẳng, ảnh
 *  chụp giá trị bất biến), khác ở chỗ đơn KOL CÓ dòng hàng và CÓ trừ tồn. */
export const kolMucDichEnum = pgEnum('kol_muc_dich', ['kol', 'chup_do', 'khac']);
export const kolDonTrangThaiEnum = pgEnum('kol_don_trang_thai', ['nhap', 'da_chot', 'da_gui', 'huy']);
export const kolHinhThucEnum = pgEnum('kol_hinh_thuc', ['tang', 'muon']);

export const kolNguoiNhan = pgTable('kol_nguoi_nhan', {
  id: uuid('id').defaultRandom().primaryKey(),
  ten: text('ten').notNull(),
  kenh: text('kenh'),
  dienThoai: text('dien_thoai'),
  email: text('email'),
  quocGia: text('quoc_gia').notNull().default('VN'),
  diaChi: text('dia_chi'),
  thanhPho: text('thanh_pho'),
  ghiChu: text('ghi_chu'),
  /** Ẩn khỏi ô chọn mà KHÔNG xoá, để đơn cũ vẫn tra ngược được người nhận. */
  ngungDung: boolean('ngung_dung').notNull().default(false),
  taoLuc: timestamp('tao_luc').notNull().defaultNow(),
  taoBoi: text('tao_boi'),
  suaLuc: timestamp('sua_luc').notNull().defaultNow(),
  suaBoi: text('sua_boi'),
}, (t) => [index('kol_nguoi_nhan_ten_idx').on(t.ten)]);

export const kolDon = pgTable('kol_don', {
  id: uuid('id').defaultRandom().primaryKey(),
  ma: text('ma').notNull().unique(),
  nguoiNhanId: uuid('nguoi_nhan_id').references(() => kolNguoiNhan.id).notNull(),
  mucDich: kolMucDichEnum('muc_dich').notNull(),
  trangThai: kolDonTrangThaiEnum('trang_thai').notNull().default('nhap'),
  /** Ảnh chụp từ sổ lúc tạo đơn: sửa sổ về sau KHÔNG đổi đơn cũ. */
  tenNhan: text('ten_nhan').notNull(),
  dienThoaiNhan: text('dien_thoai_nhan'),
  /** 'VN' là nội địa, khác là quốc tế — SUY RA, không có cột riêng để khỏi lệch. */
  quocGia: text('quoc_gia').notNull().default('VN'),
  thanhPho: text('thanh_pho'),
  diaChi: text('dia_chi'),
  hangVanChuyen: text('hang_van_chuyen'),
  maVanDon: text('ma_van_don'),
  guiLuc: timestamp('gui_luc'),
  daNhanLuc: timestamp('da_nhan_luc'),
  ghiChu: text('ghi_chu'),
  taoLuc: timestamp('tao_luc').notNull().defaultNow(),
  taoBoi: text('tao_boi'),
  suaLuc: timestamp('sua_luc').notNull().defaultNow(),
  suaBoi: text('sua_boi'),
}, (t) => [
  index('kol_don_trang_thai_idx').on(t.trangThai, t.taoLuc),
  index('kol_don_nguoi_nhan_idx').on(t.nguoiNhanId),
]);

export const kolDongDon = pgTable('kol_dong_don', {
  id: uuid('id').defaultRandom().primaryKey(),
  donId: uuid('don_id').references(() => kolDon.id, { onDelete: 'cascade' }).notNull(),
  sku: text('sku').notNull(),
  tenHang: text('ten_hang'),
  kho: text('kho').notNull(),
  soLuong: integer('so_luong').notNull(),
  hinhThuc: kolHinhThucEnum('hinh_thuc').notNull(),
  hanTra: date('han_tra'),
  /** Đông cứng khi chuyển sang 'da_gui'. numeric → Drizzle trả về STRING. */
  giaVon: numeric('gia_von', { precision: 14, scale: 4 }),
  giaVonTienTe: text('gia_von_tien_te'),
  /** 'sku_costs' khi hệ thống điền, 'tay' khi người dùng gõ. */
  giaVonNguon: text('gia_von_nguon'),
  soLuongDaTra: integer('so_luong_da_tra').notNull().default(0),
  soLuongNhapLai: integer('so_luong_nhap_lai').notNull().default(0),
}, (t) => [
  index('kol_dong_don_don_idx').on(t.donId),
  index('kol_dong_don_muon_idx').on(t.hinhThuc, t.hanTra),
]);

export const kolTraVe = pgTable('kol_tra_ve', {
  id: uuid('id').defaultRandom().primaryKey(),
  dongDonId: uuid('dong_don_id').references(() => kolDongDon.id, { onDelete: 'cascade' }).notNull(),
  soLuong: integer('so_luong').notNull(),
  /** false thì KHÔNG cộng tồn: hàng mượn về hỏng không được bán tiếp. */
  nhapLaiKho: boolean('nhap_lai_kho').notNull(),
  lyDoKhongNhap: text('ly_do_khong_nhap'),
  traLuc: timestamp('tra_luc').notNull().defaultNow(),
  ghiChu: text('ghi_chu'),
  taoBoi: text('tao_boi').notNull(),
}, (t) => [index('kol_tra_ve_dong_idx').on(t.dongDonId)]);
```

Kiểm import ở đầu `db/schema.ts` đã có `pgEnum`, `date`, `numeric`, `boolean`, `integer`, `index`. Thiếu cái nào thì thêm.

- [ ] **Bước 3: Chạy type check**

Run: `npx tsc --noEmit`
Expected: sạch, không lỗi.

- [ ] **Bước 4: Áp migration lên production**

Viết script tạm `scripts/_ap-0159.ts` (KHÔNG top-level await):

```ts
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

async function main() {
  const s = readFileSync('db/migrations/0159_kol.sql', 'utf8');
  await db.execute(sql.raw(s));
  const r = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('kol_nguoi_nhan','kol_don','kol_dong_don','kol_tra_ve') ORDER BY 1`);
  console.log('bảng đã tạo:', r.rows.map((x) => x.table_name));
  const i = await db.execute(sql`SELECT indexname FROM pg_indexes WHERE indexname = 'inventory_movements_ref_idx'`);
  console.log('index movement:', i.rows.length === 1 ? 'OK' : 'THIẾU');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx --env-file=.env scripts/_ap-0159.ts`
Expected: in ra đủ 4 bảng và `index movement: OK`. Sau đó **xoá script**: `rm scripts/_ap-0159.ts`

- [ ] **Bước 5: Commit**

```bash
git add db/migrations/0159_kol.sql db/schema.ts
git commit -m "feat(kol): bảng đơn KOL, dòng hàng, sổ người nhận và lần trả về"
```

---

### Task 2: Quyền và menu

**Files:**
- Modify: `lib/auth/rbac.ts`, `lib/auth/permissions.ts`, `lib/auth/permission-map.ts`, `lib/nav.ts`
- Create: `features/kol/perm.ts`
- Test: `lib/auth/permission-map.test.ts` (nếu đã có thì thêm ca; chưa có thì tạo)

**Interfaces:**
- Produces: `Permission` thêm `'view_kol' | 'manage_kol'`; scope `kol` với `view`/`create`/`edit`; `requireQuanLyKol(): Promise<string>`, `requireXemKol(): Promise<string>`.

- [ ] **Bước 1: Thêm quyền vào enum cũ** — `lib/auth/rbac.ts`

Thêm vào union `Permission`, ngay sau `'manage_ship_ho'`:

```ts
  | 'view_kol'
  | 'manage_kol'
```

Thêm vào `MATRIX.admin` và `MATRIX.operator`, ngay sau dòng `'view_ship_ho', 'manage_ship_ho',`:

```ts
    'view_kol', 'manage_kol',
```

**KHÔNG thêm vào `viewer`** — đơn KOL có địa chỉ và số điện thoại người thật, không mở mặc định cho vai chỉ-xem.

- [ ] **Bước 2: Thêm scope mới** — `lib/auth/permissions.ts`, trong `CATALOG`, ngay sau dòng `ship_ho`:

```ts
  { key: 'kol', label: 'Đơn KOL & chụp đồ', actions: ['view', 'create', 'edit'] },
```

- [ ] **Bước 3: Nối quyền cũ sang mới** — `lib/auth/permission-map.ts`, cạnh hai dòng `ship_ho`:

```ts
  view_kol: ['kol:view'],
  manage_kol: ['kol:view', 'kol:create', 'kol:edit'],
```

Thêm `'view_kol', 'manage_kol',` vào danh sách quyền của admin/operator trong file này (cùng chỗ đang liệt kê `'view_ship_ho', 'manage_ship_ho',`), và `'kol:view', 'kol:create', 'kol:edit',` vào danh sách scope tương ứng.

- [ ] **Bước 4: Thêm mục menu** — `lib/nav.ts`

Thêm `Camera` vào khối import từ `lucide-react` (giữ đúng thứ tự bảng chữ cái của khối đó), rồi thêm vào `NAV` ngay sau dòng `/f/ship-ho`:

```ts
  { href: '/f/kol',           label: 'Đơn KOL',       icon: Camera,          requires: 'view_kol' },
```

- [ ] **Bước 5: Viết cổng quyền** — `features/kol/perm.ts`

```ts
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

/**
 * Cổng cho MỌI server action ghi dữ liệu của luồng KOL.
 *
 * Vì sao kiểm lại dù trang đã kiểm: server action gọi được ĐỘC LẬP với trang,
 * nên không được tin trang đã gác hộ (đúng nếp features/ship-ho/require-manage.ts).
 */
export async function requireQuanLyKol(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập.');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_kol')) {
    throw new Error('Bạn không có quyền quản lý đơn KOL.');
  }
  return session.user.id;
}

/** Cổng cho thao tác chỉ ĐỌC gọi từ client (ví dụ tra giá vốn khi gõ form). */
export async function requireXemKol(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập.');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_kol')) {
    throw new Error('Bạn không có quyền xem đơn KOL.');
  }
  return session.user.id;
}
```

- [ ] **Bước 6: Viết test ánh xạ quyền** — `lib/auth/permission-map.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { PERMISSION_MAP } from './permission-map';

describe('quyền KOL', () => {
  it('view_kol chỉ mở quyền xem', () => {
    expect(PERMISSION_MAP.view_kol).toEqual(['kol:view']);
  });
  it('manage_kol mở đủ xem/tạo/sửa', () => {
    expect(PERMISSION_MAP.manage_kol).toEqual(['kol:view', 'kol:create', 'kol:edit']);
  });
});
```

Nếu tên export trong `permission-map.ts` khác `PERMISSION_MAP` thì dùng tên thật — **đọc file trước khi viết test**.

- [ ] **Bước 7: Chạy test và type check**

Run: `npx vitest run lib/auth && npx tsc --noEmit`
Expected: tất cả PASS, tsc sạch.

- [ ] **Bước 8: Commit**

```bash
git add lib/auth/rbac.ts lib/auth/permissions.ts lib/auth/permission-map.ts lib/auth/permission-map.test.ts lib/nav.ts features/kol/perm.ts
git commit -m "feat(kol): nhóm quyền riêng cho đơn KOL và mục menu"
```

---

### Task 3: Mã đơn và luật chuyển trạng thái (THUẦN)

**Files:**
- Create: `features/kol/types.ts`, `features/kol/ma-don.ts`, `features/kol/trang-thai.ts`
- Test: `features/kol/ma-don.test.ts`, `features/kol/trang-thai.test.ts`

**Interfaces:**
- Produces:
```ts
export type TrangThaiDon = 'nhap' | 'da_chot' | 'da_gui' | 'huy';
export type HinhThuc = 'tang' | 'muon';
export type MucDich = 'kol' | 'chup_do' | 'khac';
export function maDonKol(soSeq: number, luc: Date): string;
export function chuyenDuoc(tu: TrangThaiDon, den: TrangThaiDon): boolean;
export function suaDongDuoc(tt: TrangThaiDon): boolean;
export function suaGiaVonDuoc(tt: TrangThaiDon): boolean;
```

- [ ] **Bước 1: Test thất bại** — `features/kol/ma-don.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { maDonKol } from './ma-don';

describe('maDonKol', () => {
  it('dựng mã theo năm-tháng và số thứ tự đệm 4 chữ số', () => {
    expect(maDonKol(7, new Date('2026-09-23T10:00:00Z'))).toBe('KOL-2609-0007');
  });
  it('số vượt 4 chữ số thì KHÔNG cắt, để mã vẫn duy nhất', () => {
    expect(maDonKol(12345, new Date('2026-09-23T10:00:00Z'))).toBe('KOL-2609-12345');
  });
  it('sang tháng mới thì phần tháng đổi, số vẫn chạy tiếp không reset', () => {
    expect(maDonKol(8, new Date('2026-10-01T00:00:00Z'))).toBe('KOL-2610-0008');
  });
});
```

- [ ] **Bước 2: Test thất bại** — `features/kol/trang-thai.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { chuyenDuoc, suaDongDuoc, suaGiaVonDuoc } from './trang-thai';

describe('chuyenDuoc', () => {
  it('đường đi bình thường', () => {
    expect(chuyenDuoc('nhap', 'da_chot')).toBe(true);
    expect(chuyenDuoc('da_chot', 'da_gui')).toBe(true);
  });
  it('lùi về nháp để sửa dòng thì được', () => {
    expect(chuyenDuoc('da_chot', 'nhap')).toBe(true);
  });
  it('huỷ được khi còn nháp hoặc đã chốt', () => {
    expect(chuyenDuoc('nhap', 'huy')).toBe(true);
    expect(chuyenDuoc('da_chot', 'huy')).toBe(true);
  });
  it('ĐÃ GỬI thì không huỷ và không lùi — hàng đi rồi thì đường về là hàng trả', () => {
    expect(chuyenDuoc('da_gui', 'huy')).toBe(false);
    expect(chuyenDuoc('da_gui', 'da_chot')).toBe(false);
    expect(chuyenDuoc('da_gui', 'nhap')).toBe(false);
  });
  it('đơn đã huỷ là điểm cuối', () => {
    expect(chuyenDuoc('huy', 'nhap')).toBe(false);
    expect(chuyenDuoc('huy', 'da_chot')).toBe(false);
  });
  it('không cho nhảy cóc từ nháp thẳng sang đã gửi', () => {
    expect(chuyenDuoc('nhap', 'da_gui')).toBe(false);
  });
  it('chuyển sang chính nó là không hợp lệ', () => {
    expect(chuyenDuoc('nhap', 'nhap')).toBe(false);
  });
});

describe('suaDongDuoc / suaGiaVonDuoc', () => {
  it('dòng hàng chỉ sửa khi còn nháp — sau khi chốt là đã giữ chỗ tồn', () => {
    expect(suaDongDuoc('nhap')).toBe(true);
    expect(suaDongDuoc('da_chot')).toBe(false);
    expect(suaDongDuoc('da_gui')).toBe(false);
    expect(suaDongDuoc('huy')).toBe(false);
  });
  it('giá vốn sửa được cả khi đã chốt vì nó không dính tồn, nhưng đông cứng khi đã gửi', () => {
    expect(suaGiaVonDuoc('nhap')).toBe(true);
    expect(suaGiaVonDuoc('da_chot')).toBe(true);
    expect(suaGiaVonDuoc('da_gui')).toBe(false);
    expect(suaGiaVonDuoc('huy')).toBe(false);
  });
});
```

- [ ] **Bước 3: Chạy test, xác nhận FAIL**

Run: `npx vitest run features/kol`
Expected: FAIL — không tìm thấy module.

- [ ] **Bước 4: Viết `features/kol/types.ts`**

```ts
/** Kiểu dùng chung cho luồng đơn KOL & chụp đồ (spec 2026-09-23). */
export type TrangThaiDon = 'nhap' | 'da_chot' | 'da_gui' | 'huy';
export type HinhThuc = 'tang' | 'muon';
export type MucDich = 'kol' | 'chup_do' | 'khac';

/** Một dòng hàng, đủ để tính chi phí và tình trạng mượn — không dính DB. */
export interface DongDon {
  id: string;
  sku: string;
  tenHang: string | null;
  kho: string;
  soLuong: number;
  hinhThuc: HinhThuc;
  hanTra: string | null;
  /** numeric của Postgres về TS là string; null khi chưa có giá. */
  giaVon: string | null;
  giaVonTienTe: string | null;
  soLuongDaTra: number;
  soLuongNhapLai: number;
}
```

- [ ] **Bước 5: Viết `features/kol/ma-don.ts`**

```ts
/**
 * THUẦN: dựng mã đơn KOL từ số sequence.
 *
 * Sequence chạy LIÊN TỤC, cố ý không reset theo tháng: đơn cuối tháng 9 là
 * KOL-2609-0007 thì đơn đầu tháng 10 là KOL-2610-0008. Nhờ vậy mã không bao
 * giờ trùng kể cả khi ai đó sửa giờ hệ thống.
 */
export function maDonKol(soSeq: number, luc: Date): string {
  const nam = String(luc.getUTCFullYear()).slice(-2);
  const thang = String(luc.getUTCMonth() + 1).padStart(2, '0');
  return `KOL-${nam}${thang}-${String(soSeq).padStart(4, '0')}`;
}
```

- [ ] **Bước 6: Viết `features/kol/trang-thai.ts`**

```ts
import type { TrangThaiDon } from './types';

/** Đích hợp lệ cho từng trạng thái. Đã gửi và đã huỷ đều là điểm cuối. */
const DUONG_DI: Record<TrangThaiDon, readonly TrangThaiDon[]> = {
  nhap: ['da_chot', 'huy'],
  // Lùi về nháp để sửa dòng hàng: hệ thống trả lại phần tồn đã giữ chỗ.
  da_chot: ['da_gui', 'nhap', 'huy'],
  // Hàng đã đi khỏi kho — muốn thu lại thì đi đường hàng trả, không phải huỷ đơn.
  da_gui: [],
  huy: [],
};

/** THUẦN: có được chuyển từ trạng thái này sang trạng thái kia không. */
export function chuyenDuoc(tu: TrangThaiDon, den: TrangThaiDon): boolean {
  return DUONG_DI[tu].includes(den);
}

/**
 * THUẦN: có được thêm/bớt/sửa dòng hàng không.
 * Từ 'da_chot' trở đi là đã giữ chỗ tồn, sửa dòng sẽ làm lệch số đã giữ.
 */
export function suaDongDuoc(tt: TrangThaiDon): boolean {
  return tt === 'nhap';
}

/** THUẦN: có được sửa giá vốn không. Giá vốn không dính tồn nên nới tới 'da_chot'. */
export function suaGiaVonDuoc(tt: TrangThaiDon): boolean {
  return tt === 'nhap' || tt === 'da_chot';
}
```

- [ ] **Bước 7: Chạy test, xác nhận PASS**

Run: `npx vitest run features/kol && npx tsc --noEmit`
Expected: tất cả PASS, tsc sạch.

- [ ] **Bước 8: Commit**

```bash
git add features/kol/types.ts features/kol/ma-don.ts features/kol/trang-thai.ts features/kol/ma-don.test.ts features/kol/trang-thai.test.ts
git commit -m "feat(kol): mã đơn và luật chuyển trạng thái"
```

---

### Task 4: Luật chi phí, quá hạn và trả về (THUẦN)

**Files:**
- Create: `features/kol/chi-phi.ts`, `features/kol/tra-ve.ts`
- Test: `features/kol/chi-phi.test.ts`, `features/kol/tra-ve.test.ts`

**Interfaces:**
- Consumes: `DongDon` (Task 3).
- Produces:
```ts
export interface ChiPhiDong { daTieu: number; dangTreo: number; tienChiPhi: number | null; tienTe: string | null; thieuGiaVon: boolean }
export function chiPhiMotDong(d: DongDon): ChiPhiDong;
export interface TongChiPhi { theoTienTe: Record<string, number>; soMonDaTieu: number; soMonDangTreo: number; soDongThieuGiaVon: number }
export function tongChiPhi(ds: readonly DongDon[]): TongChiPhi;
export function soNgayTre(hanTra: string | null, homNay: string): number | null;
export function conNo(d: DongDon): number;
export function kiemTraVe(d: DongDon, soLuong: number, nhapLaiKho: boolean, lyDo: string | null): { ok: true } | { ok: false; loi: string };
```

**Vì sao `theoTienTe` chứ không phải một con số:** `sku_costs` có cả `VND` lẫn `USD` (đo 23/09: 4.105 dòng VND, 10 dòng USD). Cộng thẳng hai loại tiền ra một số là sai câm. Quy về VND là việc của tầng báo cáo ở Task 8, dùng tỷ giá tháng sẵn có, và phải nói rõ dòng nào không quy đổi được.

- [ ] **Bước 1: Test thất bại** — `features/kol/chi-phi.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { chiPhiMotDong, tongChiPhi, soNgayTre } from './chi-phi';
import type { DongDon } from './types';

const d = (o: Partial<DongDon>): DongDon => ({
  id: 'x', sku: 'A-1', tenHang: null, kho: 'GVM', soLuong: 1, hinhThuc: 'tang',
  hanTra: null, giaVon: '100', giaVonTienTe: 'VND', soLuongDaTra: 0, soLuongNhapLai: 0, ...o,
});

describe('chiPhiMotDong', () => {
  it('hàng tặng tính chi phí toàn bộ số lượng', () => {
    expect(chiPhiMotDong(d({ hinhThuc: 'tang', soLuong: 3, giaVon: '100' })))
      .toEqual({ daTieu: 3, dangTreo: 0, tienChiPhi: 300, tienTe: 'VND', thieuGiaVon: false });
  });
  it('hàng mượn trả về VÀ nhập lại kho thì KHÔNG tính chi phí', () => {
    expect(chiPhiMotDong(d({ hinhThuc: 'muon', soLuong: 2, soLuongDaTra: 2, soLuongNhapLai: 2, giaVon: '100' })))
      .toEqual({ daTieu: 0, dangTreo: 0, tienChiPhi: 0, tienTe: 'VND', thieuGiaVon: false });
  });
  it('hàng mượn trả về nhưng hỏng không nhập lại thì CÓ tính', () => {
    expect(chiPhiMotDong(d({ hinhThuc: 'muon', soLuong: 2, soLuongDaTra: 2, soLuongNhapLai: 0, giaVon: '100' })))
      .toEqual({ daTieu: 2, dangTreo: 0, tienChiPhi: 200, tienTe: 'VND', thieuGiaVon: false });
  });
  it('giữ nguyên tiền tệ của dòng, không mặc định về VND', () => {
    const r = chiPhiMotDong(d({ soLuong: 2, giaVon: '4', giaVonTienTe: 'USD' }));
    expect(r.tienChiPhi).toBe(8);
    expect(r.tienTe).toBe('USD');
  });
  it('hàng mượn chưa trả thì nằm ở cột đang treo, không trộn vào chi phí', () => {
    const r = chiPhiMotDong(d({ hinhThuc: 'muon', soLuong: 3, soLuongDaTra: 0, giaVon: '100' }));
    expect(r.dangTreo).toBe(3);
    expect(r.daTieu).toBe(3);
  });
  it('trả một phần: gửi 3 về 2 nhập lại 2 → tiêu 1, treo 1', () => {
    const r = chiPhiMotDong(d({ hinhThuc: 'muon', soLuong: 3, soLuongDaTra: 2, soLuongNhapLai: 2, giaVon: '100' }));
    expect(r).toEqual({ daTieu: 1, dangTreo: 1, tienChiPhi: 100, thieuGiaVon: false });
  });
  it('thiếu giá vốn thì báo thiếu, KHÔNG coi là 0 đồng', () => {
    const r = chiPhiMotDong(d({ giaVon: null, soLuong: 2 }));
    expect(r.tienChiPhi).toBeNull();
    expect(r.thieuGiaVon).toBe(true);
    expect(r.daTieu).toBe(2);
  });
});

describe('tongChiPhi', () => {
  it('cộng dồn và ĐẾM RIÊNG số dòng thiếu giá vốn', () => {
    expect(tongChiPhi([
      d({ hinhThuc: 'tang', soLuong: 2, giaVon: '50' }),
      d({ hinhThuc: 'muon', soLuong: 1, soLuongDaTra: 0, giaVon: null }),
      d({ hinhThuc: 'muon', soLuong: 4, soLuongDaTra: 4, soLuongNhapLai: 4, giaVon: '10' }),
    ])).toEqual({ theoTienTe: { VND: 100 }, soMonDaTieu: 3, soMonDangTreo: 1, soDongThieuGiaVon: 1 });
  });
  it('KHÔNG cộng thẳng hai loại tiền vào một số', () => {
    expect(tongChiPhi([
      d({ soLuong: 1, giaVon: '100', giaVonTienTe: 'VND' }),
      d({ soLuong: 1, giaVon: '4', giaVonTienTe: 'USD' }),
    ]).theoTienTe).toEqual({ VND: 100, USD: 4 });
  });
  it('danh sách rỗng ra rỗng, không ném lỗi', () => {
    expect(tongChiPhi([])).toEqual({ theoTienTe: {}, soMonDaTieu: 0, soMonDangTreo: 0, soDongThieuGiaVon: 0 });
  });
});

describe('soNgayTre', () => {
  it('chưa tới hạn trả về số âm', () => { expect(soNgayTre('2026-10-01', '2026-09-23')).toBe(-8); });
  it('đúng hạn là 0', () => { expect(soNgayTre('2026-09-23', '2026-09-23')).toBe(0); });
  it('quá hạn trả về số dương', () => { expect(soNgayTre('2026-09-20', '2026-09-23')).toBe(3); });
  it('không có hạn thì null', () => { expect(soNgayTre(null, '2026-09-23')).toBeNull(); });
});
```

- [ ] **Bước 2: Test thất bại** — `features/kol/tra-ve.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { conNo, kiemTraVe } from './tra-ve';
import type { DongDon } from './types';

const d = (o: Partial<DongDon>): DongDon => ({
  id: 'x', sku: 'A-1', tenHang: null, kho: 'GVM', soLuong: 3, hinhThuc: 'muon',
  hanTra: '2026-10-01', giaVon: '100', giaVonTienTe: 'VND', soLuongDaTra: 0, soLuongNhapLai: 0, ...o,
});

describe('conNo', () => {
  it('chưa trả gì thì nợ cả số lượng', () => { expect(conNo(d({}))).toBe(3); });
  it('trả một phần', () => { expect(conNo(d({ soLuongDaTra: 2 }))).toBe(1); });
  it('trả đủ thì hết nợ', () => { expect(conNo(d({ soLuongDaTra: 3 }))).toBe(0); });
  it('hàng tặng không nợ gì', () => { expect(conNo(d({ hinhThuc: 'tang' }))).toBe(0); });
});

describe('kiemTraVe', () => {
  it('trả trong phạm vi còn nợ thì được', () => {
    expect(kiemTraVe(d({}), 2, true, null)).toEqual({ ok: true });
  });
  it('trả VƯỢT số còn nợ thì chặn', () => {
    const r = kiemTraVe(d({ soLuongDaTra: 2 }), 2, true, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi).toContain('còn nợ 1');
  });
  it('số lượng không dương thì chặn', () => {
    expect(kiemTraVe(d({}), 0, true, null).ok).toBe(false);
    expect(kiemTraVe(d({}), -1, true, null).ok).toBe(false);
  });
  it('hàng TẶNG không có đường trả', () => {
    const r = kiemTraVe(d({ hinhThuc: 'tang' }), 1, true, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi).toContain('tặng');
  });
  it('không nhập lại kho thì BẮT BUỘC ghi lý do', () => {
    expect(kiemTraVe(d({}), 1, false, null).ok).toBe(false);
    expect(kiemTraVe(d({}), 1, false, '   ').ok).toBe(false);
    expect(kiemTraVe(d({}), 1, false, 'Váy rách gấu').ok).toBe(true);
  });
});
```

- [ ] **Bước 3: Chạy test, xác nhận FAIL**

Run: `npx vitest run features/kol`
Expected: FAIL — không tìm thấy `./chi-phi` và `./tra-ve`.

- [ ] **Bước 4: Viết `features/kol/chi-phi.ts`**

```ts
import type { DongDon } from './types';

export interface ChiPhiDong {
  /** Số món KHÔNG quay lại kho bán được — đây mới là chi phí thật. */
  daTieu: number;
  /** Số món mượn chưa trả: để riêng, KHÔNG trộn vào chi phí đã tiêu. */
  dangTreo: number;
  /** null khi dòng thiếu giá vốn — KHÔNG được coi là 0 đồng. */
  tienChiPhi: number | null;
  /** Tiền tệ của chính dòng đó. Không mặc định về VND. */
  tienTe: string | null;
  thieuGiaVon: boolean;
}

/**
 * THUẦN: chi phí của MỘT dòng hàng.
 *
 * Luật (spec §7.3): chi phí = giá vốn của hàng KHÔNG quay lại kho bán được.
 * Hàng tặng luôn tính. Hàng mượn trả về và nhập lại kho thì không tính, vì nó
 * vẫn bán được. Hàng mượn trả về mà hỏng không nhập lại thì có tính. Hàng mượn
 * chưa trả nằm ở cột "đang treo" riêng.
 */
export function chiPhiMotDong(d: DongDon): ChiPhiDong {
  const daTieu = d.hinhThuc === 'muon' ? d.soLuong - d.soLuongNhapLai : d.soLuong;
  const dangTreo = d.hinhThuc === 'muon' ? d.soLuong - d.soLuongDaTra : 0;
  const thieuGiaVon = d.giaVon == null || d.giaVon.trim() === '';
  const tienChiPhi = thieuGiaVon ? null : daTieu * Number(d.giaVon);
  const tienTe = thieuGiaVon ? null : (d.giaVonTienTe ?? 'VND');
  return { daTieu, dangTreo, tienChiPhi, tienTe, thieuGiaVon };
}

export interface TongChiPhi {
  /**
   * Cộng dồn THEO TỪNG LOẠI TIỀN. sku_costs có cả VND lẫn USD (đo 23/09/2026:
   * 4.105 dòng VND, 10 dòng USD), cộng thẳng hai loại vào một số là sai câm.
   * Quy về VND là việc của tầng báo cáo, dùng tỷ giá tháng.
   */
  theoTienTe: Record<string, number>;
  soMonDaTieu: number;
  soMonDangTreo: number;
  /** Đếm riêng để báo cáo nói thẳng, không im lặng bỏ qua. */
  soDongThieuGiaVon: number;
}

/** THUẦN: cộng dồn nhiều dòng. Dòng thiếu giá vốn không cộng tiền nhưng ĐƯỢC ĐẾM. */
export function tongChiPhi(ds: readonly DongDon[]): TongChiPhi {
  const theoTienTe: Record<string, number> = {};
  let soMonDaTieu = 0, soMonDangTreo = 0, soDongThieuGiaVon = 0;
  for (const d of ds) {
    const c = chiPhiMotDong(d);
    soMonDaTieu += c.daTieu;
    soMonDangTreo += c.dangTreo;
    if (c.thieuGiaVon) { soDongThieuGiaVon++; continue; }
    theoTienTe[c.tienTe!] = (theoTienTe[c.tienTe!] ?? 0) + c.tienChiPhi!;
  }
  return { theoTienTe, soMonDaTieu, soMonDangTreo, soDongThieuGiaVon };
}

/**
 * THUẦN: số ngày trễ so với hạn trả. Âm là chưa tới hạn, 0 là đúng hạn,
 * dương là đã quá hạn. Cả hai tham số là chuỗi ngày dạng YYYY-MM-DD.
 */
export function soNgayTre(hanTra: string | null, homNay: string): number | null {
  if (!hanTra) return null;
  const MS = 86_400_000;
  return Math.round((Date.parse(`${homNay}T00:00:00Z`) - Date.parse(`${hanTra}T00:00:00Z`)) / MS);
}
```

- [ ] **Bước 5: Viết `features/kol/tra-ve.ts`**

```ts
import type { DongDon } from './types';

/** THUẦN: còn nợ bao nhiêu món. Hàng tặng không nợ gì. */
export function conNo(d: DongDon): number {
  return d.hinhThuc === 'muon' ? d.soLuong - d.soLuongDaTra : 0;
}

/**
 * THUẦN: một lần nhận trả về có hợp lệ không.
 *
 * Chỉ dòng MƯỢN mới có đường trả (spec §6): đã tặng thì không đòi, và giữ hẹp
 * để số chi phí đã chốt không bị sửa ngược.
 */
export function kiemTraVe(
  d: DongDon, soLuong: number, nhapLaiKho: boolean, lyDo: string | null,
): { ok: true } | { ok: false; loi: string } {
  if (d.hinhThuc !== 'muon') {
    return { ok: false, loi: 'Dòng này là hàng tặng, không có đường trả về.' };
  }
  if (!Number.isInteger(soLuong) || soLuong <= 0) {
    return { ok: false, loi: 'Số lượng trả phải là số nguyên dương.' };
  }
  const no = conNo(d);
  if (soLuong > no) {
    return { ok: false, loi: `Trả ${soLuong} nhưng dòng này chỉ còn nợ ${no}.` };
  }
  if (!nhapLaiKho && !lyDo?.trim()) {
    return { ok: false, loi: 'Không nhập lại kho thì phải ghi lý do.' };
  }
  return { ok: true };
}
```

- [ ] **Bước 6: Chạy test, xác nhận PASS**

Run: `npx vitest run features/kol && npx tsc --noEmit`
Expected: tất cả PASS, tsc sạch.

- [ ] **Bước 7: Commit**

```bash
git add features/kol/chi-phi.ts features/kol/tra-ve.ts features/kol/chi-phi.test.ts features/kol/tra-ve.test.ts
git commit -m "feat(kol): luật tính chi phí marketing, quá hạn mượn và trả từng phần"
```

---

### Task 5: Cầu nối tồn kho

**Files:**
- Modify: `features/warehouse/ledger.ts` (nới union `refType`)
- Create: `features/kol/ton-kho.ts`
- Test: `features/kol/ton-kho.test.ts`

**Interfaces:**
- Consumes: `applyMovement`, `MovementDraft` (`features/warehouse/ledger.ts`).
- Produces:
```ts
export interface DongCanChuyen { id: string; sku: string; kho: string; soLuong: number }
export function draftGiuCho(d: DongCanChuyen, actor: string): MovementDraft;
export function draftTraCho(d: DongCanChuyen, actor: string): MovementDraft;
export function draftXuat(d: DongCanChuyen, actor: string): MovementDraft;
export function draftNhapLai(d: DongCanChuyen, soLuong: number, actor: string): MovementDraft;
```

**LƯU Ý QUAN TRỌNG — spec giả định sai một chỗ.** Spec §5 nói dùng `refType = 'kol_dong_don'`, nhưng `MovementDraft.refType` trong `features/warehouse/ledger.ts` là **union ĐÓNG**: `'receipt_item' | 'fulfillment_line' | 'order' | 'transfer' | 'item'`. Cột DB là `text` nên không cần migration, nhưng **phải nới union TypeScript** thì mới biên dịch được. Đây là thay đổi một dòng ở file dùng chung; không đổi hành vi của bất kỳ caller nào đang có.

- [ ] **Bước 1: Test thất bại** — `features/kol/ton-kho.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { draftGiuCho, draftTraCho, draftXuat, draftNhapLai } from './ton-kho';

const d = { id: '11111111-1111-1111-1111-111111111111', sku: 'A-1', kho: 'GVM', soLuong: 3 };

describe('draft tồn kho cho đơn KOL', () => {
  it('giữ chỗ chỉ tăng reserved, KHÔNG đụng on_hand', () => {
    expect(draftGiuCho(d, 'u1')).toEqual({
      sku: 'A-1', warehouseCode: 'GVM', deltaOnHand: 0, deltaReserved: 3,
      reason: 'auto_allocate', refType: 'kol_dong_don', refId: d.id, actor: 'u1',
    });
  });
  it('trả chỗ khi huỷ đơn đã chốt', () => {
    expect(draftTraCho(d, 'u1')).toMatchObject({ deltaOnHand: 0, deltaReserved: -3, reason: 'release_allocation' });
  });
  it('xuất kho trừ CẢ on_hand lẫn reserved — chỗ đã giữ nay thành hàng đi thật', () => {
    expect(draftXuat(d, 'u1')).toMatchObject({ deltaOnHand: -3, deltaReserved: -3, reason: 'pick' });
  });
  it('nhập lại kho chỉ cộng on_hand, theo số lượng trả chứ không theo số lượng gửi', () => {
    expect(draftNhapLai(d, 2, 'u1')).toMatchObject({ deltaOnHand: 2, deltaReserved: 0, reason: 'receipt_return' });
  });
  it('mọi draft đều gắn refType/refId để báo cáo lọc được hàng đã xuất cho KOL', () => {
    for (const m of [draftGiuCho(d, 'u1'), draftTraCho(d, 'u1'), draftXuat(d, 'u1'), draftNhapLai(d, 1, 'u1')]) {
      expect(m.refType).toBe('kol_dong_don');
      expect(m.refId).toBe(d.id);
    }
  });
});
```

- [ ] **Bước 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run features/kol/ton-kho.test.ts`
Expected: FAIL — không tìm thấy module.

- [ ] **Bước 3: Nới union `refType`** — `features/warehouse/ledger.ts`

Đổi đúng một dòng:

```ts
  refType?: 'receipt_item' | 'fulfillment_line' | 'order' | 'transfer' | 'item' | 'kol_dong_don';
```

- [ ] **Bước 4: Viết `features/kol/ton-kho.ts`**

```ts
import type { MovementDraft } from '@/features/warehouse/ledger';

/**
 * Cầu nối DUY NHẤT từ luồng KOL sang sổ cái tồn kho.
 *
 * Dùng lại bốn lý do sẵn có chứ KHÔNG thêm giá trị enum mới: validateMovement
 * (features/warehouse/allocation-logic.ts) chỉ xét delta và bất biến, hoàn toàn
 * không phân biệt lý do, nên bốn lý do này mang đúng nghĩa cho cả đơn bán lẫn
 * đơn KOL. Phân biệt bằng refType/refId — đúng mục đích hai cột đó sinh ra —
 * và tránh được migration ALTER TYPE ADD VALUE vốn không chạy chung transaction
 * với chỗ dùng nó.
 */
export interface DongCanChuyen { id: string; sku: string; kho: string; soLuong: number }

const REF = 'kol_dong_don' as const;

/** Chốt đơn: giữ chỗ, chưa lấy hàng ra khỏi kho. */
export function draftGiuCho(d: DongCanChuyen, actor: string): MovementDraft {
  return { sku: d.sku, warehouseCode: d.kho, deltaOnHand: 0, deltaReserved: d.soLuong,
    reason: 'auto_allocate', refType: REF, refId: d.id, actor };
}

/** Huỷ đơn đã chốt hoặc lùi về nháp: trả lại chỗ đã giữ. */
export function draftTraCho(d: DongCanChuyen, actor: string): MovementDraft {
  return { sku: d.sku, warehouseCode: d.kho, deltaOnHand: 0, deltaReserved: -d.soLuong,
    reason: 'release_allocation', refType: REF, refId: d.id, actor };
}

/** Đã gửi: chỗ đã giữ nay thành hàng đi thật, trừ cả hai con số. */
export function draftXuat(d: DongCanChuyen, actor: string): MovementDraft {
  return { sku: d.sku, warehouseCode: d.kho, deltaOnHand: -d.soLuong, deltaReserved: -d.soLuong,
    reason: 'pick', refType: REF, refId: d.id, actor };
}

/** Nhận hàng mượn về và còn dùng được: cộng tồn theo SỐ LƯỢNG TRẢ, không phải số đã gửi. */
export function draftNhapLai(d: DongCanChuyen, soLuong: number, actor: string): MovementDraft {
  return { sku: d.sku, warehouseCode: d.kho, deltaOnHand: soLuong, deltaReserved: 0,
    reason: 'receipt_return', refType: REF, refId: d.id, actor };
}
```

- [ ] **Bước 5: Chạy test và type check**

Run: `npx vitest run features/kol features/warehouse && npx tsc --noEmit`
Expected: tất cả PASS (kể cả test cũ của warehouse), tsc sạch.

- [ ] **Bước 6: Commit**

```bash
git add features/warehouse/ledger.ts features/kol/ton-kho.ts features/kol/ton-kho.test.ts
git commit -m "feat(kol): cầu nối tồn kho dùng lại lý do sẵn có, phân biệt bằng refType"
```

---

### Task 6: Truy vấn và thao tác ghi

**Files:**
- Create: `features/kol/queries.ts`, `features/kol/actions.ts`, `features/kol/gia-von.ts`
- Test: `features/kol/gia-von.test.ts`

**Interfaces:**
- Consumes: mọi thứ từ Task 1–5.
- Produces:
```ts
// gia-von.ts (THUẦN)
export interface DongGiaVon { costPerUnit: string; currency: string; effectiveFrom: string }
export function chonGiaVon(ds: readonly DongGiaVon[], ngay: string): DongGiaVon | null;
// queries.ts
export async function danhSachDon(loc: { trangThai?: string; nguoiNhanId?: string }): Promise<DonTomTat[]>;
export async function chiTietDon(ma: string): Promise<{ don: DonDayDu; dong: DongDon[] } | null>;
export async function danhSachNguoiNhan(gomCaNgung?: boolean): Promise<NguoiNhan[]>;
export async function dangMuon(homNay: string): Promise<MonDangMuon[]>;
export async function tonKhaDung(sku: string, kho: string): Promise<number>;
// actions.ts ('use server', CHỈ hàm async)
export async function taoNguoiNhan(fd: FormData): Promise<{ ok: boolean; loi?: string; id?: string }>;
export async function taoDon(fd: FormData): Promise<{ ok: boolean; loi?: string; ma?: string }>;
export async function chotDon(donId: string): Promise<{ ok: boolean; loi?: string }>;
export async function luiVeNhap(donId: string): Promise<{ ok: boolean; loi?: string }>;
export async function danhDauDaGui(fd: FormData): Promise<{ ok: boolean; loi?: string }>;
export async function huyDon(donId: string): Promise<{ ok: boolean; loi?: string }>;
export async function nhanTraVe(fd: FormData): Promise<{ ok: boolean; loi?: string }>;
```

- [ ] **Bước 1: Test thất bại** — `features/kol/gia-von.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { chonGiaVon } from './gia-von';

const g = (costPerUnit: string, effectiveFrom: string, currency = 'VND') => ({ costPerUnit, currency, effectiveFrom });

describe('chonGiaVon', () => {
  it('lấy dòng có hiệu lực mới nhất mà KHÔNG vượt quá ngày gửi', () => {
    expect(chonGiaVon([g('100', '2026-01-01'), g('120', '2026-06-01'), g('150', '2026-12-01')], '2026-09-23'))
      .toEqual(g('120', '2026-06-01'));
  });
  it('mọi dòng đều sau ngày gửi thì trả null, KHÔNG lấy bừa dòng gần nhất', () => {
    expect(chonGiaVon([g('150', '2026-12-01')], '2026-09-23')).toBeNull();
  });
  it('đúng ngày hiệu lực thì tính là có hiệu lực', () => {
    expect(chonGiaVon([g('120', '2026-09-23')], '2026-09-23')).toEqual(g('120', '2026-09-23'));
  });
  it('danh sách rỗng trả null', () => {
    expect(chonGiaVon([], '2026-09-23')).toBeNull();
  });
});
```

- [ ] **Bước 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run features/kol/gia-von.test.ts`
Expected: FAIL — không tìm thấy module.

- [ ] **Bước 3: Viết `features/kol/gia-von.ts`**

```ts
export interface DongGiaVon { costPerUnit: string; currency: string; effectiveFrom: string }

/**
 * THUẦN: chọn dòng giá vốn áp cho một ngày.
 *
 * Lấy dòng có effective_from LỚN NHẤT mà vẫn <= ngày gửi. Nếu mọi dòng đều sau
 * ngày gửi thì trả null chứ KHÔNG lấy bừa dòng gần nhất — thà để trống cho
 * người dùng gõ tay còn hơn điền một con số sai vào báo cáo chi phí.
 */
export function chonGiaVon(ds: readonly DongGiaVon[], ngay: string): DongGiaVon | null {
  let tot: DongGiaVon | null = null;
  for (const d of ds) {
    if (d.effectiveFrom > ngay) continue;
    if (!tot || d.effectiveFrom > tot.effectiveFrom) tot = d;
  }
  return tot;
}
```

- [ ] **Bước 4: Viết `features/kol/queries.ts`**

Đọc `features/ship-ho/queries.ts` trước để bám đúng nếp của repo. Yêu cầu bắt buộc của file này:

- `danhSachDon` nhận bộ lọc tuỳ chọn, `ORDER BY tao_luc DESC`, giới hạn 500 dòng, và trả kèm số dòng hàng của mỗi đơn.
- `chiTietDon(ma)` trả `null` gọn gàng khi không có đơn, không ném lỗi.
- `dangMuon(homNay)` chỉ lấy dòng `hinh_thuc = 'muon'` còn `so_luong_da_tra < so_luong`, join sang đơn và sổ KOL để có tên người giữ, **sắp xếp theo `han_tra` tăng dần với `NULLS LAST`** để quá hạn nằm trên cùng. Trả kèm `soNgayTre` tính bằng hàm thuần của Task 4.
- `tonKhaDung(sku, kho)` trả `qty_on_hand - qty_reserved` của dòng tồn đó, trả `0` khi chưa có dòng.
- Mảng JS đưa vào `sql` template dùng `IN ${arr}`, **không dùng `= ANY`**.

- [ ] **Bước 5: Viết `features/kol/actions.ts`**

Mở đầu file bằng `'use server';`. **Chỉ export hàm async** — hằng số, kiểu, hàm thuần phải để ở file khác, vì chỉ `next build` bắt được vi phạm này.

Mỗi hàm bắt đầu bằng `const actor = await requireQuanLyKol();`. **Mọi phép quy timestamp về ngày hay tháng phải đi qua `ngayKinhDoanh` / `thangKinhDoanh` của `lib/timezone.ts`, KHÔNG dùng `toISOString()` hay `getUTC*`** — đo thật trên dữ liệu công ty: quy theo UTC thì 36,6% đơn lệch ngày và 91 đơn lệch hẳn tháng. Sau mỗi thao tác ghi thành công gọi `revalidatePath('/f/kol')` và `revalidatePath(\`/f/kol/${ma}\`)`.

**`chotDon` — giữ chỗ tồn. Đây là hàm dễ viết sai nhất, viết đúng như sau:**

```ts
export async function chotDon(donId: string): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  const [don] = await db.select().from(schema.kolDon).where(eq(schema.kolDon.id, donId));
  if (!don) return { ok: false, loi: 'Không tìm thấy đơn.' };
  if (!chuyenDuoc(don.trangThai, 'da_chot')) {
    return { ok: false, loi: `Đơn đang ở trạng thái ${don.trangThai}, không chốt được.` };
  }
  const dong = await db.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.donId, donId));
  if (dong.length === 0) return { ok: false, loi: 'Đơn chưa có dòng hàng nào.' };

  try {
    await db.transaction(async (tx) => {
      for (const d of dong) {
        await applyMovement(tx, draftGiuCho({ id: d.id, sku: d.sku, kho: d.kho, soLuong: d.soLuong }, actor));
      }
      await tx.update(schema.kolDon)
        .set({ trangThai: 'da_chot', suaLuc: new Date(), suaBoi: actor })
        .where(eq(schema.kolDon.id, donId));
    });
  } catch {
    // applyMovement ném khi vi phạm bất biến tồn. Nói ĐÚNG mã hàng nào thiếu và
    // thiếu bao nhiêu — báo "lỗi tồn kho" chung chung thì kho không biết làm gì.
    const thieu: string[] = [];
    for (const d of dong) {
      const kd = await tonKhaDung(d.sku, d.kho);
      if (kd < d.soLuong) thieu.push(`${d.sku} tại ${d.kho}: cần ${d.soLuong}, còn ${kd}`);
    }
    return {
      ok: false,
      loi: thieu.length
        ? `Không đủ tồn để giữ chỗ — ${thieu.join('; ')}. Nhận hàng vào kho trước rồi chốt lại.`
        : 'Chốt đơn thất bại, tồn kho vừa đổi. Thử lại.',
    };
  }
  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${don.ma}`);
  return { ok: true };
}
```

**`danhDauDaGui` — xuất tồn và đông cứng giá vốn:**

```ts
export async function danhDauDaGui(fd: FormData): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  const donId = String(fd.get('donId') ?? '');
  const hang = String(fd.get('hangVanChuyen') ?? '').trim();
  const maVanDon = String(fd.get('maVanDon') ?? '').trim();
  if (!hang || !maVanDon) return { ok: false, loi: 'Phải có tên hãng và mã vận đơn trước khi đánh dấu đã gửi.' };

  const [don] = await db.select().from(schema.kolDon).where(eq(schema.kolDon.id, donId));
  if (!don) return { ok: false, loi: 'Không tìm thấy đơn.' };
  if (!chuyenDuoc(don.trangThai, 'da_gui')) {
    return { ok: false, loi: `Đơn đang ở trạng thái ${don.trangThai}, không gửi được.` };
  }
  const dong = await db.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.donId, donId));
  const luc = new Date();
  // Giờ NGHIỆP VỤ, không phải UTC. lib/timezone.ts ghi số đo thật: quy theo UTC thì
  // 36,6% đơn lệch ngày và 91 đơn lệch hẳn THÁNG. Chọn sai ngày ở đây là chọn sai
  // dòng giá vốn, rồi con số đó đông cứng vĩnh viễn vào chi phí marketing.
  const ngayGui = ngayKinhDoanh(luc)!;

  await db.transaction(async (tx) => {
    for (const d of dong) {
      await applyMovement(tx, draftXuat({ id: d.id, sku: d.sku, kho: d.kho, soLuong: d.soLuong }, actor));
      // Đông cứng giá vốn. Dòng người dùng đã gõ tay thì GIỮ NGUYÊN, không đè.
      if (d.giaVon == null) {
        const ds = await tx.select({
          costPerUnit: schema.skuCosts.costPerUnit,
          currency: schema.skuCosts.currency,
          effectiveFrom: schema.skuCosts.effectiveFrom,
          storeId: schema.skuCosts.storeId,
        }).from(schema.skuCosts).where(eq(schema.skuCosts.sku, d.sku));
        // sku_costs khoá theo (store_id, sku, effective_from) — MỘT mã hàng có thể
        // có giá ở nhiều cửa hàng. Đo 23/09/2026: hiện 0 mã nào như vậy, nhưng đã
        // có HAI cửa hàng cùng ghi giá (meanblvd 4.109 dòng, tinhatelier 6 dòng).
        // Nhập nhằng thì ĐỂ NULL cho người dùng gõ tay, không bốc giá của cửa hàng
        // khác gán vào hàng của mình — đúng cách đã xử lý ở việc mã vạch.
        const soStore = new Set(ds.map((x) => x.storeId)).size;
        const g = soStore > 1 ? null : chonGiaVon(ds, ngayGui);
        // Không tra được thì ĐỂ NULL. Báo cáo sẽ đếm dòng này là "chưa có giá",
        // còn hơn bịa một con số rồi nó nằm trong chi phí marketing mãi mãi.
        if (g) {
          await tx.update(schema.kolDongDon)
            .set({ giaVon: g.costPerUnit, giaVonTienTe: g.currency, giaVonNguon: 'sku_costs' })
            .where(eq(schema.kolDongDon.id, d.id));
        }
      }
    }
    await tx.update(schema.kolDon)
      .set({ trangThai: 'da_gui', hangVanChuyen: hang, maVanDon, guiLuc: luc, suaLuc: luc, suaBoi: actor })
      .where(eq(schema.kolDon.id, donId));
  });
  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${don.ma}`);
  return { ok: true };
}
```

**`nhanTraVe` — nhận hàng mượn về:**

```ts
export async function nhanTraVe(fd: FormData): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  const dongId = String(fd.get('dongId') ?? '');
  const soLuong = Number(fd.get('soLuong') ?? 0);
  const nhapLaiKho = fd.get('nhapLaiKho') === '1';
  const lyDo = (fd.get('lyDoKhongNhap') as string | null) ?? null;

  const [d] = await db.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.id, dongId));
  if (!d) return { ok: false, loi: 'Không tìm thấy dòng hàng.' };

  const kiem = kiemTraVe(
    { id: d.id, sku: d.sku, tenHang: d.tenHang, kho: d.kho, soLuong: d.soLuong, hinhThuc: d.hinhThuc,
      hanTra: d.hanTra, giaVon: d.giaVon, giaVonTienTe: d.giaVonTienTe,
      soLuongDaTra: d.soLuongDaTra, soLuongNhapLai: d.soLuongNhapLai },
    soLuong, nhapLaiKho, lyDo,
  );
  if (!kiem.ok) return { ok: false, loi: kiem.loi };

  await db.transaction(async (tx) => {
    await tx.insert(schema.kolTraVe).values({
      dongDonId: dongId, soLuong, nhapLaiKho,
      lyDoKhongNhap: nhapLaiKho ? null : lyDo, taoBoi: actor,
    });
    await tx.update(schema.kolDongDon).set({
      soLuongDaTra: d.soLuongDaTra + soLuong,
      // Chỉ phần NHẬP LẠI mới rời khỏi chi phí. Hàng về mà hỏng vẫn là tiền đã tiêu.
      soLuongNhapLai: nhapLaiKho ? d.soLuongNhapLai + soLuong : d.soLuongNhapLai,
    }).where(eq(schema.kolDongDon.id, dongId));
    if (nhapLaiKho) {
      await applyMovement(tx, draftNhapLai({ id: d.id, sku: d.sku, kho: d.kho, soLuong: d.soLuong }, soLuong, actor));
    }
  });
  revalidatePath('/f/kol');
  return { ok: true };
}
```

**Ba hàm còn lại, quy tắc bắt buộc:**

- **`taoDon`** — sinh mã bằng `SELECT nextval('kol_don_seq')` rồi `maDonKol(so, new Date())`. Chụp ảnh `tenNhan`/`dienThoaiNhan`/`quocGia`/`thanhPho`/`diaChi` từ sổ KOL sang đơn. Dòng `hinhThuc = 'muon'` **bắt buộc có `hanTra`**, thiếu thì trả lỗi nêu đúng dòng nào. Tạo ở `nhap`, **không đụng tồn**.
- **`luiVeNhap`** và **`huyDon`** — kiểm `chuyenDuoc` như `chotDon`. Nếu đang ở `da_chot` thì trong cùng một transaction gọi `applyMovement(tx, draftTraCho(...))` cho từng dòng để trả lại chỗ đã giữ, rồi mới đổi trạng thái.
- **`taoNguoiNhan`** — `ten` bắt buộc, phần còn lại tuỳ chọn.

- [ ] **Bước 6: Chạy đủ ba cổng**

Run: `npx vitest run features/kol features/warehouse && npx tsc --noEmit && npx next build`
Expected: test PASS, tsc sạch, build thành công. **`next build` là thứ duy nhất bắt được vi phạm `'use server'`, không được bỏ qua.**

- [ ] **Bước 7: Kiểm bằng dữ liệu thật (chỉ ĐỌC)**

Viết script tạm `scripts/_kol-doc.ts` (không top-level await) gọi `tonKhaDung` trên 3 mã hàng có tồn thật và `chonGiaVon` trên dữ liệu `sku_costs` thật, in kết quả. Xác nhận số khớp với truy vấn tay. Xoá script sau khi xong.

- [ ] **Bước 8: Commit**

```bash
git add features/kol/gia-von.ts features/kol/gia-von.test.ts features/kol/queries.ts features/kol/actions.ts
git commit -m "feat(kol): truy vấn và thao tác đặt, chốt, gửi, huỷ, nhận trả về"
```

---

### Task 7: Màn danh sách, tạo đơn và chi tiết đơn

**Files:**
- Create: `app/(dashboard)/f/kol/page.tsx`, `app/(dashboard)/f/kol/moi/page.tsx`, `app/(dashboard)/f/kol/[ma]/page.tsx`
- Create: `components/kol/BangDonKol.tsx`, `components/kol/FormDonMoi.tsx`, `components/kol/ChiTietDon.tsx`

**Interfaces:**
- Consumes: `queries.ts`, `actions.ts` (Task 6); `chiPhiMotDong`, `soNgayTre` (Task 4); `suaDongDuoc`, `suaGiaVonDuoc` (Task 3).

**Next.js bản phi tiêu chuẩn:** `params` và `searchParams` của page là **Promise**, phải `await`. Đọc `node_modules/next/dist/docs/01-app/` trước khi viết. Bám khuôn `app/(dashboard)/f/ship-ho/page.tsx` cho phần gác quyền đầu trang.

- [ ] **Bước 1: Trang danh sách** `app/(dashboard)/f/kol/page.tsx`

Mở đầu bằng khối gác quyền y như ship-hộ:

```tsx
export const dynamic = 'force-dynamic';

export default async function DanhSachKolPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_kol')) redirect('/');
  const sp = await searchParams;
  // ...
}
```

Bảng gồm các cột: mã đơn, người nhận, mục đích, **nội địa hay quốc tế** (suy từ `quocGia === 'VN'`), số món, trạng thái, hãng và mã vận đơn, ngày gửi. Bộ lọc theo trạng thái và theo người nhận. Nút "Tạo đơn" dẫn sang `/f/kol/moi`, chỉ hiện khi có quyền `manage_kol`.

- [ ] **Bước 2: Trang tạo đơn** `app/(dashboard)/f/kol/moi/page.tsx` và `components/kol/FormDonMoi.tsx`

Form gồm: chọn người nhận từ sổ (lọc bỏ `ngungDung`), chọn mục đích, và một bảng dòng hàng thêm bớt được với các cột mã hàng, kho, số lượng, hình thức (tặng/mượn), hạn trả, giá vốn.

Ba quy tắc bắt buộc ở màn này:

1. **Chọn "mượn" thì ô hạn trả bật lên và bắt buộc.** Chọn "tặng" thì ô đó tắt và xoá trống.
2. **Hiện tồn khả dụng ngay cạnh mã hàng** sau khi chọn, lấy từ `tonKhaDung`. Nhập số lượng vượt tồn thì cảnh báo ngay tại dòng đó, đừng để người dùng bấm lưu rồi mới biết.
3. **Giá vốn điền sẵn nếu tra được, để trống nếu không**, kèm một dòng chữ nhỏ nói rõ dòng nào chưa có giá và sẽ không vào được báo cáo chi phí cho tới khi điền.

- [ ] **Bước 3: Trang chi tiết** `app/(dashboard)/f/kol/[ma]/page.tsx` và `components/kol/ChiTietDon.tsx`

```tsx
export default async function ChiTietKolPage({ params }: { params: Promise<{ ma: string }> }) {
  const { ma } = await params;
  // ...
}
```

Nội dung: thông tin đơn, bảng dòng hàng kèm tình trạng mượn, và các nút theo đúng trạng thái hiện tại.

- Nút hiện ra phải khớp `chuyenDuoc`. Trạng thái `da_gui` **không có nút huỷ**.
- Ô hãng vận chuyển và mã vận đơn chỉ bật khi đang ở `da_chot`, và bấm "Đã gửi" thì cả hai phải có giá trị.
- Dòng hàng chỉ sửa được khi `suaDongDuoc(trangThai)`; ô giá vốn theo `suaGiaVonDuoc(trangThai)`.
- Mỗi dòng mượn hiện số còn nợ và nút "Nhận trả về" mở form gồm số lượng, ô chọn **"Nhập lại kho"** hoặc **"Không nhập lại"**, và ô lý do bật lên khi chọn không nhập lại.

- [ ] **Bước 4: Chạy đủ ba cổng**

Run: `npx vitest run features/kol && npx tsc --noEmit && npx eslint app/\(dashboard\)/f/kol components/kol && npx next build`
Expected: tất cả xanh.

- [ ] **Bước 5: Commit**

```bash
git add "app/(dashboard)/f/kol" components/kol
git commit -m "feat(kol): màn danh sách, tạo đơn và chi tiết đơn KOL"
```

---

### Task 8: Sổ KOL, màn đang mượn và báo cáo chi phí

**Files:**
- Create: `app/(dashboard)/f/kol/nguoi-nhan/page.tsx`, `app/(dashboard)/f/kol/dang-muon/page.tsx`
- Create: `components/kol/SoKol.tsx`, `components/kol/BangDangMuon.tsx`, `components/kol/TomTatChiPhi.tsx`
- Modify: `features/kol/queries.ts` (thêm truy vấn báo cáo)
- Test: `features/kol/bao-cao.test.ts`
- Create: `features/kol/bao-cao.ts`

**Interfaces:**
- Consumes: `tongChiPhi`, `soNgayTre`, `conNo` (Task 4).
- Produces:
```ts
export interface DongBaoCao { khoa: string; theoTienTe: Record<string, number>; soMonDaTieu: number; soMonDangTreo: number; soDongThieuGiaVon: number }
export function gomTheoThang(ds: readonly (DongDon & { guiLuc: string | null })[]): DongBaoCao[];
export function gomTheoNguoiNhan(ds: readonly (DongDon & { tenNhan: string })[]): DongBaoCao[];
export interface QuyDoi { vnd: number; khongDoiDuoc: string[] }
export function quyVeVnd(theoTienTe: Record<string, number>, period: string, rates: TiGiaThang[]): QuyDoi;
```

`TiGiaThang` và `doiTienTheoThang` lấy từ `features/cogs/tien.ts`, danh sách tỷ giá lấy từ `tiGiaThang()` ở `features/cogs/queries.ts`. **Dùng lại, không viết bản thứ hai.**

- [ ] **Bước 1: Test thất bại** — `features/kol/bao-cao.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { gomTheoThang, gomTheoNguoiNhan, quyVeVnd } from './bao-cao';
import type { DongDon } from './types';

const base: DongDon = {
  id: 'x', sku: 'A-1', tenHang: null, kho: 'GVM', soLuong: 1, hinhThuc: 'tang',
  hanTra: null, giaVon: '100', giaVonTienTe: 'VND', soLuongDaTra: 0, soLuongNhapLai: 0,
};

describe('gomTheoThang', () => {
  it('gom theo tháng của ngày gửi, sắp xếp tháng mới nhất trước', () => {
    const r = gomTheoThang([
      { ...base, guiLuc: '2026-09-10T00:00:00Z', soLuong: 2 },
      { ...base, guiLuc: '2026-08-05T00:00:00Z', soLuong: 1 },
      { ...base, guiLuc: '2026-09-20T00:00:00Z', soLuong: 3 },
    ]);
    expect(r.map((x) => x.khoa)).toEqual(['2026-09', '2026-08']);
    expect(r[0].theoTienTe).toEqual({ VND: 500 });
    expect(r[1].theoTienTe).toEqual({ VND: 100 });
  });
  it('dòng chưa gửi gom vào khoá "chua_gui", KHÔNG bị bỏ im lặng', () => {
    const r = gomTheoThang([{ ...base, guiLuc: null }]);
    expect(r.map((x) => x.khoa)).toEqual(['chua_gui']);
  });
});

describe('gomTheoNguoiNhan', () => {
  it('cộng dồn theo tên và đếm riêng dòng thiếu giá vốn', () => {
    const r = gomTheoNguoiNhan([
      { ...base, tenNhan: 'Mai', soLuong: 2 },
      { ...base, tenNhan: 'Mai', giaVon: null },
      { ...base, tenNhan: 'Lan', soLuong: 1 },
    ]);
    const mai = r.find((x) => x.khoa === 'Mai')!;
    expect(mai.theoTienTe).toEqual({ VND: 200 });
    expect(mai.soDongThieuGiaVon).toBe(1);
    expect(r.find((x) => x.khoa === 'Lan')!.theoTienTe).toEqual({ VND: 100 });
  });
});

describe('quyVeVnd', () => {
  const rates = [{ from: 'USD', to: 'VND', period: '2026-09', rate: 25000 }];
  it('VND giữ nguyên, không cần tỷ giá', () => {
    expect(quyVeVnd({ VND: 500 }, '2026-09', [])).toEqual({ vnd: 500, khongDoiDuoc: [] });
  });
  it('USD quy đổi theo tỷ giá đúng tháng', () => {
    expect(quyVeVnd({ VND: 500, USD: 4 }, '2026-09', rates)).toEqual({ vnd: 100500, khongDoiDuoc: [] });
  });
  it('thiếu tỷ giá thì KHÔNG cộng bừa, mà kê tên loại tiền không đổi được', () => {
    const r = quyVeVnd({ VND: 500, USD: 4 }, '2026-10', rates);
    expect(r.vnd).toBe(500);
    expect(r.khongDoiDuoc).toEqual(['USD']);
  });
});
```

- [ ] **Bước 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run features/kol/bao-cao.test.ts`
Expected: FAIL — không tìm thấy module.

- [ ] **Bước 3: Viết `features/kol/bao-cao.ts`**

```ts
import { thangKinhDoanh } from '@/lib/timezone';
import { doiTienTheoThang, type TiGiaThang } from '@/features/cogs/tien';
import { tongChiPhi } from './chi-phi';
import type { DongDon } from './types';

export interface DongBaoCao {
  khoa: string;
  theoTienTe: Record<string, number>;
  soMonDaTieu: number;
  soMonDangTreo: number;
  soDongThieuGiaVon: number;
}

/** Gom theo khoá do caller quyết. Generic nên không cần ép kiểu ở chỗ gọi. */
function gom<T extends DongDon>(ds: readonly T[], khoaCua: (d: T) => string): DongBaoCao[] {
  const nhom = new Map<string, T[]>();
  for (const d of ds) {
    const k = khoaCua(d);
    const cu = nhom.get(k);
    if (cu) cu.push(d); else nhom.set(k, [d]);
  }
  return [...nhom.entries()].map(([khoa, dong]) => ({ khoa, ...tongChiPhi(dong) }));
}

/**
 * THUẦN: gom chi phí theo tháng của NGÀY GỬI.
 * Dòng chưa gửi vào khoá 'chua_gui' chứ không bị bỏ im lặng — người đọc báo cáo
 * phải thấy có hàng đang nằm ngoài mọi tháng.
 */
export function gomTheoThang(ds: readonly (DongDon & { guiLuc: string | null })[]): DongBaoCao[] {
  return gom(ds, (d) => thangKinhDoanh(d.guiLuc) ?? 'chua_gui')
    .sort((a, b) => b.khoa.localeCompare(a.khoa));
}

/** THUẦN: gom chi phí theo tên người nhận, nhiều tiền nhất lên trước (quy ước: theo VND). */
export function gomTheoNguoiNhan(ds: readonly (DongDon & { tenNhan: string })[]): DongBaoCao[] {
  return gom(ds, (d) => d.tenNhan)
    .sort((a, b) => (b.theoTienTe.VND ?? 0) - (a.theoTienTe.VND ?? 0));
}

export interface QuyDoi {
  vnd: number;
  /** Loại tiền KHÔNG đổi được vì thiếu tỷ giá tháng đó. Phải hiện lên màn. */
  khongDoiDuoc: string[];
}

/**
 * THUẦN: quy nhiều loại tiền về VND bằng tỷ giá THÁNG sẵn có (D-055 báo cáo VND).
 *
 * Thiếu tỷ giá thì KHÔNG cộng bừa: kê tên loại tiền vào `khongDoiDuoc` để màn
 * nói thẳng, thà thiếu một dòng còn hơn cho ra một tổng sai mà trông như đúng.
 */
export function quyVeVnd(theoTienTe: Record<string, number>, period: string, rates: TiGiaThang[]): QuyDoi {
  let vnd = 0;
  const khongDoiDuoc: string[] = [];
  for (const [tienTe, so] of Object.entries(theoTienTe)) {
    if (tienTe === 'VND') { vnd += so; continue; }
    const r = doiTienTheoThang(so, tienTe, 'VND', period, rates);
    if (r == null) { khongDoiDuoc.push(tienTe); continue; }
    vnd += typeof r === 'number' ? r : r.amount;
  }
  return { vnd, khongDoiDuoc: khongDoiDuoc.sort() };
}
```

**Đọc `features/cogs/tien.ts` trước khi viết `quyVeVnd`** để biết `doiTienTheoThang` trả về đúng hình dạng gì (`KetQuaDoiTien | null`) rồi lấy số ra cho đúng, đừng đoán theo đoạn trên.

- [ ] **Bước 4: Chạy test, xác nhận PASS**

Run: `npx vitest run features/kol && npx tsc --noEmit`
Expected: tất cả PASS, tsc sạch.

- [ ] **Bước 5: Trang sổ KOL** `app/(dashboard)/f/kol/nguoi-nhan/page.tsx`

Danh sách hồ sơ với tìm theo tên. Mỗi hồ sơ mở ra thấy: thông tin liên hệ, danh sách đơn đã gửi, và **danh sách món đang giữ chưa trả** dùng `conNo`. Form thêm và sửa hồ sơ, có nút ngừng dùng thay cho xoá.

- [ ] **Bước 6: Trang đang mượn** `app/(dashboard)/f/kol/dang-muon/page.tsx`

Danh sách mọi dòng mượn còn nợ, dùng `dangMuon(homNay)`. **Quá hạn xếp trên cùng**, hiện số ngày trễ bằng `soNgayTre` và tô màu cảnh báo. Mỗi dòng có nút dẫn thẳng sang đơn để nhận trả về. Không có chức năng gửi nhắc tự động ở đợt này.

- [ ] **Bước 7: Khối tóm tắt chi phí** `components/kol/TomTatChiPhi.tsx`

Đặt ở đầu trang danh sách. Lấy `tongChiPhi` rồi `quyVeVnd(theoTienTe, thang, rates)` với `rates` từ `tiGiaThang()`. Hiện bốn số:

| Số | Nguồn |
|---|---|
| Chi phí đã tiêu, quy VND | `quyVeVnd(...).vnd` |
| Số món đã tiêu | `soMonDaTieu` |
| Số món đang treo ở KOL | `soMonDangTreo` |
| Số dòng chưa có giá vốn | `soDongThieuGiaVon` |

**Số cuối bắt buộc hiện kể cả khi bằng không**, để người đọc luôn biết báo cáo đang phủ được bao nhiêu. Nếu `khongDoiDuoc` không rỗng thì hiện thêm một dòng cảnh báo nêu tên loại tiền chưa có tỷ giá tháng đó, đừng im lặng bỏ số ấy ra khỏi tổng. Xem được theo tháng hoặc theo KOL.

- [ ] **Bước 8: Chạy đủ ba cổng**

Run: `npx vitest run && npx tsc --noEmit && npx eslint app/\(dashboard\)/f/kol components/kol features/kol && npx next build`
Expected: toàn bộ suite xanh (không được làm hỏng test sẵn có), tsc sạch, eslint sạch trên file mới, build thành công.

- [ ] **Bước 9: Commit**

```bash
git add "app/(dashboard)/f/kol" components/kol features/kol/bao-cao.ts features/kol/bao-cao.test.ts features/kol/queries.ts
git commit -m "feat(kol): sổ KOL, màn đang mượn và báo cáo chi phí marketing"
```

---

## Sau khi xong cả 8 task

1. Chạy lại toàn bộ: `npx vitest run && npx tsc --noEmit && npx next build`.
2. Kiểm ràng buộc toàn cục còn nguyên: `grep -n "chua-bat" features/jobs/groups.ts` phải vẫn ra `'chua-bat': ['day-nhan-kcs-lark']`.
3. Xác nhận không có file nào trong `features/dong-hang/`, `features/kho-nhan/`, `components/dong-hang/`, `components/kho-nhan/`, `features/carrier-rates/`, `features/mmp/`, `features/kpi-logistics/` bị sửa: `git diff --name-only <base> HEAD`.
4. CEO tự mở `/f/kol` kiểm tay — đăng nhập Google chặn agent, không agent nào mở được màn thật.
