# Nhận & Kiểm hàng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kho tìm món của đơn chưa fulfill qua ô search, ghi nhận "đang kiểm", rồi QC từng chiếc với ảnh to + thuộc tính lấy thẳng từ Shopify; QC không đạt thì chụp nhiều chỗ lỗi kèm lý do để in biên bản gửi brand.

**Architecture:** Màn `/f/warehouse/nhan-kcs` ghi vào **chính** sổ chiếc hàng mà phân bổ đang đọc (`goods_receipt_items`), không tạo sổ thứ hai. Chiếc ở `qc_result='pending'` chưa vào tồn; QC đạt mới gọi `applyMovement`. Ảnh và thuộc tính KHÔNG lưu — gọi Shopify GraphQL tại chỗ.

**Tech Stack:** Next.js (đọc `node_modules/next/dist/docs/` trước khi đụng route/server action), React 19, Drizzle + Postgres, vitest, Tailwind 4, shadcn/@base-ui, S3 (`lib/storage/s3.ts`), Shopify Admin GraphQL (`lib/shopify/client.ts`).

**Spec:** `docs/superpowers/specs/2026-09-24-nhan-kiem-hang-qc-loi-design.md`

## Global Constraints

- **KHÔNG xoá** `/f/warehouse/receiving` hay `goods_receipts*`. Bảng đó đang sống: 285/833 chiếc đã cấp cho đơn, cập nhật gần nhất 17/09/2026, `allocate.ts`/`release.ts`/`fulfillment/queries.ts` đang đọc.
- **KHÔNG lưu** ảnh hoặc thuộc tính Shopify vào database.
- **KHÔNG bật ghi Lark.** `WH_GHI_LARK` giữ `dry`; `day-nhan-kcs-lark` giữ trong nhóm `chua-bat`.
- **KHÔNG** vá bộ đồng bộ để điền `shopify_order_lines.shopify_product_id` (199/15.836) — việc riêng.
- Chuẩn hoá mã đơn: luôn bỏ `#` ở CẢ HAI phía khi so `lark_mon_don.order_number` với `shopify_orders.shopify_order_number`.
- Migration là SQL thô, áp bằng script tạm rồi xoá; **KHÔNG** cập nhật journal của drizzle (lệ từ 0139).
- Lớp màu Tailwind: chỉ dùng lớp repo đang dùng rộng rãi (`text-muted-foreground`, `bg-muted`, `bg-card`, `bg-background`, `text-foreground`, `border-border`, `border-input`, `bg-input`, `text-red-600 dark:text-red-400`, `text-amber-600 dark:text-amber-400`, `text-emerald-600 dark:text-emerald-400`). **Không tự chế token màu mới** (D-107).
- Mọi class truyền vào component shadcn có thể ĐÈ class gốc vì `cn()` dùng twMerge — đọc class gốc trước khi thêm (D-107).
- **Quyền dùng `requirePerm` SẴN CÓ** ở `features/receiving/perm.ts` — `requirePerm('view_receiving')` để đọc, `requirePerm('manage_qc')` để ghi. `features/kho-nhan/actions.ts` đã dùng đúng khuôn này. **KHÔNG tạo file quyền mới cho kho-nhan.**
- **Tải ảnh dùng `uploadReceiptImage` SẴN CÓ** ở `features/receiving/actions.ts` (nhận FormData với `file` + `scope`, trả khoá S3). Không viết lại đường tải ảnh.
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File Structure

| File | Trách nhiệm |
|---|---|
| `db/migrations/0165_wh-loi-qc.sql` | Enum `qc_ly_do_loi` + bảng `wh_loi_qc` |
| `features/kho-nhan/loi-qc.ts` | THUẦN: danh sách lý do, luật bắt buộc ghi chú/ảnh |
| `features/kho-nhan/thuoc-tinh-shopify.ts` | THUẦN: lọc + gộp metafield thành danh sách hiển thị |
| `features/kho-nhan/ma-don.ts` | THUẦN: chuẩn hoá mã đơn (bỏ `#`) |
| `features/kho-nhan/shopify-qc.ts` | I/O: một truy vấn Shopify cho một đơn → ảnh + thuộc tính từng dòng |
| `features/kho-nhan/tim-don.ts` | I/O: tìm món của đơn chưa fulfill |
| `features/kho-nhan/nhan-actions.ts` | I/O: ghi nhận chiếc ở `pending` |
| `features/kho-nhan/qc-actions.ts` | I/O: QC đạt (→ tồn) / không đạt (→ lỗi) |
| `features/kho-nhan/bien-ban.ts` | I/O: gom chiếc fail theo brand cho biên bản |
| `components/kho-nhan/ODdKiemHang.tsx` | Ô search + gợi ý |
| `components/kho-nhan/BangDangKiem.tsx` | Danh sách đang kiểm |
| `components/kho-nhan/ModalQc.tsx` | Modal QC toàn màn hình |
| `components/kho-nhan/KhoiLoi.tsx` | Khối nhập nhiều chỗ lỗi |
| `app/(dashboard)/f/warehouse/nhan-kcs/bien-ban/page.tsx` | Trang in biên bản |

---

### Task 1: Bảng lỗi QC

**Files:**
- Create: `db/migrations/0165_wh-loi-qc.sql`
- Modify: `db/schema.ts`
- Create: `features/kho-nhan/loi-qc.ts`
- Test: `features/kho-nhan/loi-qc.test.ts`

**Interfaces:**
- Produces: `LyDoLoi` (union 12 giá trị), `NHAN_LY_DO: Record<LyDoLoi, string>`, `kiemDongLoi(d): {ok:true} | {ok:false; loi:string}`, bảng Drizzle `whLoiQc`.

- [ ] **Bước 1: Viết test thất bại** `features/kho-nhan/loi-qc.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { kiemDongLoi, NHAN_LY_DO, LY_DO_HOP_LE } from './loi-qc';

describe('kiemDongLoi', () => {
  it('lý do hợp lệ + có ảnh → nhận', () => {
    expect(kiemDongLoi({ lyDo: 'ban', anhKey: 'qc-loi/a/1.jpg', ghiChu: '', coStorage: true }))
      .toEqual({ ok: true });
  });
  it('lý do "khác" BẮT BUỘC ghi chú', () => {
    expect(kiemDongLoi({ lyDo: 'khac', anhKey: 'k', ghiChu: '  ', coStorage: true }))
      .toEqual({ ok: false, loi: 'Lý do "Khác" phải ghi rõ trong ô ghi chú.' });
    expect(kiemDongLoi({ lyDo: 'khac', anhKey: 'k', ghiChu: 'chỉ thừa', coStorage: true }))
      .toEqual({ ok: true });
  });
  it('có kho ảnh thì ảnh BẮT BUỘC — biên bản gửi brand không ảnh thì không cãi được', () => {
    expect(kiemDongLoi({ lyDo: 'rach', anhKey: null, ghiChu: '', coStorage: true }))
      .toEqual({ ok: false, loi: 'Phải chụp ảnh chỗ lỗi.' });
  });
  it('CHƯA cấu hình kho ảnh → vẫn ghi được lỗi, không chặn kho làm việc', () => {
    expect(kiemDongLoi({ lyDo: 'rach', anhKey: null, ghiChu: '', coStorage: false }))
      .toEqual({ ok: true });
  });
  it('lý do lạ → từ chối, KHÔNG im lặng đổi sang "khác"', () => {
    expect(kiemDongLoi({ lyDo: 'vo_chai' as never, anhKey: 'k', ghiChu: '', coStorage: true }))
      .toEqual({ ok: false, loi: 'Lý do lỗi không hợp lệ.' });
  });
  it('đủ 12 lý do, mỗi lý do có nhãn tiếng Việt', () => {
    expect(LY_DO_HOP_LE).toHaveLength(12);
    for (const l of LY_DO_HOP_LE) expect(NHAN_LY_DO[l]).toBeTruthy();
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/kho-nhan/loi-qc.test.ts` — FAIL (module chưa có).

- [ ] **Bước 3: Viết** `features/kho-nhan/loi-qc.ts`

