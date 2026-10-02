# Trang phụ phí ship hộ cho brand — kế hoạch thực thi

> **Cho người thực thi:** dùng `superpowers:subagent-driven-development` hoặc `superpowers:executing-plans`. Mỗi bước có hộp kiểm `- [ ]`.

**Mục tiêu:** một trang public, mỗi brand một link riêng, DẪN NGUỒN các khoản phụ phí hãng vận chuyển trên bảng kê ship hộ của brand đó.

**Kiến trúc:** ba tệp THUẦN giữ toàn bộ luật (danh sách cho phép · phép giao khoảng tuần · luật một-link-sống), một tệp I/O nối dữ liệu, một server action có kiểm quyền, một trang public theo nếp `app/gr/[token]` đã có.

**Stack:** Next.js 16.2.6 · Drizzle + Postgres · Tailwind 4 · vitest 4.

**Spec:** [docs/superpowers/specs/2026-10-02-trang-phu-phi-cho-brand-design.md](../specs/2026-10-02-trang-phu-phi-cho-brand-design.md)

## Ràng buộc toàn cục

- `markup_percent` KHÔNG BAO GIỜ ra tới trang. Lọc bằng **danh sách cho phép**, không phải loại trừ.
- `processing` (Phí xử lý đơn hàng) KHÔNG hiện — phí của MEAN, không phải pass-through.
- Trang public: `export const dynamic = 'force-dynamic'`, metadata `robots: { index: false, follow: false }`.
- Token sai / đã thu hồi → `notFound()`. Không phân biệt hai ca.
- "Hãng brand đã đi" = mọi thời điểm, không giới hạn ngày.
- Bảng tuần dầu CHỈ những tuần giao với `shipped_at` của brand đó.
- Bình luận mã bằng tiếng Việt, giải thích VÌ SAO; theo nếp repo.
- Chạy `npx tsc --noEmit`, `npx eslint <tệp đã đổi>`, `npx vitest run` trước mỗi commit. Không bao giờ commit đỏ.

---

### Task 1: Luật phân loại phụ phí (THUẦN)

**Tệp:**
- Tạo: `features/ship-ho/trang-phu-phi/loai-phu-phi.ts`
- Test: `features/ship-ho/trang-phu-phi/loai-phu-phi.test.ts`

**Giao diện — Produces:**
```ts
export type DongBangKe =
  | 'fuel' | 'remote' | 'demand' | 'residential' | 'signature' | 'vat' | 'other';
export interface MoTaLoai { dong: DongBangKe; nhan: string; cachTinh: string }
export function loaiChoPhep(kind: string, serviceKey: string | null): MoTaLoai | null;
export const NHAN_DONG: Record<DongBangKe, string>;
```

- [ ] **Bước 1: viết test đỏ**

```ts
import { describe, it, expect } from 'vitest';
import { loaiChoPhep, NHAN_DONG } from './loai-phu-phi';

describe('loaiChoPhep', () => {
  /* Hàng rào quan trọng nhất của cả tính năng: markup_percent là LÃI của MEAN
     (dữ liệu thật: FedEx 4 dòng, DHL 4 dòng). Lộ ra là lộ lãi. */
  it('markup_percent → null, KHÔNG BAO GIỜ lên trang', () => {
    expect(loaiChoPhep('markup_percent', null)).toBeNull();
  });

  /* Danh sách CHO PHÉP, không phải loại trừ: thêm một kind mới vào enum thì nó
     mặc định bị loại, thay vì lọt ra ngoài mà không ai thấy. */
  it('kind lạ → null, mặc định bị loại', () => {
    expect(loaiChoPhep('kind_moi_nao_do', null)).toBeNull();
    expect(loaiChoPhep('', null)).toBeNull();
  });

  it('các loại pass-through → đúng dòng bảng kê', () => {
    expect(loaiChoPhep('fuel_percent', null)?.dong).toBe('fuel');
    expect(loaiChoPhep('remote_fixed', null)?.dong).toBe('remote');
    expect(loaiChoPhep('demand_per_kg', null)?.dong).toBe('demand');
    expect(loaiChoPhep('residential_fixed', null)?.dong).toBe('residential');
    expect(loaiChoPhep('vat_percent', null)?.dong).toBe('vat');
  });

  /* addon_fixed rẽ theo service_key: direct_signature là dòng "Ký nhận" trên bảng
     kê, còn addon khác gom vào "Phụ phí khác". Cùng kind, hai dòng. */
  it('addon_fixed rẽ theo service_key', () => {
    expect(loaiChoPhep('addon_fixed', 'direct_signature')?.dong).toBe('signature');
    expect(loaiChoPhep('addon_fixed', null)?.dong).toBe('other');
  });

  it('các loại lẻ gom vào "Phụ phí khác"', () => {
    for (const k of ['peak_fixed', 'per_kg_fixed', 'per_step_fixed', 'country_fixed', 'packaging_fixed']) {
      expect(loaiChoPhep(k, null)?.dong).toBe('other');
    }
  });

  it('mọi loại được phép đều có nhãn và cách tính, không dòng nào rỗng', () => {
    for (const k of ['fuel_percent', 'remote_fixed', 'demand_per_kg', 'residential_fixed',
      'vat_percent', 'peak_fixed', 'per_kg_fixed', 'per_step_fixed', 'country_fixed',
      'packaging_fixed', 'addon_fixed']) {
      const m = loaiChoPhep(k, null)!;
      expect(m.nhan.length).toBeGreaterThan(0);
      expect(m.cachTinh.length).toBeGreaterThan(0);
    }
  });

  it('mỗi dòng bảng kê có nhãn tiếng Việt', () => {
    for (const d of ['fuel', 'remote', 'demand', 'residential', 'signature', 'vat', 'other'] as const) {
      expect(NHAN_DONG[d].length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Bước 2: chạy, xác nhận đỏ**

Chạy: `npx vitest run features/ship-ho/trang-phu-phi/loai-phu-phi.test.ts`
Chờ: FAIL — không tìm thấy module.

- [ ] **Bước 3: viết mã nhỏ nhất cho xanh**

```ts
/**
 * THUẦN: loại phụ phí của hãng → DÒNG TRÊN BẢNG KÊ mà brand nhìn thấy.
 *
 * Hai bộ từ vựng: brand thấy nhãn bảng kê (price-structure.ts), `kind` là cách engine
 * chia nhỏ. Trang gom theo dòng bảng kê vì brand đi từ dòng họ đang nhìn.
 *
 * DANH SÁCH CHO PHÉP, không phải loại trừ: `markup_percent` (lãi MEAN) và mọi `kind`
 * thêm sau này mặc định KHÔNG lên trang. Loại trừ thì thêm kind mới là lọt ra ngoài.
 */
