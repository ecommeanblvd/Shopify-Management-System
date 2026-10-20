# Nhật ký thay đổi — kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi bảng vận hành có nhật ký mức từng ô — ai sửa trường nào, từ giá trị gì sang giá trị gì — xem được ở tab "Lịch sử" của từng bản ghi và ở một trang nhật ký riêng.

**Architecture:** Trigger Postgres `AFTER INSERT/UPDATE/DELETE` so `OLD` với `NEW` và ghi một dòng cho mỗi cột đổi vào `nhat_ky_thay_doi`. Trigger đọc danh tính người thao tác từ `current_setting('app.tac_nhan_id')`, do hàm bọc `ghiVoi()` đặt bằng `SET LOCAL` trong giao dịch. SQL của trigger **sinh ra từ TypeScript thuần đã có test**, vì `vitest` không chạm được SQL.

**Tech Stack:** Next.js 16.2.6, React 19.2.4, Drizzle ORM + Postgres (Supabase), Tailwind 4.3.3, vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-20-nhat-ky-thay-doi-design.md`

## Global Constraints

- Di trú **áp dụng TAY** vào production: viết tệp `NNNN_*.sql` dùng `IF NOT EXISTS`, chạy thẳng vào CSDL, **kiểm `information_schema`**, rồi mới push mã đọc tới thứ vừa thêm. `npm run db:migrate` in ra thành công nhưng KHÔNG làm gì (xem `db/migrations/README.md`).
- `vitest` chỉ bắt `lib|features|components/**/*.test.ts` — **không bắt `.tsx`**; môi trường `node`, không jsdom. Mọi logic cần test phải nằm ở tệp `.ts` thuần.
- Hook `pre-push` chạy `tsc` + `eslint` + toàn bộ suite; không push khi đỏ.
- Chỉ **một** CSDL và nó là production. Mọi lệnh DDL phải có lệnh gỡ viết sẵn và đã thử.
- Đợt này **chỉ bật trigger trên `goods_receipt_items`**. Chín bảng còn lại ở §5 của spec chờ sau 7 ngày đo.
- Tên hàm, biến, bảng, cột đặt **tiếng Việt không dấu** theo nếp repo (`nhat_ky_thay_doi`, `ghiVoi`, `tacNhan`).
- Mã viết cho hai người đọc: người sửa nó sáu tháng sau, và người đang tìm lỗi lúc 2 giờ sáng. Chú thích nói **vì sao**, không nói lại cái mã đã nói.

## Review Focus

Năm ca spec hàm ý mà không task nào tự nhiên chạm tới — mỗi dòng đã được gắn test vào task sở hữu nó:

1. **Danh tính rò giữa hai request.** Pool tái dùng kết nối; nếu dùng `set_config(..., false)` thay `SET LOCAL`, người của request trước bị gán cho request sau. → Task 4.
2. **Cột chưa khai độ nhạy.** Thêm cột mới vào bảng mà quên khai ⇒ phải **che**, không được lộ. → Task 5.
3. **Giá trị `NULL` và chuỗi rỗng.** `NULL → ''` là một thay đổi thật và phải ra một dòng; `'' → ''` thì không. → Task 1.
4. **Cột loại trừ đổi một mình.** `UPDATE` chỉ chạm `updated_at` ⇒ **không** sinh dòng nào, nếu không cron sẽ chôn vùi thao tác người. → Task 2.
5. **Thao tác không có tên người.** Cron/script ghi mà không bọc ⇒ hiện `Chưa gắn danh tính`, **không** để trống và không đoán. → Task 4.

---

### Task 1: Cấu hình cột theo dõi (thuần)

**Files:**
- Create: `features/nhat-ky/cot-theo-doi.ts`
- Test: `features/nhat-ky/cot-theo-doi.test.ts`

**Interfaces:**
- Produces: `type CheDoCot = 'tru' | 'cho-phep'`; `interface CauHinhBang { bang: string; cheDo: CheDoCot; cot: readonly string[]; cotCha?: string; bangCha?: string }`; `CAU_HINH: readonly CauHinhBang[]`; `cotDuocGhi(ch: CauHinhBang, moiCot: readonly string[]): string[]`; `laThayDoi(truoc: string | null, sau: string | null): boolean`

- [ ] **Step 1: Viết test thất bại**

```ts
it('chế độ "trừ" ghi mọi cột trừ danh sách loại trừ', () => {
  const ch = { bang: 'goods_receipt_items', cheDo: 'tru' as const, cot: ['updated_at', 'created_at'] };
  expect(cotDuocGhi(ch, ['id', 'qc_result', 'updated_at'])).toEqual(['id', 'qc_result']);
});