```ts
/**
 * THUẦN: lý do lỗi QC và luật của một dòng lỗi. Không I/O.
 *
 * Danh sách rút từ chính chữ đội kho đã gõ tay trong `goods_receipt_items`
 * (bẩn, thiếu đá đính, có mùi, lỗi vải, xước vải, hỏng khoá kéo…). Chọn từ
 * danh sách chứ không gõ tay vì bản cũ không gom nhóm được: 83 món `pass` lại
 * có lý do fail ghi trong đó, kiểu "(đã khắc phục) hỏng khóa kéo, nhờ brand sửa".
 */
export const LY_DO_HOP_LE = [
  'ban', 'rach', 'loi_vai', 'xuoc_vai', 'hong_khoa', 'thieu_phu_kien',
  'co_mui', 'sai_mau', 'sai_size', 'loi_duong_may', 'o_loang_mau', 'khac',
] as const;

export type LyDoLoi = (typeof LY_DO_HOP_LE)[number];

export const NHAN_LY_DO: Record<LyDoLoi, string> = {
  ban: 'Bẩn', rach: 'Rách', loi_vai: 'Lỗi vải', xuoc_vai: 'Xước vải',
  hong_khoa: 'Hỏng khoá kéo', thieu_phu_kien: 'Thiếu phụ kiện / đá đính',
  co_mui: 'Có mùi', sai_mau: 'Sai màu', sai_size: 'Sai size',
  loi_duong_may: 'Lỗi đường may', o_loang_mau: 'Ố / loang màu', khac: 'Khác',
};

export interface DongLoiTho {
  lyDo: LyDoLoi;
  anhKey: string | null;
  ghiChu: string;
  /** `isStorageConfigured()` — chưa có kho ảnh thì không chặn kho làm việc. */
  coStorage: boolean;
}

export function kiemDongLoi(d: DongLoiTho): { ok: true } | { ok: false; loi: string } {
  if (!(LY_DO_HOP_LE as readonly string[]).includes(d.lyDo)) {
    return { ok: false, loi: 'Lý do lỗi không hợp lệ.' };
  }
  if (d.lyDo === 'khac' && d.ghiChu.trim() === '') {
    return { ok: false, loi: 'Lý do "Khác" phải ghi rõ trong ô ghi chú.' };
  }
  if (d.coStorage && !d.anhKey) return { ok: false, loi: 'Phải chụp ảnh chỗ lỗi.' };
  return { ok: true };
}
```

- [ ] **Bước 4:** `npx vitest run features/kho-nhan/loi-qc.test.ts` — PASS.

- [ ] **Bước 5: Viết migration** `db/migrations/0165_wh-loi-qc.sql`

```sql
-- Mỗi CHỖ LỖI một dòng. `goods_receipt_items` chỉ có một ô `qc_fail_photo_key`
-- (0 dòng, chưa ai dùng), mà một chiếc váy bẩn gấu VÀ rách nách VÀ hỏng khoá là
-- ba chỗ lỗi, mỗi chỗ một ảnh. Nhồi vào một ô là mất bằng chứng khi cãi với brand.
CREATE TYPE qc_ly_do_loi AS ENUM (
  'ban','rach','loi_vai','xuoc_vai','hong_khoa','thieu_phu_kien',
  'co_mui','sai_mau','sai_size','loi_duong_may','o_loang_mau','khac');

CREATE TABLE wh_loi_qc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_item_id uuid NOT NULL REFERENCES goods_receipt_items(id) ON DELETE CASCADE,
  ly_do qc_ly_do_loi NOT NULL,
  anh_key text,
  ghi_chu text,
  tao_luc timestamp NOT NULL DEFAULT now(),
  tao_boi text NOT NULL
);

CREATE INDEX wh_loi_qc_item_idx ON wh_loi_qc (receipt_item_id);
```

- [ ] **Bước 6: Thêm vào** `db/schema.ts` (cạnh `goodsReceiptItems`)

```ts
export const qcLyDoLoiEnum = pgEnum('qc_ly_do_loi', [
  'ban', 'rach', 'loi_vai', 'xuoc_vai', 'hong_khoa', 'thieu_phu_kien',
  'co_mui', 'sai_mau', 'sai_size', 'loi_duong_may', 'o_loang_mau', 'khac',
]);

/** Một CHỖ LỖI trên một chiếc hàng. Một chiếc có thể nhiều dòng. */
export const whLoiQc = pgTable('wh_loi_qc', {
  id: uuid('id').defaultRandom().primaryKey(),
  receiptItemId: uuid('receipt_item_id')
    .references(() => goodsReceiptItems.id, { onDelete: 'cascade' }).notNull(),
  lyDo: qcLyDoLoiEnum('ly_do').notNull(),
  anhKey: text('anh_key'),
  ghiChu: text('ghi_chu'),
  taoLuc: timestamp('tao_luc').notNull().defaultNow(),
  taoBoi: text('tao_boi').notNull(),
}, (t) => [index('wh_loi_qc_item_idx').on(t.receiptItemId)]);
```

- [ ] **Bước 7: Áp migration** — tạo `scripts/_mig.ts` đọc file SQL và `db.execute(sql.raw(...))`, chạy `npx tsx --env-file=.env scripts/_mig.ts`, xác minh bằng truy vấn `information_schema`, rồi **xoá script**.

- [ ] **Bước 8:** `npx tsc --noEmit && npx vitest run features/kho-nhan` — xanh.

- [ ] **Bước 9: Commit** `feat(kho-nhan): bảng wh_loi_qc — mỗi chỗ lỗi một dòng, 12 lý do chọn sẵn`

---

### Task 2: Lọc thuộc tính Shopify

**Files:**
- Create: `features/kho-nhan/thuoc-tinh-shopify.ts`
- Test: `features/kho-nhan/thuoc-tinh-shopify.test.ts`

**Interfaces:**
- Produces: `locThuocTinh(nodes): { hien: {nhan:string; giaTri:string}[]; soBiCat: number }`

- [ ] **Bước 1: Viết test thất bại** `features/kho-nhan/thuoc-tinh-shopify.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { locThuocTinh, type MetafieldTho } from './thuoc-tinh-shopify';

const mf = (namespace: string, key: string, value: string, extra: Partial<MetafieldTho> = {}): MetafieldTho =>
  ({ namespace, key, value, reference: null, references: null, ...extra });

describe('locThuocTinh', () => {
  it('chỉ nhận namespace custom và shopify', () => {
    const r = locThuocTinh([
      mf('custom', 'pattern', 'Plain'),
      mf('theme', 'estimateEndDate', '14'),
      mf('swym_wishlist', 'wishlist_social_count', '3'),
      mf('mm-google-shopping', 'google_product_category', '1604'),
    ]);
    expect(r.hien.map((x) => x.giaTri)).toEqual(['Plain']);
    expect(r.soBiCat).toBe(3);
  });

  it('quy tham chiếu metaobject về chữ đọc được', () => {
    const r = locThuocTinh([
      mf('custom', 'materials_v2', '["gid://shopify/Metaobject/1"]',
         { references: [{ displayName: 'Crepe' }] }),
      mf('custom', 'fitting_type_v2', 'gid://shopify/Metaobject/2',
         { reference: { displayName: 'Slim' } }),
    ]);
    expect(r.hien.map((x) => x.giaTri)).toEqual(['Crepe', 'Slim']);
  });

  it('còn là gid chưa quy đổi được thì BỎ, không hiện mã cho người kiểm', () => {
    const r = locThuocTinh([mf('custom', 'pattern', 'gid://shopify/Metaobject/9')]);
    expect(r.hien).toHaveLength(0);
    expect(r.soBiCat).toBe(1);
  });

  it('bỏ blob dài quá 200 ký tự (widget review, JSON cấu hình app)', () => {
    const r = locThuocTinh([mf('custom', 'badge', '<div class="jdgm">' + 'x'.repeat(300) + '</div>')]);
    expect(r.hien).toHaveLength(0);
    expect(r.soBiCat).toBe(1);
  });

  it('gộp hai thế hệ: _v2 THẮNG bản cũ, chỉ hiện MỘT dòng', () => {
    const r = locThuocTinh([
      mf('custom', 'fitting_type', 'Regular'),
      mf('custom', 'fitting_type_v2', 'x', { reference: { displayName: 'Slim' } }),
    ]);
    expect(r.hien).toEqual([{ nhan: 'Kiểu dáng', giaTri: 'Slim' }]);
  });

  it('chỉ có bản cũ thì vẫn hiện bản cũ', () => {
    const r = locThuocTinh([mf('custom', 'fitting_type', 'Regular')]);
    expect(r.hien).toEqual([{ nhan: 'Kiểu dáng', giaTri: 'Regular' }]);
  });

  it('loại khoá không phục vụ kiểm hàng', () => {
    const r = locThuocTinh([
      mf('custom', 'return_refund_policy_v2', 'x', { reference: { displayName: '30 days' } }),
      mf('custom', 'seasonal', 'x', { reference: { displayName: 'Summer' } }),
    ]);
    expect(r.hien).toHaveLength(0);
  });

  it('đếm đúng số bị cắt để người sửa sau biết bộ lọc đang cắt bao nhiêu', () => {
    const r = locThuocTinh([mf('custom', 'pattern', 'Plain'), mf('theme', 'a', '1'), mf('theme', 'b', '2')]);
    expect(r.soBiCat).toBe(2);
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/kho-nhan/thuoc-tinh-shopify.test.ts` — FAIL.

