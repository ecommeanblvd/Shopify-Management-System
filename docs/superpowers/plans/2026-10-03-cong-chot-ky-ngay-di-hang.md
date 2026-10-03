# Cổng chốt kỳ + ngày đi hàng — kế hoạch thực thi

> **Cho người thực thi:** dùng `superpowers:subagent-driven-development` hoặc
> `superpowers:executing-plans`. Mỗi bước có checkbox để theo dõi.

**Mục tiêu:** bảng kê ship hộ dùng NGÀY HÃNG LẤY HÀNG, và kỳ chỉ được phát hành sau khi qua
một cổng rà soát; kỳ xanh thì đẩy sang Google Sheet của brand và sang MMP.

**Kiến trúc:** mọi luật nằm trong module THUẦN có test; tầng I/O chỉ nạp dữ liệu rồi gọi luật.
Đẩy Google Sheet đi qua đúng outbox mà đẩy MMP đang dùng, vì cùng tính chất "gọi ra ngoài, hỏng
thì phải thử lại".

**Nền tảng:** Next.js 16.2.6 · Drizzle + Postgres · vitest 4 · Tailwind 4 · Railway.

**Spec:** `docs/superpowers/specs/2026-10-03-cong-chot-ky-ngay-di-hang-design.md`

## Ràng buộc chung

- Tiếng Việt cho mọi tên hàm, biến, chú thích và thông báo người dùng — theo nếp toàn repo.
- Chú thích giải thích **VÌ SAO**, kèm số đo thật khi có. Không chú thích mô tả lại code.
- KHÔNG sửa `ship_ho_orders.shipped_at`. Nó là mốc nghiệp vụ của mình.
- KHÔNG ghi ngược lên bảng Lark đơn ship hộ. Giữ một chiều Lark → SMS.
- Mức phụ phí xăng dầu của hãng luôn là bội **0,25%**.
- Aramex không có API tra cứu → ngày đi hàng lấy `shipped_at`, nguồn `'lark'`.
- Service account **không tạo được** sheet (`storageQuotaExceeded`) — chỉ ghi vào sheet đã
  được chia sẻ. Brand chưa có sheet thì báo việc, KHÔNG chặn chốt kỳ.
- Biến môi trường đã có trên Railway: `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`.
- Chạy script trên dữ liệu thật qua `railway run --service Shopify-Management-System npx tsx …`.
- Trước khi push: `npx tsc --noEmit` + `npx vitest run` phải xanh.

## Cấu trúc tệp

| Tệp | Trách nhiệm |
|---|---|
| `features/ship-ho/ngay-di-hang.ts` | THUẦN — chọn ngày đi hàng + nguồn. Nơi DUY NHẤT quyết định. |
| `features/ship-ho/nap-ngay-lay-hang.ts` | đã có (FedEx) — thêm nhánh UPS |
| `features/ship-ho/tuan-fuel.ts` | THUẦN — tra % công bố của tuần chứa một ngày |
| `features/ship-ho/cong-chot-ky.ts` | THUẦN — ba phép kiểm, trả danh sách đơn hỏng kèm lý do |
| `features/ship-ho/statement-core.ts` | đã có — gắn cổng vào `phatHanhBangKe` |
| `lib/google/sheets.ts` | I/O — ký JWT, lấy token, gọi Sheets API |
| `features/ship-ho/day-sheet.ts` | I/O — dựng hàng và ghi tab kỳ lên sheet brand |
| `features/ship-ho/statement-outbox.ts` | đã có — thêm `'statement.sheet'` vào `LoaiSuKienKe` |

---

### Task 1: `ngayDiHang` — nơi duy nhất quyết định ngày đi hàng

**Tệp:**
- Tạo: `features/ship-ho/ngay-di-hang.ts`
- Test: `features/ship-ho/ngay-di-hang.test.ts`

**Giao diện — Produces:**
```ts
export type NguonNgayDi = 'hang' | 'lark';
export interface DonCoNgay { pickedUpAt: Date | string | null; shippedAt: string | null }
export function ngayDiHang(d: DonCoNgay): { ngay: string | null; nguon: NguonNgayDi };
```

- [ ] **Bước 1: viết test hỏng**

```ts
import { describe, it, expect } from 'vitest';
import { ngayDiHang } from './ngay-di-hang';

describe('ngayDiHang', () => {
  /* AWB 873918787369 THẬT: FedEx quét PU 06/07, còn `shipped_at` ghi 03/07 (mốc tạo nhãn).
     Phụ phí xăng dầu tính theo tuần của NGÀY ĐI, nên phải lấy 06/07. */
  it('có ngày hãng thì lấy ngày hãng', () => {
    expect(ngayDiHang({ pickedUpAt: new Date(2026, 6, 6, 14, 52), shippedAt: '2026-07-03' }))
      .toEqual({ ngay: '2026-07-06', nguon: 'hang' });
  });

  /* Aramex HN không có API tra cứu (CEO chốt 03/10): rơi về ngày Đức điền trên Lark, nhưng
     nguồn phải nói ra — ngoại lệ KHAI BÁO, không phải rơi-về im lặng. */
  it('không có ngày hãng thì lấy ngày Lark và khai nguồn', () => {
    expect(ngayDiHang({ pickedUpAt: null, shippedAt: '2026-09-21' }))
      .toEqual({ ngay: '2026-09-21', nguon: 'lark' });
  });

  it('không có ngày nào thì trả null, KHÔNG bịa', () => {
    expect(ngayDiHang({ pickedUpAt: null, shippedAt: null })).toEqual({ ngay: null, nguon: 'lark' });
  });

  /* Cột `picked_up_at` là timestamp không múi giờ; đọc bằng giờ địa phương để không lệch ngày
     (bài học D-194 — `toISOString` quy sang UTC làm lệch một ngày). */
  it('Date gần nửa đêm vẫn ra đúng ngày treo tường', () => {
    expect(ngayDiHang({ pickedUpAt: new Date(2026, 6, 6, 23, 59), shippedAt: null }).ngay).toBe('2026-07-06');
    expect(ngayDiHang({ pickedUpAt: new Date(2026, 6, 6, 0, 1), shippedAt: null }).ngay).toBe('2026-07-06');
  });

  it('chuỗi ngày cũng nhận', () => {
    expect(ngayDiHang({ pickedUpAt: '2026-07-06 14:52:00', shippedAt: null }).ngay).toBe('2026-07-06');
  });
});
```

- [ ] **Bước 2: chạy để thấy hỏng**

Chạy: `npx vitest run features/ship-ho/ngay-di-hang.test.ts`
Kỳ vọng: FAIL — `Failed to resolve import './ngay-di-hang'`

- [ ] **Bước 3: viết cài đặt**

```ts
/**
 * THUẦN: ngày hàng THẬT SỰ rời kho, và con số đó đến từ đâu. Không I/O.
 *
 * `shipped_at` là lúc Đức gõ trên Lark; `picked_up_at` là mốc hãng quét lấy hàng. Hai mốc lệch
 * nhau tới 3 ngày (AWB 873918787369: tạo nhãn 03/07, lấy hàng 06/07), mà phụ phí xăng dầu tính
 * theo TUẦN CỦA NGÀY ĐI — nên lấy nhầm mốc là tra nhầm tuần.
 *
 * Trả CẢ ngày lẫn nguồn trong một lượt: nguồn suy được từ `pickedUpAt == null` nên KHÔNG lưu
 * thành cột riêng, nhưng người đọc bảng kê vẫn cần biết, nên phải trả ra đây — thay vì để mỗi
 * nơi tự suy lại (hai bản sao của một luật là hẹn ngày chúng lệch — D-201).
 */
export type NguonNgayDi = 'hang' | 'lark';

export interface DonCoNgay {
  pickedUpAt: Date | string | null;
  shippedAt: string | null;
}

function ngayDiaPhuong(d: Date | string): string | null {
  const dt = typeof d === 'string' ? new Date(d.replace(' ', 'T')) : d;
  if (Number.isNaN(dt.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function ngayDiHang(d: DonCoNgay): { ngay: string | null; nguon: NguonNgayDi } {
  if (d.pickedUpAt != null) {
    const ngay = ngayDiaPhuong(d.pickedUpAt);
    if (ngay) return { ngay, nguon: 'hang' };
  }
  return { ngay: d.shippedAt ? d.shippedAt.slice(0, 10) : null, nguon: 'lark' };
}
```