export type DongBangKe =
  | 'fuel' | 'remote' | 'demand' | 'residential' | 'signature' | 'vat' | 'other';

export interface MoTaLoai { dong: DongBangKe; nhan: string; cachTinh: string }

export const NHAN_DONG: Record<DongBangKe, string> = {
  fuel: 'Phụ phí xăng dầu',
  remote: 'Phụ phí vùng sâu vùng xa',
  demand: 'Phụ phí nhu cầu cao điểm',
  residential: 'Giao địa chỉ nhà dân',
  signature: 'Ký nhận (direct signature)',
  vat: 'VAT',
  other: 'Phụ phí khác',
};

const CHO_PHEP: Record<string, MoTaLoai> = {
  fuel_percent: { dong: 'fuel', nhan: NHAN_DONG.fuel, cachTinh: 'Phần trăm trên cước cơ bản, hãng công bố theo tuần' },
  remote_fixed: { dong: 'remote', nhan: NHAN_DONG.remote, cachTinh: 'Tiền cố định mỗi đơn, hoặc theo kg — lấy mức cao hơn' },
  demand_per_kg: { dong: 'demand', nhan: NHAN_DONG.demand, cachTinh: 'Tiền theo kg, áp theo nước đến' },
  residential_fixed: { dong: 'residential', nhan: NHAN_DONG.residential, cachTinh: 'Tiền cố định mỗi đơn' },
  vat_percent: { dong: 'vat', nhan: NHAN_DONG.vat, cachTinh: 'Phần trăm trên tổng' },
  peak_fixed: { dong: 'other', nhan: 'Phụ phí cao điểm', cachTinh: 'Tiền cố định mỗi đơn' },
  per_kg_fixed: { dong: 'other', nhan: 'Phụ phí theo trọng lượng', cachTinh: 'Tiền theo kg' },
  per_step_fixed: { dong: 'other', nhan: 'Phụ phí theo bậc trọng lượng', cachTinh: 'Tiền mỗi bậc cân' },
  country_fixed: { dong: 'other', nhan: 'Phụ phí theo nước đến', cachTinh: 'Tiền cố định mỗi đơn' },
  packaging_fixed: { dong: 'other', nhan: 'Phí bao bì', cachTinh: 'Tiền cố định mỗi đơn' },
};

