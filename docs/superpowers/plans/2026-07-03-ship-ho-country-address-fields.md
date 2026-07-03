# Ship hộ — Trường địa chỉ custom theo quốc gia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm trường địa chỉ bắt buộc theo quốc gia vào form tạo đơn ship hộ — Saudi Arabia cần Short Address hoặc Google Maps link; AE/QA/KW/BH/OM cần House Number — lưu có cấu trúc và validate chặt.

**Architecture:** Một module thuần `lib/geo/address-requirements.ts` là nguồn sự thật (map nước→yêu cầu + hàm validate dùng chung client/server). Form render field có điều kiện theo nước; server action re-validate authoritative; 3 cột `text` mới trên `ship_ho_orders` lưu dữ liệu; trang chi tiết hiển thị lại.

**Tech Stack:** Next.js (App Router, breaking-changes fork — đọc `node_modules/next/dist/docs/` nếu chạm API Next), React client component, Drizzle ORM (PostgreSQL), Vitest.

## Global Constraints

- Ngôn ngữ UI + commit message: tiếng Việt (đúng convention repo ship-ho).
- Short Address chuẩn hoá `trim().toUpperCase()`, khớp regex `^[A-Z]{4}[0-9]{4}$` (vd `RBMA4176`).
- Google Maps link phải parse được là URL scheme `http`/`https`.
- House Number bắt buộc = sau `trim()` không rỗng.
- Nước cần House Number: `AE, QA, KW, BH, OM` (KHÔNG gồm SA). Nước cần Short-Address-hoặc-Maps: `SA`.
- 3 cột mới đều `text` nullable: `house_number`, `short_address`, `maps_url`.
- Validate dùng CHUNG một hàm thuần cho cả client và server (không nhân đôi logic).
- Trước khi push: chạy `npx tsc --noEmit` và test suite, chỉ push nếu cả hai xanh.
- Commit message kết thúc bằng dòng: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Module nguồn sự thật + validate (thuần, có test)

**Files:**
- Create: `lib/geo/address-requirements.ts`
- Test: `lib/geo/address-requirements.test.ts`

**Interfaces:**
- Consumes: không có (module thuần, không phụ thuộc React/DB).
- Produces:
  - `interface AddressExtraReq { houseNumber?: true; shortAddressOrMaps?: true }`
  - `const ADDRESS_EXTRA: Record<string, AddressExtraReq>`
  - `interface AddressExtraInput { houseNumber?: string; shortAddress?: string; mapsUrl?: string }`
  - `function requirementFor(country: string): AddressExtraReq | undefined`
  - `function validateAddressExtra(country: string, input: AddressExtraInput): { ok: boolean; error?: string; normalized: AddressExtraInput }`

- [ ] **Step 1: Viết test thất bại**