- [ ] **Bước 3: Viết** `features/kho-nhan/thuoc-tinh-shopify.ts`

```ts
/**
 * THUẦN: biến metafield thô của Shopify thành danh sách thuộc tính cho người QC soi.
 *
 * DANH SÁCH CHO PHÉP, không phải danh sách chặn. Đo thật 24/09: 10 sản phẩm trả
 * về 58 metafield khác nhau, phần lớn là rác app — widget đánh giá judge.me dạng
 * HTML hàng nghìn ký tự, `bcpo_data` JSON, badge, swym_wishlist, mm-google-shopping,
 * mc-facebook, theme.*. Dùng danh sách chặn thì app cài thêm cái mới là rác lại
 * tràn vào màn QC.
 */
const NAMESPACE_NHAN = new Set(['custom', 'shopify']);
const KHOA_LOAI_TRU = new Set([
  'return_refund_policy_v2', 'seasonal', 'suggested_item', 'product_return_refund_policy',
]);
const DAI_TOI_DA = 200;

/** Nhãn tiếng Việt theo thuộc tính LOGIC (đã bỏ hậu tố thế hệ). */
const NHAN: Record<string, string> = {
  pattern: 'Hoạ tiết', material: 'Chất liệu', materials: 'Chất liệu', fabric: 'Chất liệu',
  apparel_silhouette: 'Dáng', fitting_type: 'Kiểu dáng', neck_style: 'Cổ',
  neckline_type: 'Cổ', neckline: 'Cổ', collar_type: 'Cổ áo',
  sleeve_length: 'Độ dài tay', 'sleeve-length-type': 'Độ dài tay',
  sleeve_type: 'Kiểu tay', sleeveline: 'Đường tay', waistline: 'Cạp',
  waistrise: 'Độ cao cạp', product_length: 'Độ dài', length: 'Độ dài',
  'skirt-dress-length-type': 'Độ dài', closure_type: 'Khoá',
  embellishment_feature: 'Chi tiết trang trí', included_component: 'Phụ kiện kèm',
  lining: 'Lót', lining_description: 'Lót', form_type: 'Form',
  models_measurement: 'Số đo người mẫu', 'dress-style': 'Kiểu váy',
  pocket_type: 'Túi', sewing_details: 'Chi tiết may', 'clothing-features': 'Đặc tính',
  'care-instructions': 'Hướng dẫn bảo quản', size: 'Size',
};

export interface MetafieldTho {
  namespace: string;
  key: string;
  value: string | null;
  reference?: { displayName?: string | null } | null;
  references?: { displayName?: string | null }[] | null;
}

export interface DongThuocTinh { nhan: string; giaTri: string }

/**
 * Bỏ hậu tố thế hệ để hai bản cũ/mới gộp về một thuộc tính logic.
 * Shopify của MEAN đang có CẢ `custom.fitting_type` (8/10 sản phẩm) lẫn
 * `custom.fitting_type_v2` (9/10) — không gộp thì màn QC hiện trùng hoặc hiện ô trống.
 */
function khoaLogic(key: string): string {
  return key.replace(/_v2_multi$/, '').replace(/_v2$/, '').replace(/_multi$/, '');
}

function chuDocDuoc(m: MetafieldTho): string | null {
  const nhieu = (m.references ?? []).map((r) => r?.displayName).filter((x): x is string => Boolean(x));
  if (nhieu.length) return nhieu.join(', ');
  if (m.reference?.displayName) return m.reference.displayName;
  const v = (m.value ?? '').trim();
  if (!v) return null;
  // Còn là gid (một hoặc một mảng) thì chưa quy đổi được — không hiện mã cho người kiểm.
  if (v.includes('gid://')) return null;
  if (v.length > DAI_TOI_DA) return null;
  // Giá trị dạng mảng JSON chuỗi: ["156cm"] → 156cm
  if (v.startsWith('[')) {
    try {
      const arr: unknown = JSON.parse(v);
      if (Array.isArray(arr)) {
        const chu = arr.filter((x): x is string => typeof x === 'string');
        return chu.length ? chu.join(', ') : null;
      }
    } catch { /* không phải JSON — dùng nguyên chuỗi */ }
  }
  return v;
}

export function locThuocTinh(nodes: readonly MetafieldTho[]): { hien: DongThuocTinh[]; soBiCat: number } {
  let soBiCat = 0;
  // khoá logic → { ưu tiên thế hệ, giá trị }. `_v2` thắng bản cũ.
  const gom = new Map<string, { moi: boolean; giaTri: string }>();

  for (const m of nodes) {
    if (!NAMESPACE_NHAN.has(m.namespace) || KHOA_LOAI_TRU.has(m.key)) { soBiCat += 1; continue; }
    const chu = chuDocDuoc(m);
    if (!chu) { soBiCat += 1; continue; }
    const k = khoaLogic(m.key);
    const laMoi = m.key !== k;
    const cu = gom.get(k);
    if (!cu || (laMoi && !cu.moi)) gom.set(k, { moi: laMoi, giaTri: chu });
    else if (cu) soBiCat += 0; // trùng thuộc tính logic — không tính là bị cắt
  }

  const hien: DongThuocTinh[] = [];
  for (const [k, v] of gom) hien.push({ nhan: NHAN[k] ?? k.replace(/_/g, ' '), giaTri: v.giaTri });
  return { hien, soBiCat };
}
```

- [ ] **Bước 4:** `npx vitest run features/kho-nhan/thuoc-tinh-shopify.test.ts` — PASS.

- [ ] **Bước 5: Commit** `feat(kho-nhan): lọc thuộc tính Shopify bằng danh sách cho phép, gộp hai thế hệ _v2`

---

### Task 3: Chuẩn hoá mã đơn + truy vấn Shopify

**Files:**
- Create: `features/kho-nhan/ma-don.ts`
- Create: `features/kho-nhan/shopify-qc.ts`
- Test: `features/kho-nhan/ma-don.test.ts`

**Interfaces:**
- Consumes: `locThuocTinh` (Task 2).
- Produces: `chuanHoaMaDon(s): string`, `layDuLieuQc(storeId, shopifyOrderId): Promise<DuLieuQcDon | null>` với
  `DuLieuQcDon = { dacDiemDon: string[]; dong: { sku: string|null; variantId: string|null; productId: string|null; anh: string[]; thuocTinh: DongThuocTinh[]; soBiCat: number }[] }`.