- [ ] **Bước 4: chạy lại cho xanh**

Chạy: `npx vitest run features/ship-ho/ngay-di-hang.test.ts`
Kỳ vọng: 5 test PASS

- [ ] **Bước 5: commit**

```bash
git add features/ship-ho/ngay-di-hang.ts features/ship-ho/ngay-di-hang.test.ts
git commit -m "feat(ship-ho): ngayDiHang — nơi duy nhất quyết định ngày hàng rời kho"
```

---

### Task 2: nối UPS vào lượt nạp ngày lấy hàng

**Tệp:**
- Sửa: `features/ship-ho/ngay-lay-hang.ts` (thêm hàm cho UPS)
- Sửa: `features/ship-ho/nap-ngay-lay-hang.ts` (thêm nhánh UPS)
- Test: `features/ship-ho/ngay-lay-hang.test.ts` (thêm describe)

**Giao diện — Consumes:** `mocLayHang(suKien)` đã có (FedEx, mã `PU`).
**Giao diện — Produces:**
```ts
export function mocLayHangUps(suKien: readonly SuKienQuetToiThieu[]): Date | null;
```

- [ ] **Bước 1: viết test hỏng**

```ts
import { mocLayHangUps } from './ngay-lay-hang';

describe('mocLayHangUps', () => {
  /* UPS dùng mã trạng thái `P` cho CẢ lượt lấy hàng lẫn lượt ra xe giao (phân biệt bằng mô
     tả), nên lấy `P` SỚM NHẤT — lượt đi đầu tiên. Xem bảng mã ở `lib/ups/track.ts:27`. */
  it('lấy sự kiện P sớm nhất', () => {
    expect(mocLayHangUps([
      { eventType: 'P', date: '2026-09-25T10:00:00' },
      { eventType: 'P', date: '2026-09-21T08:30:00' },
      { eventType: 'D', date: '2026-09-28T09:00:00' },
    ])?.toISOString().slice(0, 10)).toBe('2026-09-21');
  });

  it('không có P → null', () => {
    expect(mocLayHangUps([{ eventType: 'I', date: '2026-09-22T10:00:00' }])).toBeNull();
    expect(mocLayHangUps([])).toBeNull();
  });

  it('ngày hỏng thì bỏ qua', () => {
    expect(mocLayHangUps([{ eventType: 'P', date: 'khong-phai-ngay' }])).toBeNull();
  });
});
```

- [ ] **Bước 2: chạy để thấy hỏng**

Chạy: `npx vitest run features/ship-ho/ngay-lay-hang.test.ts`
Kỳ vọng: FAIL — `mocLayHangUps is not a function`

- [ ] **Bước 3: viết cài đặt**

Trong `features/ship-ho/ngay-lay-hang.ts`, tách phần chung rồi thêm hàm UPS:

```ts
/** Mã sự kiện UPS cho lượt lấy hàng. UPS dùng CÙNG mã này cho lượt ra xe giao. */
export const MA_LAY_HANG_UPS = 'P';

/** Mốc sự kiện SỚM NHẤT mang mã `ma`, hoặc `null`. */
function mocSomNhat(suKien: readonly SuKienQuetToiThieu[], ma: string): Date | null {
  let som: Date | null = null;
  for (const e of suKien) {
    if (e.eventType !== ma || !e.date) continue;
    const d = new Date(e.date);
    if (Number.isNaN(d.getTime())) continue;
    if (som === null || d < som) som = d;
  }
  return som;
}

export function mocLayHang(suKien: readonly SuKienQuetToiThieu[]): Date | null {
  return mocSomNhat(suKien, MA_LAY_HANG);
}

/**
 * Mốc lấy hàng UPS.
 *
 * CHƯA KIỂM ĐƯỢC bằng hoá đơn: phép chứng minh dùng cho FedEx là "%fuel của tuần chứa ngày đó
 * khớp % suy từ hoá đơn" (116/116 đơn), mà hệ thống chưa có hoá đơn UPS nào. Khi hoá đơn UPS
 * đầu tiên về, chạy lại đúng phép kiểm đó trước khi tin.
 */
export function mocLayHangUps(suKien: readonly SuKienQuetToiThieu[]): Date | null {
  return mocSomNhat(suKien, MA_LAY_HANG_UPS);
}
```

Trong `features/ship-ho/nap-ngay-lay-hang.ts`: bỏ điều kiện `ILIKE 'FedEx%'`, chọn thêm tên
hãng, rồi rẽ nhánh. UPS tra TỪNG MÃ MỘT (`layLichSuQuetUps` nhận một mã), FedEx tra theo lô 30.

```ts
const la = (ten: string | null, hang: string) => (ten ?? '').toLowerCase().startsWith(hang);

// … trong vòng lặp, sau khi đã có `lo`:
const fedex = lo.filter((d) => la(d.hang, 'fedex'));
const ups = lo.filter((d) => la(d.hang, 'ups'));

if (fedex.length > 0) {
  const quet = await layLichSuQuet(fedex.map((d) => d.awb!));
  for (const d of fedex) {
    const r = quet.get(d.awb!);
    await ghiMoc(d, r && !('loi' in r) ? mocLayHang(r.suKien) : null, ket);
  }
}
for (const d of ups) {
  const r = await layLichSuQuetUps(d.awb!);
  await ghiMoc(d, 'loi' in r ? null : mocLayHangUps(r.suKien), ket);
}
```

với hàm phụ trong cùng tệp:

```ts
async function ghiMoc(
  d: { id: string; gui: string | null }, moc: Date | null, ket: KetQuaNapNgayLayHang,
): Promise<void> {
  if (!moc) { ket.khong++; return; }
  ket.co++;
  if (moc.toISOString().slice(0, 10) !== String(d.gui)) ket.lech++;
  await db.update(schema.shipHoOrders).set({ pickedUpAt: moc })
    .where(eq(schema.shipHoOrders.id, d.id));
}
```

Câu truy vấn đổi thành (giữ nguyên `::int`, nếu bỏ thì Postgres từ chối cả câu):

```ts
.where(and(
  isNotNull(schema.shipHoOrders.trackingNumber),
  isNull(schema.shipHoOrders.pickedUpAt),
  sql`(${schema.carrierAccounts.name} ILIKE 'FedEx%' OR ${schema.carrierAccounts.name} ILIKE 'UPS%')`,
  sql`${schema.shipHoOrders.shippedAt} >= CURRENT_DATE - ${NGAY_CON_TRA_DUOC}::int`,
))
```

và `select` thêm `hang: schema.carrierAccounts.name`.

- [ ] **Bước 4: chạy lại cho xanh**

Chạy: `npx vitest run features/ship-ho/ngay-lay-hang.test.ts && npx tsc --noEmit`
Kỳ vọng: test PASS, tsc không báo gì

- [ ] **Bước 5: chạy thật, xem 5 đơn UPS có ra ngày không**

```bash
railway run --service Shopify-Management-System npx tsx scripts/nap-ngay-lay-hang.ts
```
Kỳ vọng: in ra số đơn thử gồm cả UPS. Nếu UPS trả `null` hết thì DỪNG và báo — nghĩa là mã `P`
không phải mã lấy hàng của UPS, phải soi lại lịch sử quét thật trước khi ghi.

- [ ] **Bước 6: ghi thật rồi kiểm**

```bash
railway run --service Shopify-Management-System npx tsx scripts/nap-ngay-lay-hang.ts --ap-dung
```
Kỳ vọng: 5 đơn UPS có `picked_up_at`.

- [ ] **Bước 7: commit**

```bash
git add features/ship-ho/ngay-lay-hang.ts features/ship-ho/ngay-lay-hang.test.ts features/ship-ho/nap-ngay-lay-hang.ts
git commit -m "feat(ship-ho): nạp ngày lấy hàng cho cả UPS"
```

---