Tạo `lib/geo/address-requirements.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateAddressExtra, requirementFor, ADDRESS_EXTRA } from './address-requirements';

describe('ADDRESS_EXTRA map', () => {
  it('SA cần short-address-hoặc-maps, không cần house number', () => {
    expect(ADDRESS_EXTRA.SA).toEqual({ shortAddressOrMaps: true });
  });
  it('5 nước GCC còn lại cần house number', () => {
    for (const iso of ['AE', 'QA', 'KW', 'BH', 'OM']) {
      expect(ADDRESS_EXTRA[iso]).toEqual({ houseNumber: true });
    }
  });
  it('requirementFor không phân biệt hoa/thường + khoảng trắng', () => {
    expect(requirementFor(' sa ')).toEqual({ shortAddressOrMaps: true });
    expect(requirementFor('US')).toBeUndefined();
  });
});

describe('validateAddressExtra — Saudi Arabia', () => {
  it('chỉ short address hợp lệ → ok, uppercase', () => {
    const r = validateAddressExtra('SA', { shortAddress: 'rbma4176' });
    expect(r.ok).toBe(true);
    expect(r.normalized.shortAddress).toBe('RBMA4176');
  });
  it('short address sai format → lỗi', () => {
    const r = validateAddressExtra('SA', { shortAddress: 'RB4176' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Short Address/i);
  });
  it('chỉ maps url hợp lệ → ok', () => {
    const r = validateAddressExtra('SA', { mapsUrl: 'https://maps.app.goo.gl/abc' });
    expect(r.ok).toBe(true);
    expect(r.normalized.mapsUrl).toBe('https://maps.app.goo.gl/abc');
  });
  it('maps url không phải http(s) → lỗi', () => {
    const r = validateAddressExtra('SA', { mapsUrl: 'javascript:alert(1)' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Maps|URL/i);
  });
  it('cả hai rỗng → lỗi bắt buộc ít nhất 1', () => {
    const r = validateAddressExtra('SA', {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ít nhất/i);
  });
});

describe('validateAddressExtra — GCC house number', () => {
  it('thiếu house number → lỗi', () => {
    const r = validateAddressExtra('AE', { houseNumber: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/House Number/i);
  });
  it('có house number → ok, trim', () => {
    const r = validateAddressExtra('QA', { houseNumber: '  12B ' });
    expect(r.ok).toBe(true);
    expect(r.normalized.houseNumber).toBe('12B');
  });
});

describe('validateAddressExtra — ngoài phạm vi', () => {
  it('US luôn ok, không kèm field extra', () => {
    const r = validateAddressExtra('US', { houseNumber: 'x', shortAddress: 'y', mapsUrl: 'z' });
    expect(r.ok).toBe(true);
    expect(r.normalized).toEqual({});
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npx vitest run lib/geo/address-requirements.test.ts`
Expected: FAIL — không import được `./address-requirements` (module chưa tồn tại).

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `lib/geo/address-requirements.ts`:

```ts
/** Nguồn sự thật: trường địa chỉ bắt buộc theo quốc gia (ship hộ). Thuần, không phụ thuộc React/DB. */

export interface AddressExtraReq {
  houseNumber?: true; // house number bắt buộc
  shortAddressOrMaps?: true; // cần short address HOẶC maps url
}

// SA: short-address-hoặc-maps. AE/QA/KW/BH/OM: house number. Khác: không yêu cầu.
export const ADDRESS_EXTRA: Record<string, AddressExtraReq> = {
  SA: { shortAddressOrMaps: true },
  AE: { houseNumber: true },
  QA: { houseNumber: true },
  KW: { houseNumber: true },
  BH: { houseNumber: true },
  OM: { houseNumber: true },
};

export interface AddressExtraInput {
  houseNumber?: string;
  shortAddress?: string;
  mapsUrl?: string;
}

const SHORT_ADDRESS_RE = /^[A-Z]{4}[0-9]{4}$/;

export function requirementFor(country: string): AddressExtraReq | undefined {
  return ADDRESS_EXTRA[country.trim().toUpperCase()];
}

function isHttpUrl(s: string): boolean {
  let u: URL;
  try { u = new URL(s); } catch { return false; }
  return u.protocol === 'http:' || u.protocol === 'https:';
}

export function validateAddressExtra(
  country: string,
  input: AddressExtraInput,
): { ok: boolean; error?: string; normalized: AddressExtraInput } {
  const req = requirementFor(country);
  if (!req) return { ok: true, normalized: {} };

  const normalized: AddressExtraInput = {};

  if (req.houseNumber) {
    const hn = (input.houseNumber ?? '').trim();
    if (!hn) return { ok: false, error: 'Thiếu House Number', normalized };
    normalized.houseNumber = hn;
  }

  if (req.shortAddressOrMaps) {
    const short = (input.shortAddress ?? '').trim().toUpperCase();
    const maps = (input.mapsUrl ?? '').trim();
    if (short) {
      if (!SHORT_ADDRESS_RE.test(short)) {
        return { ok: false, error: 'Short Address phải là 4 chữ + 4 số (vd RBMA4176)', normalized };
      }
      normalized.shortAddress = short;
    }
    if (maps) {
      if (!isHttpUrl(maps)) {
        return { ok: false, error: 'Google Maps link phải là URL http(s) hợp lệ', normalized };
      }
      normalized.mapsUrl = maps;
    }
    if (!normalized.shortAddress && !normalized.mapsUrl) {
      return { ok: false, error: 'Cần ít nhất 1: Short Address hoặc Google Maps link', normalized };
    }
  }

  return { ok: true, normalized };
}
```