- [ ] **Bước 1: Viết test thất bại** `features/kho-nhan/ma-don.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { chuanHoaMaDon } from './ma-don';

describe('chuanHoaMaDon', () => {
  it('bỏ # đầu — lark_mon_don lưu "MBLVD26763", shopify_orders lưu "#MBLVD2009"', () => {
    expect(chuanHoaMaDon('#MBLVD26763')).toBe('MBLVD26763');
    expect(chuanHoaMaDon('MBLVD26763')).toBe('MBLVD26763');
  });
  it('cắt khoảng trắng hai đầu', () => {
    expect(chuanHoaMaDon('  #MBLVD26763  ')).toBe('MBLVD26763');
  });
  it('hai dạng phải khớp nhau — đây là cạm bẫy đã đo: ghép thẳng ra 597/7150, chuẩn hoá ra 6168', () => {
    expect(chuanHoaMaDon('#MBLVD26763')).toBe(chuanHoaMaDon('MBLVD26763'));
  });
  it('chuỗi rỗng ra rỗng, không ném lỗi', () => {
    expect(chuanHoaMaDon('')).toBe('');
    expect(chuanHoaMaDon('   ')).toBe('');
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/kho-nhan/ma-don.test.ts` — FAIL.

- [ ] **Bước 3: Viết** `features/kho-nhan/ma-don.ts`

```ts
/**
 * THUẦN: chuẩn hoá mã đơn để so được giữa hai bảng.
 *
 * `lark_mon_don.order_number` lưu "MBLVD26763" còn `shopify_orders.shopify_order_number`
 * lưu "#MBLVD2009". Đo 24/09: ghép thẳng ra 597/7.150, chuẩn hoá bỏ `#` ra 6.168 (86%).
 * Quên chuẩn hoá thì truy vấn trả GẦN NHƯ RỖNG mà không có lỗi nào báo.
 */