### Task 3: tra % xăng dầu của tuần chứa một ngày

**Tệp:**
- Tạo: `features/ship-ho/tuan-fuel.ts`
- Test: `features/ship-ho/tuan-fuel.test.ts`

**Giao diện — Produces:**
```ts
export interface TuanFuel { tu: string; den: string | null; pct: number }
export function pctTuanCuaNgay(tuan: readonly TuanFuel[], ngay: string): number | null;
```

- [ ] **Bước 1: viết test hỏng**

```ts
import { describe, it, expect } from 'vitest';
import { pctTuanCuaNgay, type TuanFuel } from './tuan-fuel';

/* Mức FedEx THẬT quanh tháng 7/2026 — đọc từ `carrier_surcharges` ngày 03/10/2026. */
const TUAN: TuanFuel[] = [
  { tu: '2026-06-29', den: '2026-07-06', pct: 38.5 },
  { tu: '2026-07-06', den: '2026-07-13', pct: 38.25 },
  { tu: '2026-07-13', den: '2026-07-20', pct: 38.5 },
  { tu: '2026-07-20', den: null, pct: 39.75 },
];

describe('pctTuanCuaNgay', () => {
  /* Đúng ca đã gây hiểu nhầm hôm 02/10: ngày tạo nhãn 03/07 ra 38,50%, ngày hãng lấy hàng
     06/07 ra 38,25% — và hoá đơn ghi 38,25%. */
  it('03/07 → 38,50% · 06/07 → 38,25%', () => {
    expect(pctTuanCuaNgay(TUAN, '2026-07-03')).toBe(38.5);
    expect(pctTuanCuaNgay(TUAN, '2026-07-06')).toBe(38.25);
  });

  it('biên: ngày đầu tuần THUỘC tuần đó, ngày cuối thuộc tuần sau', () => {
    expect(pctTuanCuaNgay(TUAN, '2026-07-12')).toBe(38.25);
    expect(pctTuanCuaNgay(TUAN, '2026-07-13')).toBe(38.5);
  });

  it('tuần đang mở (den null) nhận mọi ngày từ mốc đầu trở đi', () => {
    expect(pctTuanCuaNgay(TUAN, '2026-12-31')).toBe(39.75);
  });

  it('ngày trước mọi tuần đã biết → null, KHÔNG đoán', () => {
    expect(pctTuanCuaNgay(TUAN, '2026-01-01')).toBeNull();
  });
});
```

- [ ] **Bước 2: chạy để thấy hỏng**

Chạy: `npx vitest run features/ship-ho/tuan-fuel.test.ts`
Kỳ vọng: FAIL — không resolve được `./tuan-fuel`

- [ ] **Bước 3: viết cài đặt**

```ts
/**
 * THUẦN: mức phụ phí xăng dầu hãng công bố cho tuần chứa một ngày. Không I/O.
 *
 * Khoảng tuần là NỬA MỞ `[tu, den)`: hãng đổi mức vào thứ Hai, nên ngày `den` đã thuộc tuần
 * sau. Lấy nhầm biên là sai đúng một tuần, mà hai tuần liền kề thường chênh nhau 0,25–1,5%.
 */
export interface TuanFuel {
  tu: string;
  /** `null` = tuần đang mở. */
  den: string | null;
  pct: number;
}

export function pctTuanCuaNgay(tuan: readonly TuanFuel[], ngay: string): number | null {
  const w = tuan.find((x) => ngay >= x.tu && (x.den === null || ngay < x.den));
  return w ? w.pct : null;
}
```

- [ ] **Bước 4: chạy lại cho xanh**

Chạy: `npx vitest run features/ship-ho/tuan-fuel.test.ts`
Kỳ vọng: 4 test PASS

- [ ] **Bước 5: commit**

```bash
git add features/ship-ho/tuan-fuel.ts features/ship-ho/tuan-fuel.test.ts
git commit -m "feat(ship-ho): tra % xăng dầu theo tuần chứa một ngày"
```

---

### Task 4: ba phép kiểm của cổng chốt kỳ

**Tệp:**
- Tạo: `features/ship-ho/cong-chot-ky.ts`
- Test: `features/ship-ho/cong-chot-ky.test.ts`

**Giao diện — Consumes:** `ngayDiHang` (Task 1) · `pctTuanCuaNgay`, `TuanFuel` (Task 3) ·
`gocFuelTrenBill`, `phanTramFuelDangTin` (đã có ở `features/ship-ho/goc-fuel-bill.ts`).

**Giao diện — Produces:**
```ts
export type MaLoiCong = 'thieu_ngay_di' | 'fuel_lech_tuan' | 'fuel_ngoai_luoi';
export interface LoiCong { code: string; ma: MaLoiCong; ly: string }
export interface DonKiemCong {
  code: string;
  tenHang: string | null;
  pickedUpAt: Date | string | null;
  shippedAt: string | null;
  bill: {
    base: number; discount: number; remote: number; demand: number;
    signature: number; residential: number; addressCorrection: number; fuel: number;
  } | null;
}
export function kiemCongChotKy(don: readonly DonKiemCong[], tuan: readonly TuanFuel[]): LoiCong[];
export function hangCoNguonTra(tenHang: string | null): boolean;
```

- [ ] **Bước 1: viết test hỏng**

```ts
import { describe, it, expect } from 'vitest';
import { kiemCongChotKy, hangCoNguonTra, type DonKiemCong } from './cong-chot-ky';
import type { TuanFuel } from './tuan-fuel';

const TUAN: TuanFuel[] = [
  { tu: '2026-07-06', den: '2026-07-13', pct: 38.25 },
  { tu: '2026-07-20', den: '2026-07-27', pct: 39.75 },
];
const don = (o: Partial<DonKiemCong>): DonKiemCong => ({
  code: 'X', tenHang: 'FedEx Vietnam — International Priority (IP) 2026',
  pickedUpAt: new Date(2026, 6, 6), shippedAt: '2026-07-06', bill: null, ...o,
});
/* Hoá đơn THẬT của AWB 873918787369: fuel 420.576 trên gốc 1.099.544 = 38,25%. */
const BILL_DUNG = { base: 3_058_500, discount: -2_136_056, remote: 0, demand: 0,
  signature: 92_700, residential: 84_400, addressCorrection: 0, fuel: 420_576 };

describe('hangCoNguonTra', () => {
  it('FedEx/UPS/DHL có nguồn, Aramex thì không', () => {
    expect(hangCoNguonTra('FedEx Vietnam — International Priority (IP) 2026')).toBe(true);
    expect(hangCoNguonTra('UPS Worldwide Expedited')).toBe(true);
    expect(hangCoNguonTra('DHL Express Vietnam — Worldwide Export 2026')).toBe(true);
    expect(hangCoNguonTra('Aramex HN (Hợp Nhất)')).toBe(false);
  });
  /* Không biết hãng thì KHÔNG được coi là "không có nguồn" rồi cho qua — 2 đơn trong dữ liệu
     thật thiếu `carrier_account_id`. Coi như có nguồn để cổng chặn và người đi xem lại. */
  it('không biết hãng thì coi như CÓ nguồn — để cổng chặn', () => {
    expect(hangCoNguonTra(null)).toBe(true);
  });
});

describe('kiemCongChotKy', () => {
  it('đơn đủ điều kiện thì không có lỗi nào', () => {
    expect(kiemCongChotKy([don({ bill: BILL_DUNG })], TUAN)).toEqual([]);
  });

  it('hãng có nguồn tra mà thiếu ngày hãng → chặn', () => {
    const r = kiemCongChotKy([don({ code: 'A1', pickedUpAt: null, bill: BILL_DUNG })], TUAN);
    expect(r).toHaveLength(1);
    expect(r[0].ma).toBe('thieu_ngay_di');
    expect(r[0].code).toBe('A1');
  });

  /* Aramex không có API — ngoại lệ ĐƯỢC KHAI BÁO, dùng ngày Lark, không bị chặn. */
  it('Aramex thiếu ngày hãng thì KHÔNG chặn', () => {
    expect(kiemCongChotKy([don({ tenHang: 'Aramex HN (Hợp Nhất)', pickedUpAt: null, bill: null })], TUAN)).toEqual([]);
  });

  /* Đúng lỗi của #KLS1998: tuần của ngày đi là 39,75% nhưng bill ra 38,25%. */
  it('%fuel không khớp tuần của ngày đi → chặn', () => {
    const r = kiemCongChotKy([don({
      code: 'A2', pickedUpAt: new Date(2026, 6, 20), shippedAt: '2026-07-20', bill: BILL_DUNG,
    })], TUAN);
    expect(r).toHaveLength(1);
    expect(r[0].ma).toBe('fuel_lech_tuan');
    expect(r[0].ly).toContain('39,75');
    expect(r[0].ly).toContain('38,25');
  });

  /* 52,65% — con số đã lọt ra bảng gửi brand ngày 02/10. Không mức nào của hãng là 52,65%. */
  it('%fuel ngoài lưới 0,25% → chặn', () => {
    const r = kiemCongChotKy([don({
      code: 'A3', bill: { ...BILL_DUNG, fuel: 579_000 },
    })], TUAN);
    expect(r).toHaveLength(1);
    expect(r[0].ma).toBe('fuel_ngoai_luoi');
  });

  it('đơn chưa có hoá đơn thì bỏ qua hai phép kiểm fuel', () => {
    expect(kiemCongChotKy([don({ bill: null })], TUAN)).toEqual([]);
  });

  it('nhiều đơn hỏng thì trả đủ danh sách, không dừng ở đơn đầu', () => {
    const r = kiemCongChotKy([
      don({ code: 'B1', pickedUpAt: null, bill: null }),
      don({ code: 'B2', bill: { ...BILL_DUNG, fuel: 579_000 } }),
    ], TUAN);
    expect(r.map((x) => x.code)).toEqual(['B1', 'B2']);
  });
});
```