- [ ] **Step 4: Chạy test để xác nhận PASS**

Run: `npx vitest run lib/geo/address-requirements.test.ts`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add lib/geo/address-requirements.ts lib/geo/address-requirements.test.ts
git commit -m "feat(ship-ho): address-requirements — validate trường địa chỉ theo quốc gia + test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: DB — 3 cột mới + schema Drizzle

**Files:**
- Create: `db/migrations/0085_ship-ho-address-extra.sql`
- Modify: `db/schema.ts` (khối `shipHoOrders`, sau `address2`)

**Interfaces:**
- Consumes: không có.
- Produces: cột `shipHoOrders.houseNumber`, `shipHoOrders.shortAddress`, `shipHoOrders.mapsUrl` (đều `text` nullable) dùng trong Task 3.

- [ ] **Step 1: Viết migration SQL**

Tạo `db/migrations/0085_ship-ho-address-extra.sql`:

```sql
ALTER TABLE "ship_ho_orders" ADD COLUMN "house_number" text;
ALTER TABLE "ship_ho_orders" ADD COLUMN "short_address" text;
ALTER TABLE "ship_ho_orders" ADD COLUMN "maps_url" text;
```

- [ ] **Step 2: Thêm cột vào schema Drizzle**

Trong `db/schema.ts`, khối `export const shipHoOrders = pgTable('ship_ho_orders', {`, ngay sau dòng `address2: text('address2'),` thêm:

```ts
  // Trường địa chỉ custom theo quốc gia (Trung Đông)
  houseNumber: text('house_number'),
  shortAddress: text('short_address'),
  mapsUrl: text('maps_url'),
```

- [ ] **Step 3: Đồng bộ snapshot meta của drizzle**

Run: `npm run db:generate`
Expected: drizzle nhận diện schema đã khớp migration thủ công (không sinh migration trùng cột). Nếu nó sinh thêm file migration cho đúng 3 cột này, XOÁ file `0085_*.sql` thủ công vừa tạo và giữ file drizzle sinh (tránh chạy ALTER 2 lần). Mục tiêu: đúng 1 migration thêm 3 cột + snapshot `db/migrations/meta/*` cập nhật.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (không lỗi type do cột mới).

- [ ] **Step 5: Commit**

```bash
git add db/migrations db/schema.ts
git commit -m "feat(ship-ho): migration + schema 3 cột địa chỉ custom (house_number/short_address/maps_url)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Server action — nhận + validate + lưu field extra

**Files:**
- Modify: `features/ship-ho/orders-actions.ts` (`CreateShipHoOrderInput` + `createShipHoOrder`)

**Interfaces:**
- Consumes: `validateAddressExtra` từ Task 1; cột `houseNumber/shortAddress/mapsUrl` từ Task 2.
- Produces: `CreateShipHoOrderInput` mở rộng thêm `houseNumber?: string; shortAddress?: string; mapsUrl?: string`.

- [ ] **Step 1: Mở rộng input type**

Trong `features/ship-ho/orders-actions.ts`, thêm vào `interface CreateShipHoOrderInput` (sau `address2?: string;`):

```ts
  houseNumber?: string;
  shortAddress?: string;
  mapsUrl?: string;