export function loaiChoPhep(kind: string, serviceKey: string | null): MoTaLoai | null {
  /* addon_fixed rẽ theo service_key: direct_signature là dòng "Ký nhận" trên bảng kê
   * (price-structure.ts gộp nó vào cột `signature`), addon khác gom vào "Phụ phí khác". */
  if (kind === 'addon_fixed') {
    return serviceKey === 'direct_signature'
      ? { dong: 'signature', nhan: NHAN_DONG.signature, cachTinh: 'Tiền cố định mỗi đơn, chỉ khi đơn chọn ký nhận' }
      : { dong: 'other', nhan: 'Dịch vụ cộng thêm', cachTinh: 'Tiền cố định, chỉ khi đơn chọn dịch vụ đó' };
  }
  return CHO_PHEP[kind] ?? null;
}
```

- [ ] **Bước 4: chạy, xác nhận xanh**

Chạy: `npx vitest run features/ship-ho/trang-phu-phi/loai-phu-phi.test.ts`
Chờ: PASS, 7 test.

- [ ] **Bước 5: commit**

```bash
git add features/ship-ho/trang-phu-phi/loai-phu-phi.ts features/ship-ho/trang-phu-phi/loai-phu-phi.test.ts
git commit -m "feat(phu-phi): luật phân loại phụ phí theo dòng bảng kê, lọc bằng danh sách cho phép"
```

---

### Task 2: Lọc tuần dầu theo ngày gửi của brand (THUẦN)

**Tệp:**
- Tạo: `features/ship-ho/trang-phu-phi/tuan-dau.ts`
- Test: `features/ship-ho/trang-phu-phi/tuan-dau.test.ts`

**Giao diện — Produces:**
```ts
export interface TuanDau { tu: string; den: string | null; phanTram: number }
export function locTuanCoDon(
  tuan: readonly TuanDau[],
  ngayGui: readonly string[],
  homNay: string,
): TuanDau[];
```

Tất cả ngày là chuỗi `YYYY-MM-DD`. `den === null` = mức đang mở, so tới `homNay`.

- [ ] **Bước 1: viết test đỏ**

```ts
import { describe, it, expect } from 'vitest';
import { locTuanCoDon, type TuanDau } from './tuan-dau';

const t = (tu: string, den: string | null, phanTram: number): TuanDau => ({ tu, den, phanTram });
const HOM_NAY = '2026-10-02';

describe('locTuanCoDon', () => {
  /* Dữ liệu thật tháng 7/2026 của FedEx: 5 tuần liên tiếp. Brand chỉ gửi 1 đơn ngày
     14/07 thì chỉ được thấy tuần chứa ngày đó — đây là con số đã dùng để tính tiền
     chính đơn của họ, không phải kho dữ liệu chung. */
  it('chỉ giữ tuần chứa ngày gửi của brand', () => {
    const tuan = [
      t('2026-06-29', '2026-07-06', 38.5),
      t('2026-07-06', '2026-07-13', 38.25),
      t('2026-07-13', '2026-07-20', 38.5),
      t('2026-07-20', '2026-07-27', 39.75),
    ];
    expect(locTuanCoDon(tuan, ['2026-07-14'], HOM_NAY)).toEqual([t('2026-07-13', '2026-07-20', 38.5)]);
  });

  /* Khoảng nửa mở [tu, den): ngày gửi ĐÚNG bằng `den` thuộc tuần SAU, không phải
     tuần này. Sai một ngày ở đây là đưa brand mức của tuần khác làm căn cứ. */
  it('khoảng nửa mở: ngày bằng `den` thuộc tuần sau', () => {
    const tuan = [t('2026-07-06', '2026-07-13', 38.25), t('2026-07-13', '2026-07-20', 38.5)];
    expect(locTuanCoDon(tuan, ['2026-07-13'], HOM_NAY).map((x) => x.phanTram)).toEqual([38.5]);
    expect(locTuanCoDon(tuan, ['2026-07-06'], HOM_NAY).map((x) => x.phanTram)).toEqual([38.25]);
  });

  it('nhiều ngày gửi → nhiều tuần, mới nhất trên cùng', () => {
    const tuan = [
      t('2026-07-06', '2026-07-13', 38.25),
      t('2026-07-13', '2026-07-20', 38.5),
      t('2026-07-20', '2026-07-27', 39.75),
    ];
    expect(locTuanCoDon(tuan, ['2026-07-08', '2026-07-22'], HOM_NAY).map((x) => x.phanTram))
      .toEqual([39.75, 38.25]);
  });

  it('`den` null = mức đang mở, so tới hôm nay', () => {
    const tuan = [t('2026-09-28', null, 44)];
    expect(locTuanCoDon(tuan, ['2026-10-01'], HOM_NAY)).toHaveLength(1);
    expect(locTuanCoDon(tuan, ['2026-09-20'], HOM_NAY)).toHaveLength(0);
  });

  it('brand không có đơn → rỗng, KHÔNG trả cả bảng', () => {
    expect(locTuanCoDon([t('2026-07-06', '2026-07-13', 38.25)], [], HOM_NAY)).toEqual([]);
  });

  it('ngày gửi ngoài mọi tuần → rỗng', () => {
    expect(locTuanCoDon([t('2026-07-06', '2026-07-13', 38.25)], ['2026-01-01'], HOM_NAY)).toEqual([]);
  });

  it('không trả tuần trùng lặp khi nhiều đơn cùng tuần', () => {
    const tuan = [t('2026-07-06', '2026-07-13', 38.25)];
    expect(locTuanCoDon(tuan, ['2026-07-07', '2026-07-08', '2026-07-09'], HOM_NAY)).toHaveLength(1);
  });
});
```

- [ ] **Bước 2: chạy, xác nhận đỏ**

Chạy: `npx vitest run features/ship-ho/trang-phu-phi/tuan-dau.test.ts`
Chờ: FAIL — không tìm thấy module.

- [ ] **Bước 3: viết mã nhỏ nhất cho xanh**

```ts
/**
 * THUẦN: lọc các tuần phụ phí dầu CHỈ còn những tuần brand đó thực sự có đơn gửi.
 *
 * Vì sao giới hạn (CEO 02/10/2026): mức dầu là con số ĐÃ DÙNG để tính tiền chính brand
 * đó, nên đưa cho họ là xuất trình căn cứ. Trả cả bảng lùi tới 2025 thì trang thành
 * kho tra cứu cho cả thị trường — thứ CEO nói rõ là không muốn.
 *
 * Vì sao hãng không thay được chỗ này: FedEx/DHL/UPS CHỈ công bố tuần hiện tại. Kalisa
 * đối soát tháng 7 mở trang hãng sẽ thấy mức tuần này, không phải 38,5% của tuần 29/06.
 * SMS là nơi duy nhất còn giữ lịch sử.
 */
