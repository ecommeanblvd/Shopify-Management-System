# Bước "Lên vận đơn" trong Đóng hàng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hộp thoại chỉ-đọc trên `/f/dong-hang` gom đủ thông tin để người lên vận đơn copy & paste sang form của hãng, kèm luật chọn ZIP+4, băng cảnh báo địa chỉ và nút verify lại.

**Architecture:** Toàn bộ LUẬT nằm trong một module thuần `features/dong-hang/van-don.ts` (có test). Hai server action mỏng trong `features/dong-hang/actions.ts` lo I/O: một đọc CSDL + gọi Shopify live một lượt, một verify lại địa chỉ. Một component hộp thoại mới; `BangDongHang.tsx` chỉ thêm nút mở.

**Tech Stack:** Next.js 16.2.6 · React 19.2.4 · Drizzle ORM + Postgres · vitest 4 · Tailwind 4.

## Global Constraints

- Spec gốc: `docs/superpowers/specs/2026-10-12-len-van-don-dong-hang-design.md`. Mọi con số và câu chữ trong plan này copy từ đó.
- **Không migration, không cột mới, không backfill.** Lượt này chỉ đọc; ghi duy nhất là lượt verify địa chỉ (đã idempotent, dùng lõi sẵn có).
- Bộ test của repo **không bắt `.tsx`** (`vitest` chỉ match `lib|features|components/**/*.test.ts`). Mọi luật phải nằm ở module `.ts` thuần mới có test canh.
- **Quyền:** action đọc gác `view_fulfillment`; action verify gác `chon_line_ship`. KHÔNG dùng `view_receiving` hay `manage_fulfillment` — vai trò `logistics` của Đức không có hai quyền đó.
- Trước mỗi commit: `npx tsc --noEmit` và `npx vitest run <đường dẫn test vừa sửa>`. Trước khi push: hook pre-push chạy tsc + eslint + toàn bộ test.
- Câu chữ tiếng Việt, không dấu ba chấm thay nội dung. Ô không có giá trị hiện `—`.
- `AGENTS.md`: Next.js 16 có breaking changes — đọc `node_modules/next/dist/docs/` trước khi viết code Next mới. Plan này không thêm route mới nên không chạm phần đó.

---

### Task 1: Luật địa chỉ — `chonZip` + `canhBaoDiaChi`

**Files:**
- Create: `features/dong-hang/van-don.ts`
- Test: `features/dong-hang/van-don.test.ts`

**Interfaces:**
- Consumes: không có (task đầu).
- Produces:
  - `export interface DiaChiDon { shipName: string | null; shipCompany: string | null; shipAddress1: string | null; shipAddress2: string | null; shipCity: string | null; shipProvinceCode: string | null; shipPostcode: string | null; shipCountry: string | null; addrIssue: string | null; addrStandardized: string | null; addrDeliverable: boolean | null; addrVerifiedAt: string | null }`
  - `export function chonZip(d: Pick<DiaChiDon, 'shipPostcode' | 'addrStandardized' | 'addrIssue'>): { zip: string | null; nguon: 'zip4' | 'khach'; vi: string }`
  - `export function canhBaoDiaChi(d: Pick<DiaChiDon, 'addrIssue'>): { muc: 'do' | 'vang' | 'khong'; cau: string | null; batXacNhan: boolean }`

- [ ] **Step 1: Viết test fail**

Tạo `features/dong-hang/van-don.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { chonZip, canhBaoDiaChi } from './van-don';

describe('chonZip', () => {
  it('ZIP+4 nối đúng mã khách → dán ZIP+4', () => {
    const r = chonZip({ shipPostcode: '32312', addrStandardized: 'TALLAHASSEE, FL, 32312-3934', addrIssue: null });
    expect(r).toMatchObject({ zip: '32312-3934', nguon: 'zip4' });
  });
  /* INTERPOLATED = hãng nội suy +4 từ dải số nhà quanh đó, KHÔNG tra được chính địa chỉ này
   * (155 đơn). Dán một +4 đoán tệ hơn dán ZIP 5 số đúng. */
  it('cờ nội suy → bỏ ZIP+4, dán mã khách', () => {
    const r = chonZip({ shipPostcode: '32312', addrStandardized: 'TALLAHASSEE, FL, 32312-3934', addrIssue: 'INTERPOLATED.STREET.ADDRESS' });
    expect(r).toMatchObject({ zip: '32312', nguon: 'khach' });
    expect(r.vi).toMatch(/nội suy/);
  });
  it('hãng không trả bản chuẩn hoá → dán mã khách', () => {
    expect(chonZip({ shipPostcode: '32312', addrStandardized: null, addrIssue: null }))
      .toMatchObject({ zip: '32312', nguon: 'khach' });
  });
  it('mã hãng trả KHÔNG nối tiếp mã khách → dán mã khách, không đổi bừa', () => {
    expect(chonZip({ shipPostcode: '32312', addrStandardized: 'MIAMI, FL, 33101-1234', addrIssue: null }))
      .toMatchObject({ zip: '32312', nguon: 'khach' });
  });
  it('mã hãng trả dài BẰNG mã khách (ca GB) → dán mã khách', () => {
    expect(chonZip({ shipPostcode: 'W9 1UJ', addrStandardized: 'LONDON, W9 1UJ', addrIssue: null }))
      .toMatchObject({ zip: 'W9 1UJ', nguon: 'khach' });
  });
  it('đơn không có mã bưu chính → null, nói rõ', () => {
    const r = chonZip({ shipPostcode: null, addrStandardized: 'DUBAI', addrIssue: null });
    expect(r.zip).toBeNull();
    expect(r.vi).toMatch(/không có mã bưu chính/);
  });
});

describe('canhBaoDiaChi', () => {
  /* Bốn cách viết đã gặp thật trên dữ liệu production, đều chứa chữ "suite". */
  it.each([
    'SuiteRequiredButMissing', 'InvalidSuiteNumber', 'SUITE.NUMBER.REQUIRED', 'INVALID.SUITE.NUMBER',
  ])('cờ %s → băng ĐỎ, bắt xác nhận', (co) => {
    const r = canhBaoDiaChi({ addrIssue: co });
    expect(r.muc).toBe('do');
    expect(r.batXacNhan).toBe(true);
    expect(r.cau).toMatch(/số căn hộ/);
  });
  it('cờ khác → băng vàng, không bắt xác nhận', () => {
    const r = canhBaoDiaChi({ addrIssue: 'STANDARDIZED.ADDRESS.NOTFOUND' });
    expect(r).toMatchObject({ muc: 'vang', batXacNhan: false });
    expect(r.cau).toContain('STANDARDIZED.ADDRESS.NOTFOUND');
  });
  it('không cờ → không băng', () => {
    expect(canhBaoDiaChi({ addrIssue: null })).toMatchObject({ muc: 'khong', cau: null, batXacNhan: false });
  });
});
```

- [ ] **Step 2: Chạy test cho chắc nó FAIL**

Run: `npx vitest run features/dong-hang/van-don.test.ts`
Expected: FAIL — `Failed to resolve import "./van-don"`.

- [ ] **Step 3: Viết `van-don.ts` phần địa chỉ**

Tạo `features/dong-hang/van-don.ts`:

```ts
/**
 * THUẦN: luật của bước LÊN VẬN ĐƠN trên màn Đóng hàng. Không I/O.
 *
 * Spec: docs/superpowers/specs/2026-10-12-len-van-don-dong-hang-design.md
 *
 * Vì sao luật nằm hết ở đây: bộ test của repo không bắt `.tsx`, nên luật đặt trong component
 * là luật không ai canh. Hộp thoại chỉ việc vẽ những gì module này trả ra.
 */

export interface DiaChiDon {
  shipName: string | null; shipCompany: string | null;
  shipAddress1: string | null; shipAddress2: string | null;
  shipCity: string | null; shipProvinceCode: string | null;
  shipPostcode: string | null; shipCountry: string | null;
  addrIssue: string | null; addrStandardized: string | null;
  addrDeliverable: boolean | null;
  /** ISO, null = CHƯA verify lần nào → chặn copy khối Người nhận. */
  addrVerifiedAt: string | null;
}

/** Bỏ mọi ký tự không phải chữ rồi viết thường — để so cờ bất kể cách viết của hãng
 *  (`SuiteRequiredButMissing` và `SUITE.NUMBER.REQUIRED` cùng về `suite…`). */
const chuanCo = (v: string | null): string => (v ?? '').toLowerCase().replace(/[^a-z]/g, '');
/** Viết hoa, bỏ khoảng trắng — để so hai mã bưu chính. */
const chuanZip = (v: string): string => v.toUpperCase().replace(/\s+/g, '');

/**
 * ZIP nên dán sang form hãng.
 *
 * `addr_standardized` KHÔNG phải địa chỉ chuẩn hoá đầy đủ — nó chỉ có city/state/ZIP+4
 * ("1395 Silver Moon Drive, Tallahassee 32312" → "TALLAHASSEE, FL, 32312-3934"). Nên việc duy
 * nhất quyết được ở đây là dán ZIP nào, không có chuyện dán đường của hãng thay đường của khách.
 *
 * Ba điều kiện mới dùng ZIP của hãng: nó NỐI TIẾP mã khách gõ (không phải mã của nơi khác), nó
 * DÀI HƠN (có thêm phần +4 mới đáng dán), và cờ KHÔNG phải họ nội suy.
 */
export function chonZip(
  d: Pick<DiaChiDon, 'shipPostcode' | 'addrStandardized' | 'addrIssue'>,
): { zip: string | null; nguon: 'zip4' | 'khach'; vi: string } {
  const goc = (d.shipPostcode ?? '').trim();
  if (goc === '') return { zip: null, nguon: 'khach', vi: 'Đơn không có mã bưu chính' };
  if (chuanCo(d.addrIssue).includes('interpolated')) {
    return {
      zip: goc, nguon: 'khach',
      vi: 'Bỏ ZIP 9 số: hãng nội suy phần +4 từ dải số nhà quanh đó, không tra được chính địa chỉ này',
    };
  }
  const doan = (d.addrStandardized ?? '').split(',').pop()?.trim() ?? '';
  if (doan === '') return { zip: goc, nguon: 'khach', vi: 'Hãng không trả ZIP mở rộng' };
  const a = chuanZip(doan); const b = chuanZip(goc);
  if (a.startsWith(b) && a.length > b.length) {
    return { zip: doan, nguon: 'zip4', vi: 'ZIP 9 số hãng trả — dán số này giảm phí sửa địa chỉ' };
  }
  return { zip: goc, nguon: 'khach', vi: 'ZIP hãng trả không mở rộng mã của khách' };
}

/**
 * Băng cảnh báo địa chỉ.
 *
 * Họ cờ "thiếu/sai số căn hộ" (238 đơn, bốn cách viết, đều chứa chữ `suite`) phải BẮT XÁC NHẬN
 * chứ không chỉ nhắc: đó đúng loại lỗi dẫn tới phí sửa địa chỉ và vụ hoàn hàng ~10tr, và KPI
 * nhân hệ số nghiêm trọng ×2 cho `sai_dia_chi_giao` (D-073, D-076).
 */
export function canhBaoDiaChi(
  d: Pick<DiaChiDon, 'addrIssue'>,
): { muc: 'do' | 'vang' | 'khong'; cau: string | null; batXacNhan: boolean } {
  const c = chuanCo(d.addrIssue);
  if (c === '') return { muc: 'khong', cau: null, batXacNhan: false };
  if (c.includes('suite')) {
    return {
      muc: 'do', batXacNhan: true,
      cau: 'Địa chỉ thiếu hoặc sai số căn hộ — hãng sẽ thu phí sửa địa chỉ hoặc trả hàng về.',
    };
  }
  return {
    muc: 'vang', batXacNhan: false,
    cau: `Hãng đánh dấu địa chỉ: ${d.addrIssue} — kiểm lại trước khi lên vận đơn.`,
  };
}
```

- [ ] **Step 4: Chạy test cho chắc nó PASS**

Run: `npx vitest run features/dong-hang/van-don.test.ts`
Expected: PASS — toàn bộ test trong tệp xanh.

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`
Expected: không in gì.

- [ ] **Step 6: Commit**

```bash
git add features/dong-hang/van-don.ts features/dong-hang/van-don.test.ts
git commit -m "feat(dong-hang): luật chọn ZIP + băng cảnh báo địa chỉ cho bước lên vận đơn"
```

---

### Task 2: Luật kiện và hàng hoá — `nguonCanKien` + `moTaHangHoa`

**Files:**
- Modify: `features/dong-hang/van-don.ts` (thêm vào cuối)
- Test: `features/dong-hang/van-don.test.ts` (thêm vào cuối)

**Interfaces:**
- Consumes: không có gì từ Task 1 (hai hàm độc lập, cùng tệp).
- Produces:
  - `export interface CanKienVao { sms: { hop: string | null; canKg: number | null; dai: number | null; rong: number | null; cao: number | null; luc: string } | null; lark: { hop: string | null; canKg: number | null; dai: number | null; rong: number | null; cao: number | null } | null }`
  - `export function nguonCanKien(v: CanKienVao): { canKg: number | null; dai: number | null; rong: number | null; cao: number | null; hop: string | null; nguon: 'sms' | 'lark' | null; nhan: string; thieu: string[] }`
  - `export function moTaHangHoa(tenSanPham: string, chatLieu: string | null): string`

- [ ] **Step 1: Viết test fail**

Thêm vào cuối `features/dong-hang/van-don.test.ts`:

```ts
import { nguonCanKien, moTaHangHoa } from './van-don';

const sms = { hop: 'A3', canKg: 2.4, dai: 40, rong: 30, cao: 20, luc: '2026-10-12T03:00:00.000Z' };
const lark = { hop: 'B1', canKg: 2.1, dai: 38, rong: 28, cao: 18 };

describe('nguonCanKien', () => {
  it('có bước Đóng thùng của SMS → lấy SMS (lần cân cuối)', () => {
    const r = nguonCanKien({ sms, lark });
    expect(r).toMatchObject({ canKg: 2.4, dai: 40, rong: 30, cao: 20, hop: 'A3', nguon: 'sms', thieu: [] });
    expect(r.nhan).toMatch(/Đóng thùng/);
  });
  it('chưa đóng thùng trong SMS → rơi về Lark, nói rõ nguồn', () => {
    const r = nguonCanKien({ sms: null, lark });
    expect(r).toMatchObject({ canKg: 2.1, hop: 'B1', nguon: 'lark', thieu: [] });
    expect(r.nhan).toMatch(/Lark/);
  });
  it('không có nguồn nào → thiếu cả cân và kích thước', () => {
    const r = nguonCanKien({ sms: null, lark: null });
    expect(r).toMatchObject({ canKg: null, nguon: null });
    expect(r.thieu).toEqual(['cân', 'kích thước']);
  });
  it('có cân nhưng THIẾU một chiều → vẫn tính là thiếu kích thước', () => {
    const r = nguonCanKien({ sms: null, lark: { ...lark, cao: null } });
    expect(r.thieu).toEqual(['kích thước']);
  });
  it('cân 0 không phải cân → tính là thiếu', () => {
    const r = nguonCanKien({ sms: null, lark: { ...lark, canKg: 0 } });
    expect(r.thieu).toEqual(['cân']);
  });
});