- [ ] **Bước 2: chạy để thấy hỏng**

Chạy: `npx vitest run features/ship-ho/cong-chot-ky.test.ts`
Kỳ vọng: FAIL — không resolve được `./cong-chot-ky`

- [ ] **Bước 3: viết cài đặt**

```ts
/**
 * THUẦN: cổng rà soát trước khi phát hành một kỳ bảng kê. Không I/O.
 *
 * Vì sao cần: trước 03/10/2026 kỳ được phát hành mà không có phép kiểm nào về ngày hay về
 * %phụ phí — và một con số sai (52,65% ở #KLS1998) đã kịp ra tới bảng gửi brand.
 *
 * Trả DANH SÁCH đơn hỏng kèm lý do, không trả một câu chung: người sửa cần biết đơn nào.
 */
import { ngayDiHang } from './ngay-di-hang';
import { pctTuanCuaNgay, type TuanFuel } from './tuan-fuel';
import { gocFuelTrenBill, phanTramFuelDangTin } from './goc-fuel-bill';

export type MaLoiCong = 'thieu_ngay_di' | 'fuel_lech_tuan' | 'fuel_ngoai_luoi';
export interface LoiCong { code: string; ma: MaLoiCong; ly: string }

export interface DonKiemCong {
  code: string;
  tenHang: string | null;
  pickedUpAt: Date | string | null;
  shippedAt: string | null;
  /** `null` = chưa có hoá đơn hãng → hai phép kiểm fuel không áp dụng. */
  bill: {
    base: number; discount: number; remote: number; demand: number;
    signature: number; residential: number; addressCorrection: number; fuel: number;
  } | null;
}

/** Hãng có API tra lịch sử quét. Aramex HN không có (CEO chốt 03/10). */
const CO_NGUON = ['fedex', 'ups', 'dhl'];

/**
 * Hãng này có tra được ngày lấy hàng không.
 *
 * Không biết tên hãng → trả `true` để cổng CHẶN. Hai đơn trong dữ liệu thật thiếu
 * `carrier_account_id`; coi chúng là "không có nguồn" rồi cho qua là lấy an toàn giả.
 */
export function hangCoNguonTra(tenHang: string | null): boolean {
  if (!tenHang) return true;
  const t = tenHang.toLowerCase();
  return CO_NGUON.some((h) => t.startsWith(h));
}

const pct = (n: number) => n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function kiemCongChotKy(don: readonly DonKiemCong[], tuan: readonly TuanFuel[]): LoiCong[] {
  const loi: LoiCong[] = [];
  for (const d of don) {
    const { ngay } = ngayDiHang(d);
    if (hangCoNguonTra(d.tenHang) && d.pickedUpAt == null) {
      loi.push({ code: d.code, ma: 'thieu_ngay_di',
        ly: `chưa tra được ngày hãng lấy hàng (${d.tenHang ?? 'không rõ hãng'})` });
      continue;
    }
    if (!d.bill || !(d.bill.fuel > 0)) continue;
    const goc = gocFuelTrenBill(d.bill);
    if (!(goc > 0)) continue;
    const suy = Math.round((d.bill.fuel / goc) * 100 * 1000) / 1000;
    if (!phanTramFuelDangTin(suy)) {
      loi.push({ code: d.code, ma: 'fuel_ngoai_luoi',
        ly: `%xăng dầu suy từ hoá đơn = ${pct(suy)}% — không phải bội của 0,25%, nhiều khả năng mẫu số thiếu một khoản chịu fuel` });
      continue;
    }
    const congBo = ngay ? pctTuanCuaNgay(tuan, ngay) : null;
    if (congBo != null && Math.abs(congBo - suy) > 0.001) {
      loi.push({ code: d.code, ma: 'fuel_lech_tuan',
        ly: `đi hàng ${ngay} thuộc tuần ${pct(congBo)}% nhưng hoá đơn tính ${pct(suy)}%` });
    }
  }
  return loi;
}
```

- [ ] **Bước 4: chạy lại cho xanh**

Chạy: `npx vitest run features/ship-ho/cong-chot-ky.test.ts`
Kỳ vọng: 9 test PASS

- [ ] **Bước 5: commit**

```bash
git add features/ship-ho/cong-chot-ky.ts features/ship-ho/cong-chot-ky.test.ts
git commit -m "feat(ship-ho): ba phép kiểm cổng chốt kỳ"
```

---

### Task 5: chạy cổng ở chế độ CHỈ ĐẾM trên mọi kỳ đã phát hành

Không gắn cổng vào luồng thật cho tới khi biết nó sẽ chặn những gì. Nếu nó chặn một kỳ đã phát
hành thành công, phải hiểu lý do TRƯỚC.

**Tệp:**
- Tạo: `scripts/soi-cong-chot-ky.ts`

**Giao diện — Consumes:** `kiemCongChotKy`, `DonKiemCong` (Task 4) · `TuanFuel` (Task 3).

- [ ] **Bước 1: viết script**

