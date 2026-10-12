# Nhập tracking → giá ước tính → ghi ngược Lark — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhân sự dán mã vận đơn vào kiện trong hệ thống; hệ thống lấy giá ước tính của chính kiện đó rồi ghi mã vận đơn + khối ô chi phí lên dòng Lark, chỉ điền ô trống.

**Architecture:** Bốn module thuần (bóc mã vận đơn · chuẩn hoá giá về một hình · dựng patch Lark · chọn nguồn giá) + một server action + một cron điền bù. Nguồn giá: API sống ở đâu có (FedEx `Rate`, UPS `Rating`), engine nội bộ ở chỗ còn lại (Aramex, DHL). Đường ghi Lark dùng lại `updateLogRecordFields` và `COT_CHI_PHI` đã có.

**Tech Stack:** Next.js 16 (server actions), Drizzle + Postgres, vitest 4, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-10-12-nhap-tracking-day-gia-uoc-tinh-len-lark-design.md`

## Global Constraints

- **Chỉ điền ô TRỐNG trên Lark, không bao giờ đè.** (CEO 12/10/2026, khớp D-045.)
- **Một đường ghi duy nhất:** `updateLogRecordFields(recordId, fields)`. Không thêm API tạo/xoá record.
- **`COT_CHI_PHI` trong `features/lark/ghi-nguoc/cot.ts` là nơi DUY NHẤT giữ tên cột Lark.** Không khai bảng tên cột thứ hai.
- **Không ghi** `Giá chiết khấu`, `% Phụ phí Nhiên liệu` (công thức Lark), mọi cột Lookup, `Log Unique code` (AutoNumber).
- **Rate API hỏng không được chặn nhân sự:** mã vận đơn phải lưu được kể cả khi không lấy được giá.
- **Giá lấy theo cân + kích thước ĐÃ ĐÓNG của kiện**, không theo số brand khai.
- **vitest chỉ nhận `.ts`** — mọi logic nằm trong module thuần, `.tsx` chỉ hiển thị.
- **Khoá Lark chỉ có trên Railway** — mọi lệnh chạm Lark chạy qua `railway run`, không in giá trị khoá.
- **Bản ghi thử trên Lark phải xoá sau khi thử.**
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Review Focus

Năm chỗ spec ngụ ý mà không task nào tự nhiên phủ — mỗi dòng đã được gắn test vào task sở hữu:

1. **Dán URL có query string / URL hãng khác / dán nhầm cả câu** → bóc ra số sai mà vẫn trông hợp lệ. (Task 1)
2. **Kiện chưa có `lark_record_id`** → không ghi được Lark; phải nói ra, không im lặng coi như xong. (Task 7 — `canDienBu` có test cho đúng điều kiện này; Task 5 trả `canhBao` cùng lý do)
3. **Nguồn giá thiếu một khoản** (UPS không trả VAT) → ghi `0` vào ô thay vì để trống, biến "không biết" thành "bằng không". (Task 3)
4. **Mã vận đơn đã thuộc kiện khác** → hai kiện cùng một mã, hỏng mọi phép nối theo tracking. (Task 5)
5. **Kiện Aramex/DHL** → đi đường engine, không được báo lỗi giả "hãng không hỗ trợ". (Task 4)

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `features/dong-hang/ma-van-don.ts` | THUẦN: bóc mã vận đơn từ chuỗi nhân sự dán (URL hoặc số trần) |
| `features/dong-hang/gia-uoc-tinh.ts` | THUẦN: kiểu `GiaUocTinh` + hai bộ chuyển (engine `QuoteBreakdown` → `GiaUocTinh`, khoản UPS → `GiaUocTinh`) |
| `features/lark/ghi-nguoc/patch-gia-uoc-tinh.ts` | THUẦN: dựng patch Lark từ `GiaUocTinh`, chỉ ô trống |
| `features/dong-hang/lay-gia-uoc-tinh.ts` | I/O: chọn nguồn giá theo hãng, trả `GiaUocTinh \| null` |
| `features/dong-hang/actions.ts` | thêm action `luuTrackingChoKien` |
| `components/dong-hang/ONhapTracking.tsx` | ô nhập (hiển thị thuần) |
| `app/api/cron/dien-bu-gia-uoc-tinh/route.ts` | cron điền bù |

---

### Task 1: Bóc mã vận đơn từ chuỗi dán

**Files:**
- Create: `features/dong-hang/ma-van-don.ts`
- Test: `features/dong-hang/ma-van-don.test.ts`

**Interfaces:**
- Produces: `export function macVanDonTu(raw: string): string | null`

- [ ] **Step 1: Viết test đỏ**

```ts
describe('macVanDonTu', () => {
  it('số trần giữ nguyên', () => {
    expect(macVanDonTu('876817928550')).toBe('876817928550');
    expect(macVanDonTu('1Z2050VDD919649050')).toBe('1Z2050VDD919649050');
  });
  it('bóc từ URL FedEx', () => {
    expect(macVanDonTu('https://www.fedex.com/fedextrack/?trknbr=876817928550')).toBe('876817928550');
  });
  it('bóc từ URL UPS', () => {
    expect(macVanDonTu('https://www.ups.com/track?tracknum=1Z2050VDD919649050')).toBe('1Z2050VDD919649050');
  });
  it('bỏ khoảng trắng và ký tự vô hình khi copy', () => {
    expect(macVanDonTu('  876817928550​ ')).toBe('876817928550');
  });
  /* Review Focus #1: URL lạ không có tham số mã → KHÔNG được đoán bừa một đoạn số
   * trong đường dẫn, vì mã sai trông y hệt mã đúng. */
  it('URL không nhận ra được thì trả null, không đoán', () => {
    expect(macVanDonTu('https://example.com/a/12345/b')).toBeNull();
  });
  it('cả câu có chữ thì trả null', () => {
    expect(macVanDonTu('mã của em là 876817928550 nhé')).toBeNull();
  });
  it('rỗng → null', () => { expect(macVanDonTu('   ')).toBeNull(); });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ** — `npx vitest run features/dong-hang/ma-van-don.test.ts` · Expect: FAIL "macVanDonTu is not a function"

- [ ] **Step 3: Viết `macVanDonTu(raw: string): string | null` trong `features/dong-hang/ma-van-don.ts`**

Luật: chuẩn hoá (bỏ khoảng trắng + ký tự zero-width) → nếu toàn bộ chuỗi là mã hợp lệ thì trả luôn; nếu là URL thì **chỉ đọc tham số truy vấn đã biết** (`trknbr`, `tracknum`, `tracknumbers`, `trackingnumber`, `awb` — so khớp không phân biệt hoa thường), không bao giờ moi số từ đường dẫn. Mã hợp lệ = `^[A-Z0-9]{8,35}$` sau khi viết hoa.

- [ ] **Step 4: Chạy, xác nhận xanh**

- [ ] **Step 5: Commit** — `feat(đóng hàng): bóc mã vận đơn từ URL hoặc số trần`

---

### Task 2: Chuẩn hoá giá ước tính về một hình

**Files:**
- Create: `features/dong-hang/gia-uoc-tinh.ts`
- Test: `features/dong-hang/gia-uoc-tinh.test.ts`

**Interfaces:**
- Consumes: `QuoteBreakdown` từ `features/carrier-rates/engine/quote.ts`; `KhoanBaoGiaUps` từ `lib/ups/rate.ts`
- Produces:
```ts
export interface GiaUocTinh {
  nguon: 'fedex-api' | 'ups-api' | 'bang-gia';
  base: number | null; fuel: number | null; remote: number | null; demand: number | null;
  signature: number | null; residential: number | null; importHandling: number | null;
  vat: number | null; total: number | null;
}
export function tuEngine(b: QuoteBreakdown, total: number): GiaUocTinh
export function tuKhoanUps(khoan: KhoanBaoGiaUps[], total: number): GiaUocTinh
export function tuFedexQuote(q: FedexQuoteSnap): GiaUocTinh   // FedexQuoteSnap từ features/shipments/reconcile-view.ts
export const VAT_PHAN_TRAM = 0.08
export function vatSuyRa(g: GiaUocTinh): number | null
```

**Mỗi khoản là `null` khi nguồn KHÔNG nói gì về nó** — khác hẳn `0` ("hãng có tính, bằng không"). Task 3 dựa vào phân biệt này để không ghi `0` vào ô mình không biết.

- [ ] **Step 1: Viết test đỏ**

```ts
describe('tuEngine', () => {
  it('map đúng từng khoản và đánh dấu nguồn bảng giá', () => {
    const g = tuEngine({ base: 100, fuel: 20, remote: 5, demand: 3, residential: 7,
      addonReference: 9, countryFixed: 11, /* …phần còn lại của QuoteBreakdown */ } as QuoteBreakdown, 155);
    expect(g).toMatchObject({ nguon: 'bang-gia', base: 100, fuel: 20, remote: 5, demand: 3,
      residential: 7, signature: 9, importHandling: 11, total: 155 });
  });
});

describe('tuKhoanUps', () => {
  it('cộng dồn khoản trùng mã', () => {
    expect(tuKhoanUps([{ ma: 'FUEL SURCHARGE', tien: 10 }, { ma: 'FUEL SURCHARGE', tien: 5 }], 15).fuel).toBe(15);
  });
  /* Review Focus #3: UPS KHÔNG trả VAT thành khoản riêng. Phải là null, không phải 0. */
  it('UPS không có VAT → vat là null, KHÔNG phải 0', () => {
    expect(tuKhoanUps([{ ma: 'FUEL SURCHARGE', tien: 10 }], 10).vat).toBeNull();
  });
  it('khoản UPS không biết xếp đâu thì bỏ qua, không làm hỏng các khoản khác', () => {
    expect(tuKhoanUps([{ ma: 'KHOAN_LA', tien: 99 }, { ma: 'FUEL SURCHARGE', tien: 10 }], 109).fuel).toBe(10);
  });
});

describe('tuFedexQuote', () => {
  /* `fedex_rate_quotes` đã giữ sẵn từng khoản (xem FedexQuoteSnap); chỉ đổi tên trường,
   * KHÔNG tính lại gì — tính lại là đẻ ra con số thứ hai cho cùng một kiện. */
  it('map thẳng từ dòng quote đã lưu, nguồn là fedex-api', () => {
    const g = tuFedexQuote({ totalNetCharge: 500, fuel: 50, fuelPercent: 47.75, remote: 0,
      demand: 10, residential: 0, signature: 20, countryFixed: 30, vat: 40, discount: -100,
      service: 'IP', rateZone: 'H' });
    expect(g).toMatchObject({ nguon: 'fedex-api', fuel: 50, demand: 10, signature: 20,
      importHandling: 30, vat: 40, total: 500 });
  });
});

describe('vatSuyRa', () => {
  /* Đo 37/37 dòng hoá đơn UPS 100000813108: VAT = 7,97–8,00% của gốc chịu thuế;
   * gốc = mọi khoản dịch vụ, TRỪ chính VAT và TRỪ thuế nhập khẩu. */
  it('8% trên tổng các khoản dịch vụ', () => {
    expect(vatSuyRa({ base: 1000, fuel: 100, remote: null, demand: null, signature: null,
      residential: null, importHandling: 400, vat: null, total: null, nguon: 'ups-api' })).toBe(120);
  });
  it('đã có vat thì giữ nguyên, không tính lại', () => {
    expect(vatSuyRa({ vat: 77, base: 1000 } as GiaUocTinh)).toBe(77);
  });
  it('không có khoản nào → null, không ra 0', () => {
    expect(vatSuyRa({ vat: null, base: null, fuel: null } as GiaUocTinh)).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

- [ ] **Step 3: Viết ba hàm trong `features/dong-hang/gia-uoc-tinh.ts`**

`tuEngine`: đọc `QuoteBreakdown` theo bảng map ở Interfaces. Ký nhận của FedEx là `addonReference` (addon `when_billed`, không vào total) — xem chú thích trong `engine/quote.ts`. Phí xử lý hàng nhập lấy `countryFixed`, rơi về `countryFixedReference` khi `countryFixed` = 0.

`tuKhoanUps`: map mã khoản UPS → nhóm, cộng dồn khi trùng mã; mã lạ bỏ qua. Dùng lại bảng mã trong `lib/ups/rate.ts` nếu đã đủ, không khai lại.

`vatSuyRa`: `vat` đã có thì trả nguyên; chưa có thì `VAT_PHAN_TRAM × Σ(các khoản dịch vụ không null)`, làm tròn; mọi khoản đều null → `null`.

- [ ] **Step 4: Chạy, xác nhận xanh**

- [ ] **Step 5: Commit** — `feat(đóng hàng): chuẩn hoá giá ước tính về một hình chung`

---

### Task 3: Dựng patch Lark cho khối ô chi phí

**Files:**
- Create: `features/lark/ghi-nguoc/patch-gia-uoc-tinh.ts`
- Test: `features/lark/ghi-nguoc/patch-gia-uoc-tinh.test.ts`

**Interfaces:**
- Consumes: `GiaUocTinh` (Task 2); `COT_CHI_PHI`, `COT` từ `./cot`
- Produces: `export function patchGiaUocTinh(g: GiaUocTinh, oHienCo: Record<string, unknown>, tracking: string | null): Record<string, unknown>`

- [ ] **Step 1: Viết test đỏ**

```ts
describe('patchGiaUocTinh', () => {
  const g = { nguon: 'bang-gia', base: 100, fuel: 20, remote: null, demand: null,
    signature: null, residential: null, importHandling: null, vat: 10, total: 130 } as GiaUocTinh;

  it('ô trống thì điền', () => {
    expect(patchGiaUocTinh(g, {}, null)[COT_CHI_PHI.base]).toBe(100);
  });
  /* Anti-goal của spec: không bao giờ đè số người gõ tay. */
  it('ô ĐÃ CÓ số thì KHÔNG đụng', () => {
    const p = patchGiaUocTinh(g, { [COT_CHI_PHI.base]: 999 }, null);
    expect(COT_CHI_PHI.base in p).toBe(false);
  });
  it('ô có số 0 cũng là ĐÃ CÓ, không đè', () => {
    const p = patchGiaUocTinh(g, { [COT_CHI_PHI.base]: 0 }, null);
    expect(COT_CHI_PHI.base in p).toBe(false);
  });
  /* Review Focus #3: khoản null = KHÔNG BIẾT → không được ghi 0 vào ô. */
  it('khoản null thì bỏ hẳn khỏi patch, không ghi 0', () => {
    const p = patchGiaUocTinh(g, {}, null);
    expect(COT_CHI_PHI.remote in p).toBe(false);
  });
  it('ghi mã vận đơn khi ô trống', () => {
    expect(patchGiaUocTinh(g, {}, 'T1')[COT.trackingNumber]).toBe('T1');
  });
  it('Lark đã có mã vận đơn KHÁC thì không đè', () => {
    const p = patchGiaUocTinh(g, { [COT.trackingNumber]: 'T-CU' }, 'T-MOI');
    expect(COT.trackingNumber in p).toBe(false);
  });
  it('không có gì để ghi thì patch rỗng', () => {
    expect(Object.keys(patchGiaUocTinh(g, { [COT_CHI_PHI.base]: 1, [COT_CHI_PHI.fuel]: 1, [COT_CHI_PHI.vat]: 1 }, null))).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

- [ ] **Step 3: Viết `patchGiaUocTinh` trong `features/lark/ghi-nguoc/patch-gia-uoc-tinh.ts`**

Luật ô trống: dùng chung cách `dung-patch.ts` đang đọc ô hiện có (`larkText` / so sánh null) — **đọc file đó trước**, đừng tự định nghĩa lại "trống". `undefined`, `null`, chuỗi rỗng là trống; số `0` là ĐÃ CÓ.

Nếu `COT.trackingNumber` chưa tồn tại trong `cot.ts` thì thêm vào đó (một chỗ duy nhất giữ tên cột), không khai cục bộ.

- [ ] **Step 4: Chạy, xác nhận xanh**

- [ ] **Step 5: Commit** — `feat(lark): dựng patch giá ước tính, chỉ điền ô trống`

---

### Task 4: Lấy giá ước tính cho một kiện

**Files:**
- Create: `features/dong-hang/lay-gia-uoc-tinh.ts`
- Test: `features/dong-hang/lay-gia-uoc-tinh.test.ts` (chỉ phần thuần: chọn nguồn)

**Interfaces:**
- Consumes: `quoteShipmentToCache(input: QuoteShipmentInput)` từ `features/carrier-rates/fedex-quote-cache.ts` · `baoGiaUpsShop` từ `lib/ups/rate.ts` · `quoteOrderAcrossCarriers` từ `features/carrier-rates/compare/quote-order-carriers.ts` · `laNhaDan` (đã dùng trong `dong-hang/actions.ts`)
- Produces:
```ts
export function nguonGiaCho(carrierKey: string | null): 'fedex-api' | 'ups-api' | 'bang-gia'
export async function layGiaUocTinh(shipmentId: string): Promise<GiaUocTinh | null>
```

- [ ] **Step 1: Viết test đỏ cho phần thuần**

```ts
describe('nguonGiaCho', () => {
  it('fedex → API FedEx', () => { expect(nguonGiaCho('fedex')).toBe('fedex-api'); });
  it('ups → API UPS', () => { expect(nguonGiaCho('ups')).toBe('ups-api'); });
  /* Review Focus #5: Aramex/DHL đi bảng giá, KHÔNG phải lỗi. Engine có 1.800 ô giá
   * cho Aramex và 1.520 ô cho DHL; CEO xác nhận cách tính đã khớp bill Aramex. */
  it('aramex → bảng giá', () => { expect(nguonGiaCho('aramex')).toBe('bang-gia'); });
  it('dhl → bảng giá', () => { expect(nguonGiaCho('dhl')).toBe('bang-gia'); });
  it('hãng chưa biết / null → bảng giá, không ném lỗi', () => {
    expect(nguonGiaCho(null)).toBe('bang-gia');
    expect(nguonGiaCho('hang-moi')).toBe('bang-gia');
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

- [ ] **Step 3: Viết `nguonGiaCho` và `layGiaUocTinh` trong `features/dong-hang/lay-gia-uoc-tinh.ts`**

`layGiaUocTinh` nạp kiện (cân + kích thước ĐÃ ĐÓNG, nước, mã bưu chính, thành phố, `addrClass`, `originHub`, ngày nhãn), rồi theo `nguonGiaCho`:
- `fedex-api`: gọi `quoteShipmentToCache`, rồi đọc lại dòng `fedex_rate_quotes` của kiện → `GiaUocTinh` (`nguon: 'fedex-api'`).
- `ups-api`: gọi `baoGiaUpsShop`, lấy mức rẻ nhất, `tuKhoanUps(...)`, rồi `vatSuyRa`.
- `bang-gia`: gọi `quoteOrderAcrossCarriers`, lấy dòng của đúng `carrierKey` của kiện, `tuEngine(row.breakdown, row.vndCost)`.

Hai cờ cho đường FedEx: `isResidential` dùng `laNhaDan(addrClass, country)` như `baoGiaKien` đang làm; `signatureOptIn` **phải lấy từ cấu hình phụ phí ký nhận của hãng cho nước đích**, không hardcode `false` — xem `DIRECT_SIGNATURE_EXEMPT_COUNTRIES` và D-044. Nếu không quyết được nguồn, **dừng và hỏi**, đừng đoán: bỏ sót là ước tính thiếu đúng khoản Đức cần đối chiếu.

Bất kỳ lỗi nào → trả `null`, không ném.

- [ ] **Step 4: Chạy, xác nhận xanh**

- [ ] **Step 5: Commit** — `feat(đóng hàng): lấy giá ước tính theo hãng (API sống hoặc bảng giá)`

---

### Task 5: Action nhập tracking

**Files:**
- Modify: `features/dong-hang/actions.ts`
- Create: `features/dong-hang/luu-tracking.ts` (phần thuần: kiểm tra đầu vào)
- Test: `features/dong-hang/luu-tracking.test.ts`

**Interfaces:**
- Consumes: `macVanDonTu` (Task 1) · `layGiaUocTinh` (Task 4) · `patchGiaUocTinh` (Task 3) · `updateLogRecordFields` từ `features/lark/client.ts`
- Produces:
```ts
export type KetQuaLuuTracking =
  | { ok: true; tracking: string; giaDaGhi: boolean; canhBao?: string }
  | { ok: false; loi: string };
export function kiemTraTracking(raw: string, dangDungOKienKhac: boolean): { ok: true; tracking: string } | { ok: false; loi: string }
// trong actions.ts:
export async function luuTrackingChoKien(shipmentId: string, raw: string): Promise<KetQuaLuuTracking>
```

- [ ] **Step 1: Viết test đỏ cho `kiemTraTracking`**

```ts
describe('kiemTraTracking', () => {
  it('mã hợp lệ thì qua', () => {
    expect(kiemTraTracking('876817928550', false)).toEqual({ ok: true, tracking: '876817928550' });
  });
  it('bóc được từ URL', () => {
    expect(kiemTraTracking('https://www.fedex.com/fedextrack/?trknbr=876817928550', false))
      .toEqual({ ok: true, tracking: '876817928550' });
  });
  it('không bóc được thì báo lỗi nói rõ phải làm gì', () => {
    const r = kiemTraTracking('abc xyz', false);
    expect(r.ok).toBe(false);
    expect((r as { loi: string }).loi).toContain('mã vận đơn');
  });
  /* Review Focus #4: hai kiện cùng một mã làm hỏng mọi phép nối theo tracking —
   * khoá ghép của hệ thống là MÃ VẬN ĐƠN (Decisions dòng 511). */
  it('mã đã thuộc kiện khác thì CHẶN', () => {
    const r = kiemTraTracking('876817928550', true);
    expect(r.ok).toBe(false);
    expect((r as { loi: string }).loi).toContain('kiện khác');
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

- [ ] **Step 3: Viết `kiemTraTracking` trong `features/dong-hang/luu-tracking.ts`**

- [ ] **Step 4: Chạy, xác nhận xanh**

- [ ] **Step 5: Viết `luuTrackingChoKien` trong `features/dong-hang/actions.ts`**

Gate quyền: cùng mức với các action đóng hàng đang có trong file (đọc file, dùng lại đúng quyền đó). Thứ tự bắt buộc:
1. `kiemTraTracking` (tra `shipments` xem mã đã thuộc kiện khác chưa) — hỏng thì dừng, chưa ghi gì.
2. **Lưu `shipments.tracking_number` NGAY.** Mọi bước sau là best-effort.
3. `layGiaUocTinh` — `null` thì trả `{ ok: true, giaDaGhi: false, canhBao: 'chưa lấy được giá ước tính, cron sẽ thử lại' }`.
4. Kiện không có `lark_record_id` → `{ ok: true, giaDaGhi: false, canhBao: 'kiện chưa có dòng Lark tương ứng' }` (**Review Focus #2** — nói ra, không im lặng).
5. Đọc record Lark hiện tại → `patchGiaUocTinh` → `updateLogRecordFields` khi patch không rỗng.

- [ ] **Step 6: Commit** — `feat(đóng hàng): action nhập mã vận đơn, kèm ghi giá ước tính lên Lark`

---

### Task 6: Ô nhập trong màn Đóng hàng

**Files:**
- Create: `components/dong-hang/ONhapTracking.tsx`
- Modify: màn Đóng hàng (chèn ô nhập vào dòng kiện đã đóng mà chưa có tracking)

**Interfaces:**
- Consumes: `luuTrackingChoKien` (Task 5)

- [ ] **Step 1: Dựng `ONhapTracking`** — ô text + nút Lưu. Dán URL cũng nhận. Trạng thái đang gọi thì khoá nút. Kết quả hiện ngay tại chỗ: thành công kèm `canhBao` nếu có; lỗi thì hiện nguyên câu `loi`.

Không đặt logic trong `.tsx` (vitest không chạy `.tsx`). Không gọi trong `useEffect` (lint `react-hooks/set-state-in-effect`) — gọi trong handler.

- [ ] **Step 2: Chạy `npx tsc --noEmit` và `npx eslint` trên hai file** · Expect: sạch

- [ ] **Step 3: Tự kiểm bằng preview** — `preview_start` cấu hình `web-3001`, mở màn Đóng hàng, kiểm ô hiện đúng chỗ. Không nhờ người khác xem hộ.

- [ ] **Step 4: Commit** — `feat(đóng hàng): ô nhập mã vận đơn trên dòng kiện`

---

### Task 7: Cron điền bù

**Files:**
- Create: `app/api/cron/dien-bu-gia-uoc-tinh/route.ts`
- Create: `features/dong-hang/dien-bu.ts` (phần thuần: chọn kiện cần điền)
- Test: `features/dong-hang/dien-bu.test.ts`

**Interfaces:**
- Produces: `export function canDienBu(k: { trackingNumber: string | null; larkRecordId: string | null; daGhiGiaLuc: Date | null }): boolean`

- [ ] **Step 1: Viết test đỏ**

```ts
describe('canDienBu', () => {
  it('có tracking + có record Lark + chưa ghi giá → cần', () => {
    expect(canDienBu({ trackingNumber: 'T', larkRecordId: 'rec', daGhiGiaLuc: null })).toBe(true);
  });
  it('chưa có tracking → chưa tới lượt', () => {
    expect(canDienBu({ trackingNumber: null, larkRecordId: 'rec', daGhiGiaLuc: null })).toBe(false);
  });
  it('chưa có record Lark → chưa ghi được', () => {
    expect(canDienBu({ trackingNumber: 'T', larkRecordId: null, daGhiGiaLuc: null })).toBe(false);
  });
  it('đã ghi rồi → thôi', () => {
    expect(canDienBu({ trackingNumber: 'T', larkRecordId: 'rec', daGhiGiaLuc: new Date() })).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

- [ ] **Step 3: Viết `canDienBu`, thêm cột `shipments.gia_uoc_tinh_ghi_luc` (timestamp, nullable)**

Migration viết tay theo `db/migrations/README.md`: file `.sql` dùng `ADD COLUMN IF NOT EXISTS`, chạy tay vào DB, xác minh bằng `information_schema`, **rồi mới** push code. `npm run db:migrate` báo thành công nhưng không làm gì — đừng tin nó.

- [ ] **Step 4: Viết route cron** — lặp kiện `canDienBu`, gọi lại đúng bước 3–5 của Task 5, ghi `gia_uoc_tinh_ghi_luc` khi ghi được. Giới hạn số kiện mỗi lượt; đặt cùng vùng `asia-southeast1` như các cron khác (D-051).

- [ ] **Step 5: Chạy, xác nhận xanh; commit** — `feat(đóng hàng): cron điền bù giá ước tính lên Lark`

---

## Phép kiểm cuối, trước khi coi là xong

- [ ] Ghi thử lên **một** dòng Lark thật qua `railway run`, kiểm đúng ô, **rồi xoá dấu vết thử**.
- [ ] Chứng minh ô đã có số không bị đè (bằng chính dòng thử đó).
- [ ] Chứng minh Rate API hỏng thì tracking vẫn lưu được.
- [ ] Đo lại độ phủ `lark_record_id` — còn thấp thì chạy backfill trước khi bật cron.
- [ ] `npx tsc --noEmit` + `npx eslint` + `npx vitest run` toàn bộ, xanh.