describe('moTaHangHoa', () => {
  it('có chất liệu → ghép tên — chất liệu', () => {
    expect(moTaHangHoa('Amy Dress', 'Silk')).toBe('Amy Dress — Silk');
  });
  it('thiếu chất liệu → chỉ tên, KHÔNG để dấu gạch lơ lửng', () => {
    expect(moTaHangHoa('Amy Dress', null)).toBe('Amy Dress');
    expect(moTaHangHoa('Amy Dress', '   ')).toBe('Amy Dress');
  });
});
```

- [ ] **Step 2: Chạy test cho chắc nó FAIL**

Run: `npx vitest run features/dong-hang/van-don.test.ts`
Expected: FAIL — `nguonCanKien is not a function`.

- [ ] **Step 3: Viết hai hàm**

Thêm vào cuối `features/dong-hang/van-don.ts`:

```ts
export interface CanKienVao {
  /** Bước ĐÓNG THÙNG của SMS (`sms_*`, migration 0187) — cột SMS sở hữu. */
  sms: { hop: string | null; canKg: number | null; dai: number | null; rong: number | null; cao: number | null; luc: string } | null;
  /** Số Lark ghi (`actual_weight_kg`, `dim_*`) — đường lùi khi SMS chưa đóng thùng. */
  lark: { hop: string | null; canKg: number | null; dai: number | null; rong: number | null; cao: number | null } | null;
}

/**
 * Cân + kích thước nên dán, kèm nguồn.
 *
 * SMS THẮNG Lark: bước Đóng thùng là lần cân cuối và là cột SMS sở hữu (đồng bộ Lark không
 * đụng). Hai số có thể khác nhau nên LUÔN nói ra đang lấy từ đâu.
 *
 * KHÔNG BAO GIỜ rơi về cân dự kiến của các món: nó cộng cân từng món đã tính một hộp mỗi món,
 * nên nhiều món gộp một thùng thì nó CAO HƠN cân kiện thật — xem `NHAN_DU_KIEN` trong
 * `can-du-kien.ts`. Thiếu thì nói thiếu, không điền số gần đúng.
 */
export function nguonCanKien(v: CanKienVao): {
  canKg: number | null; dai: number | null; rong: number | null; cao: number | null;
  hop: string | null; nguon: 'sms' | 'lark' | null; nhan: string; thieu: string[];
} {
  const nguon: 'sms' | 'lark' | null = v.sms ? 'sms' : v.lark ? 'lark' : null;
  const chon = v.sms ?? v.lark;
  const nhan = nguon === 'sms'
    ? 'cân + kích thước từ bước Đóng thùng của SMS'
    : nguon === 'lark'
      ? 'cân + kích thước Lark ghi (SMS chưa đóng thùng)'
      : 'chưa có cân và kích thước';
  const thieu: string[] = [];
  if (!chon || chon.canKg == null || !(chon.canKg > 0)) thieu.push('cân');
  if (!chon || chon.dai == null || chon.rong == null || chon.cao == null) thieu.push('kích thước');
  return {
    canKg: chon?.canKg ?? null, dai: chon?.dai ?? null, rong: chon?.rong ?? null,
    cao: chon?.cao ?? null, hop: chon?.hop ?? null, nguon, nhan, thieu,
  };
}

/** Ô "Description of goods" của form hãng: `<tên> — <chất liệu>`; thiếu chất liệu thì chỉ tên. */
export function moTaHangHoa(tenSanPham: string, chatLieu: string | null): string {
  const t = tenSanPham.trim();
  const c = (chatLieu ?? '').trim();
  return c === '' ? t : `${t} — ${c}`;
}
```

- [ ] **Step 4: Chạy test cho chắc nó PASS**

Run: `npx vitest run features/dong-hang/van-don.test.ts`
Expected: PASS — toàn bộ test trong tệp xanh.

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`
Expected: không in gì.

- [ ] **Step 6: Commit**

```bash
git add features/dong-hang/van-don.ts features/dong-hang/van-don.test.ts
git commit -m "feat(dong-hang): luật nguồn cân kiện + mô tả hàng hoá"
```

---

### Task 3: Lắp bốn khối — `dungKhoiVanDon` + `vanBanKhoi`

**Files:**
- Modify: `features/dong-hang/van-don.ts` (thêm vào cuối)
- Test: `features/dong-hang/van-don.test.ts` (thêm vào cuối)

**Interfaces:**
- Consumes: `DiaChiDon`, `chonZip`, `canhBaoDiaChi` (Task 1); `CanKienVao`, `nguonCanKien`, `moTaHangHoa` (Task 2); `canQuyDoi` từ `./logic` (đã có: `canQuyDoi(weightKg: number | null, dims: { l: number; w: number; h: number | null } | null): { quyDoi: number | null; tinhCuoc: number | null; theo: 'quy_doi' | 'thuc' | null }`).
- Produces:
  - `export interface O { nhan: string; giaTri: string | null; vi?: string; chiDeXem?: boolean }`
  - `export interface Khoi { ten: string; o: O[]; chanCopy: boolean; lyDoChan: string | null; canhBao: { muc: 'do' | 'vang' | 'khong'; cau: string | null; batXacNhan: boolean } | null }`
  - `export interface MonHang { tenSanPham: string; sku: string | null; soLuong: number; chatLieu: string | null }`
  - `export interface VaoKhoiVanDon { diaChi: DiaChiDon; tuShopify: { phone: string | null; email: string | null } | null; can: CanKienVao; mon: MonHang[]; soKien: { n: number; tong: number } | null }`
  - `export function dungKhoiVanDon(vao: VaoKhoiVanDon): Khoi[]`
  - `export function vanBanKhoi(k: Khoi): string`

- [ ] **Step 1: Viết test fail**

Thêm vào cuối `features/dong-hang/van-don.test.ts`:

```ts
import { dungKhoiVanDon, vanBanKhoi, type VaoKhoiVanDon } from './van-don';

const DIA_CHI = {
  shipName: 'Jane Doe', shipCompany: null,
  shipAddress1: '1395 Silver Moon Drive', shipAddress2: null,
  shipCity: 'Tallahassee', shipProvinceCode: 'US-FL',
  shipPostcode: '32312', shipCountry: 'US',
  addrIssue: null, addrStandardized: 'TALLAHASSEE, FL, 32312-3934',
  addrDeliverable: true, addrVerifiedAt: '2026-10-01T00:00:00.000Z',
};
const vao = (over: Partial<VaoKhoiVanDon> = {}): VaoKhoiVanDon => ({
  diaChi: DIA_CHI,
  tuShopify: { phone: '+1 850 555 0100', email: 'jane@example.com' },
  can: { sms, lark: null },
  mon: [{ tenSanPham: 'Amy Dress', sku: 'RS25-AmyDress-M-CRW', soLuong: 1, chatLieu: 'Silk' }],
  soKien: { n: 1, tong: 1 },
  ...over,
});

describe('dungKhoiVanDon', () => {
  it('đủ bốn khối, đúng thứ tự', () => {
    expect(dungKhoiVanDon(vao()).map((k) => k.ten))
      .toEqual(['Người nhận', 'Kiện hàng', 'Hàng hoá', 'Khai hải quan']);
  });
  it('khối Người nhận dán ZIP 9 số và có SĐT từ Shopify', () => {
    const k = dungKhoiVanDon(vao())[0];
    expect(k.o.find((x) => x.nhan === 'ZIP')?.giaTri).toBe('32312-3934');
    expect(k.o.find((x) => x.nhan === 'SĐT')?.giaTri).toBe('+1 850 555 0100');
    expect(k.chanCopy).toBe(false);
  });
  it('chưa verify → CHẶN copy khối Người nhận, các khối khác vẫn copy được', () => {
    const ks = dungKhoiVanDon(vao({ diaChi: { ...DIA_CHI, addrVerifiedAt: null } }));
    expect(ks[0]).toMatchObject({ chanCopy: true });
    expect(ks[0].lyDoChan).toMatch(/chưa verify/);
    expect(ks.slice(1).every((k) => k.chanCopy === false)).toBe(true);
  });
  it('cờ số căn hộ → băng đỏ trên khối Người nhận', () => {
    const k = dungKhoiVanDon(vao({ diaChi: { ...DIA_CHI, addrIssue: 'SuiteRequiredButMissing' } }))[0];
    expect(k.canhBao).toMatchObject({ muc: 'do', batXacNhan: true });
  });
  it('Shopify không gọi được → ô SĐT/email nói rõ, KHÔNG để trống im lặng', () => {
    const ks = dungKhoiVanDon(vao({ tuShopify: null }));
    const sdt = ks[0].o.find((x) => x.nhan === 'SĐT')!;
    expect(sdt.giaTri).toBeNull();
    expect(sdt.vi).toMatch(/không lấy được từ Shopify/);
    expect(ks[0].chanCopy).toBe(false);
  });
  it('thiếu kích thước → CHẶN copy khối Kiện hàng', () => {
    const ks = dungKhoiVanDon(vao({ can: { sms: null, lark: { hop: 'B1', canKg: 2, dai: 38, rong: 28, cao: null } } }));
    expect(ks[1]).toMatchObject({ chanCopy: true });
    expect(ks[1].lyDoChan).toMatch(/kích thước/);
    expect(ks[0].chanCopy).toBe(false);
  });
  it('khối Kiện hàng có cân quy đổi và nó CHỈ ĐỂ XEM', () => {
    const o = dungKhoiVanDon(vao())[1].o.find((x) => x.nhan === 'Cân quy đổi')!;
    expect(o.chiDeXem).toBe(true);
  });
  it('số kiện: 1 kiện → 1/1; 2 kiện → n/2; chưa có mã Lark → — kèm lý do', () => {
    expect(dungKhoiVanDon(vao())[1].o.find((x) => x.nhan === 'Số kiện')?.giaTri).toBe('1/1');
    expect(dungKhoiVanDon(vao({ soKien: { n: 2, tong: 2 } }))[1].o.find((x) => x.nhan === 'Số kiện')?.giaTri).toBe('2/2');
    const o = dungKhoiVanDon(vao({ soKien: null }))[1].o.find((x) => x.nhan === 'Số kiện')!;
    expect(o.giaTri).toBeNull();
    expect(o.vi).toMatch(/chưa có mã Lark/);
  });
  it('mỗi món ba ô: mô tả, SKU, số lượng', () => {
    const k = dungKhoiVanDon(vao())[2];
    expect(k.o.map((x) => x.nhan)).toEqual(['Món 1 — mô tả', 'Món 1 — SKU', 'Món 1 — số lượng']);
    expect(k.o[0].giaTri).toBe('Amy Dress — Silk');
  });
  /* Đơn nhiều kiện: không đoán món nào thuộc kiện nào (sku_text Lark là chuỗi dính liền và
   * null ở 6/12 kiện mẫu) — liệt kê đủ và để người đóng tự chọn. */
  it('đơn nhiều kiện → băng vàng trên khối Hàng hoá', () => {
    const k = dungKhoiVanDon(vao({ soKien: { n: 1, tong: 2 } }))[2];
    expect(k.canhBao).toMatchObject({ muc: 'vang' });
    expect(k.canhBao?.cau).toMatch(/2 kiện/);
  });
  it('khối Khai hải quan: 5 ô, tất cả để trống kèm câu "gõ tay"', () => {
    const k = dungKhoiVanDon(vao())[3];
    expect(k.o.map((x) => x.nhan))
      .toEqual(['Giá trị khai', 'Đơn vị tiền', 'HS code', 'Nước xuất xứ', 'Loại dịch vụ']);
    expect(k.o.every((x) => x.giaTri === null && /gõ tay/.test(x.vi ?? ''))).toBe(true);
    expect(k.chanCopy).toBe(false);
  });
});

describe('vanBanKhoi', () => {
  it('mỗi dòng `Nhãn: giá trị`, ô trống hiện —, bỏ ô chỉ-để-xem', () => {
    const t = vanBanKhoi(dungKhoiVanDon(vao())[1]);
    expect(t).toContain('Cân thực (kg): 2.4');
    expect(t).toContain('Loại hộp: A3');
    expect(t).not.toContain('Cân quy đổi');
    expect(vanBanKhoi(dungKhoiVanDon(vao())[3])).toContain('HS code: —');
  });
});
```

- [ ] **Step 2: Chạy test cho chắc nó FAIL**

Run: `npx vitest run features/dong-hang/van-don.test.ts`
Expected: FAIL — `dungKhoiVanDon is not a function`.

- [ ] **Step 3: Viết phần lắp khối**

Thêm `import { canQuyDoi } from './logic';` vào đầu `features/dong-hang/van-don.ts`, rồi thêm vào cuối tệp:

```ts
export interface O {
  nhan: string;
  giaTri: string | null;
  /** Câu giải thích hiện cạnh ô — vì sao giá trị là thế này, hoặc vì sao nó trống. */
  vi?: string;
  /** Ô tham khảo, KHÔNG vào văn bản "copy cả khối" (dán sang form hãng là rác). */
  chiDeXem?: boolean;
}

export interface Khoi {
  ten: string;
  o: O[];
  chanCopy: boolean;
  lyDoChan: string | null;
  canhBao: { muc: 'do' | 'vang' | 'khong'; cau: string | null; batXacNhan: boolean } | null;
}

export interface MonHang {
  /** `product_title` (+ `variant_title` khi có) của dòng đơn. */
  tenSanPham: string;
  sku: string | null;
  soLuong: number;
  /** Metafield `custom.materials_v2` qua `locThuocTinh`; null khi Shopify không trả được. */
  chatLieu: string | null;
}

export interface VaoKhoiVanDon {
  diaChi: DiaChiDon;
  /** null = không gọi được Shopify → ô SĐT/email nói rõ thay vì để trống im lặng. */
  tuShopify: { phone: string | null; email: string | null } | null;
  can: CanKienVao;
  mon: MonHang[];
  /** `n/N` của kiện trong đơn; null khi kiện chưa có mã Lark. */
  soKien: { n: number; tong: number } | null;
}

const KHONG_LAY_DUOC = 'không lấy được từ Shopify — thử lại';
const GO_TAY = 'gõ tay bên cổng hãng';
const so = (n: number | null): string | null => (n == null ? null : String(n));

/** Bốn khối của hộp thoại Lên vận đơn, theo đúng thứ tự người lên vận đơn điền form. */
export function dungKhoiVanDon(vao: VaoKhoiVanDon): Khoi[] {
  const d = vao.diaChi;
  const zip = chonZip(d);
  const can = nguonCanKien(vao.can);
  const qd = canQuyDoi(can.canKg, can.dai != null && can.rong != null ? { l: can.dai, w: can.rong, h: can.cao } : null);

  const nguoiNhan: Khoi = {
    ten: 'Người nhận',
    o: [
      { nhan: 'Tên', giaTri: d.shipName },
      { nhan: 'Công ty', giaTri: d.shipCompany },
      { nhan: 'Địa chỉ 1', giaTri: d.shipAddress1 },
      { nhan: 'Địa chỉ 2', giaTri: d.shipAddress2 },
      { nhan: 'Thành phố', giaTri: d.shipCity },
      // Mã bang Shopify mang tiền tố nước ("US-FL") — form hãng chỉ nhận phần sau.
      { nhan: 'Bang / Tỉnh', giaTri: d.shipProvinceCode ? (d.shipProvinceCode.split('-').pop() ?? null) : null },
      { nhan: 'ZIP', giaTri: zip.zip, vi: zip.vi },
      { nhan: 'Nước', giaTri: d.shipCountry },
      { nhan: 'SĐT', giaTri: vao.tuShopify?.phone ?? null, ...(vao.tuShopify ? {} : { vi: KHONG_LAY_DUOC }) },
      { nhan: 'Email', giaTri: vao.tuShopify?.email ?? null, ...(vao.tuShopify ? {} : { vi: KHONG_LAY_DUOC }) },
    ],
    chanCopy: d.addrVerifiedAt == null,
    lyDoChan: d.addrVerifiedAt == null ? 'Địa chỉ chưa verify — bấm "Verify ngay" trước khi copy' : null,
    canhBao: canhBaoDiaChi(d),
  };

  const kienHang: Khoi = {
    ten: 'Kiện hàng',
    o: [
      { nhan: 'Cân thực (kg)', giaTri: so(can.canKg), vi: can.nhan },
      { nhan: 'Dài (cm)', giaTri: so(can.dai) },
      { nhan: 'Rộng (cm)', giaTri: so(can.rong) },
      { nhan: 'Cao (cm)', giaTri: so(can.cao) },
      { nhan: 'Loại hộp', giaTri: can.hop },
      {
        nhan: 'Số kiện',
        giaTri: vao.soKien ? `${vao.soKien.n}/${vao.soKien.tong}` : null,
        ...(vao.soKien ? {} : { vi: 'kiện chưa có mã Lark nên không biết thứ tự' }),
      },
      {
        nhan: 'Cân quy đổi', giaTri: so(qd.quyDoi), chiDeXem: true,
        vi: qd.tinhCuoc != null ? `hãng tính cước theo ${qd.tinhCuoc} kg` : 'chưa đủ số để tính',
      },
    ],
    chanCopy: can.thieu.length > 0,
    lyDoChan: can.thieu.length > 0
      ? `Thiếu ${can.thieu.join(' và ')} — phải cân lại trước khi lên vận đơn`
      : null,
    canhBao: null,
  };

  const hangHoa: Khoi = {
    ten: 'Hàng hoá',
    o: vao.mon.flatMap((m, i) => [
      { nhan: `Món ${i + 1} — mô tả`, giaTri: moTaHangHoa(m.tenSanPham, m.chatLieu) },
      { nhan: `Món ${i + 1} — SKU`, giaTri: m.sku },
      { nhan: `Món ${i + 1} — số lượng`, giaTri: String(m.soLuong) },
    ]),
    chanCopy: false,
    lyDoChan: null,
    canhBao: (vao.soKien?.tong ?? 1) > 1
      ? {
          muc: 'vang', batXacNhan: false,
          cau: `Đơn này có ${vao.soKien!.tong} kiện — tự chọn món nào thuộc kiện này.`,
        }
      : null,
  };

  const haiQuan: Khoi = {
    ten: 'Khai hải quan',
    o: [
      { nhan: 'Giá trị khai', giaTri: null, vi: GO_TAY },
      { nhan: 'Đơn vị tiền', giaTri: null, vi: GO_TAY },
      { nhan: 'HS code', giaTri: null, vi: GO_TAY },
      { nhan: 'Nước xuất xứ', giaTri: null, vi: GO_TAY },
      // Spec xếp "Loại dịch vụ" vào khối này dù nó không phải khoản hải quan: bốn ô đều
      // là ô NGƯỜI GÕ TAY bên cổng hãng, gom một chỗ thì người lên vận đơn quét một lượt.
      { nhan: 'Loại dịch vụ', giaTri: null, vi: GO_TAY },
    ],
    chanCopy: false, lyDoChan: null, canhBao: null,
  };

  return [nguoiNhan, kienHang, hangHoa, haiQuan];
}

/** Văn bản cho nút "copy cả khối". Bỏ ô chỉ-để-xem; ô trống hiện `—`. */
export function vanBanKhoi(k: Khoi): string {
  return k.o.filter((x) => !x.chiDeXem).map((x) => `${x.nhan}: ${x.giaTri ?? '—'}`).join('\n');
}
```

- [ ] **Step 4: Chạy test cho chắc nó PASS**

Run: `npx vitest run features/dong-hang/van-don.test.ts`
Expected: PASS — toàn bộ test trong tệp xanh.

- [ ] **Step 5: tsc + eslint**

Run: `npx tsc --noEmit && npx eslint features/dong-hang/van-don.ts features/dong-hang/van-don.test.ts`
Expected: cả hai không in gì.

- [ ] **Step 6: Commit**

```bash
git add features/dong-hang/van-don.ts features/dong-hang/van-don.test.ts
git commit -m "feat(dong-hang): lắp bốn khối thông tin lên vận đơn + văn bản copy cả khối"
```

---

### Task 4: Phía máy chủ — đọc CSDL, gọi Shopify, verify lại

**Files:**
- Modify: `features/dong-hang/queries.ts` (thêm hàm vào cuối)
- Modify: `features/dong-hang/actions.ts` (thêm hai action vào cuối)

**Interfaces:**
- Consumes: `dungKhoiVanDon`, `VaoKhoiVanDon`, `Khoi`, `MonHang`, `DiaChiDon`, `CanKienVao` (Task 3); `locThuocTinh` từ `@/features/kho-nhan/thuoc-tinh-shopify`; `verifyAndStoreOrderAddress` từ `@/features/shopify-orders/address-verify`; `getStoreToken`, `graphqlCall` từ `@/lib/shopify/client`.
- Produces:
  - `export async function docNenVanDon(shipmentId: string): Promise<NenVanDon | null>` trong `queries.ts`, với `export interface NenVanDon { storeId: string; shopDomain: string; apiVersion: string; shopifyOrderId: string; orderId: string; diaChi: DiaChiDon; can: CanKienVao; mon: MonHang[]; soKien: { n: number; tong: number } | null }`
  - `export async function layKhoiVanDon(shipmentId: string): Promise<{ ok: true; khoi: Khoi[]; luc: string } | { ok: false; loi: string }>` trong `actions.ts`
  - `export async function verifyDiaChiKien(shipmentId: string): Promise<{ ok: boolean; loi?: string }>` trong `actions.ts`

- [ ] **Step 1: Thêm hàm đọc vào `queries.ts`**