```ts
/**
 * Cổng chốt kỳ sẽ chặn những kỳ nào, vì lý do gì — CHỈ ĐỌC, không ghi gì.
 *
 * Chạy TRƯỚC khi gắn cổng vào `phatHanhBangKe`: một cổng chặn mất kỳ đã phát hành trót lọt là
 * cổng sai, và biết điều đó sau khi bật thì đã muộn.
 *
 * Chạy: railway run --service Shopify-Management-System npx tsx scripts/soi-cong-chot-ky.ts
 */
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { kiemCongChotKy, type DonKiemCong } from '@/features/ship-ho/cong-chot-ky';
import type { TuanFuel } from '@/features/ship-ho/tuan-fuel';

const n = (v: unknown) => Number(v ?? 0);

async function main(): Promise<void> {
  const tuan: TuanFuel[] = (await db.execute<Record<string, unknown>>(sql`
    SELECT s.starts_at::date tu, s.ends_at::date den, s.value::numeric pct
    FROM carrier_surcharges s JOIN carrier_accounts ca ON ca.id = s.carrier_account_id
    WHERE ca.name ILIKE 'FedEx%' AND s.kind = 'fuel_percent' ORDER BY s.starts_at;`)).rows
    .map((x) => ({ tu: String(x.tu), den: x.den ? String(x.den) : null, pct: n(x.pct) }));

  const ke = await db.execute<Record<string, unknown>>(sql`
    SELECT id, partner_brand_slug brand, period_start::date ky, status
    FROM ship_ho_statements ORDER BY period_start;`);

  for (const k of ke.rows) {
    const don = (await db.execute<Record<string, unknown>>(sql`
      SELECT o.code, ca.name hang, o.picked_up_at, o.shipped_at::date gui, o.actual_bill_breakdown ab
      FROM ship_ho_orders o LEFT JOIN carrier_accounts ca ON ca.id = o.carrier_account_id
      WHERE o.statement_id = ${k.id};`)).rows
      .map((x): DonKiemCong => {
        const ab = x.ab as Record<string, unknown> | null;
        return {
          code: String(x.code), tenHang: x.hang == null ? null : String(x.hang),
          pickedUpAt: x.picked_up_at as Date | null, shippedAt: x.gui == null ? null : String(x.gui),
          bill: ab == null ? null : {
            base: n(ab.base), discount: n(ab.discount), remote: n(ab.remote), demand: n(ab.demand),
            signature: n(ab.signature), residential: n(ab.residential),
            addressCorrection: n(ab.addressCorrection), fuel: n(ab.fuel),
          },
        };
      });
    const loi = kiemCongChotKy(don, tuan);
    const nhan = `${String(k.brand).padEnd(12)} ${k.ky} ${String(k.status).padEnd(7)} ${String(don.length).padStart(3)} đơn`;
    if (loi.length === 0) { console.log(`✓ ${nhan}`); continue; }
    console.log(`✗ ${nhan} — ${loi.length} đơn hỏng`);
    for (const l of loi.slice(0, 5)) console.log(`     ${l.code} [${l.ma}] ${l.ly}`);
    if (loi.length > 5) console.log(`     … còn ${loi.length - 5} đơn`);
  }
  process.exit(0);
}
main();
```

- [ ] **Bước 2: chạy trên dữ liệu thật**

```bash
railway run --service Shopify-Management-System npx tsx scripts/soi-cong-chot-ky.ts
```

- [ ] **Bước 3: giải thích từng kỳ bị chặn**

Mỗi kỳ `✗` phải trả lời được: lý do có đúng không, và sửa bằng cách nào (nạp lại ngày lấy hàng,
hay dữ liệu hoá đơn sai). **Nếu một kỳ bị chặn mà không giải thích được thì DỪNG** — cổng sai,
quay lại Task 4. Không đi tiếp Task 6 khi còn kỳ chưa giải thích được.

- [ ] **Bước 4: commit**

```bash
git add scripts/soi-cong-chot-ky.ts
git commit -m "feat(ship-ho): script soi cổng chốt kỳ ở chế độ chỉ đếm"
```

---

### Task 6: gắn cổng vào `phatHanhBangKe`

**Tệp:**
- Sửa: `features/ship-ho/statement-core.ts` (hàm `phatHanhBangKe`)

**Giao diện — Consumes:** `kiemCongChotKy`, `DonKiemCong` (Task 4) · `TuanFuel` (Task 3).

- [ ] **Bước 1: thêm hàm nạp dữ liệu cho cổng**

Trong `features/ship-ho/statement-core.ts`:

```ts
/**
 * Nạp dữ liệu rồi chạy cổng rà soát cho một bảng kê.
 *
 * Tách khỏi `phatHanhBangKe` để script `soi-cong-chot-ky.ts` dùng lại được y nguyên — cổng chạy
 * thử và cổng chạy thật phải là MỘT, không phải hai bản chép tay.
 */
export async function chayCongChotKy(statementId: string): Promise<LoiCong[]> {
  const tuan: TuanFuel[] = (await db.execute<Record<string, unknown>>(sql`
    SELECT s.starts_at::date tu, s.ends_at::date den, s.value::numeric pct
    FROM carrier_surcharges s JOIN carrier_accounts ca ON ca.id = s.carrier_account_id
    WHERE ca.name ILIKE 'FedEx%' AND s.kind = 'fuel_percent' ORDER BY s.starts_at;`)).rows
    .map((x) => ({ tu: String(x.tu), den: x.den ? String(x.den) : null, pct: Number(x.pct ?? 0) }));
  const n = (v: unknown) => Number(v ?? 0);
  const don = (await db.execute<Record<string, unknown>>(sql`
    SELECT o.code, ca.name hang, o.picked_up_at, o.shipped_at::date gui, o.actual_bill_breakdown ab
    FROM ship_ho_orders o LEFT JOIN carrier_accounts ca ON ca.id = o.carrier_account_id
    WHERE o.statement_id = ${statementId};`)).rows
    .map((x): DonKiemCong => {
      const ab = x.ab as Record<string, unknown> | null;
      return {
        code: String(x.code), tenHang: x.hang == null ? null : String(x.hang),
        pickedUpAt: x.picked_up_at as Date | null, shippedAt: x.gui == null ? null : String(x.gui),
        bill: ab == null ? null : {
          base: n(ab.base), discount: n(ab.discount), remote: n(ab.remote), demand: n(ab.demand),
          signature: n(ab.signature), residential: n(ab.residential),
          addressCorrection: n(ab.addressCorrection), fuel: n(ab.fuel),
        },
      };
    });
  return kiemCongChotKy(don, tuan);
}
```

Rồi sửa `scripts/soi-cong-chot-ky.ts` để gọi `chayCongChotKy(k.id)` thay cho đoạn nạp chép tay.

- [ ] **Bước 2: chèn cổng vào `phatHanhBangKe`**

Đặt NGAY SAU phép kiểm `donLechKy` đang có, TRƯỚC khi đổi trạng thái sang `issued`:

```ts
  const congLoi = await chayCongChotKy(id);
  if (congLoi.length > 0) {
    const vd = congLoi.slice(0, 5).map((l) => `${l.code}: ${l.ly}`).join(' · ');
    return { ok: false,
      error: `Cổng rà soát chặn ${congLoi.length} đơn — ${vd}${congLoi.length > 5 ? ` · còn ${congLoi.length - 5} đơn` : ''}` };
  }
```

- [ ] **Bước 3: tsc + test toàn bộ**

Chạy: `npx tsc --noEmit && npx vitest run`
Kỳ vọng: tsc im lặng; mọi test xanh.

- [ ] **Bước 4: thử trên một bảng kê NHÁP thật**

```bash
railway run --service Shopify-Management-System npx tsx scripts/soi-cong-chot-ky.ts
```
Kỳ vọng: kết quả giống hệt lượt chạy ở Task 5 — nếu khác, nghĩa là hai đường nạp dữ liệu đã
lệch nhau và phải sửa trước khi đi tiếp.

- [ ] **Bước 5: commit**

```bash
git add features/ship-ho/statement-core.ts scripts/soi-cong-chot-ky.ts
git commit -m "feat(ship-ho): phát hành kỳ phải qua cổng rà soát"
```

---

### Task 7: bảng kê dùng ngày đi hàng

Dòng payload được dựng THẲNG trong `banBangKeSangMmp` (`statement-core.ts`, quanh dòng 348),
không qua hàm riêng — nên không có chỗ nào để viết unit test thuần. Phép kiểm thật ở đây là
dựng lại payload của một kỳ THẬT và soi bốn đơn đã biết. `ngayDiHang` đã có test riêng ở Task 1.

**Tệp:**
- Sửa: `features/ship-ho/statement-core.ts` — `getShipHoStatement` (thêm cột) và
  `banBangKeSangMmp` (dùng `ngayDiHang`)
- Sửa: `docs/integrations/mmp-ship-ho-api.md`

**Giao diện — Consumes:** `ngayDiHang` (Task 1).

- [ ] **Bước 1: cho `getShipHoStatement` lấy thêm cột**

```bash
grep -n "shippedAt: " features/ship-ho/statement-core.ts
```
Thêm `pickedUpAt: schema.shipHoOrders.pickedUpAt` vào đúng mệnh đề `select` đang lấy
`shippedAt` của `ship_ho_orders`.

- [ ] **Bước 2: dùng `ngayDiHang` khi dựng dòng**

Tại `features/ship-ho/statement-core.ts` quanh dòng 341, mở rộng kiểu đọc rồi đổi dòng payload:

```ts
    const r = o as { code: string; mmpRef: string | null; brandReference: string | null;
      trackingNumber: string | null; shippedAt: string | null; pickedUpAt: Date | null;
      giaThuVnd: number | null; billNumber?: string | null; issueDate?: string | null };
```

```ts
    const ngay = ngayDiHang(r);
    dong.push({
      code: r.code, mmpRef: r.mmpRef, brandReference: r.brandReference, trackingNumber: r.trackingNumber,
      // NGÀY ĐI HÀNG, không phải ngày tạo nhãn: brand đối chiếu %xăng dầu theo tuần của ngày
      // này, mà hai mốc lệch nhau tới 3 ngày (AWB 873918787369).
      shippedAt: ngay.ngay, nguonNgayDi: ngay.nguon, amountVnd: r.giaThuVnd,
      ...
```

Thêm `nguonNgayDi: NguonNgayDi` vào kiểu `DongBangKeMmp`.

- [ ] **Bước 3: tsc + test toàn bộ**

Chạy: `npx tsc --noEmit && npx vitest run`
Kỳ vọng: tsc im lặng, mọi test xanh.

- [ ] **Bước 4: soi trên dữ liệu thật**

```bash
railway run --service Shopify-Management-System npx tsx -e "import { db } from '@/db/client'; import { sql } from 'drizzle-orm'; db.execute(sql\\`SELECT o.code, o.shipped_at::date gui, o.picked_up_at::date lay FROM ship_ho_orders o WHERE o.code IN ('26-INSLG-SV-0007','26-INSLG-SV-0031','26-INSLG-SV-0034') ORDER BY 1;\\`).then((r) => { console.table(r.rows); process.exit(0); });"
```
Kỳ vọng: SV-0007 `gui 2026-07-03` / `lay 2026-07-06`. Sau khi sửa, payload của kỳ chứa đơn này
phải mang **2026-07-06** và `nguonNgayDi: 'hang'`. Đơn Aramex bất kỳ phải mang `'lark'`.

- [ ] **Bước 5: báo MMP biết có trường mới**

Thêm `nguonNgayDi` vào `docs/integrations/mmp-ship-ho-api.md`: hai giá trị `hang` | `lark`, kèm
một câu nói rõ `shippedAt` nay là ngày hãng lấy hàng chứ không phải ngày tạo nhãn. Trường THÊM
vào, nghĩa trường cũ không đổi, nên MMP không phải sửa gì để tiếp tục chạy.

- [ ] **Bước 6: commit**

```bash
git add features/ship-ho/statement-core.ts docs/integrations/mmp-ship-ho-api.md
git commit -m "feat(ship-ho): bảng kê mang ngày đi hàng và nguồn của nó"
```

---

### Task 8: module gọi Google Sheets

**Tệp:**
- Tạo: `lib/google/sheets.ts`
- Test: `lib/google/sheets.test.ts`

**Giao diện — Produces:**
```ts
export async function tokenGoogle(): Promise<string>;
export async function goiSheets(sheetId: string, duong: string, init?: RequestInit): Promise<Record<string, unknown>>;
export function serialNgay(iso: string): number;
export function tuSerial(n: number): string;
```

- [ ] **Bước 1: viết test hỏng cho phần THUẦN**

```ts
import { describe, it, expect } from 'vitest';
import { serialNgay, tuSerial } from './sheets';

describe('serial ngày của Google Sheets', () => {
  /* Mốc neo đã biết — dùng để tự kiểm phép quy đổi TRƯỚC khi ghi lên sheet thật. Chính phép
     assert này đã chặn một lượt ghi sai ngày hôm 02/10/2026. */
  it('mốc neo 45292 = 01/01/2024', () => {
    expect(tuSerial(45292)).toBe('2024-01-01');
    expect(serialNgay('2024-01-01')).toBe(45292);
  });
  it('đi về được cả hai chiều', () => {
    for (const d of ['2026-07-03', '2026-07-06', '2026-12-31']) expect(tuSerial(serialNgay(d))).toBe(d);
  });
});
```

- [ ] **Bước 2: chạy để thấy hỏng**

Chạy: `npx vitest run lib/google/sheets.test.ts`
Kỳ vọng: FAIL — không resolve được `./sheets`

- [ ] **Bước 3: viết cài đặt**