it('chế độ "cho-phép" chỉ ghi cột trong danh sách, cột lạ bị bỏ', () => {
  const ch = { bang: 'shopify_orders', cheDo: 'cho-phep' as const, cot: ['selected_carrier_key'] };
  expect(cotDuocGhi(ch, ['id', 'raw_payload', 'selected_carrier_key'])).toEqual(['selected_carrier_key']);
});

it('cho-phép KHÔNG kéo theo cột lạ dù tên giống khuôn', () => {
  const ch = { bang: 'shopify_orders', cheDo: 'cho-phep' as const, cot: ['cost_override'] };
  expect(cotDuocGhi(ch, ['cost_override_2', 'cost_override'])).toEqual(['cost_override']);
});

// Review Focus #3
it('NULL sang chuỗi rỗng LÀ thay đổi', () => { expect(laThayDoi(null, '')).toBe(true); });
it('chuỗi rỗng sang NULL LÀ thay đổi', () => { expect(laThayDoi('', null)).toBe(true); });
it('hai giá trị giống nhau KHÔNG phải thay đổi', () => { expect(laThayDoi('pass', 'pass')).toBe(false); });
it('hai NULL KHÔNG phải thay đổi', () => { expect(laThayDoi(null, null)).toBe(false); });

it('CAU_HINH có goods_receipt_items, nối lên lô qua receipt_id', () => {
  const ch = CAU_HINH.find((x) => x.bang === 'goods_receipt_items');
  expect(ch?.cotCha).toBe('receipt_id');
  expect(ch?.bangCha).toBe('goods_receipts');
});

it('mọi bảng trong CAU_HINH loại trừ updated_at và created_at', () => {
  for (const ch of CAU_HINH.filter((x) => x.cheDo === 'tru')) {
    expect(ch.cot).toContain('updated_at');
    expect(ch.cot).toContain('created_at');
  }
});