Thêm vào cuối `features/dong-hang/queries.ts` (tệp đã có `import { db, schema } from '@/db/client'` và các toán tử drizzle — thêm `asc` vào danh sách import từ `drizzle-orm` nếu chưa có):

```ts
import type { CanKienVao, DiaChiDon, MonHang } from './van-don';

export interface NenVanDon {
  storeId: string; shopDomain: string; apiVersion: string;
  shopifyOrderId: string; orderId: string;
  diaChi: DiaChiDon; can: CanKienVao; mon: MonHang[];
  soKien: { n: number; tong: number } | null;
}

const soHoacNull = (v: string | null): number | null => (v == null ? null : Number(v));

/**
 * Mọi thứ hộp thoại Lên vận đơn cần mà CSDL đã có. Không gọi mạng.
 *
 * `soKien`: `tong` đếm kiện của đơn CÓ mã Lark; `n` là thứ tự của kiện này khi sắp mã Lark
 * tăng dần — chọn cách sắp này vì mã kiện Lark (`PK-…`) là khoá duy nhất và ổn định, không
 * phụ thuộc thứ tự truy vấn. Kiện chưa có mã Lark → null, KHÔNG đoán thứ tự.
 */
export async function docNenVanDon(shipmentId: string): Promise<NenVanDon | null> {
  const [r] = await db.select({
    orderId: schema.shopifyOrders.id,
    storeId: schema.shopifyOrders.storeId,
    shopifyOrderId: schema.shopifyOrders.shopifyOrderId,
    shopDomain: schema.stores.shopDomain,
    apiVersion: schema.stores.apiVersion,
    logUniqueCode: schema.shipments.logUniqueCode,
    shipName: schema.shopifyOrders.shipName, shipCompany: schema.shopifyOrders.shipCompany,
    shipAddress1: schema.shopifyOrders.shipAddress1, shipAddress2: schema.shopifyOrders.shipAddress2,
    shipCity: schema.shopifyOrders.shipCity, shipProvinceCode: schema.shopifyOrders.shipProvinceCode,
    shipPostcode: schema.shopifyOrders.shipPostcode, shipCountry: schema.shopifyOrders.shipCountry,
    addrIssue: schema.shopifyOrders.addrIssue, addrStandardized: schema.shopifyOrders.addrStandardized,
    addrDeliverable: schema.shopifyOrders.addrDeliverable, addrVerifiedAt: schema.shopifyOrders.addrVerifiedAt,
    smsHop: schema.shipments.smsHop, smsCan: schema.shipments.smsWeightKg,
    smsL: schema.shipments.smsDimLengthCm, smsW: schema.shipments.smsDimWidthCm,
    smsH: schema.shipments.smsDimHeightCm, smsLuc: schema.shipments.smsPackedAt,
    larkHop: schema.shipments.larkHop, larkCan: schema.shipments.actualWeightKg,
    larkL: schema.shipments.dimLengthCm, larkW: schema.shipments.dimWidthCm, larkH: schema.shipments.dimHeightCm,
  })
    .from(schema.shipments)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .where(eq(schema.shipments.id, shipmentId))
    .limit(1);
  if (!r) return null;

  const dong = await db.select({
    productTitle: schema.shopifyOrderLines.productTitle,
    variantTitle: schema.shopifyOrderLines.variantTitle,
    sku: schema.shopifyOrderLines.sku,
    quantity: schema.shopifyOrderLines.quantity,
  }).from(schema.shopifyOrderLines).where(eq(schema.shopifyOrderLines.orderId, r.orderId));

  const maKien = await db.select({ ma: schema.shipments.logUniqueCode })
    .from(schema.shipments)
    .where(and(eq(schema.shipments.orderId, r.orderId), isNotNull(schema.shipments.logUniqueCode)))
    .orderBy(asc(schema.shipments.logUniqueCode));
  const ds = maKien.map((x) => x.ma!).filter(Boolean);
  const viTri = r.logUniqueCode ? ds.indexOf(r.logUniqueCode) : -1;

  return {
    storeId: r.storeId, shopDomain: r.shopDomain, apiVersion: r.apiVersion,
    shopifyOrderId: r.shopifyOrderId, orderId: r.orderId,
    diaChi: {
      shipName: r.shipName, shipCompany: r.shipCompany,
      shipAddress1: r.shipAddress1, shipAddress2: r.shipAddress2,
      shipCity: r.shipCity, shipProvinceCode: r.shipProvinceCode,
      shipPostcode: r.shipPostcode, shipCountry: r.shipCountry,
      addrIssue: r.addrIssue, addrStandardized: r.addrStandardized,
      addrDeliverable: r.addrDeliverable,
      addrVerifiedAt: r.addrVerifiedAt ? r.addrVerifiedAt.toISOString() : null,
    },
    can: {
      sms: r.smsLuc != null ? {
        hop: r.smsHop, canKg: soHoacNull(r.smsCan), dai: soHoacNull(r.smsL),
        rong: soHoacNull(r.smsW), cao: soHoacNull(r.smsH), luc: r.smsLuc.toISOString(),
      } : null,
      lark: {
        hop: r.larkHop, canKg: soHoacNull(r.larkCan), dai: soHoacNull(r.larkL),
        rong: soHoacNull(r.larkW), cao: soHoacNull(r.larkH),
      },
    },
    mon: dong.map((l) => ({
      tenSanPham: [l.productTitle, l.variantTitle].filter(Boolean).join(' · '),
      sku: l.sku, soLuong: l.quantity, chatLieu: null,
    })),
    soKien: viTri >= 0 ? { n: viTri + 1, tong: ds.length } : null,
  };
}
```

- [ ] **Step 2: Kiểm import của `queries.ts`**

Mở đầu tệp và bảo đảm `drizzle-orm` import có đủ `and`, `asc`, `eq`, `isNotNull`. Thiếu thì thêm.

Run: `npx tsc --noEmit`
Expected: không in gì.

- [ ] **Step 3: Thêm hai action vào `actions.ts`**

Thêm vào cuối `features/dong-hang/actions.ts`:

```ts
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { locThuocTinh, type MetafieldTho } from '@/features/kho-nhan/thuoc-tinh-shopify';
import { verifyAndStoreOrderAddress } from '@/features/shopify-orders/address-verify';
import { docNenVanDon } from './queries';
import { dungKhoiVanDon, type Khoi } from './van-don';

const TRUY_VAN_VAN_DON = `query($id: ID!) {
  order(id: $id) {
    email
    shippingAddress { phone }
    lineItems(first: 50) { nodes {
      sku
      product { metafields(first: 50) { nodes {
        namespace key value
        reference { ... on Metaobject { displayName } }
        references(first: 10) { nodes { ... on Metaobject { displayName } } } } } } } } }
}`;

interface DongShopify { sku?: string | null; product?: { metafields?: { nodes?: MetafieldTho[] } | null } | null }

const cacheVanDon = new Map<string, { khoi: Khoi[]; luc: string }>();

/**
 * Khối thông tin cho bước LÊN VẬN ĐƠN của một kiện.
 *
 * Một lượt gọi Shopify lấy đúng ba thứ CSDL không có: SĐT (bộ sync không kéo field `phone`,
 * 0/13.125 đơn), email, và chất liệu (`custom.materials_v2`). Lấy live chứ không backfill vì
 * chỉ cần đơn đang lên vận đơn và live thì luôn là số mới nhất.
 *
 * Shopify hỏng thì KHÔNG ném: `tuShopify = null`, hộp thoại vẫn mở với địa chỉ + cân + SKU từ
 * CSDL, ô SĐT/email nói rõ "không lấy được". Đi theo đúng nguyên tắc của `layDuLieuQc` bên QC —
 * mất ảnh/thuộc tính thì mất, không chặn người làm việc.
 */
export async function layKhoiVanDon(
  shipmentId: string,
): Promise<{ ok: true; khoi: Khoi[]; luc: string } | { ok: false; loi: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, loi: 'Chưa đăng nhập' };
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_fulfillment')) return { ok: false, loi: 'Không có quyền' };

  const hit = cacheVanDon.get(shipmentId);
  if (hit && Date.now() - new Date(hit.luc).getTime() < CACHE_MS) return { ok: true, ...hit };

  const nen = await docNenVanDon(shipmentId);
  if (!nen) return { ok: false, loi: 'Không tìm thấy kiện' };

  let tuShopify: { phone: string | null; email: string | null } | null = null;
  let theoSku = new Map<string, string | null>();
  try {
    const token = await getStoreToken(nen.storeId);
    const r = await graphqlCall({
      shopDomain: nen.shopDomain, apiVersion: nen.apiVersion, token,
      query: TRUY_VAN_VAN_DON, variables: { id: nen.shopifyOrderId },
    }) as { data?: { order?: { email?: string | null; shippingAddress?: { phone?: string | null } | null; lineItems?: { nodes?: DongShopify[] } } | null } };
    const don = r.data?.order;
    if (don) {
      tuShopify = { phone: don.shippingAddress?.phone ?? null, email: don.email ?? null };
      theoSku = new Map((don.lineItems?.nodes ?? []).map((l) => [
        (l.sku ?? '').trim(),
        locThuocTinh(l.product?.metafields?.nodes ?? []).hien.find((x) => x.nhan === 'Chất liệu')?.giaTri ?? null,
      ]));
    }
  } catch (e) {
    console.error('[dong-hang] layKhoiVanDon: Shopify lỗi:', e);
  }

  const khoi = dungKhoiVanDon({
    diaChi: nen.diaChi, tuShopify, can: nen.can, soKien: nen.soKien,
    mon: nen.mon.map((m) => ({ ...m, chatLieu: theoSku.get((m.sku ?? '').trim()) ?? null })),
  });
  const kq = { khoi, luc: new Date().toISOString() };
  cacheVanDon.set(shipmentId, kq);
  return { ok: true, ...kq };
}

/**
 * Verify lại địa chỉ NGAY tại bước lên vận đơn.
 *
 * Gác `chon_line_ship`, KHÔNG dùng `verifyOrderAddressAction` của features/fulfillment: hàm đó
 * đòi `manage_fulfillment` mà vai trò `logistics` không có. Lõi verify thì dùng lại nguyên, không
 * viết luật thứ hai.
 */
export async function verifyDiaChiKien(shipmentId: string): Promise<{ ok: boolean; loi?: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, loi: 'Chưa đăng nhập' };
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'chon_line_ship')) return { ok: false, loi: 'Không có quyền verify địa chỉ' };

  const [k] = await db.select({ orderId: schema.shipments.orderId })
    .from(schema.shipments).where(eq(schema.shipments.id, shipmentId)).limit(1);
  if (!k) return { ok: false, loi: 'Không tìm thấy kiện' };

  const r = await verifyAndStoreOrderAddress(k.orderId);
  // Khối đã dựng mang kết quả verify cũ — bỏ đi để lượt mở sau đọc lại.
  cacheVanDon.delete(shipmentId);
  revalidatePath('/f/dong-hang');
  return r.ok ? { ok: true } : { ok: false, loi: r.error ?? 'Verify thất bại' };
}
```

- [ ] **Step 4: tsc + eslint**

Run: `npx tsc --noEmit && npx eslint features/dong-hang/actions.ts features/dong-hang/queries.ts`
Expected: cả hai không in gì.

- [ ] **Step 5: Thử trên dữ liệu thật bằng script tạm**

Tạo `scripts/_tmp-van-don.ts`:

```ts
import 'dotenv/config';
import { docNenVanDon } from '@/features/dong-hang/queries';
import { dungKhoiVanDon, vanBanKhoi } from '@/features/dong-hang/van-don';
import { db, schema } from '@/db/client';
import { isNull } from 'drizzle-orm';

async function main() {
  const kien = await db.select({ id: schema.shipments.id })
    .from(schema.shipments).where(isNull(schema.shipments.trackingNumber)).limit(3);
  for (const k of kien) {
    const nen = await docNenVanDon(k.id);
    if (!nen) { console.log(k.id, 'không đọc được'); continue; }
    // tuShopify null = đúng ca Shopify hỏng, kiểm luôn đường lùi.
    const khoi = dungKhoiVanDon({ ...nen, tuShopify: null });
    console.log(`\n=== kiện ${k.id} · đơn ${nen.shopifyOrderId} · số kiện ${JSON.stringify(nen.soKien)} ===`);
    for (const b of khoi) {
      console.log(`-- ${b.ten}${b.chanCopy ? ` [CHẶN: ${b.lyDoChan}]` : ''}${b.canhBao?.cau ? ` [${b.canhBao.muc}: ${b.canhBao.cau}]` : ''}`);
      console.log(vanBanKhoi(b).split('\n').map((x) => '   ' + x).join('\n'));
    }
  }
  process.exit(0);
}
void main();
```

Run: `npx dotenv -- npx tsx scripts/_tmp-van-don.ts`
Expected: in ra 3 kiện, mỗi kiện 4 khối. Kiểm bằng mắt: ZIP đúng luật, khối Kiện hàng bị chặn khi thiếu kích thước, số kiện `1/1`.
Rồi xoá script: `rm scripts/_tmp-van-don.ts`

- [ ] **Step 6: Commit**

```bash
git add features/dong-hang/queries.ts features/dong-hang/actions.ts
git commit -m "feat(dong-hang): action lấy khối lên vận đơn (CSDL + một lượt Shopify) và verify lại địa chỉ"
```

---

### Task 5: Hộp thoại + nút mở

**Files:**
- Create: `components/dong-hang/HopThoaiVanDon.tsx`
- Modify: `components/dong-hang/BangDongHang.tsx:394-408` (thêm nút cạnh nút "So cước & chọn")

**Interfaces:**
- Consumes: `layKhoiVanDon`, `verifyDiaChiKien` (Task 4); `Khoi`, `O`, `vanBanKhoi` (Task 3); `Dialog, DialogContent, DialogHeader, DialogTitle` từ `@/components/ui/dialog`.
- Produces: `export function HopThoaiVanDon(p: { shipmentId: string; maKien: string | null; dong: boolean; coQuyenChon: boolean; onDong: () => void })` — `dong` là cờ đóng/mở do cha giữ, `onDong` để cha tắt cờ; component tự gọi `layKhoiVanDon` lúc mở.

- [ ] **Step 1: Viết component**