```ts
/**
 * Gọi Google Sheets API bằng tài khoản dịch vụ.
 *
 * Tự ký JWT bằng `node:crypto` thay vì kéo thư viện `googleapis` — thư viện đó mang theo cả
 * gRPC trong khi ta chỉ cần hai lệnh REST. Giữ token trong RAM đúng nếp
 * `features/lark/client.ts` đang dùng.
 *
 * Tài khoản dịch vụ KHÔNG tạo được file mới (`storageQuotaExceeded` — nó không có dung lượng
 * Drive riêng). Nó chỉ đọc/ghi sheet đã được chia sẻ quyền `writer`.
 */
import { createSign } from 'node:crypto';

const PHAM_VI = 'https://www.googleapis.com/auth/spreadsheets';
const GOC_SERIAL = Date.UTC(1899, 11, 30);
const b64 = (s: string) => Buffer.from(s).toString('base64url');
let nho: { token: string; het: number } | null = null;

/** `YYYY-MM-DD` → số thứ tự ngày của Google Sheets. */
export function serialNgay(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - GOC_SERIAL) / 86_400_000);
}

/** Chiều ngược của `serialNgay`. */
export function tuSerial(n: number): string {
  return new Date(GOC_SERIAL + n * 86_400_000).toISOString().slice(0, 10);
}

function env(ten: string): string {
  const v = process.env[ten];
  if (!v) throw new Error(`[google] thiếu biến ${ten}`);
  return v;
}

export async function tokenGoogle(): Promise<string> {
  if (nho && nho.het > Date.now() + 60_000) return nho.token;
  // Railway lưu xuống dòng thành hai ký tự "\n" — phải đổi lại thành xuống dòng thật.
  const key = env('GOOGLE_SA_PRIVATE_KEY').replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const dau = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify({
    iss: env('GOOGLE_SA_EMAIL'), scope: PHAM_VI,
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
  }))}`;
  const chuKy = createSign('RSA-SHA256').update(dau).end().sign(key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${dau}.${chuKy}` }),
    // Không timeout là kết nối treo làm cron treo vĩnh viễn — cùng lý do ở `lark/client.ts`.
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json() as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error(`[google] lấy token hỏng: ${j.error_description ?? r.status}`);
  nho = { token: j.access_token, het: Date.now() + 3_000_000 };
  return nho.token;
}

export async function goiSheets(
  sheetId: string, duong: string, init?: RequestInit,
): Promise<Record<string, unknown>> {
  const t = await tokenGoogle();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${duong}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const j = await r.json() as Record<string, unknown>;
  if (!r.ok) throw new Error(`[google] HTTP ${r.status}: ${JSON.stringify((j as { error?: unknown }).error).slice(0, 300)}`);
  return j;
}
```

- [ ] **Bước 4: chạy lại cho xanh**

Chạy: `npx vitest run lib/google/sheets.test.ts`
Kỳ vọng: 2 test PASS

- [ ] **Bước 5: thử lấy token thật**

```bash
railway run --service Shopify-Management-System npx tsx -e "import { tokenGoogle } from '@/lib/google/sheets'; tokenGoogle().then((t) => { console.log('token dài', t.length); process.exit(0); });"
```
Kỳ vọng: in ra độ dài token. KHÔNG in nội dung token.

- [ ] **Bước 6: commit**

```bash
git add lib/google
git commit -m "feat(google): module gọi Sheets API bằng tài khoản dịch vụ"
```

---

### Task 9: cột `doi_soat_sheet_id` trên đối tác

**Tệp:**
- Tạo: `db/migrations/0196_doi-soat-sheet-id.sql`
- Sửa: `db/schema.ts` (bảng `shipHoPartners`)

- [ ] **Bước 1: viết migration**

```sql
-- Sheet đối soát của brand — nơi hệ thống ghi tab theo kỳ.
--
-- Tài khoản dịch vụ KHÔNG tạo được sheet mới (kiểm 03/10/2026: Drive trả
-- `storageQuotaExceeded` vì nó không có dung lượng Drive riêng). Nên sheet do CEO tạo và chia
-- sẻ quyền writer cho sms-sheet-manager@shopify-management-510413.iam.gserviceaccount.com,
-- rồi dán id vào đây. NULL = brand chưa có sheet; chốt kỳ vẫn chạy, chỉ báo việc.
ALTER TABLE ship_ho_partners
  ADD COLUMN IF NOT EXISTS doi_soat_sheet_id text;

-- Sheet "Đối soát Fulfillment Kalisa" đã có và đã chia sẻ.
UPDATE ship_ho_partners
   SET doi_soat_sheet_id = '1eY33WoNpC8_wxuGS8FKqOu8sNG0I_bHAo-Kf4nbrruc'
 WHERE brand_slug = 'kalisa' AND doi_soat_sheet_id IS NULL;
```

- [ ] **Bước 2: thêm vào schema**

```ts
  /**
   * Id sheet đối soát của brand. NULL = chưa có.
   *
   * Hệ thống KHÔNG tự tạo được sheet (tài khoản dịch vụ không có dung lượng Drive) — CEO tạo
   * và chia sẻ quyền writer, rồi dán id vào đây.
   */
  doiSoatSheetId: text('doi_soat_sheet_id'),
```

- [ ] **Bước 3: áp migration lên production**

```bash
railway run --service Shopify-Management-System npx tsx -e "import { readFileSync } from 'node:fs'; import { db } from '@/db/client'; import { sql } from 'drizzle-orm'; db.execute(sql.raw(readFileSync('db/migrations/0196_doi-soat-sheet-id.sql','utf8'))).then(() => { console.log('xong'); process.exit(0); });"
```

- [ ] **Bước 4: kiểm cột đã có và Kalisa đã gán**

```bash
railway run --service Shopify-Management-System npx tsx -e "import { db } from '@/db/client'; import { sql } from 'drizzle-orm'; db.execute(sql\`SELECT brand_slug, doi_soat_sheet_id FROM ship_ho_partners ORDER BY 1;\`).then((r) => { console.table(r.rows); process.exit(0); });"
```
Kỳ vọng: kalisa có id, các brand khác `null`.

- [ ] **Bước 5: tsc + commit**

```bash
npx tsc --noEmit
git add db/migrations/0196_doi-soat-sheet-id.sql db/schema.ts
git commit -m "feat(ship-ho): cột sheet đối soát của brand"
```

---

### Task 10: đẩy bảng kê lên Google Sheet qua outbox

**Tệp:**
- Tạo: `features/ship-ho/hang-sheet.ts` (THUẦN — dựng hàng)
- Tạo: `features/ship-ho/hang-sheet.test.ts`
- Tạo: `features/ship-ho/day-sheet.ts` (I/O — ghi tab)
- Sửa: `features/ship-ho/statement-outbox.ts` (thêm loại sự kiện)
- Sửa: `features/ship-ho/statement-core.ts` (`banBangKeSangMmp` bắn thêm sự kiện sheet)

**Giao diện — Consumes:** `goiSheets`, `serialNgay` (Task 8) · `ngayDiHang` (Task 1) ·
`banSuKienBangKe` đã có.

**Giao diện — Produces:**
```ts
export const COT_SHEET: readonly string[];
export function hangSheet(don: readonly DonSheet[]): (string | number)[][];
export async function dayBangKeLenSheet(statementId: string): Promise<{ ok: boolean; detail: string }>;
```

- [ ] **Bước 1: viết test hỏng cho phần dựng hàng**

```ts
import { describe, it, expect } from 'vitest';
import { COT_SHEET, hangSheet, type DonSheet } from './hang-sheet';

const don: DonSheet = {
  stt: 1, maBrand: 'kalisakol85', tracking: '873918787369', hang: 'FEDEX',
  ngayDi: '2026-07-06', canKg: 2, nuoc: 'US',
  cuoc: 996_240, pctFuel: 38.25, fuel: 448_803, kyNhan: 92_700, nhuCau: 0, vungXa: 0,
  nhaDan: 84_400, xuLyNhap: 68_300, suaDiaChi: 0, phuPhiKhac: 0, vat: 139_235,
  xuLyDon: 50_000, tongThu: 1_879_678, maSms: '26-INSLG-SV-0007',
};

describe('hangSheet', () => {
  it('đúng thứ tự 21 cột của sheet đối soát', () => {
    expect(COT_SHEET).toHaveLength(21);
    expect(COT_SHEET[0]).toBe('STT');
    expect(COT_SHEET[13]).toBe('Phí Giao nhà dân');
    expect(COT_SHEET[20]).toBe('Mã SMS');
  });

  /* Tiền trên sheet là CHUỖI "996.240 đ" chứ không phải số — đo trực tiếp ô thật ngày
     02/10/2026. Ghi số vào là mất hậu tố và lệch định dạng cả cột. */
  it('tiền là chuỗi có hậu tố đ, phần trăm dùng dấu phẩy', () => {
    const h = hangSheet([don])[0];
    expect(h[7]).toBe('996.240 đ');
    expect(h[8]).toBe('38,25%');
    expect(h[13]).toBe('84.400 đ');
  });

  /* Ngày là SỐ serial để Google hiểu là ngày thật — ghi chuỗi thì cột mất khả năng sắp xếp,
     và locale đọc sai thứ tự ngày/tháng (sheet từng lưu 03/07 thành 7 tháng 3). */
  it('ngày là số serial, không phải chuỗi', () => {
    expect(hangSheet([don])[0][4]).toBe(46209);
  });

  it('nhiều đơn thì giữ nguyên thứ tự truyền vào', () => {
    const r = hangSheet([don, { ...don, stt: 2, maSms: 'X' }]);
    expect(r.map((h) => h[20])).toEqual(['26-INSLG-SV-0007', 'X']);
  });
});
```

- [ ] **Bước 2: chạy để thấy hỏng**

Chạy: `npx vitest run features/ship-ho/hang-sheet.test.ts`
Kỳ vọng: FAIL — không resolve được `./hang-sheet`

- [ ] **Bước 3: viết `hang-sheet.ts`**

```ts
/**
 * THUẦN: dựng hàng ghi lên sheet đối soát. Không I/O.
 *
 * Thứ tự và kiểu dữ liệu lấy từ CHÍNH sheet Kalisa đang dùng (đọc ô thật 02/10/2026): tiền là
 * CHUỖI `"996.240 đ"`, phần trăm là chuỗi `"38,25%"`, còn ngày là SỐ serial. Ghi sai kiểu thì
 * cột mất định dạng hoặc mất khả năng sắp xếp.
 */
import { serialNgay } from '@/lib/google/sheets';

export const COT_SHEET = [
  'STT', 'Mã đơn', 'Mã tracking', 'Couriers', 'Ngày gửi', 'Cân nặng tính cước', 'Quốc gia',
  'Cước vận chuyển', '% PP Nhiên liệu', 'PP Nhiên liệu', 'PP kí nhận trực tiếp', 'PP Nhu cầu',
  'PP vùng sâu xa', 'Phí Giao nhà dân', 'PP xử lý hàng nhập', 'PP Address Correction',
  'Phụ phí khác', 'VAT (8%)', 'PP Xử lý hàng hóa', 'Tổng thu', 'Mã SMS',
] as const;

export interface DonSheet {
  stt: number; maBrand: string; tracking: string; hang: string;
  ngayDi: string | null; canKg: number; nuoc: string;
  cuoc: number; pctFuel: number | null; fuel: number; kyNhan: number; nhuCau: number;
  vungXa: number; nhaDan: number; xuLyNhap: number; suaDiaChi: number; phuPhiKhac: number;
  vat: number; xuLyDon: number; tongThu: number; maSms: string;
}

const tien = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} đ`;
const pct = (n: number | null) =>
  n == null ? '' : `${n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export function hangSheet(don: readonly DonSheet[]): (string | number)[][] {
  return don.map((d) => [
    d.stt, d.maBrand, d.tracking, d.hang, d.ngayDi ? serialNgay(d.ngayDi) : '', d.canKg, d.nuoc,
    tien(d.cuoc), pct(d.pctFuel), tien(d.fuel), tien(d.kyNhan), tien(d.nhuCau), tien(d.vungXa),
    tien(d.nhaDan), tien(d.xuLyNhap), tien(d.suaDiaChi), tien(d.phuPhiKhac), tien(d.vat),
    tien(d.xuLyDon), tien(d.tongThu), d.maSms,
  ]);
}
```

- [ ] **Bước 4: chạy lại cho xanh**

Chạy: `npx vitest run features/ship-ho/hang-sheet.test.ts`
Kỳ vọng: 4 test PASS

- [ ] **Bước 5: viết `day-sheet.ts`**

```ts
/**
 * Ghi một kỳ bảng kê lên sheet đối soát của brand.
 *
 * Tab do MÁY sở hữu: xoá sạch rồi ghi lại mỗi lượt. Không sửa từng ô, vì sửa từng ô cần dò theo
 * mã đơn và chỉ cần ai chèn một cột là ghi lệch chỗ — im lặng.
 *
 * Brand chưa có `doi_soat_sheet_id` thì KHÔNG coi là lỗi: trả một dòng báo việc. Chốt kỳ không
 * được phụ thuộc vào việc CEO đã kịp tạo sheet hay chưa.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { goiSheets } from '@/lib/google/sheets';
import { COT_SHEET, hangSheet, type DonSheet } from './hang-sheet';

export async function dayBangKeLenSheet(statementId: string): Promise<{ ok: boolean; detail: string }> {
  const [ke] = await db.select({
    brand: schema.shipHoStatements.partnerBrandSlug,
    ky: schema.shipHoStatements.periodStart,
  }).from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, statementId)).limit(1);
  if (!ke) return { ok: false, detail: 'không thấy bảng kê' };

  const [dt] = await db.select({ sheetId: schema.shipHoPartners.doiSoatSheetId })
    .from(schema.shipHoPartners).where(eq(schema.shipHoPartners.brandSlug, ke.brand)).limit(1);
  if (!dt?.sheetId) {
    return { ok: true, detail: `brand ${ke.brand} chưa có sheet đối soát — tạo rồi chia sẻ cho ${process.env.GOOGLE_SA_EMAIL ?? 'tài khoản dịch vụ'} và dán id vào trang đối tác` };
  }

  const don: DonSheet[] = await dungDonSheet(statementId);
  // Tên tab theo nếp sheet Kalisa: "7.26", "8.26" — tháng.năm, không số 0 ở đầu.
  const d = new Date(String(ke.ky));
  const tenTab = `${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`;

  const meta = await goiSheets(dt.sheetId, '?fields=sheets.properties(sheetId,title)');
  const cu = (meta.sheets as { properties: { sheetId: number; title: string } }[])
    .find((s) => s.properties.title === tenTab)?.properties.sheetId;
  if (cu != null) {
    await goiSheets(dt.sheetId, ':batchUpdate', { method: 'POST',
      body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: cu } }] }) });
  }
  const them = await goiSheets(dt.sheetId, ':batchUpdate', { method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tenTab } } }] }) });
  const idTab = ((them.replies as { addSheet: { properties: { sheetId: number } } }[])[0]).addSheet.properties.sheetId;

  // Cột ngày phải có định dạng NGÀY, không thì serial hiện ra như một số năm chữ số.
  await goiSheets(dt.sheetId, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [
    { updateSpreadsheetProperties: { properties: { locale: 'vi_VN' }, fields: 'locale' } },
    { repeatCell: {
      range: { sheetId: idTab, startRowIndex: 1, startColumnIndex: 4, endColumnIndex: 5 },
      cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } },
      fields: 'userEnteredFormat.numberFormat' } },
  ] }) });

  await goiSheets(dt.sheetId, `/values/${encodeURIComponent(tenTab)}!A1?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [[...COT_SHEET], ...hangSheet(don)] }),
  });
  return { ok: true, detail: `ghi ${don.length} dòng vào tab ${tenTab}` };
}
```

`dungDonSheet(statementId)` nằm cùng tệp: đọc đơn của kỳ, chạy qua `shipHoPriceStructure` để
lấy từng khoản — dùng LẠI đúng hàm mà màn đối soát đang dùng, không tính lại bằng tay.

- [ ] **Bước 6: thêm loại sự kiện vào outbox**

Trong `features/ship-ho/statement-outbox.ts`:

```ts
export type LoaiSuKienKe = 'statement.issued' | 'statement.paid' | 'statement.sheet';
```

và trong `guiHangKe`, rẽ nhánh: `statement.sheet` thì gọi `dayBangKeLenSheet(r.statementId)`
thay vì gọi MMP.

- [ ] **Bước 7: bắn sự kiện sheet khi phát hành**

Trong `banBangKeSangMmp`, sau khi đã bắn `statement.issued`:

```ts
  // Sheet đi SAU và ĐỘC LẬP: MMP là hợp đồng, sheet là bản tiện đọc. Sheet hỏng không được
  // làm hỏng việc kỳ đã phát hành.
  await banSuKienBangKe(id, brand, 'statement.sheet', {});