```

- [ ] **Step 2: Import hàm validate**

Thêm vào đầu file (cùng nhóm import):

```ts
import { validateAddressExtra } from '@/lib/geo/address-requirements';
```

- [ ] **Step 3: Validate authoritative + lưu**

Trong `createShipHoOrder`, sau guard `if (!Number.isFinite(Number(input.weightKg)) ...)` và TRƯỚC `let id: string;`, thêm:

```ts
  const extra = validateAddressExtra(input.country, {
    houseNumber: input.houseNumber,
    shortAddress: input.shortAddress,
    mapsUrl: input.mapsUrl,
  });
  if (!extra.ok) return { ok: false, error: extra.error };
```

Trong object `.values({ ... })` của `db.insert(schema.shipHoOrders)`, sau `address2: input.address2 || null,` thêm:

```ts
        houseNumber: extra.normalized.houseNumber ?? null,
        shortAddress: extra.normalized.shortAddress ?? null,
        mapsUrl: extra.normalized.mapsUrl ?? null,
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/ship-ho/orders-actions.ts
git commit -m "feat(ship-ho): createShipHoOrder validate + lưu trường địa chỉ theo quốc gia

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Form — render field có điều kiện + validate client

**Files:**
- Modify: `app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx`

**Interfaces:**
- Consumes: `requirementFor`, `validateAddressExtra` từ Task 1; input mở rộng của `createShipHoOrder` từ Task 3.
- Produces: không có (UI cuối cùng).

- [ ] **Step 1: Import requirement + state field extra**

Trong `NewOrderForm.tsx`, thêm import (cạnh import `COUNTRIES, dialCodeFor`):

```ts
import { requirementFor, validateAddressExtra } from '@/lib/geo/address-requirements';
```

Trong `useState` khởi tạo `f`, thêm vào object (sau `phone: ''`):

```ts
    houseNumber: '', shortAddress: '', mapsUrl: '',
```

- [ ] **Step 2: Reset field extra khi đổi quốc gia**

Tìm `onChange={(v) => patch({ country: v, city: '' })}` của SearchSelect quốc gia, đổi thành:

```tsx
              onChange={(v) => patch({ country: v, city: '', houseNumber: '', shortAddress: '', mapsUrl: '' })}
```

- [ ] **Step 3: Render field có điều kiện sau ô "Địa chỉ"**

Ngay SAU dòng `<label className="text-sm block">Địa chỉ<input ... /></label>` (địa chỉ `address1`), thêm:

```tsx
        {requirementFor(f.country)?.houseNumber && (
          <label className="text-sm block">House Number *
            <input className={inputCls} value={f.houseNumber} onChange={set('houseNumber')} placeholder="Số nhà / building" />
          </label>
        )}
        {requirementFor(f.country)?.shortAddressOrMaps && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Saudi Arabia: nhập ít nhất 1 trong 2 — Short Address hoặc Google Maps link.</p>
            <div className="grid grid-cols-2 gap-4">
              <label className="text-sm">Short Address
                <input className={inputCls} value={f.shortAddress} onChange={set('shortAddress')} placeholder="VD RBMA4176" />
              </label>
              <label className="text-sm">Google Maps link
                <input className={inputCls} value={f.mapsUrl} onChange={set('mapsUrl')} placeholder="https://maps.app.goo.gl/…" />
              </label>
            </div>
          </div>
        )}
```

- [ ] **Step 4: Validate client + gửi field extra khi submit**

Trong hàm `submit`, sau `setErr(null);` và trước `const line = lines.find(...)`, thêm:

```ts
      const extra = validateAddressExtra(f.country, {
        houseNumber: f.houseNumber, shortAddress: f.shortAddress, mapsUrl: f.mapsUrl,
      });
      if (!extra.ok) { setErr(extra.error ?? 'Thiếu thông tin địa chỉ'); return; }
```

Trong lời gọi `createShipHoOrder({ ... })`, sau `address1: f.address1,` thêm:

```ts
        houseNumber: extra.normalized.houseNumber, shortAddress: extra.normalized.shortAddress, mapsUrl: extra.normalized.mapsUrl,
```