Tạo `components/dong-hang/HopThoaiVanDon.tsx`:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { Copy, Check, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { layKhoiVanDon, verifyDiaChiKien } from '@/features/dong-hang/actions';
import { vanBanKhoi, type Khoi, type O } from '@/features/dong-hang/van-don';

/** Nút copy một ô hoặc cả khối. Đổi sang dấu tích 1,5 giây để người dùng biết đã copy. */
function NutCopy({ text, nhan, tat }: { text: string; nhan: string; tat: boolean }) {
  const [xong, setXong] = useState(false);
  return (
    <button
      type="button" disabled={tat || text === '' || text === '—'}
      aria-label={`Copy ${nhan}`}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setXong(true);
          setTimeout(() => setXong(false), 1500);
        }).catch(() => undefined);
      }}
      className="shrink-0 cursor-pointer rounded border border-border p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {xong ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function DongO({ o, tat }: { o: O; tat: boolean }) {
  return (
    <div className="flex items-start gap-2 border-b border-border/60 py-1.5 last:border-0">
      <span className="w-36 shrink-0 text-xs text-muted-foreground">{o.nhan}</span>
      <span className="min-w-0 flex-1 break-words text-[13px] font-medium tabular-nums">
        {o.giaTri ?? <span className="font-normal text-muted-foreground">—</span>}
        {o.vi && <span className="mt-0.5 block text-[11px] font-normal leading-snug text-muted-foreground">{o.vi}</span>}
      </span>
      {!o.chiDeXem && <NutCopy text={o.giaTri ?? ''} nhan={o.nhan} tat={tat} />}
    </div>
  );
}

export function HopThoaiVanDon({
  shipmentId, maKien, dong, coQuyenChon, onDong,
}: {
  shipmentId: string; maKien: string | null; dong: boolean; coQuyenChon: boolean; onDong: () => void;
}) {
  const [khoi, setKhoi] = useState<Khoi[] | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [daXacNhan, setDaXacNhan] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!dong) return;
    setLoi(null);
    void layKhoiVanDon(shipmentId).then((r) => {
      if (r.ok) setKhoi(r.khoi); else setLoi(r.loi);
    });
  }, [dong, shipmentId]);

  const verify = () => start(async () => {
    const r = await verifyDiaChiKien(shipmentId);
    if (!r.ok) { setLoi(r.loi ?? 'Verify thất bại'); return; }
    const lai = await layKhoiVanDon(shipmentId);
    if (lai.ok) setKhoi(lai.khoi);
  });

  return (
    <Dialog open={dong} onOpenChange={(o) => { if (!o) { onDong(); setDaXacNhan(false); } }}>
      <DialogContent className="w-[95vw] max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Lên vận đơn{maKien ? ` · ${maKien}` : ''}
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Copy từng ô sang form của hãng. Hệ thống không tạo nhãn — nhãn vẫn lên ở cổng hãng như cũ.
        </p>

        {loi && <p className="text-sm text-destructive">{loi}</p>}
        {!khoi && !loi && <p className="text-xs text-muted-foreground animate-pulse">Đang lấy thông tin…</p>}

        {khoi?.map((b) => {
          const chanDo = b.canhBao?.batXacNhan === true && !daXacNhan;
          const tat = b.chanCopy || chanDo;
          return (
            <section key={b.ten} className="space-y-1 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{b.ten}</h3>
                <NutCopy text={vanBanKhoi(b)} nhan={`cả khối ${b.ten}`} tat={tat} />
              </div>

              {b.canhBao?.cau && (
                <div className={`flex items-start gap-2 rounded-md p-2 text-xs ${
                  b.canhBao.muc === 'do'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                }`}>
                  {b.canhBao.muc === 'do' ? <ShieldAlert className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
                  <div className="space-y-1">
                    <p>{b.canhBao.cau}</p>
                    {b.canhBao.batXacNhan && (
                      <label className="flex cursor-pointer items-center gap-1.5 font-medium">
                        <input type="checkbox" checked={daXacNhan} onChange={(e) => setDaXacNhan(e.target.checked)} />
                        Tôi đã kiểm và vẫn lên vận đơn
                      </label>
                    )}
                  </div>
                </div>
              )}

              {b.chanCopy && (
                <div className="flex items-center justify-between gap-2 rounded-md bg-muted p-2 text-xs">
                  <span>{b.lyDoChan}</span>
                  {b.ten === 'Người nhận' && coQuyenChon && (
                    <button
                      type="button" onClick={verify} disabled={pending}
                      className="shrink-0 cursor-pointer rounded-md bg-amber-500 px-2.5 py-1 font-semibold text-amber-950 transition hover:bg-amber-400 disabled:opacity-60"
                    >
                      {pending ? 'Đang verify…' : 'Verify ngay'}
                    </button>
                  )}
                </div>
              )}

              <div>{b.o.map((o) => <DongO key={o.nhan} o={o} tat={tat} />)}</div>
            </section>
          );
        })}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Nối nút mở vào `BangDongHang.tsx`**

Thêm import ở đầu tệp:

```tsx
import { HopThoaiVanDon } from './HopThoaiVanDon';
```

Sửa trong component **`DongKien`** (khai ở `BangDongHang.tsx:312`, đã có `k`, `coQuyenChon`
và `useState` trong phạm vi). Thêm state và nút. Ngay sau `<div className="pr-4">…</div>` của nút So cước, thêm:

```tsx
      <div className="pr-4">
        {khongDiHang ? null : (
          <button
            type="button" onClick={() => setMoVanDon(true)}
            className="whitespace-nowrap rounded-lg border border-border px-3 py-2 text-[13px] font-medium transition hover:border-foreground/40"
          >
            Lên vận đơn
          </button>
        )}
      </div>
```

và khai state cạnh các state khác của dòng:

```tsx
  const [moVanDon, setMoVanDon] = useState(false);
```

và render hộp thoại ở cuối JSX của dòng:

```tsx
      <HopThoaiVanDon
        shipmentId={k.shipmentId} maKien={k.logUniqueCode} dong={moVanDon}
        coQuyenChon={coQuyenChon} onDong={() => setMoVanDon(false)}
      />
```

- [ ] **Step 3: tsc + eslint**

Run: `npx tsc --noEmit && npx eslint components/dong-hang/HopThoaiVanDon.tsx components/dong-hang/BangDongHang.tsx`
Expected: cả hai không in gì.

- [ ] **Step 4: Kiểm trên trình duyệt**

Mở `/f/dong-hang`, bấm "Lên vận đơn" ở một kiện. Kiểm bằng mắt:
1. Bốn khối hiện đúng thứ tự Người nhận → Kiện hàng → Hàng hoá → Khai hải quan.
2. Bấm nút copy một ô → dán ra ngoài đúng giá trị; nút đổi sang dấu tích rồi quay lại.
3. Nút "copy cả khối" ra nhiều dòng `Nhãn: giá trị`, **không** có dòng "Cân quy đổi".
4. Khối Khai hải quan: 4 ô đều `—`, nút copy của từng ô bị mờ.
5. Kiện thiếu kích thước: khối Kiện hàng hiện lý do chặn và nút copy mờ, các khối khác vẫn copy được.

- [ ] **Step 5: Toàn bộ test + commit**

```bash
npx vitest run
git add components/dong-hang/HopThoaiVanDon.tsx components/dong-hang/BangDongHang.tsx
git commit -m "feat(dong-hang): hộp thoại Lên vận đơn — copy từng ô sang form hãng"
```

---

## Sau khi xong

Chạy `superpowers:finishing-a-development-branch`. Trước khi push, hook pre-push sẽ chạy tsc + eslint + toàn bộ test.

Ghi Second Brain theo `CLAUDE.md` của repo: entry vào `Activity Log.md`, và một quyết định mới vào `Decisions.md` ghi lại hai điều đáng nhớ — `addr_standardized` chỉ có city/state/ZIP+4 (không có đường), và `layDuLieuQc`/`verifyOrderAddressAction` không dùng lại được vì vai trò `logistics` thiếu quyền chúng đòi.