```

- [ ] **Bước 8: tsc + test toàn bộ**

Chạy: `npx tsc --noEmit && npx vitest run`
Kỳ vọng: tsc im lặng, mọi test xanh.

- [ ] **Bước 9: thử thật trên một kỳ của Kalisa**

```bash
railway run --service Shopify-Management-System npx tsx -e "import { dayBangKeLenSheet } from '@/features/ship-ho/day-sheet'; import { db } from '@/db/client'; import { sql } from 'drizzle-orm'; db.execute(sql\`SELECT id FROM ship_ho_statements WHERE partner_brand_slug='kalisa' ORDER BY period_start DESC LIMIT 1;\`).then(async (r) => { console.log(await dayBangKeLenSheet(String(r.rows[0].id))); process.exit(0); });"
```
Kỳ vọng: tạo tab mới trên sheet Kalisa, đúng số dòng. **Mở sheet nhìn bằng mắt**: ngày hiện
`dd/mm/yyyy`, tiền có hậu tố `đ`, cột `Mã SMS` khớp.

- [ ] **Bước 10: commit**

```bash
git add features/ship-ho/hang-sheet.ts features/ship-ho/hang-sheet.test.ts features/ship-ho/day-sheet.ts features/ship-ho/statement-outbox.ts features/ship-ho/statement-core.ts
git commit -m "feat(ship-ho): đẩy bảng kê lên Google Sheet của brand qua outbox"
```

---

## Tự soi kế hoạch

**Phủ spec:** §3 nguồn ngày đi hàng → Task 1, 2 · §4 mô hình dữ liệu → Task 1, 9 · §5 cổng →
Task 3, 4, 5, 6 · §6 Google Sheet → Task 8, 9, 10 · §7 thứ tự và outbox → Task 10 · §8 ca biên
→ Task 4 (thiếu hãng, Aramex), Task 10 (brand chưa có sheet) · §9 kiểm thử → test ở mỗi task +
Task 5 chạy chế độ chỉ đếm.

**Không chỗ nào treo:** mọi bước có mã hoặc câu lệnh cụ thể; không có "TBD", không có "xử lý
lỗi phù hợp".

**Tên hàm nhất quán:** `ngayDiHang` · `NguonNgayDi` · `mocLayHang` · `mocLayHangUps` ·
`pctTuanCuaNgay` · `TuanFuel` · `kiemCongChotKy` · `DonKiemCong` · `LoiCong` · `hangCoNguonTra` ·
`chayCongChotKy` · `tokenGoogle` · `goiSheets` · `serialNgay` · `tuSerial` · `COT_SHEET` ·
`hangSheet` · `DonSheet` · `dayBangKeLenSheet` — dùng đúng tên này ở mọi task.

**Thứ tự phụ thuộc:** 1 → 2 · 3 → 4 → 5 → 6 · 1 → 7 · 8 → 9 → 10. Task 5 là CỔNG CHẶN: không
đi tiếp khi còn kỳ bị chặn mà chưa giải thích được.