- [ ] **Step 5: Type-check + build form**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/f/ship-ho/new/NewOrderForm.tsx"
git commit -m "feat(ship-ho): form tạo đơn — field địa chỉ theo quốc gia (SA short-address/maps, GCC house-number)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Trang chi tiết — hiển thị field extra

**Files:**
- Modify: `app/(dashboard)/f/ship-ho/[id]/page.tsx`

**Interfaces:**
- Consumes: cột `houseNumber/shortAddress/mapsUrl` (đã có trong `getShipHoOrder` vì `select()` toàn bộ bảng — xác minh ở Step 1).
- Produces: không có.

- [ ] **Step 1: Xác minh query trả về cột mới**

Run: `grep -n "select" features/ship-ho/queries.ts | head`
Kiểm tra `getShipHoOrder` dùng `db.select().from(schema.shipHoOrders)` (không chỉ định cột) → cột mới tự có. Nếu nó liệt kê cột tường minh, thêm `houseNumber`, `shortAddress`, `mapsUrl` vào danh sách select.

- [ ] **Step 2: Thêm dòng hiển thị trong block "Đến"**

Trong `app/(dashboard)/f/ship-ho/[id]/page.tsx`, trong `<Card>` đầu tiên, ngay sau `<div><span className="text-muted-foreground">Đến</span>...</div>`, thêm:

```tsx
        {o.houseNumber && <div><span className="text-muted-foreground">House Number</span><div>{o.houseNumber}</div></div>}
        {o.shortAddress && <div><span className="text-muted-foreground">Short Address</span><div>{o.shortAddress}</div></div>}
        {o.mapsUrl && <div><span className="text-muted-foreground">Google Maps</span><div><a href={o.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">{o.mapsUrl}</a></div></div>}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/f/ship-ho/[id]/page.tsx"
git commit -m "feat(ship-ho): trang chi tiết hiển thị trường địa chỉ theo quốc gia

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Verify toàn bộ + đẩy nhánh

**Files:** không sửa code (chỉ chạy kiểm tra).

- [ ] **Step 1: Type-check toàn dự án**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Chạy test suite liên quan**

Run: `npx vitest run lib/geo/address-requirements.test.ts`
Expected: PASS. (Chạy thêm `npx vitest run` nếu muốn full — chỉ push khi xanh.)

- [ ] **Step 3: Xác minh migration hợp lệ (dry, không chạy production)**

Xem lại `db/migrations/0085_*` (hoặc file drizzle sinh) đúng 3 cột `text` nullable, không đụng cột khác.

- [ ] **Step 4: Đẩy nhánh (chỉ khi tsc + test xanh)**

```bash
git push -u origin feat/ship-ho-country-address-fields
```

---

## Self-Review

**Spec coverage:**
- Config nguồn sự thật + validate dùng chung → Task 1. ✅
- Storage 3 cột dedicated → Task 2. ✅
- Form render có điều kiện + reset khi đổi nước + validate client → Task 4. ✅
- Server validate authoritative + lưu → Task 3. ✅
- DB migration + schema → Task 2. ✅
- Hiển thị trang chi tiết (maps là link) → Task 5. ✅
- Test thuần `validateAddressExtra` (SA valid/invalid, GCC thiếu house number, ngoài phạm vi) → Task 1. ✅
- Ngoài phạm vi (không đẩy carrier thật, không sửa import/reconcile) → tôn trọng, không có task. ✅

**Placeholder scan:** không có TBD/TODO; mọi step code đều đầy đủ. ✅

**Type consistency:** `validateAddressExtra(country, AddressExtraInput) → { ok, error?, normalized }` và `requirementFor(country) → AddressExtraReq | undefined` dùng nhất quán ở Task 3/4/5. Tên cột `houseNumber/shortAddress/mapsUrl` khớp giữa schema (Task 2), action (Task 3), form (Task 4), detail (Task 5). ✅