it('shopify_orders dùng cho-phép và KHÔNG có raw_payload', () => {
  const ch = CAU_HINH.find((x) => x.bang === 'shopify_orders');
  expect(ch?.cheDo).toBe('cho-phep');
  expect(ch?.cot).not.toContain('raw_payload');
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ** — `npx vitest run features/nhat-ky/cot-theo-doi.test.ts`. Chờ: FAIL, không tìm thấy module.

- [ ] **Step 3: Viết `features/nhat-ky/cot-theo-doi.ts`**

Khai `CAU_HINH` cho đủ 10 bảng ở §5 của spec. Tám bảng người sửa là chính (`shipments`, `goods_receipts`, `goods_receipt_items`, `warehouse_inventory`, `inventory_movements`, `order_fulfillment`, `order_fulfillment_lines`, `ship_ho_orders`) dùng `cheDo: 'tru'` với danh sách loại trừ `updated_at`, `created_at`, `last_tracked_at`, `lark_synced_at`, `delivery_status`, `track_detail`. Hai bảng máy ghi là chính (`shopify_orders`, `shopify_order_lines`) dùng `cheDo: 'cho-phep'`.

Đọc `db/schema.ts` để lấy **tên cột thật** cho danh sách `cho-phep` — chỉ những cột người sửa được qua giao diện. `raw_payload` tuyệt đối không có trong danh sách.

`cotCha`/`bangCha` khai cho các bảng con: `goods_receipt_items` → `receipt_id`/`goods_receipts`, `shopify_order_lines` → `order_id`/`shopify_orders`, `order_fulfillment_lines` → `fulfillment_id`/`order_fulfillment`.

- [ ] **Step 4: Chạy test, xác nhận XANH**

- [ ] **Step 5: Commit** — `feat(nhật ký): khai cột được theo dõi cho 10 bảng vận hành`

---

### Task 2: Sinh SQL trigger từ cấu hình (thuần)

**Files:**
- Create: `features/nhat-ky/sinh-trigger.ts`
- Test: `features/nhat-ky/sinh-trigger.test.ts`

**Interfaces:**
- Consumes: `CauHinhBang`, `CAU_HINH` từ Task 1.
- Produces: `sinhTrigger(ch: CauHinhBang, moiCot: readonly string[]): string`; `sinhGoTrigger(bang: string): string`

Trigger dùng **một hàm chung** `nhat_ky_ghi()` (tạo ở Task 3); mỗi bảng chỉ khác ở `TG_ARGV`. `sinhTrigger` sinh câu `CREATE TRIGGER` truyền ba đối số: danh sách cột (phân tách bằng dấu phẩy), `cotCha`, `bangCha`.

- [ ] **Step 1: Viết test thất bại**

```ts
it('sinh CREATE TRIGGER truyền danh sách cột làm đối số', () => {
  const sql = sinhTrigger({ bang: 'goods_receipt_items', cheDo: 'tru', cot: ['updated_at'], cotCha: 'receipt_id', bangCha: 'goods_receipts' },
    ['id', 'qc_result', 'updated_at']);
  expect(sql).toContain('CREATE TRIGGER nhat_ky_goods_receipt_items');
  expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON goods_receipt_items');
  expect(sql).toContain('FOR EACH ROW EXECUTE FUNCTION nhat_ky_ghi(');
  expect(sql).toContain("'id,qc_result'");
  expect(sql).toContain("'receipt_id'");
  expect(sql).toContain("'goods_receipts'");
  expect(sql).not.toContain('updated_at');
});

it('bảng không có cha truyền chuỗi rỗng cho hai đối số cuối', () => {
  const sql = sinhTrigger({ bang: 'shipments', cheDo: 'tru', cot: [] }, ['id', 'tracking_number']);
  expect(sql).toContain("'id,tracking_number', '', ''");
});

it('sinh lệnh gỡ dùng IF EXISTS để chạy lại không hỏng', () => {
  expect(sinhGoTrigger('shipments')).toBe('DROP TRIGGER IF EXISTS nhat_ky_shipments ON shipments;');
});

// Review Focus #4 — ghim ở tầng sinh SQL: cột loại trừ không bao giờ vào đối số,
// nên trigger không có cách nào sinh dòng cho nó.
it('cột loại trừ KHÔNG lọt vào đối số trigger', () => {
  const sql = sinhTrigger({ bang: 'shipments', cheDo: 'tru', cot: ['updated_at', 'last_tracked_at'] },
    ['id', 'tracking_number', 'updated_at', 'last_tracked_at']);
  expect(sql).toContain("'id,tracking_number'");
});

it('tên bảng lạ bị từ chối, không nối thẳng vào SQL', () => {
  expect(() => sinhTrigger({ bang: 'x"; DROP TABLE y; --', cheDo: 'tru', cot: [] }, ['id'])).toThrow();
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

- [ ] **Step 3: Viết `features/nhat-ky/sinh-trigger.ts`**

Chặn tên bảng/cột không khớp `/^[a-z_][a-z0-9_]*$/` bằng `throw` — hàm này sinh SQL chạy thẳng vào CSDL, nên tên không hợp lệ phải chết tại đây chứ không đi tiếp.

- [ ] **Step 4: Chạy test, xác nhận XANH**

- [ ] **Step 5: Commit** — `feat(nhật ký): sinh SQL trigger từ cấu hình đã có test`

---

### Task 3: Bảng nhật ký + hàm trigger, áp tay lên CSDL

**Files:**
- Create: `db/migrations/0210_nhat-ky-thay-doi.sql`
- Create: `scripts/nhat-ky-bat-tat.ts`
- Modify: `db/schema.ts` (thêm `nhatKyThayDoi`)

**Interfaces:**
- Consumes: `sinhTrigger`, `sinhGoTrigger` từ Task 2.
- Produces: bảng `nhat_ky_thay_doi`; hàm `nhat_ky_ghi()`; `schema.nhatKyThayDoi`.

Cột bảng theo §3 của spec: `id uuid pk`, `bang text`, `ban_ghi_id text`, `cha_bang text`, `cha_id text`, `thao_tac text`, `truong text`, `truoc text`, `sau text`, `tac_nhan_id text`, `tac_nhan_nhan text`, `luc timestamptz default now()`.

Chỉ mục: `(bang, ban_ghi_id, luc desc)` cho tab Lịch sử; `(cha_bang, cha_id, luc desc)` cho cuốn dòng con; `(bang, luc desc)` cho trang nhật ký.

Hàm `nhat_ky_ghi()` đọc `TG_ARGV[0]` (danh sách cột), `TG_ARGV[1]` (cột cha), `TG_ARGV[2]` (bảng cha); lấy danh tính từ `current_setting('app.tac_nhan_id', true)` và `current_setting('app.tac_nhan_nhan', true)`. `INSERT` ghi `sau` cho từng cột, `UPDATE` chỉ ghi cột có `truoc IS DISTINCT FROM sau`, `DELETE` ghi `truoc`.

- [ ] **Step 1: Viết tệp di trú** với `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`. **Chưa** tạo trigger nào trong tệp này — trigger bật riêng ở Step 5 để gỡ được độc lập.

- [ ] **Step 2: Viết `scripts/nhat-ky-bat-tat.ts`**

`--bang=<tên>` bật trigger cho một bảng (đọc cột thật từ `information_schema.columns`, gọi `sinhTrigger`), `--tat` gỡ. **Chạy thử là mặc định**, `--ap-dung` mới ghi. In ra SQL sẽ chạy trước khi chạy.

- [ ] **Step 3: Áp tệp di trú thẳng vào CSDL**

```bash
railway run --service Shopify-Management-System psql "$DATABASE_URL" -f db/migrations/0210_nhat-ky-thay-doi.sql
```

- [ ] **Step 4: Kiểm `information_schema` rằng bảng, 3 chỉ mục và hàm đã có thật.** Không kiểm là không biết.

- [ ] **Step 5: Thử LỆNH GỠ TRƯỚC khi bật thật**

Bật trigger trên `goods_receipt_items`, rồi thử **cả ba thao tác** trong một giao dịch rồi
`ROLLBACK`: `INSERT` (phải ra một dòng mỗi cột có giá trị), `UPDATE` một cột (ra **đúng một**
dòng), `UPDATE` chỉ chạm `updated_at` (ra **không** dòng nào), `DELETE` (ra một dòng mỗi cột,
cột `truoc` có giá trị).

Rồi chạy `--tat`, xác nhận trigger biến mất và lệnh `UPDATE` vẫn chạy bình thường. Rồi bật lại.
**Đường lui phải thử xong mới được để trigger sống trên production.**

- [ ] **Step 6: Thêm `nhatKyThayDoi` vào `db/schema.ts`**, chạy `npx tsc --noEmit`.

- [ ] **Step 7: Viết `scripts/nhat-ky-don-cu.ts`**

Xoá dòng `luc < now() - interval '12 months'` theo lô, **chạy thử là mặc định**, `--ap-dung` mới
xoá. Spec §8 chốt giữ 12 tháng; viết luôn bây giờ vì trong một năm nữa sẽ không ai nhớ ra, và
lúc nhớ ra thì bảng đã quá lớn để dọn trong một lượt. Chưa cần đặt lịch cron — nêu trong phần
bàn giao để CEO quyết sau khi có số đo ở Task 9.

- [ ] **Step 8: Commit** — `feat(nhật ký): bảng, hàm trigger, công cụ bật/tắt và dọn dòng cũ`

---

### Task 4: Danh tính người thao tác

**Files:**
- Create: `features/nhat-ky/tac-nhan.ts`
- Create: `features/nhat-ky/tac-nhan.test.ts`
- Create: `features/nhat-ky/ghi-voi.ts`
- Modify: `features/kho-nhan/qc-actions.ts`, `features/kho-nhan/nhan-actions.ts`, `features/dong-hang/actions.ts:609` (`luuTrackingChoKien`)

**Interfaces:**
- Produces: `type TacNhan = { kieu: 'nguoi'; userId: string } | { kieu: 'may'; nhan: string }`; `nhanTacNhan(t: TacNhan): string`; `ghiVoi<R>(t: TacNhan, fn: (tx: Tx) => Promise<R>): Promise<R>`; hằng `MAY = { DONG_BO_LARK, LARK_BAN_VE, CRON, SCRIPT, NHAP_FILE }`.

- [ ] **Step 1: Viết test thất bại**

```ts
it('người thì nhãn rỗng — màn hình tự tra tên theo userId', () => {
  expect(nhanTacNhan({ kieu: 'nguoi', userId: 'u1' })).toBe('');
});

it('máy thì nhãn là chính chuỗi đã khai', () => {
  expect(nhanTacNhan({ kieu: 'may', nhan: MAY.DONG_BO_LARK })).toBe('Đồng bộ Lark');
});

it('nhãn máy KHÔNG được trùng nhau giữa các nguồn', () => {
  const ds = Object.values(MAY);
  expect(new Set(ds).size).toBe(ds.length);
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

- [ ] **Step 3: Viết `tac-nhan.ts` và `ghi-voi.ts`**

`ghiVoi` mở `db.transaction`, chạy `SET LOCAL app.tac_nhan_id` và `SET LOCAL app.tac_nhan_nhan` **bằng tham số** (`set_config($1,$2,true)`, không nối chuỗi), rồi chạy `fn(tx)`.

Chú thích bắt buộc ngay tại chỗ, vì đây là bẫy dễ "sửa cho gọn" nhất:

> **KHÔNG** dùng `set_config(..., false)` (mức phiên). `db/client.ts` dùng một `Pool`; kết nối được tái dùng, nên danh tính của request trước sẽ rò sang request sau — **gán sai người tệ hơn không gán ai**. `SET LOCAL` chết theo giao dịch, đó là lý do mọi lệnh ghi cần gắn danh tính phải nằm trong giao dịch.

- [ ] **Step 4: Chạy test, xác nhận XANH**

- [ ] **Step 5: Bọc ba luồng CEO nêu đích danh**

QC nhập kho, nhập kho, và `luuTrackingChoKien`. Chỉ ba luồng này; phần còn lại là nợ có số đo (Task 7 hiện con số đó).

- [ ] **Step 5b: Gắn nhãn cho các nguồn MÁY đang ghi vào 10 bảng trong phạm vi**

`features/lark/sync.ts` → `MAY.DONG_BO_LARK`; webhook `nhan-mot-dong.ts` → `patch-kien.ts` →
`MAY.LARK_BAN_VE`; `features/shipments/import-actions.ts` → `MAY.NHAP_FILE`.

Không bỏ bước này: spec §4 chốt thay đổi từ máy phải hiện **đúng nhãn của nó**, và CEO chọn
*"Ghi rõ 'Đồng bộ Lark' luôn, cần thấy hết"*. Bỏ qua thì mọi thay đổi từ Lark rơi vào
`Chưa gắn danh tính` — lẫn với lỗi quên bọc, không phân biệt được nữa.

- [ ] **Step 6: Kiểm bằng tay trên CSDL — Review Focus #1 và #5**

Gọi hai action khác nhau bởi hai người khác nhau liên tiếp, xác nhận hai dòng nhật ký mang **đúng hai `tac_nhan_id` khác nhau**. Rồi chạy một `UPDATE` trần ngoài `ghiVoi`, xác nhận dòng nhật ký có `tac_nhan_id` NULL và `tac_nhan_nhan` NULL (màn hình sẽ hiện `Chưa gắn danh tính` ở Task 7).

- [ ] **Step 7: Commit** — `feat(nhật ký): gắn danh tính người thao tác qua SET LOCAL trong giao dịch`

---

### Task 5: Che giá trị nhạy cảm + nhãn cột tiếng Việt

**Files:**
- Create: `features/nhat-ky/che-gia-tri.ts`
- Create: `features/nhat-ky/che-gia-tri.test.ts`
- Create: `features/nhat-ky/nhan-cot.ts`

**Interfaces:**
- Produces: `DO_NHAY: Record<string, Record<string, Permission>>`; `cheNeuCan(bang: string, cot: string, giaTri: string | null, quyen: readonly Permission[]): { gia: string | null; biChe: boolean }`; `nhanCot(bang: string, cot: string): string`
- Consumes: `Permission` từ `@/lib/auth/rbac`.

- [ ] **Step 1: Viết test thất bại**

```ts
it('cột nhạy cảm bị che khi thiếu quyền, và NÓI RÕ là bị che', () => {
  const r = cheNeuCan('shopify_orders', 'cost_override', '120000', []);
  expect(r).toEqual({ gia: null, biChe: true });
});

it('cột nhạy cảm hiện đủ khi có quyền', () => {
  expect(cheNeuCan('shopify_orders', 'cost_override', '120000', ['view_cogs']))
    .toEqual({ gia: '120000', biChe: false });
});

it('cột không nhạy cảm ai cũng xem được', () => {
  expect(cheNeuCan('goods_receipt_items', 'qc_result', 'pass', []))
    .toEqual({ gia: 'pass', biChe: false });
});

// Review Focus #2 — mặc định AN TOÀN, không mặc định lộ.
it('cột CHƯA khai độ nhạy thì bị CHE, không phải hiện', () => {
  const r = cheNeuCan('shopify_orders', 'cot_moi_chua_ai_khai', 'x', []);
  expect(r.biChe).toBe(true);
});

it('cột chưa khai vẫn che kể cả khi người dùng có nhiều quyền', () => {
  expect(cheNeuCan('shopify_orders', 'cot_moi_chua_ai_khai', 'x', ['view_cogs', 'view_orders']).biChe).toBe(true);
});

it('nhãn cột là tiếng Việt người dùng đang thấy trên màn hình', () => {
  expect(nhanCot('goods_receipt_items', 'qc_result')).toBe('Kết quả QC');
});

it('cột chưa có nhãn thì hiện TÊN CỘT, không để trống', () => {
  expect(nhanCot('goods_receipt_items', 'cot_la')).toBe('cot_la');
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

- [ ] **Step 3: Viết hai tệp**

`DO_NHAY` khai theo bảng → cột → quyền cần có. Luật mặc định: **bảng có mặt trong `DO_NHAY` thì cột chưa khai bị che**; bảng không có mặt (vd `goods_receipt_items`) thì mọi cột mở. Khai `shopify_orders`, `shopify_order_lines`, `ship_ho_orders` vào `DO_NHAY`.

Nhãn lấy từ nhãn **đang hiện trên màn hình** của module tương ứng, không tự đặt tên mới.

- [ ] **Step 4: Chạy test, xác nhận XANH**

- [ ] **Step 5: Commit** — `feat(nhật ký): che giá trị nhạy cảm theo quyền, mặc định che khi chưa khai`

---

### Task 6: Gom dòng + truy vấn

**Files:**
- Create: `features/nhat-ky/gom-dong.ts`
- Create: `features/nhat-ky/gom-dong.test.ts`
- Create: `features/nhat-ky/queries.ts`

**Interfaces:**
- Consumes: `cheNeuCan`, `nhanCot` (Task 5); `schema.nhatKyThayDoi` (Task 3).
- Produces: `interface DongNhatKy { truong: string; nhan: string; truoc: string | null; sau: string | null; biChe: boolean }`; `interface KhoiNhatKy { luc: Date; tacNhanId: string | null; tacNhanNhan: string; banGhiId: string; dong: DongNhatKy[] }`; `interface DongTho { bang: string; banGhiId: string; truong: string; truoc: string | null; sau: string | null; tacNhanId: string | null; tacNhanNhan: string | null; luc: Date }`; `gomKhoi(rows: readonly DongTho[], quyen: readonly Permission[]): KhoiNhatKy[]`; `nhatKyCuaBanGhi(bang, banGhiId, quyen)`; `nhatKyCuaBang(bang, loc, quyen)`; `demChuaGanDanhTinh(): Promise<Array<{ bang: string; soDong: number }>>`

- [ ] **Step 1: Viết test thất bại cho `gomKhoi`**

```ts
it('thay đổi cùng người, cùng lúc, cùng bản ghi gom thành MỘT khối', () => {
  const k = gomKhoi([
    { bang: 'goods_receipt_items', banGhiId: 'r1', truong: 'qc_result', truoc: 'pending', sau: 'pass', tacNhanId: 'u1', tacNhanNhan: null, luc: new Date('2026-10-20T03:00:00Z') },
    { bang: 'goods_receipt_items', banGhiId: 'r1', truong: 'qc_checked_by', truoc: null, sau: 'u1', tacNhanId: 'u1', tacNhanNhan: null, luc: new Date('2026-10-20T03:00:00Z') },
  ], []);
  expect(k).toHaveLength(1);
  expect(k[0].dong).toHaveLength(2);
});

it('cùng lúc nhưng KHÁC người thì KHÔNG gom', () => {
  const k = gomKhoi([
    { bang: 'g', banGhiId: 'r1', truong: 'a', truoc: null, sau: '1', tacNhanId: 'u1', tacNhanNhan: null, luc: new Date('2026-10-20T03:00:00Z') },
    { bang: 'g', banGhiId: 'r1', truong: 'b', truoc: null, sau: '2', tacNhanId: 'u2', tacNhanNhan: null, luc: new Date('2026-10-20T03:00:00Z') },
  ], []);
  expect(k).toHaveLength(2);
});

it('không có danh tính thì nhãn là "Chưa gắn danh tính", KHÔNG để trống', () => {
  const k = gomKhoi([{ bang: 'g', banGhiId: 'r1', truong: 'a', truoc: null, sau: '1', tacNhanId: null, tacNhanNhan: null, luc: new Date() }], []);
  expect(k[0].tacNhanNhan).toBe('Chưa gắn danh tính');
});

it('tác nhân máy giữ nguyên nhãn của nó', () => {
  const k = gomKhoi([{ bang: 'g', banGhiId: 'r1', truong: 'a', truoc: null, sau: '1', tacNhanId: null, tacNhanNhan: 'Đồng bộ Lark', luc: new Date() }], []);
  expect(k[0].tacNhanNhan).toBe('Đồng bộ Lark');
});

it('khối mới nhất đứng trước', () => {
  const k = gomKhoi([
    { bang: 'g', banGhiId: 'r1', truong: 'a', truoc: null, sau: '1', tacNhanId: 'u1', tacNhanNhan: null, luc: new Date('2026-10-19T00:00:00Z') },
    { bang: 'g', banGhiId: 'r1', truong: 'b', truoc: null, sau: '2', tacNhanId: 'u1', tacNhanNhan: null, luc: new Date('2026-10-20T00:00:00Z') },
  ], []);
  expect(k[0].luc.toISOString()).toBe('2026-10-20T00:00:00.000Z');
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

- [ ] **Step 3: Viết `gom-dong.ts` rồi `queries.ts`**

`nhatKyCuaBanGhi` lấy cả dòng của **chính bản ghi** (`bang` + `ban_ghi_id`) và dòng của **dòng con** (`cha_bang` + `cha_id`) rồi gom chung — xem §6 của spec. `queries.ts` gọi `requirePerm('view_nhat_ky')` và truyền quyền của người đang xem vào `gomKhoi`.

- [ ] **Step 4: Chạy test, xác nhận XANH**

- [ ] **Step 5: Commit** — `feat(nhật ký): gom khối theo người-lúc-bản ghi, truy vấn cuốn cả dòng con`

---

### Task 7: Hai màn hình + quyền + điều hướng

**Files:**
- Create: `components/nhat-ky/BangNhatKy.tsx`
- Create: `components/nhat-ky/TabLichSu.tsx`
- Create: `app/(dashboard)/f/nhat-ky/page.tsx`
- Modify: `lib/auth/rbac.ts` (thêm `view_nhat_ky`), `lib/auth/permission-map.ts`, `lib/nav.ts`
- Modify: màn chi tiết lô nhập kho — gắn tab "Lịch sử"

**Interfaces:**
- Consumes: `KhoiNhatKy`, `nhatKyCuaBanGhi`, `nhatKyCuaBang`, `demChuaGanDanhTinh` (Task 6).

- [ ] **Step 1: Thêm quyền `view_nhat_ky` vào `Permission`, map sang `['nhat_ky:view']`, gán cho MỌI vai trò đang có** (CEO chốt: mọi nhân sự xem được). Chạy `npx vitest run lib/auth` — các test phân quyền đang có phải vẫn xanh.

- [ ] **Step 2: Viết `BangNhatKy.tsx`** — cột `Ngày · Người dùng · Trường · Trước → Sau`, một khối một nhóm. `NULL` hiện `–`; ô bị che hiện `•••` kèm chữ nói rõ bị che vì quyền (**không ẩn im lặng**); giá trị dạng chọn hiện chip màu. Bố cục theo ảnh Lark CEO đưa trong spec §1.

- [ ] **Step 3: Viết `TabLichSu.tsx`** dùng `BangNhatKy`, nhận `bang` + `banGhiId`.

- [ ] **Step 4: Viết trang `/f/nhat-ky`** — lọc theo bảng, người, trường, khoảng ngày. Hiện số dòng `Chưa gắn danh tính` theo bảng từ `demChuaGanDanhTinh()` để món nợ ở Task 4 luôn nhìn thấy được.

- [ ] **Step 5: Gắn tab "Lịch sử" vào màn chi tiết lô nhập kho** và thêm mục nav.

- [ ] **Step 6: Soát bằng trình duyệt** — mở preview, sửa một ô QC, xác nhận dòng mới hiện đúng tên người, tên trường tiếng Việt, giá trị trước/sau. Chụp màn gửi CEO. Không nhờ người khác kiểm hộ.

- [ ] **Step 7: Commit** — `feat(nhật ký): tab Lịch sử trên bản ghi và trang nhật ký cả bảng`

---

### Task 8: Bỏ kiểu xoá-rồi-chèn-lại của đồng bộ đơn

**Files:**
- Modify: `features/shopify-orders/sync/upsert-order.ts:116`

Bắt buộc **trước** khi bật trigger cho `shopify_order_lines`. Hiện mỗi lượt đồng bộ một đơn xoá sạch rồi chèn lại toàn bộ dòng hàng; với trigger thì mỗi lượt sinh N dòng `xoa` + N dòng `them` nội dung y hệt nhau — nhiễu tới mức không ai mở, và chiếm phần lớn khối lượng.

- [ ] **Step 1: Viết test thất bại** — đồng bộ lại một đơn **không đổi gì** thì số dòng hàng không đổi và không dòng nào bị xoá/chèn lại.
- [ ] **Step 2: Chạy test, xác nhận ĐỎ**
- [ ] **Step 3: Đổi sang `INSERT ... ON CONFLICT DO UPDATE`** + xoá đúng dòng không còn trong payload.
- [ ] **Step 4: Chạy test, xác nhận XANH**
- [ ] **Step 5: Commit** — `fix(đồng bộ đơn): upsert dòng hàng thay vì xoá sạch rồi chèn lại`

---

### Task 9: Công cụ đo và cửa sổ 7 ngày

**Files:**
- Create: `scripts/nhat-ky-do-tai.ts`

- [ ] **Step 1: Viết `scripts/nhat-ky-do-tai.ts`** — in ba con số spec §8 đòi: số dòng nhật ký mỗi ngày, tỉ lệ dòng do người so với do máy, và thời gian ghi trung bình của bảng đang bật.
- [ ] **Step 2: Chạy lấy mốc nền TRƯỚC khi bật** (nếu Task 3 đã bật thì tắt, đo, bật lại).
- [ ] **Step 3: Commit** — `feat(nhật ký): công cụ đo tải trước khi mở rộng`
- [ ] **Step 4: Chờ 7 ngày rồi chạy lại.** Ngưỡng dừng: thời gian ghi tăng quá **20%**, hoặc hơn **200.000 dòng/ngày** trên riêng bảng đó. Chạm ngưỡng thì **không mở rộng** — cắt theo thứ tự §8 rồi đo lại.
- [ ] **Step 5: Báo CEO ba con số và đề xuất mở rộng hay không.**

---

## Ngoài phạm vi đợt này

- Bật trigger cho 9 bảng còn lại — chờ kết quả Task 9.
- Dựng lại lịch sử quá khứ: **không làm được**, CSDL không giữ vết cũ.
- Nút hoàn tác từ nhật ký.
- Bọc danh tính cho ~167 chỗ ghi còn lại.