export interface TuanDau { tu: string; den: string | null; phanTram: number }

/**
 * Khoảng NỬA MỞ `[tu, den)`: ngày gửi đúng bằng `den` thuộc tuần SAU. Hãng đổi mức vào
 * đúng ngày biên, nên lấy khoảng đóng hai đầu là đưa brand mức của tuần khác làm căn cứ.
 * `den === null` = mức đang mở, so tới `homNay`.
 */
export function locTuanCoDon(
  tuan: readonly TuanDau[],
  ngayGui: readonly string[],
  homNay: string,
): TuanDau[] {
  const giu = tuan.filter((w) => {
    const den = w.den ?? homNay;
    return ngayGui.some((d) => d >= w.tu && d < den);
  });
  // Mới nhất trên cùng: brand đối soát thường bắt đầu từ kỳ gần nhất.
  return [...giu].sort((a, b) => b.tu.localeCompare(a.tu));
}
```

- [ ] **Bước 4: chạy, xác nhận xanh**

Chạy: `npx vitest run features/ship-ho/trang-phu-phi/tuan-dau.test.ts`
Chờ: PASS, 7 test.

- [ ] **Bước 5: commit**

```bash
git add features/ship-ho/trang-phu-phi/tuan-dau.ts features/ship-ho/trang-phu-phi/tuan-dau.test.ts
git commit -m "feat(phu-phi): lọc tuần dầu theo ngày gửi của brand, khoảng nửa mở"
```

---

### Task 3: Bảng link + luật một-link-sống

**Tệp:**
- Tạo: `db/migrations/0192_link-phu-phi-brand.sql`
- Sửa: `db/schema.ts` — thêm `brandSurchargeLinks` ngay trước `export const shipHoPartners`
- Tạo: `features/ship-ho/trang-phu-phi/link-token.ts`
- Test: `features/ship-ho/trang-phu-phi/link-token.test.ts`

**Giao diện — Produces:**
```ts
export function sinhToken(): string;
export const DO_DAI_TOI_THIEU = 32;
```

- [ ] **Bước 1: viết migration**

```sql
-- Link PUBLIC cho brand xem nguồn phụ phí ship hộ (CEO 02/10/2026).
--
-- MỘT link sống cho mỗi brand tại một thời điểm: `revoked_at IS NULL` là điều kiện
-- "còn hiệu lực". Hai link sống cùng lúc là hai thứ phải nhớ thu hồi, và sẽ có cái bị quên.
--
-- Token 32 byte ngẫu nhiên, KHÔNG mang thông tin brand: đoán được một token là đọc được
-- phụ phí của brand khác.

CREATE TABLE IF NOT EXISTS "brand_surcharge_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "partner_brand_slug" text NOT NULL REFERENCES "mmp_brands"("slug"),
  "token" text NOT NULL UNIQUE,
  "created_by" text REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "revoked_at" timestamp
);

-- Tra token → brand ở mỗi lượt mở trang: phải nhanh và chỉ nhận link còn hiệu lực.
CREATE INDEX IF NOT EXISTS "brand_surcharge_links_token_idx"
  ON "brand_surcharge_links" ("token") WHERE "revoked_at" IS NULL;

-- Tìm link đang sống của một brand (để thu hồi trước khi tạo mới).
CREATE UNIQUE INDEX IF NOT EXISTS "brand_surcharge_links_mot_link_song_idx"
  ON "brand_surcharge_links" ("partner_brand_slug") WHERE "revoked_at" IS NULL;