export function chuanHoaMaDon(s: string): string {
  return s.trim().replace(/^#/, '');
}
```

- [ ] **Bước 4:** `npx vitest run features/kho-nhan/ma-don.test.ts` — PASS.

- [ ] **Bước 5: Viết** `features/kho-nhan/shopify-qc.ts`

```ts
'use server';

import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { locThuocTinh, type DongThuocTinh, type MetafieldTho } from './thuoc-tinh-shopify';
import { requirePerm } from '@/features/receiving/perm';

export interface DongQc {
  sku: string | null;
  variantId: string | null;
  productId: string | null;
  tenSanPham: string | null;
  tenBienThe: string | null;
  /** Ảnh biến thể ĐỨNG ĐẦU (đúng màu khách đặt), rồi tới ảnh sản phẩm. */
  anh: string[];
  thuocTinh: DongThuocTinh[];
  soBiCat: number;
}

export interface DuLieuQcDon {
  /** `order.special_features` — GỘP CẢ ĐƠN, không tách theo món. Màn phải ghi rõ. */
  dacDiemDon: string[];
  dong: DongQc[];
}

const TRUY_VAN = `query($id: ID!) {
  order(id: $id) {
    specialFeatures: metafield(namespace: "order", key: "special_features") { value }
    lineItems(first: 50) { nodes {
      sku name quantity
      variant { id title image { url } }
      product { id title
        images(first: 8) { nodes { url } }
        metafields(first: 50) { nodes {
          namespace key value
          reference { ... on Metaobject { displayName } }
          references(first: 10) { nodes { ... on Metaobject { displayName } } } } } } } } } }`;

/**
 * Ảnh + thuộc tính cho MỘT đơn, lấy THẲNG từ Shopify. KHÔNG lưu lại (CEO 24/09:
 * tiết kiệm storage, không nhân bản dữ liệu).
 *
 * Trả `null` khi hỏng — KHÔNG ném. Màn QC phải mở và bấm Đạt/Không đạt được kể
 * cả khi Shopify chết; mất ảnh và thuộc tính thôi, không chặn kho làm việc.
 * Đo thật 24/09: 444–615ms mỗi lượt, chi phí 5–45 điểm trên hạn mức 20.000 với
 * tốc độ hồi 1.000/giây — không có rủi ro chạm trần.
 */
export async function layDuLieuQc(storeId: string, shopifyOrderId: string): Promise<DuLieuQcDon | null> {
  await requirePerm('view_receiving');
  try {
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    if (!store) return null;
    const token = await getStoreToken(store.id);
    const r = await graphqlCall({
      shopDomain: store.shopDomain, apiVersion: store.apiVersion, token,
      query: TRUY_VAN, variables: { id: shopifyOrderId },
    }) as { data?: { order?: unknown } };
    const don = (r.data as { order?: Record<string, unknown> } | undefined)?.order;
    if (!don) return null;

    let dacDiemDon: string[] = [];
    const sf = (don.specialFeatures as { value?: string } | null)?.value;
    if (sf) { try { const a: unknown = JSON.parse(sf); if (Array.isArray(a)) dacDiemDon = a.filter((x): x is string => typeof x === 'string'); } catch { /* giá trị lạ — bỏ qua */ } }

    const nodes = ((don.lineItems as { nodes?: unknown[] } | undefined)?.nodes ?? []) as Record<string, never>[];
    const dong: DongQc[] = nodes.map((li) => {
      const v = li.variant as { id?: string; title?: string; image?: { url?: string } } | null;
      const p = li.product as { id?: string; title?: string; images?: { nodes?: { url: string }[] }; metafields?: { nodes?: MetafieldTho[] } } | null;
      const anhBienThe = v?.image?.url ? [v.image.url] : [];
      const anhSp = (p?.images?.nodes ?? []).map((x) => x.url);
      const loc = locThuocTinh(p?.metafields?.nodes ?? []);
      return {
        sku: (li.sku as string | null) ?? null,
        variantId: v?.id ?? null,
        productId: p?.id ?? null,
        tenSanPham: p?.title ?? null,
        tenBienThe: v?.title ?? null,
        anh: [...anhBienThe, ...anhSp.filter((u) => u !== anhBienThe[0])],
        thuocTinh: loc.hien,
        soBiCat: loc.soBiCat,
      };
    });
    return { dacDiemDon, dong };
  } catch (e) {
    console.error('[kho-nhan] layDuLieuQc lỗi:', e);
    return null;
  }
}
```

- [ ] **Bước 6:** `npx tsc --noEmit` — xanh. Kiểm bằng script tạm: gọi `layDuLieuQc` cho một đơn `UNFULFILLED` thật, in ra số ảnh và số thuộc tính; xoá script sau khi chạy.

- [ ] **Bước 7: Commit** `feat(kho-nhan): lấy ảnh + thuộc tính QC thẳng từ Shopify, hỏng thì trả null chứ không chặn`

---

### Task 4: Tìm món của đơn chưa fulfill

**Files:**
- Create: `features/kho-nhan/tim-don.ts`
- Test: `features/kho-nhan/tim-don-logic.test.ts`
- Create: `features/kho-nhan/tim-don-logic.ts`

**Interfaces:**
- Consumes: `chuanHoaMaDon` (Task 3), `boDauTiengViet` từ `@/features/kol/bo-dau`.
- Produces: `timMonChuaNhan(tuKhoa): Promise<KetQuaTim[]>` với
  `KetQuaTim = { lineId: string; orderId: string; storeId: string; shopifyOrderId: string; maDon: string; sku: string|null; tenSanPham: string|null; tenBienThe: string|null; vendor: string|null; datSl: number; daNhan: number }`.

- [ ] **Bước 1: Viết test thất bại** `features/kho-nhan/tim-don-logic.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { conNhanDuoc, kieuTuKhoa } from './tim-don-logic';

describe('conNhanDuoc', () => {
  it('đặt 3 mới nhận 1 → VẪN hiện, vì hàng về nhiều đợt là chuyện thường', () => {
    expect(conNhanDuoc({ datSl: 3, daNhan: 1 })).toBe(true);
  });
  it('đã nhận đủ → ẩn', () => {
    expect(conNhanDuoc({ datSl: 3, daNhan: 3 })).toBe(false);
  });
  it('nhận thừa (brand gửi dư) → ẩn, không âm', () => {
    expect(conNhanDuoc({ datSl: 3, daNhan: 5 })).toBe(false);
  });
  it('chưa nhận gì → hiện', () => {
    expect(conNhanDuoc({ datSl: 1, daNhan: 0 })).toBe(true);
  });
});

describe('kieuTuKhoa', () => {
  it('toàn số dài ≥ 10 → coi là ID sản phẩm (tem V: in ra số trần)', () => {
    expect(kieuTuKhoa('35730194464936')).toBe('id');
  });
  it('có chữ → tìm theo chữ', () => {
    expect(kieuTuKhoa('MBLVD26763')).toBe('chu');
    expect(kieuTuKhoa('ao dai')).toBe('chu');
  });
  it('số ngắn → vẫn là chữ, không nhầm thành ID', () => {
    expect(kieuTuKhoa('26763')).toBe('chu');
  });
  it('dưới 2 ký tự → không tìm', () => {
    expect(kieuTuKhoa('a')).toBe('qua_ngan');
    expect(kieuTuKhoa(' ')).toBe('qua_ngan');
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/kho-nhan/tim-don-logic.test.ts` — FAIL.

- [ ] **Bước 3: Viết** `features/kho-nhan/tim-don-logic.ts`

```ts
/** THUẦN: luật của ô tìm món chờ nhận. Không I/O. */

/**
 * Dòng đặt 3 chiếc mới về 1 thì VẪN còn nhận được — hàng về nhiều đợt là chuyện
 * thường. Ẩn sớm là kho không nhận nốt được hàng đợt sau.
 */
export function conNhanDuoc(d: { datSl: number; daNhan: number }): boolean {
  return d.daNhan < d.datSl;
}

export type KieuTuKhoa = 'qua_ngan' | 'id' | 'chu';

/** Tem `V:` in ra số trần; id Shopify dài ≥ 10 chữ số nên số ngắn không bị nhầm. */
export function kieuTuKhoa(raw: string): KieuTuKhoa {
  const q = raw.trim();
  if (q.length < 2) return 'qua_ngan';
  return /^\d{10,}$/.test(q) ? 'id' : 'chu';
}
```

- [ ] **Bước 4:** `npx vitest run features/kho-nhan/tim-don-logic.test.ts` — PASS.

- [ ] **Bước 5: Viết** `features/kho-nhan/tim-don.ts`

```ts
'use server';

import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { boDauTiengViet } from '@/features/kol/bo-dau';
import { chuanHoaMaDon } from './ma-don';
import { conNhanDuoc, kieuTuKhoa } from './tim-don-logic';
import { requirePerm } from '@/features/receiving/perm';

const GIOI_HAN = 20;

export interface KetQuaTim {
  lineId: string; orderId: string; storeId: string; shopifyOrderId: string;
  maDon: string; sku: string | null;
  tenSanPham: string | null; tenBienThe: string | null;
  vendor: string | null; datSl: number; daNhan: number;
}

/**
 * Món của đơn đang UNFULFILLED / PARTIALLY_FULFILLED mà CHƯA nhận đủ.
 *
 * Không có danh sách dựng sẵn (CEO 24/09) — ô tìm là cửa duy nhất. Khớp theo mã
 * đơn (chuẩn hoá bỏ `#` cả hai phía), SKU, tên sản phẩm KHÔNG DẤU, hoặc ID sản
 * phẩm/biến thể dạng số (thứ tem `V:` in ra).
 */
export async function timMonChuaNhan(tuKhoa: string): Promise<KetQuaTim[]> {
  await requirePerm('view_receiving');
  const kieu = kieuTuKhoa(tuKhoa);
  if (kieu === 'qua_ngan') return [];
  const q = tuKhoa.trim();
  const maDon = chuanHoaMaDon(q);
  const khongDau = `%${boDauTiengViet(q)}%`;

  const dieuKien = kieu === 'id'
    ? or(
        sql`regexp_replace(coalesce(${schema.shopifyOrderLines.shopifyVariantId}, ''), '[^0-9]', '', 'g') = ${q}`,
        sql`regexp_replace(coalesce(${schema.shopifyOrderLines.shopifyProductId}, ''), '[^0-9]', '', 'g') = ${q}`,
        sql`EXISTS (SELECT 1 FROM shopify_variants v WHERE v.sku = ${schema.shopifyOrderLines.sku}
              AND regexp_replace(v.shopify_variant_id, '[^0-9]', '', 'g') = ${q})`,
      )
    : or(
        sql`regexp_replace(${schema.shopifyOrders.shopifyOrderNumber}, '^#', '') ILIKE ${`%${maDon}%`}`,
        sql`${schema.shopifyOrderLines.sku} ILIKE ${`%${q}%`}`,
        sql`EXISTS (SELECT 1 FROM shopify_variants v WHERE v.sku = ${schema.shopifyOrderLines.sku}
              AND v.tim_kiem LIKE ${khongDau})`,
      );

  const rows = await db.select({
    lineId: schema.shopifyOrderLines.id,
    orderId: schema.shopifyOrders.id,
    storeId: schema.shopifyOrders.storeId,
    shopifyOrderId: schema.shopifyOrders.shopifyOrderId,
    maDon: schema.shopifyOrders.shopifyOrderNumber,
    sku: schema.shopifyOrderLines.sku,
    tenSanPham: schema.shopifyOrderLines.productTitle,
    tenBienThe: schema.shopifyOrderLines.variantTitle,
    vendor: schema.shopifyOrderLines.vendor,
    datSl: schema.shopifyOrderLines.quantity,
    daNhan: sql<number>`(SELECT count(*)::int FROM goods_receipt_items gi
      WHERE gi.fulfillment_line_id IS NOT DISTINCT FROM NULL
        AND gi.order_id = ${schema.shopifyOrders.id}
        AND gi.sku IS NOT DISTINCT FROM ${schema.shopifyOrderLines.sku})`,
  })
    .from(schema.shopifyOrderLines)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shopifyOrderLines.orderId))
    .where(and(
      inArray(schema.shopifyOrders.fulfillmentStatus, ['UNFULFILLED', 'PARTIALLY_FULFILLED']),
      isNotNull(schema.shopifyOrderLines.sku),
      dieuKien,
    ))
    .limit(GIOI_HAN * 3);

  return rows.filter((r) => conNhanDuoc({ datSl: r.datSl, daNhan: r.daNhan })).slice(0, GIOI_HAN);
}
```

- [ ] **Bước 6:** `npx tsc --noEmit` — xanh. Kiểm bằng script tạm: gọi `timMonChuaNhan('MBLVD')` và `timMonChuaNhan('ao dai')`, xác nhận ra kết quả và **không rỗng**; xoá script.

- [ ] **Bước 7: Commit** `feat(kho-nhan): tìm món của đơn chưa fulfill theo mã đơn / SKU / tên không dấu / ID`

---

### Task 5: Ghi nhận chiếc hàng ở trạng thái đang kiểm

**Files:**
- Create: `features/kho-nhan/nhan-actions.ts`
- Create: `features/kho-nhan/nhan-logic.ts`
- Test: `features/kho-nhan/nhan-logic.test.ts`

**Interfaces:**
- Consumes: `KetQuaTim` (Task 4).
- Produces: `ghiNhanChiec(lineId): Promise<{ ok: boolean; loi?: string; itemId?: string }>`, `maChiec(seq, luc): string`.

- [ ] **Bước 1: Viết test thất bại** `features/kho-nhan/nhan-logic.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { maChiec } from './nhan-logic';

describe('maChiec', () => {
  it('dựng mã chiếc theo năm-tháng giờ kinh doanh + số thứ tự 5 chữ số', () => {
    expect(maChiec(7, new Date('2026-09-23T10:00:00Z'))).toBe('WH-2609-00007');
  });
  it('ranh tháng theo giờ kinh doanh: 00:00 ngày 1/10 VN = 17:00 ngày 30/9 UTC → tháng 10', () => {
    expect(maChiec(8, new Date('2026-09-30T17:00:00Z'))).toBe('WH-2610-00008');
  });
  it('số vượt 5 chữ số thì KHÔNG cắt, để mã vẫn duy nhất', () => {
    expect(maChiec(123456, new Date('2026-09-23T10:00:00Z'))).toBe('WH-2609-123456');
  });
  it('số không hợp lệ thì ném', () => {
    expect(() => maChiec(0, new Date('2026-09-23T10:00:00Z'))).toThrow();
    expect(() => maChiec(1.5, new Date('2026-09-23T10:00:00Z'))).toThrow();
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/kho-nhan/nhan-logic.test.ts` — FAIL.

- [ ] **Bước 3: Viết** `features/kho-nhan/nhan-logic.ts`

```ts
import { thangKinhDoanh } from '@/lib/timezone';

/**
 * THUẦN: mã của MỘT CHIẾC hàng vật lý (`goods_receipt_items.unit_code`).
 *
 * Năm-tháng theo giờ kinh doanh (Asia/Bangkok) chứ không UTC — chiếc nhận lúc
 * 00:30 ngày 1/10 VN phải ghi tháng 10. Sequence chạy liên tục, không reset theo
 * tháng, nên mã không bao giờ trùng kể cả khi ai đó sửa giờ hệ thống.
 */
export function maChiec(soSeq: number, luc: Date): string {
  if (!Number.isInteger(soSeq) || soSeq <= 0) {
    throw new Error(`Số thứ tự chiếc phải là số nguyên dương, nhận được: ${soSeq}`);
  }
  const thang = thangKinhDoanh(luc);
  if (!thang) throw new Error(`Không lấy được tháng kinh doanh từ: ${luc}`);
  const namThang = thang.replace('-', '').slice(-4);
  return `WH-${namThang}-${String(soSeq).padStart(5, '0')}`;
}
```

- [ ] **Bước 4:** `npx vitest run features/kho-nhan/nhan-logic.test.ts` — PASS.

- [ ] **Bước 5: Viết migration phụ** `db/migrations/0166_wh-chiec-seq.sql` và áp như Task 1 bước 7

```sql
-- Sequence cho mã chiếc hàng. Liên tục, không reset theo tháng.
CREATE SEQUENCE IF NOT EXISTS wh_chiec_seq START 1;
```

- [ ] **Bước 6: Viết** `features/kho-nhan/nhan-actions.ts`

```ts
'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { maChiec } from './nhan-logic';
import { requirePerm } from '@/features/receiving/perm';

/**
 * Ghi nhận MỘT chiếc vừa về, ở trạng thái ĐANG KIỂM.
 *
 * `qc_result='pending'` và `disposition='pending'` → chiếc này KHÔNG vào tồn và
 * phân bổ KHÔNG nhìn thấy. Chỉ QC đạt mới nhập kho (CEO 24/09: "QC thành công
 * thì mới nhập vào kho, vì nếu QC không thành công sẽ cần phải trả lại cho brand").
 *
 * `current_warehouse_code` để NULL tới khi QC đạt — chưa kiểm thì chưa thuộc kho nào.
 */
export async function ghiNhanChiec(lineId: string): Promise<{ ok: boolean; loi?: string; itemId?: string }> {
  const actor = await requirePerm('manage_qc');
  try {
    const [line] = await db.select({
      id: schema.shopifyOrderLines.id,
      orderId: schema.shopifyOrderLines.orderId,
      sku: schema.shopifyOrderLines.sku,
      productTitle: schema.shopifyOrderLines.productTitle,
      variantTitle: schema.shopifyOrderLines.variantTitle,
      vendor: schema.shopifyOrderLines.vendor,
    }).from(schema.shopifyOrderLines).where(eq(schema.shopifyOrderLines.id, lineId)).limit(1);
    if (!line) return { ok: false, loi: 'Không tìm thấy dòng đơn.' };

    // Phiếu nhận theo NGÀY + brand: gom chiếc về một phiếu để biên bản và tra cứu
    // đi theo lô, thay vì mỗi chiếc một phiếu.
    const homNay = new Date().toISOString().slice(0, 10);
    const maPhieu = `WH-${homNay}-${line.vendor ?? 'KHONG-BRAND'}`;
    let [phieu] = await db.select().from(schema.goodsReceipts)
      .where(eq(schema.goodsReceipts.code, maPhieu)).limit(1);
    if (!phieu) {
      [phieu] = await db.insert(schema.goodsReceipts).values({
        code: maPhieu, warehouseCode: 'GVM', sourceType: 'consignment',
        vendor: line.vendor, receivedAt: new Date(), receivedBy: actor,
      }).returning();
    }

    const seq = await db.execute<{ v: string }>("SELECT nextval('wh_chiec_seq') AS v");
    const unitCode = maChiec(Number(seq.rows[0]?.v), new Date());

    const [item] = await db.insert(schema.goodsReceiptItems).values({
      receiptId: phieu.id,
      unitCode,
      sku: line.sku,
      productTitle: line.productTitle,
      variantTitle: line.variantTitle,
      orderId: line.orderId,
      qcResult: 'pending',
      disposition: 'pending',
    }).returning({ id: schema.goodsReceiptItems.id });

    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true, itemId: item.id };
  } catch (e) {
    console.error('[kho-nhan] ghiNhanChiec lỗi:', e);
    return { ok: false, loi: 'Ghi nhận thất bại, thử lại.' };
  }
}
```

- [ ] **Bước 7:** `npx tsc --noEmit && npx vitest run features/kho-nhan` — xanh.

- [ ] **Bước 8: Kiểm bất biến bằng script tạm** — ghi nhận một chiếc, rồi chạy truy vấn phân bổ (`features/warehouse/allocate.ts` đọc `goods_receipt_items` theo `currentWarehouseCode` + `qcCheckedAt`) và xác nhận chiếc `pending` **KHÔNG** xuất hiện. Xoá script.

- [ ] **Bước 9: Commit** `feat(kho-nhan): ghi nhận chiếc ở trạng thái đang kiểm, chưa vào tồn`

---

### Task 6: QC đạt / không đạt

**Files:**
- Create: `features/kho-nhan/qc-actions.ts`
- Modify: `features/kho-nhan/queries.ts` (thêm `danhSachDangKiem`)
- Test: `features/kho-nhan/qc-logic.test.ts`
- Create: `features/kho-nhan/qc-logic.ts`

**Interfaces:**
- Consumes: `kiemDongLoi`, `LyDoLoi` (Task 1).
- Produces: `qcDat(itemId, kho)`, `qcKhongDat(itemId, dongLoi[])`, `danhSachDangKiem()`.

- [ ] **Bước 1: Viết test thất bại** `features/kho-nhan/qc-logic.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { chuyenDuocQc, kiemLoQc } from './qc-logic';

describe('chuyenDuocQc', () => {
  it('pending → pass được', () => { expect(chuyenDuocQc('pending', 'pass')).toBe(true); });
  it('pending → fail được', () => { expect(chuyenDuocQc('pending', 'fail')).toBe(true); });
  it('đã pass rồi thì KHÔNG cho QC lại — hàng đã vào tồn, QC lại là nhập đôi', () => {
    expect(chuyenDuocQc('pass', 'fail')).toBe(false);
    expect(chuyenDuocQc('pass', 'pass')).toBe(false);
  });
  it('đã fail rồi thì KHÔNG cho QC lại', () => {
    expect(chuyenDuocQc('fail', 'pass')).toBe(false);
  });
});

describe('kiemLoQc', () => {
  it('QC không đạt phải có ÍT NHẤT MỘT chỗ lỗi', () => {
    expect(kiemLoQc([], true)).toEqual({ ok: false, loi: 'Phải ghi ít nhất một chỗ lỗi.' });
  });
  it('mọi dòng hợp lệ → nhận', () => {
    expect(kiemLoQc([{ lyDo: 'ban', anhKey: 'a', ghiChu: '' }], true)).toEqual({ ok: true });
  });
  it('một dòng sai thì CHỈ RA DÒNG NÀO, không báo chung chung', () => {
    expect(kiemLoQc([
      { lyDo: 'ban', anhKey: 'a', ghiChu: '' },
      { lyDo: 'khac', anhKey: 'b', ghiChu: '' },
    ], true)).toEqual({ ok: false, loi: 'Chỗ lỗi 2: Lý do "Khác" phải ghi rõ trong ô ghi chú.' });
  });
});
```

- [ ] **Bước 2:** `npx vitest run features/kho-nhan/qc-logic.test.ts` — FAIL.

- [ ] **Bước 3: Viết** `features/kho-nhan/qc-logic.ts`

```ts
import { kiemDongLoi, type LyDoLoi } from './loi-qc';

export type KetQuaQc = 'pending' | 'pass' | 'fail';

/**
 * THUẦN: QC chỉ chạy MỘT LẦN cho một chiếc.
 *
 * Đã `pass` là hàng đã vào tồn qua `applyMovement`; cho QC lại là nhập đôi hoặc
 * trừ tồn của chiếc đã bán. Muốn sửa thì phải đi đường điều chỉnh tồn riêng.
 */
export function chuyenDuocQc(tu: KetQuaQc, den: 'pass' | 'fail'): boolean {
  return tu === 'pending';
}

export interface DongLoiVao { lyDo: LyDoLoi; anhKey: string | null; ghiChu: string }

export function kiemLoQc(dong: readonly DongLoiVao[], coStorage: boolean):
  | { ok: true } | { ok: false; loi: string } {
  if (dong.length === 0) return { ok: false, loi: 'Phải ghi ít nhất một chỗ lỗi.' };
  for (let i = 0; i < dong.length; i++) {
    const r = kiemDongLoi({ ...dong[i]!, coStorage });
    if (!r.ok) return { ok: false, loi: `Chỗ lỗi ${i + 1}: ${r.loi}` };
  }
  return { ok: true };
}
```

- [ ] **Bước 4:** `npx vitest run features/kho-nhan/qc-logic.test.ts` — PASS.

- [ ] **Bước 5: Viết** `features/kho-nhan/qc-actions.ts`

```ts
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { applyMovement } from '@/features/warehouse/ledger';
import { isStorageConfigured } from '@/lib/storage/s3';
import { chuyenDuocQc, kiemLoQc, type DongLoiVao } from './qc-logic';
import { requirePerm } from '@/features/receiving/perm';

/**
 * QC ĐẠT → chiếc vào tồn. Đây là chỗ DUY NHẤT trong luồng này gọi `applyMovement`.
 *
 * Khoá dòng `FOR UPDATE` rồi ĐỌC LẠI trạng thái trong transaction: hai người cùng
 * bấm Đạt trên một chiếc thì người sau phải thấy `pass` và dừng, không nhập đôi tồn.
 */
export async function qcDat(itemId: string, kho: string): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requirePerm('manage_qc');
  try {
    await db.transaction(async (tx) => {
      const [it] = await tx.select().from(schema.goodsReceiptItems)
        .where(eq(schema.goodsReceiptItems.id, itemId)).for('update');
      if (!it) throw new Error('Không tìm thấy chiếc hàng.');
      if (!chuyenDuocQc(it.qcResult, 'pass')) throw new Error('Chiếc này đã QC rồi.');
      if (!it.sku) throw new Error('Chiếc này chưa có SKU, không nhập kho được.');

      await tx.update(schema.goodsReceiptItems).set({
        qcResult: 'pass', disposition: 'store', currentWarehouseCode: kho,
        qcCheckedBy: actor, qcCheckedAt: new Date(),
      }).where(eq(schema.goodsReceiptItems.id, itemId));

      await applyMovement(tx, {
        sku: it.sku, warehouseCode: kho, deltaOnHand: 1, deltaReserved: 0,
        reason: 'receipt_consignment', refType: 'receipt_item', refId: itemId,
        actor, createIfMissing: { productTitle: it.productTitle, variantTitle: it.variantTitle },
      });
    });
    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true };
  } catch (e) {
    console.error('[kho-nhan] qcDat lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'QC thất bại, thử lại.' };
  }
}

/**
 * QC KHÔNG ĐẠT → chiếc sang `return_to_brand`, ghi từng chỗ lỗi.
 * KHÔNG gọi `applyMovement`: hàng lỗi không bao giờ vào tồn.
 */
export async function qcKhongDat(itemId: string, dongLoi: DongLoiVao[]): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requirePerm('manage_qc');
  const kiem = kiemLoQc(dongLoi, isStorageConfigured());
  if (!kiem.ok) return { ok: false, loi: kiem.loi };
  try {
    await db.transaction(async (tx) => {
      const [it] = await tx.select().from(schema.goodsReceiptItems)
        .where(eq(schema.goodsReceiptItems.id, itemId)).for('update');
      if (!it) throw new Error('Không tìm thấy chiếc hàng.');
      if (!chuyenDuocQc(it.qcResult, 'fail')) throw new Error('Chiếc này đã QC rồi.');

      await tx.update(schema.goodsReceiptItems).set({
        qcResult: 'fail', disposition: 'return_to_brand',
        qcCheckedBy: actor, qcCheckedAt: new Date(),
      }).where(eq(schema.goodsReceiptItems.id, itemId));

      await tx.insert(schema.whLoiQc).values(dongLoi.map((d) => ({
        receiptItemId: itemId, lyDo: d.lyDo,
        anhKey: d.anhKey, ghiChu: d.ghiChu.trim() || null, taoBoi: actor,
      })));
    });
    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true };
  } catch (e) {
    console.error('[kho-nhan] qcKhongDat lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'Ghi lỗi thất bại, thử lại.' };
  }
}
```

- [ ] **Bước 6: Thêm truy vấn** `danhSachDangKiem` vào `features/kho-nhan/queries.ts`

```ts
/** Chiếc đang chờ kiểm — mới nhất trước. Chỉ `pending`. */
export async function danhSachDangKiem(): Promise<DangKiem[]> {
  await requirePerm('view_receiving');
  return db.select({
    id: schema.goodsReceiptItems.id,
    unitCode: schema.goodsReceiptItems.unitCode,
    sku: schema.goodsReceiptItems.sku,
    tenSanPham: schema.goodsReceiptItems.productTitle,
    tenBienThe: schema.goodsReceiptItems.variantTitle,
    orderId: schema.goodsReceiptItems.orderId,
    maDon: schema.shopifyOrders.shopifyOrderNumber,
    storeId: schema.shopifyOrders.storeId,
    shopifyOrderId: schema.shopifyOrders.shopifyOrderId,
    taoLuc: schema.goodsReceiptItems.createdAt,
  })
    .from(schema.goodsReceiptItems)
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .where(eq(schema.goodsReceiptItems.qcResult, 'pending'))
    .orderBy(desc(schema.goodsReceiptItems.createdAt))
    .limit(200);
}
```

- [ ] **Bước 7:** `npx tsc --noEmit && npx vitest run` — xanh.

- [ ] **Bước 8: Kiểm bất biến bằng script tạm** — trong một transaction rồi rollback: tạo chiếc `pending`, gọi `qcDat`, xác nhận đúng MỘT dòng `inventory_movements`; gọi `qcDat` lần hai, xác nhận bị từ chối "đã QC rồi" và KHÔNG có dòng movement thứ hai. Xoá script.

- [ ] **Bước 9: Commit** `feat(kho-nhan): QC đạt vào tồn, QC không đạt sang trả brand kèm từng chỗ lỗi`

---

### Task 7: Giao diện — search, danh sách đang kiểm, modal QC

**Files:**
- Create: `components/kho-nhan/ODdKiemHang.tsx`, `components/kho-nhan/BangDangKiem.tsx`, `components/kho-nhan/ModalQc.tsx`, `components/kho-nhan/KhoiLoi.tsx`
- Modify: `app/(dashboard)/f/warehouse/nhan-kcs/page.tsx`

**Interfaces:**
- Consumes: `timMonChuaNhan`, `ghiNhanChiec`, `danhSachDangKiem`, `layDuLieuQc`, `qcDat`, `qcKhongDat`, `NHAN_LY_DO`, `LY_DO_HOP_LE`.

- [ ] **Bước 1: Đọc tài liệu Next** — `node_modules/next/dist/docs/` phần server actions + `searchParams` (là Promise ở bản này). ĐỌC TRƯỚC KHI VIẾT.

- [ ] **Bước 2: Viết `ODdKiemHang.tsx`** — ô tìm, debounce 250ms, gọi `timMonChuaNhan`, mỗi kết quả hiện `mã đơn · SKU · tên + biến thể · brand · đã nhận x/y`, bấm → `ghiNhanChiec(lineId)`. Có `aria-label`, `cursor-pointer`, focus thấy được.

- [ ] **Bước 3: Viết `BangDangKiem.tsx`** — bảng chiếc `pending`: mã chiếc, SKU, tên, mã đơn, nhận lúc; bấm một dòng mở `ModalQc`.

- [ ] **Bước 4: Viết `ModalQc.tsx`** — modal toàn màn hình:
  - `DialogContent` **KHÔNG thêm `relative`** (đè mất `fixed` vì twMerge, D-107). Dùng `flex flex-col` nếu cần vùng cuộn riêng.
  - Trái: ảnh cao gần hết màn hình, nút `‹`/`›` và phím `←`/`→` đổi ảnh, `aria-label` rõ.
  - Phải: SKU/tên/màu/size rồi danh sách `thuocTinh`; dưới cùng ghi `còn N thuộc tính khác không hiển thị` khi `soBiCat > 0`.
  - Băng `dacDiemDon` với nhãn **"Đặc điểm của cả đơn"**.
  - Shopify trả `null` → vẫn mở, hiện "Không lấy được ảnh và thuộc tính từ Shopify", hai nút vẫn bấm được.
  - Hai nút: **Đạt** (chọn kho GVM/AP/DM rồi gọi `qcDat`) và **Không đạt** (mở `KhoiLoi`).

- [ ] **Bước 5: Viết `KhoiLoi.tsx`** — danh sách chỗ lỗi thêm/xoá được; mỗi dòng: chọn lý do từ `LY_DO_HOP_LE` (nhãn `NHAN_LY_DO`), ô ảnh (`capture="environment"` để điện thoại mở thẳng camera), ô ghi chú.

  **Tải ảnh:** mỗi ô ảnh gọi `uploadReceiptImage` SẴN CÓ (`features/receiving/actions.ts`) với `FormData` mang `file` và `scope = itemId`; hàm trả về khoá S3, đặt vào `anhKey` của dòng lỗi đó. **Không viết lại đường tải ảnh.**

  Nút Lưu gọi `qcKhongDat(itemId, dongLoi)`. Lỗi trả về hiện đúng chỗ lỗi nào sai (`kiemLoQc` đã ghi rõ "Chỗ lỗi 2: …").

  Chưa cấu hình kho ảnh → ô ảnh ẩn đi và hiện dòng "chưa cấu hình kho ảnh nên không đính được ảnh"; vẫn lưu được lỗi + lý do.

- [ ] **Bước 6: Nối vào** `page.tsx` — bỏ ô gõ mã đơn cũ, đặt `ODdKiemHang` trên cùng, `BangDangKiem` dưới.

- [ ] **Bước 7:** `npx tsc --noEmit && npx eslint components/kho-nhan features/kho-nhan && npx vitest run && npx next build` — tất cả xanh.

- [ ] **Bước 8: Soát lớp màu** — với MỌI lớp màu vừa viết, đếm mức dùng toàn repo:
  `grep -rho "\btext-muted-foreground\b" components app | wc -l`. **Lớp nào không file nào khác dùng thì là lớp đã hỏng** (D-107). Sửa trước khi commit.

- [ ] **Bước 9: Commit** `feat(kho-nhan): ô tìm món chờ nhận, danh sách đang kiểm, modal QC ảnh to + thuộc tính`

---

### Task 8: Biên bản trả brand

**Files:**
- Create: `features/kho-nhan/bien-ban.ts`
- Create: `app/(dashboard)/f/warehouse/nhan-kcs/bien-ban/page.tsx`
- Create: `components/kho-nhan/BienBan.tsx`

**Interfaces:**
- Consumes: `NHAN_LY_DO` (Task 1).
- Produces: `chiecChoTraBrand(brand, tuNgay, denNgay): Promise<ChiecLoi[]>`, `danhDauDaLapBienBan(itemIds, maBienBan)`.

- [ ] **Bước 1: Viết** `features/kho-nhan/bien-ban.ts`

```ts
'use server';

import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getSignedDownloadUrl, isStorageConfigured } from '@/lib/storage/s3';
import { requirePerm } from '@/features/receiving/perm';

export interface ChiecLoi {
  itemId: string; unitCode: string; sku: string | null;
  tenSanPham: string | null; tenBienThe: string | null; maDon: string | null;
  loi: { lyDo: string; ghiChu: string | null; anhUrl: string | null }[];
}

/**
 * Chiếc QC không đạt, chờ trả brand, CHƯA nằm trong biên bản nào.
 * `vendor_return_doc_key` (cột đã có sẵn) là cờ đã lập biên bản — lọc `IS NULL`
 * để không lập trùng.
 */
export async function chiecChoTraBrand(brand: string, tuNgay: Date, denNgay: Date): Promise<ChiecLoi[]> {
  await requirePerm('view_receiving');
  const rows = await db.select({
    itemId: schema.goodsReceiptItems.id,
    unitCode: schema.goodsReceiptItems.unitCode,
    sku: schema.goodsReceiptItems.sku,
    tenSanPham: schema.goodsReceiptItems.productTitle,
    tenBienThe: schema.goodsReceiptItems.variantTitle,
    maDon: schema.shopifyOrders.shopifyOrderNumber,
  })
    .from(schema.goodsReceiptItems)
    .innerJoin(schema.goodsReceipts, eq(schema.goodsReceipts.id, schema.goodsReceiptItems.receiptId))
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .where(and(
      eq(schema.goodsReceiptItems.qcResult, 'fail'),
      eq(schema.goodsReceiptItems.disposition, 'return_to_brand'),
      isNull(schema.goodsReceiptItems.vendorReturnDocKey),
      eq(schema.goodsReceipts.vendor, brand),
      gte(schema.goodsReceiptItems.qcCheckedAt, tuNgay),
      lte(schema.goodsReceiptItems.qcCheckedAt, denNgay),
    ));

  return Promise.all(rows.map(async (r) => {
    const loi = await db.select().from(schema.whLoiQc)
      .where(eq(schema.whLoiQc.receiptItemId, r.itemId));
    return {
      ...r,
      loi: await Promise.all(loi.map(async (l) => ({
        lyDo: l.lyDo,
        ghiChu: l.ghiChu,
        anhUrl: l.anhKey && isStorageConfigured() ? await getSignedDownloadUrl(l.anhKey, 3600) : null,
      }))),
    };
  }));
}

/** Đánh dấu đã lập biên bản để lần sau không lấy lại những chiếc này. */
export async function danhDauDaLapBienBan(itemIds: string[], maBienBan: string): Promise<void> {
  await requirePerm('manage_qc');
  if (itemIds.length === 0) return;
  for (const id of itemIds) {
    await db.update(schema.goodsReceiptItems)
      .set({ vendorReturnDocKey: maBienBan })
      .where(and(eq(schema.goodsReceiptItems.id, id),
                 isNull(schema.goodsReceiptItems.vendorReturnDocKey)));
  }
}
```

- [ ] **Bước 2: Viết** `components/kho-nhan/BienBan.tsx` — chọn brand + khoảng ngày, hiện danh sách, nút **In**. Bản in dùng `window.print()` + CSS `@media print` (cùng cách màn in tem đang làm, **không thêm thư viện PDF**). Mỗi chiếc một khối: mã chiếc, SKU, tên + biến thể, mã đơn, từng chỗ lỗi (nhãn tiếng Việt từ `NHAN_LY_DO` + ghi chú) kèm ảnh.

- [ ] **Bước 3: Viết** `page.tsx` — gác quyền như `nhan-kcs/page.tsx`, `searchParams` là Promise.

- [ ] **Bước 4:** `npx tsc --noEmit && npx eslint && npx vitest run && npx next build` — xanh.

- [ ] **Bước 5: Commit** `feat(kho-nhan): biên bản trả brand — gom chiếc lỗi theo brand, in được`

---

## Kiểm tra cuối cùng trước khi báo xong

- [ ] `npx tsc --noEmit` sạch
- [ ] `npx eslint components/kho-nhan features/kho-nhan` — 0 lỗi 0 cảnh báo
- [ ] `npx vitest run` — toàn bộ xanh, không giảm so với 3.561
- [ ] `npx next build` xanh
- [ ] **Bất biến đắt nhất**: chiếc `qc_result='pending'` KHÔNG xuất hiện trong truy vấn phân bổ. Chứng minh bằng script chạy trên dữ liệu thật rồi xoá script.
- [ ] `WH_GHI_LARK` vẫn `dry`; `day-nhan-kcs-lark` vẫn trong nhóm `chua-bat`
- [ ] `/f/warehouse/receiving` vẫn chạy, chưa xoá gì