```

- [ ] **Bước 2: thêm vào schema**

```ts
/**
 * Link PUBLIC cho brand xem nguồn phụ phí (migration 0192, CEO 02/10/2026).
 *
 * `revoked_at IS NULL` = còn hiệu lực. Unique index có điều kiện trên
 * `partner_brand_slug WHERE revoked_at IS NULL` ép MỘT link sống mỗi brand ở TẦNG DB —
 * không dựa vào mã nhớ thu hồi link cũ.
 */
export const brandSurchargeLinks = pgTable('brand_surcharge_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  partnerBrandSlug: text('partner_brand_slug').references(() => mmpBrands.slug).notNull(),
  token: text('token').notNull().unique(),
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  revokedAt: timestamp('revoked_at'),
});
```

- [ ] **Bước 3: viết test đỏ cho token**

```ts
import { describe, it, expect } from 'vitest';
import { sinhToken, DO_DAI_TOI_THIEU } from './link-token';

describe('sinhToken', () => {
  /* Đoán được một token là đọc được phụ phí của brand khác. */
  it('đủ dài và khác nhau mỗi lần', () => {
    const a = sinhToken(), b = sinhToken();
    expect(a.length).toBeGreaterThanOrEqual(DO_DAI_TOI_THIEU);
    expect(a).not.toBe(b);
  });

  /* Token nằm trong URL nên không được chứa ký tự phải mã hoá — dán vào Zalo là gãy. */
  it('chỉ chứa ký tự an toàn cho URL', () => {
    for (let i = 0; i < 50; i++) expect(sinhToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('KHÔNG mang thông tin brand', () => {
    expect(sinhToken()).not.toMatch(/kalisa|brand|mmp/i);
  });
});
```

- [ ] **Bước 4: chạy, xác nhận đỏ**

Chạy: `npx vitest run features/ship-ho/trang-phu-phi/link-token.test.ts`
Chờ: FAIL — không tìm thấy module.

- [ ] **Bước 5: viết mã**

```ts
import { randomBytes } from 'node:crypto';

/** 32 byte → 43 ký tự base64url. Đoán được một token là đọc được phụ phí brand khác. */
export const DO_DAI_TOI_THIEU = 32;

/** `base64url` vì token nằm trong URL: base64 thường có `+` `/` `=`, dán vào Zalo là gãy. */
export function sinhToken(): string {
  return randomBytes(32).toString('base64url');
}
```

- [ ] **Bước 6: chạy test + tsc, rồi apply migration**

```bash
npx vitest run features/ship-ho/trang-phu-phi/link-token.test.ts
npx tsc --noEmit
railway run --service Shopify-Management-System npx tsx scripts/tmp/ap-0192.ts
```

Script apply viết tạm trong `scripts/tmp/`, đọc tệp SQL rồi `db.execute(sql.raw(...))`, sau đó `select column_name from information_schema.columns where table_name = 'brand_surcharge_links'` và in ra để xác nhận 6 cột. Xoá `scripts/tmp/` sau khi chạy.

- [ ] **Bước 7: commit**

```bash
git add db/migrations/0192_link-phu-phi-brand.sql db/schema.ts features/ship-ho/trang-phu-phi/link-token.ts features/ship-ho/trang-phu-phi/link-token.test.ts
git commit -m "feat(phu-phi): bảng link brand + token base64url, một link sống ép ở tầng DB"
```

---

### Task 4: Truy vấn dữ liệu trang

**Tệp:**
- Tạo: `features/ship-ho/trang-phu-phi/queries.ts`
- Sửa: `features/carrier-rates/fuel-fetcher/fedex.ts:34` — đổi `const PAGE_URL` thành `export const FEDEX_SURCHARGE_PAGE_URL`, sửa hai nơi dùng trong cùng tệp (dòng 58 `Referer`, dòng 225 `fetcher(PAGE_URL, …)`)

**Giao diện — Consumes:** `loaiChoPhep`, `NHAN_DONG` (Task 1) · `locTuanCoDon`, `TuanDau` (Task 2) · `brandSurchargeLinks` (Task 3)

**Giao diện — Produces:**
```ts
export interface DongPhuPhi {
  dong: DongBangKe; nhan: string; cachTinh: string;
  giaTri: string; hieuLucTu: string | null; ghiChu: string | null;
}
export interface TepBangChung { id: string; label: string; tu: string | null; den: string | null }
export interface HangTrenTrang {
  carrierAccountId: string; tenHang: string; linkHang: string | null;
  dong: DongPhuPhi[]; tuanDau: TuanDau[]; tep: TepBangChung[];
}
export interface TrangPhuPhi { brandSlug: string; tenBrand: string; hang: HangTrenTrang[] }
export async function docTrangPhuPhi(token: string): Promise<TrangPhuPhi | null>;
export async function tepThuocBrand(token: string, evidenceId: string): Promise<string | null>;
```

`docTrangPhuPhi` trả `null` khi token sai hoặc đã thu hồi. `tepThuocBrand` trả `file_key` hoặc `null`.

- [ ] **Bước 1: export link FedEx**

Trong `features/carrier-rates/fuel-fetcher/fedex.ts`, đổi dòng 34 thành:

```ts
/** Trang FedEx công bố phụ phí — dùng cả ở trang dẫn nguồn cho brand (`trang-phu-phi`). */
export const FEDEX_SURCHARGE_PAGE_URL = 'https://www.fedex.com/en-vn/shipping/surcharges.html';
```

Rồi thay hai chỗ dùng `PAGE_URL` trong cùng tệp bằng tên mới. Chạy `npx tsc --noEmit` để chắc không sót chỗ nào.

- [ ] **Bước 2: viết `queries.ts`**

```ts
/**
 * I/O cho trang dẫn nguồn phụ phí. Toàn bộ LUẬT nằm ở `loai-phu-phi.ts` và `tuan-dau.ts`;
 * tệp này chỉ đọc dữ liệu rồi nối lại.
 *
 * Đọc MỘT LƯỢT cho cả trang, không truy vấn theo từng dòng.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { loaiChoPhep, NHAN_DONG, type DongBangKe } from './loai-phu-phi';
import { locTuanCoDon, type TuanDau } from './tuan-dau';
import { FEDEX_SURCHARGE_PAGE_URL } from '@/features/carrier-rates/fuel-fetcher/fedex';
import { DHL_VN_PAGE_URL } from '@/features/carrier-rates/fuel-fetcher/dhl-vn';
import { UPS_FUEL_PAGE_URL } from '@/features/carrier-rates/fuel-fetcher/ups';
import { SF_FUEL_PAGE_URL } from '@/features/carrier-rates/fuel-fetcher/sf';

/* Hãng KHÔNG có trang công bố (Aramex) → null, và trang bỏ hẳn dòng link. KHÔNG trỏ sang
 * trang chủ: một link không dẫn tới con số nào thì tệ hơn không có link. */
function linkHang(ten: string): string | null {
  const t = ten.toLowerCase();
  if (t.startsWith('fedex')) return FEDEX_SURCHARGE_PAGE_URL;
  if (t.startsWith('dhl')) return DHL_VN_PAGE_URL;
  if (t.startsWith('ups')) return UPS_FUEL_PAGE_URL;
  if (t.startsWith('sf ')) return SF_FUEL_PAGE_URL;
  return null;
}
```

Thân `docTrangPhuPhi(token)`:
1. đọc `brand_surcharge_links` theo `token` **và** `isNull(revokedAt)`; không có → `return null`;
2. đọc `mmp_brands.displayName` theo slug;
3. đọc hãng đã đi: `selectDistinct({ id: shipHoOrders.carrierAccountId })` với `eq(partnerBrandSlug, slug)` và `isNotNull(carrierAccountId)`; rỗng → trả `{ brandSlug, tenBrand, hang: [] }`;
4. đọc `carrierAccounts.name` cho các id đó;
5. đọc `carrier_surcharges` của các id đó với `active = true` và `isNull(endsAt)`, trừ `fuel_percent` (dầu đi đường riêng), map qua `loaiChoPhep(kind, serviceKey)` và **bỏ dòng `null`**;
6. đọc ngày gửi: `select distinct carrier_account_id, shipped_at` của brand, `isNotNull(shippedAt)`;
7. đọc mọi dòng `fuel_percent` (`active = true`) của các hãng đó, đưa qua `locTuanCoDon(tuan, ngayGuiCuaHangDo, homNay)`;
8. đọc `carrier_remote_evidence` theo các `carrier_account_id`;
9. gom theo hãng, sắp hãng theo tên.

`homNay` lấy bằng `new Date().toISOString().slice(0, 10)`.

Thân `tepThuocBrand(token, evidenceId)`:
1. token còn hiệu lực → slug; không thì `null`;
2. đọc `carrier_remote_evidence` theo `evidenceId` lấy `fileKey` + `carrierAccountId`;
3. **kiểm `carrierAccountId` đó có nằm trong tập hãng brand đã đi** — thiếu phép kiểm này thì brand đổi `evidenceId` trên URL là tải được tài liệu hãng họ chưa bao giờ dùng;
4. trả `fileKey`, hoặc `null`.

- [ ] **Bước 3: tsc + lint**

```bash
npx tsc --noEmit
npx eslint features/ship-ho/trang-phu-phi features/carrier-rates/fuel-fetcher/fedex.ts
```

- [ ] **Bước 4: kiểm trên dữ liệu thật**

Viết script tạm `scripts/tmp/thu-trang.ts`: tạo một dòng `brand_surcharge_links` cho `kalisa` bằng `sinhToken()`, gọi `docTrangPhuPhi(token)`, in ra số hãng · số dòng phụ phí mỗi hãng · số tuần dầu · số tệp, **rồi XOÁ dòng link vừa tạo** để trả lại nguyên trạng. Khẳng định bằng mắt: không dòng nào có nhãn chứa chữ "markup" hay "lãi".

- [ ] **Bước 5: commit**

```bash
git add features/ship-ho/trang-phu-phi/queries.ts features/carrier-rates/fuel-fetcher/fedex.ts
git commit -m "feat(phu-phi): truy vấn trang dẫn nguồn, kiểm tệp bằng chứng thuộc hãng brand đã đi"
```

---

### Task 5: Trang public + route tải tệp

**Tệp:**
- Tạo: `app/pp/[token]/page.tsx`
- Tạo: `app/pp/[token]/evidence/[evidenceId]/route.ts`

**Giao diện — Consumes:** `docTrangPhuPhi`, `tepThuocBrand` (Task 4)

- [ ] **Bước 1: viết route tải tệp**

Theo đúng mẫu route nội bộ đã có (`app/(dashboard)/f/carrier-rates/[id]/remote-postcodes/evidence/[evidenceId]/route.ts`), nhưng **không kiểm session** — kiểm bằng token:

```ts
import { NextResponse } from 'next/server';
import { tepThuocBrand } from '@/features/ship-ho/trang-phu-phi/queries';
import { getSignedDownloadUrl } from '@/lib/storage/s3';

/** Tải tệp tài liệu vùng xa qua LINK BRAND. Không session — phép kiểm là token + tệp
 *  phải thuộc một hãng brand đó đã đi (xem `tepThuocBrand`). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; evidenceId: string }> },
) {
  const { token, evidenceId } = await params;
  const key = await tepThuocBrand(token, evidenceId);
  // Token sai, link thu hồi, hay tệp không thuộc hãng brand đã đi — CÙNG một câu trả lời,
  // để không ai dò được tệp nào tồn tại.
  if (!key) return new NextResponse('Not found', { status: 404 });
  try {
    return NextResponse.redirect(await getSignedDownloadUrl(key, 300), 307);
  } catch {
    return new NextResponse('Không lấy được tệp, thử lại sau.', { status: 502 });
  }
}
```

- [ ] **Bước 2: viết trang**

Theo nếp `app/gr/[token]/page.tsx`:

```tsx
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const t = await docTrangPhuPhi(token);
  if (!t) return { title: 'Không tìm thấy', robots: { index: false, follow: false } };
  return {
    title: `Phụ phí vận chuyển — ${t.tenBrand}`,
    robots: { index: false, follow: false },
  };
}
```

Thân trang:
- `const t = await docTrangPhuPhi(token); if (!t) notFound();`
- tiêu đề: `Phụ phí vận chuyển — {t.tenBrand}`, kèm một đoạn mở đầu nói rõ **đây là các khoản hãng vận chuyển thu MEAN và MEAN thu lại brand đúng số đó**;
- `t.hang.length === 0` → hiện đúng câu: *"Chưa có đơn nào qua SMS nên chưa có phụ phí để dẫn nguồn."* Không hiện bảng rỗng;
- mỗi hãng một khối: tên hãng · link trang công bố (nếu có) · bảng các dòng phụ phí (nhãn · cách tính · mức · hiệu lực từ) · nếu `tuanDau.length > 0` thì bảng tuần dầu · nếu `tep.length > 0` thì danh sách tệp với link `/pp/{token}/evidence/{id}`;
- hãng không còn phụ phí đang mở (`dong.length === 0 && tuanDau.length === 0`) → vẫn hiện tên hãng + link, kèm câu *"Không có phụ phí nào đang áp dụng."*;
- **cuối trang**, câu bắt buộc: *"Trang này chỉ dẫn nguồn các khoản phụ phí của hãng vận chuyển. Những khoản khác trên bảng kê — phí xử lý đơn hàng, thuế và phí nhập khẩu thu hộ — không có nguồn hãng; liên hệ MEAN BLVD nếu cần đối chiếu."*

Tailwind: theo cách `app/gr/[token]/page.tsx` đang dùng (không dựng hệ màu mới). Chữ thân ≥ 16px, bảng bọc `overflow-x-auto` để không tràn ngang trên điện thoại.

- [ ] **Bước 3: tsc + lint + test toàn bộ**

```bash
npx tsc --noEmit
npx eslint app/pp features/ship-ho/trang-phu-phi
npx vitest run
```

Bộ test có `components/rsc-ham-qua-bien.test.ts` canh ranh giới RSC — trang này là Server Component và không truyền hàm xuống Client Component nào, nên phải xanh.

- [ ] **Bước 4: xem thật trên trình duyệt**

Tạo link tạm cho `kalisa` bằng script trong `scripts/tmp/`, mở `preview_start` tới `/pp/<token>`, đọc trang bằng `read_page`, chụp ảnh. Kiểm bằng mắt: có hãng · có bảng tuần dầu tháng 7 · có tệp vùng xa · **không có dòng nào nói về markup/lãi** · câu cuối trang có mặt. Xoá link tạm sau khi xem.

- [ ] **Bước 5: commit**

```bash
git add app/pp
git commit -m "feat(phu-phi): trang public dẫn nguồn + route tải tệp vùng xa theo token"
```

---

### Task 6: Khối quản trị tạo / thu hồi link

**Tệp:**
- Tạo: `features/ship-ho/trang-phu-phi/actions.ts`
- Tạo: `components/ship-ho/KhoiLinkPhuPhi.tsx`
- Sửa: `app/(dashboard)/f/ship-ho/partners/page.tsx` — render khối mới
- Test: `features/ship-ho/trang-phu-phi/actions.test.ts`

**Giao diện — Consumes:** `sinhToken` (Task 3)

**Giao diện — Produces:**
```ts
export async function taoLinkPhuPhi(brandSlug: string): Promise<{ ok: boolean; token?: string; loi?: string }>;
export async function thuHoiLinkPhuPhi(brandSlug: string): Promise<{ ok: boolean; loi?: string }>;
```

- [ ] **Bước 1: viết actions**

```ts
'use server';
```

`taoLinkPhuPhi`:
1. `await requireManageShipHo()` — chốt quyền, cùng quyền mọi thao tác ship hộ;
2. trong MỘT transaction: `update` link đang sống của brand đó đặt `revokedAt = now()`, rồi `insert` dòng mới với `sinhToken()`. Hai câu trong một transaction vì unique index có điều kiện sẽ từ chối dòng thứ hai nếu chưa thu hồi dòng cũ — tách ra là có lúc brand không còn link nào;
3. `revalidatePath('/f/ship-ho/partners')`;
4. trả token.

`thuHoiLinkPhuPhi`: kiểm quyền, `update ... set revokedAt = now() where partnerBrandSlug = ? and revokedAt is null`, revalidate.

- [ ] **Bước 2: viết component**

`'use client'`. Mỗi brand một dòng: tên brand · trạng thái link (`chưa có` / `đang sống, tạo ngày …`) · nút **Tạo link** hoặc **Chép link** + **Thu hồi**. Chép dùng `navigator.clipboard.writeText`. Hiện link dạng đầy đủ `${origin}/pp/${token}` để chép xong dán được ngay.

Nút đang chạy thì `disabled` (luật `loading-buttons`). Mọi nút có `cursor-pointer`.

- [ ] **Bước 3: nối vào trang partners**

`page.tsx` đọc danh sách brand + link đang sống (`revokedAt IS NULL`) rồi truyền xuống. Không truyền hàm từ Server sang Client Component — chỉ truyền dữ liệu; component tự gọi server action.

- [ ] **Bước 4: tsc + lint + test toàn bộ**

```bash
npx tsc --noEmit
npx eslint features/ship-ho/trang-phu-phi components/ship-ho "app/(dashboard)/f/ship-ho/partners"
npx vitest run
```

- [ ] **Bước 5: thử thật**

Mở `/f/ship-ho/partners`, tạo link cho `kalisa`, chép, mở link ở tab khác (`preview_start`), xác nhận trang hiện đúng. Bấm **Thu hồi**, mở lại link, xác nhận ra 404.

- [ ] **Bước 6: commit**

```bash
git add features/ship-ho/trang-phu-phi/actions.ts components/ship-ho/KhoiLinkPhuPhi.tsx "app/(dashboard)/f/ship-ho/partners/page.tsx"
git commit -m "feat(phu-phi): khối quản trị tạo/chép/thu hồi link phụ phí cho brand"
```

---

## Tự soi kế hoạch

**Phủ spec:** §2 token+đường dẫn → Task 3, 5 · §3.1 hãng đã đi → Task 4 · §3.2 danh sách cho phép → Task 1 · §3.2.1 không hiện `processing` → Task 1 (không có trong bảng ánh xạ) + Task 5 (câu cuối trang) · §3.3 tuần dầu → Task 2, 4 · §3.4 tệp vùng xa → Task 4, 5 · §3.5 link hãng → Task 4 · §4 kiến trúc → cấu trúc tệp · §6 ca biên → Task 4, 5 · §7 test → Task 1, 2, 3 · quản trị link → Task 6.

**Không chỗ nào treo:** mọi bước có mã hoặc câu lệnh cụ thể; không có "TBD", không có "xử lý lỗi phù hợp".

**Tên hàm nhất quán:** `loaiChoPhep` · `NHAN_DONG` · `locTuanCoDon` · `TuanDau` · `sinhToken` · `docTrangPhuPhi` · `tepThuocBrand` · `taoLinkPhuPhi` · `thuHoiLinkPhuPhi` — dùng đúng tên này ở mọi task.
