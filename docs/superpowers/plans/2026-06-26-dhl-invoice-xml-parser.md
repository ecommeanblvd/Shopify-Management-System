# Parser hoá đơn DHL XML (nhận cả XML+CSV) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đọc thẳng file hoá đơn DHL **XML** (AccountisXML) — đủ + đúng mọi loại phí để đối soát — giữ song song đường CSV.

**Architecture:** `parseDhlInvoiceXml` xuất cùng type `DhlInvoicePrefill` như CSV parser (downstream không đổi). Group `InvoiceLine` theo `SellersLineId`, mỗi line → 1 `DhlChargeLine` (code = mã phí DHL). `bucketOf` (dùng chung) phân loại; mở rộng P→base, YL/YO→nonConveyable. `detectInvoiceFormat`/import route `.xml`.

**Tech Stack:** Next.js, Vitest, hand-rolled parse (không thêm lib, đồng bộ CSV parser).

## Global Constraints

- XML là **nguồn đối soát**; PDF/CSV chỉ là bằng chứng đính kèm. Phải đọc **đủ + đúng MỌI phí**.
- Mapping mã phí (đã xác nhận bằng CSV thật): `P→base`, `FF→fuel`, `FD→gogreen`, `CA→elevatedRisk`, `SF→directSignature`, `MA→addressCorrection`, `YL/YO→nonConveyable`. Mã lạ (vd `OO`) → `unknown` (cảnh báo), KHÔNG bỏ/đoán bừa.
- `bucketOf` đã có FF/FD/CA/SF/MA theo code; CHỈ thêm `P→base`, `YL/YO→nonConveyable` (không đổi nhánh CSV 'WEIGHT').
- XML parser xuất cùng shape `DhlInvoicePrefill`/`DhlShipment`/`DhlChargeLine` (import type từ `./dhl-invoice-csv`).
- Total shipment = Σ(LineExtensionAmount) excl + Σ(TotalTaxAmount); totalInclVat = excl + tax.
- Nhận cả `.csv` (giữ) và `.xml` cho DHL. Không migration.
- Verify mỗi task: `npx tsc --noEmit` + `npx vitest run`; task cuối thêm `npm run lint` (0 errors) + `npm run build`.
- Branch: `feat/dhl-invoice-xml` (đã tạo, spec commit `6aead48`).

---

### Task 1: `bucketOf` — thêm P→base, YL/YO→nonConveyable

**Files:**
- Modify: `features/carrier-rates/ap/dhl-billed-map.ts`
- Test: `features/carrier-rates/ap/dhl-billed-map.test.ts`

**Interfaces:**
- Produces: `bucketOf` phân loại thêm code `P` (base), `YL`/`YO` (nonConveyable).

- [ ] **Step 1: Write the failing test**

Thêm vào `features/carrier-rates/ap/dhl-billed-map.test.ts` (trong describe của mapChargesToBilled — dùng đúng helper test sẵn có; nếu test gọi `mapChargesToBilled`, kiểm qua kết quả bucket):

```ts
import { mapChargesToBilled } from './dhl-billed-map';

describe('bucketOf — mã phí XML', () => {
  const mk = (code: string, charge: number) => ({ code, name: '', charge, tax: 0, total: charge });
  it('P → base (freight XML)', () => {
    const m = mapChargesToBilled([mk('P', 800000)], { totalTax: 0, totalInclVat: 800000, weightKg: 1 });
    expect(m.base).toBe(800000);
    expect(m.unknown).toHaveLength(0);
  });
  it('YL/YO → nonConveyable', () => {
    const m = mapChargesToBilled([mk('YL', 50000), mk('YO', 60000)], { totalTax: 0, totalInclVat: 110000, weightKg: null });
    expect(m.nonConveyable).toBe(110000);
    expect(m.unknown).toHaveLength(0);
  });
  it('mã lạ (OO) → unknown (không nhét bừa)', () => {
    const m = mapChargesToBilled([mk('OO', 9000)], { totalTax: 0, totalInclVat: 9000, weightKg: null });
    expect(m.unknown).toHaveLength(1);
    expect(m.base).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/carrier-rates/ap/dhl-billed-map.test.ts`
Expected: FAIL — `P` và `YL/YO` hiện vào `unknown` (base/nonConveyable = 0).

- [ ] **Step 3: Implement**

Trong `features/carrier-rates/ap/dhl-billed-map.ts`, hàm `bucketOf`, thêm 2 nhánh:
- Ngay sau `if (c.code === 'WEIGHT') return 'base';`:
```ts
  if (c.code === 'P') return 'base'; // XML DHL: freight = code 'P' (CSV dùng 'WEIGHT')
```
- Ngay sau nhánh `if (/non.?conveyable/.test(n)) return 'nonConveyable';`:
```ts
  if (code === 'YL' || code === 'YO') return 'nonConveyable'; // XML: name rỗng, nhận theo code
```
(Giữ nguyên mọi nhánh khác.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/carrier-rates/ap/dhl-billed-map.test.ts`
Expected: PASS (case cũ + 3 mới).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output.

```bash
git add features/carrier-rates/ap/dhl-billed-map.ts features/carrier-rates/ap/dhl-billed-map.test.ts
git commit -m "feat(ops): bucketOf nhận mã XML P→base, YL/YO→nonConveyable"
```

---

### Task 2: `parseDhlInvoiceXml`

**Files:**
- Create: `features/carrier-rates/ap/dhl-invoice-xml.ts`
- Test: `features/carrier-rates/ap/dhl-invoice-xml.test.ts`

**Interfaces:**
- Consumes: type `DhlInvoicePrefill`, `DhlShipment`, `DhlChargeLine` từ `./dhl-invoice-csv`.
- Produces: `parseDhlInvoiceXml(text: string): DhlInvoicePrefill | null` (cùng shape CSV parser).

- [ ] **Step 1: Write the failing test**

Create `features/carrier-rates/ap/dhl-invoice-xml.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDhlInvoiceXml } from './dhl-invoice-xml';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice><ID>HANRTEST001</ID>
<LegalTotal><LineExtensionTotalAmount amountCurrencyID="VND">2404330.00</LineExtensionTotalAmount><TaxExclusiveTotalAmount>2404330.00</TaxExclusiveTotalAmount><TaxInclusiveTotalAmount>2596677.00</TaxInclusiveTotalAmount></LegalTotal>
<TaxTotal><TotalTaxAmount>192347.00</TotalTaxAmount></TaxTotal>
<IssueDate>2026-03-31</IssueDate>
<PaymentMeans><PaymentDueDate>2026-04-14</PaymentDueDate></PaymentMeans>
<InvoiceLine><Item><Delivery><ActualDeliveryDateTime>2026-03-10</ActualDeliveryDateTime></Delivery><BuyersItemIdentification><ID>P</ID><code>P</code></BuyersItemIdentification><Description>EXPRESS WORLDWIDE nondoc</Description></Item><LineExtensionAmount>803632.00</LineExtensionAmount><TotalTaxAmount>64291.00</TotalTaxAmount><Delivery><OrderLineReference><OrderReference></OrderReference><SellersLineId>3483557033</SellersLineId><BuyersLineId>#MBLVD27669</BuyersLineId></OrderLineReference><LoadWeight>1.45</LoadWeight></Delivery></InvoiceLine>
<InvoiceLine><Item><BuyersItemIdentification><ID>FF</ID><code>FF</code></BuyersItemIdentification></Item><LineExtensionAmount>525098.00</LineExtensionAmount><TotalTaxAmount>42008.00</TotalTaxAmount><Delivery><OrderLineReference><SellersLineId>3483557033</SellersLineId><BuyersLineId>#MBLVD27669</BuyersLineId></OrderLineReference></Delivery></InvoiceLine>
<InvoiceLine><Item><BuyersItemIdentification><ID>CA</ID><code>CA</code></BuyersItemIdentification></Item><LineExtensionAmount>918000.00</LineExtensionAmount><TotalTaxAmount>73440.00</TotalTaxAmount><Delivery><OrderLineReference><SellersLineId>3483557033</SellersLineId><BuyersLineId>#MBLVD27669</BuyersLineId></OrderLineReference></Delivery></InvoiceLine>
<InvoiceLine><Item><BuyersItemIdentification><ID>SF</ID><code>SF</code></BuyersItemIdentification></Item><LineExtensionAmount>150000.00</LineExtensionAmount><TotalTaxAmount>12000.00</TotalTaxAmount><Delivery><OrderLineReference><SellersLineId>3483557033</SellersLineId><BuyersLineId>#MBLVD27669</BuyersLineId></OrderLineReference></Delivery></InvoiceLine>
<InvoiceLine><Item><BuyersItemIdentification><ID>FD</ID><code>FD</code></BuyersItemIdentification></Item><LineExtensionAmount>7600.00</LineExtensionAmount><TotalTaxAmount>608.00</TotalTaxAmount><Delivery><OrderLineReference><SellersLineId>3483557033</SellersLineId><BuyersLineId>#MBLVD27669</BuyersLineId></OrderLineReference></Delivery></InvoiceLine>
<InvoiceLine><Item><Delivery><ActualDeliveryDateTime>2026-03-12</ActualDeliveryDateTime></Delivery><BuyersItemIdentification><ID>P</ID><code>P</code></BuyersItemIdentification><Description>EXPRESS WORLDWIDE nondoc</Description></Item><LineExtensionAmount>500000.00</LineExtensionAmount><TotalTaxAmount>40000.00</TotalTaxAmount><Delivery><OrderLineReference><SellersLineId>9999999999</SellersLineId><BuyersLineId>#TA2200</BuyersLineId></OrderLineReference><LoadWeight>2.00</LoadWeight></Delivery></InvoiceLine>
</Invoice>`;

describe('parseDhlInvoiceXml', () => {
  it('Invoice-level fields', () => {
    const p = parseDhlInvoiceXml(XML)!;
    expect(p.billNumber).toBe('HANRTEST001');
    expect(p.amountInclVat).toBe(2596677);
    expect(p.amountExclVat).toBe(2404330);
    expect(p.issueDate).toBe('2026-03-31');
    expect(p.dueDate).toBe('2026-04-14');
    expect(p.currency).toBe('VND');
  });
  it('group theo SellersLineId → 2 shipment, đủ phí, total đúng', () => {
    const p = parseDhlInvoiceXml(XML)!;
    expect(p.shipments).toHaveLength(2);
    const s = p.shipments.find((x) => x.shipmentNumber === '3483557033')!;
    expect(s.orderRef).toBe('#MBLVD27669');
    expect(s.weightKg).toBe(1.45);
    expect(s.date).toBe('2026-03-10');
    expect(s.charges).toHaveLength(5); // P/FF/CA/SF/FD
    expect(s.charges.map((c) => c.code).sort()).toEqual(['CA','FD','FF','P','SF']);
    expect(s.totalExclVat).toBe(2404330);
    expect(s.totalTax).toBe(192347);
    expect(s.totalInclVat).toBe(2596677);
  });
  it('XML rỗng/sai → null', () => {
    expect(parseDhlInvoiceXml('')).toBeNull();
    expect(parseDhlInvoiceXml('<x/>')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run features/carrier-rates/ap/dhl-invoice-xml.test.ts`
Expected: FAIL — "Cannot find module './dhl-invoice-xml'".

- [ ] **Step 3: Implement**

Create `features/carrier-rates/ap/dhl-invoice-xml.ts`:

```ts
/**
 * Parser hoá đơn DHL dạng XML (AccountisXML Global Invoice). Đọc THẲNG file gốc
 * của DHL — đủ + đúng mọi loại phí để đối soát. Xuất cùng DhlInvoicePrefill như
 * CSV parser → downstream (bill-line, reconcile) không đổi. Hand-rolled (không lib).
 */
import type { DhlInvoicePrefill, DhlShipment, DhlChargeLine } from './dhl-invoice-csv';

/** Tên đọc-được cho mã phí DHL (XML để name rỗng). bucketOf phân loại theo code. */
const DHL_CHARGE_CODE_NAME: Record<string, string> = {
  P: 'Weight charge', FF: 'Fuel Surcharge', FD: 'GoGreen Plus - Carbon Reduced',
  CA: 'Elevated Risk', SF: 'Direct Signature', MA: 'Address Correction',
  YL: 'Non-Conveyable Piece', YO: 'Non-Conveyable Piece',
};

/** Lấy text của tag đầu tiên trong 1 đoạn. THUẦN. */
function tagText(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
}
function num(s: string): number { const n = Number((s ?? '').replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function r2(n: number): number { return Math.round(n * 100) / 100; }

export function parseDhlInvoiceXml(text: string): DhlInvoicePrefill | null {
  if (!text || !/<Invoice\b/.test(text)) return null;
  const firstLine = text.indexOf('<InvoiceLine');
  const header = firstLine >= 0 ? text.slice(0, firstLine) : text;
  const billNumber = tagText(header, 'ID');
  const issueDate = tagText(header, 'IssueDate');
  if (!billNumber || !issueDate) return null;
  const amountInclVat = num(tagText(header, 'TaxInclusiveTotalAmount'));
  const amountExclVat = num(tagText(header, 'TaxExclusiveTotalAmount'));
  const dueDate = tagText(header, 'PaymentDueDate') || issueDate;
  const curMatch = header.match(/amountCurrencyID="([^"]+)"/);
  const currency = curMatch?.[1] ?? 'VND';

  // Gom InvoiceLine theo SellersLineId.
  const byTracking = new Map<string, DhlShipment>();
  const lineBlocks = text.split('<InvoiceLine').slice(1).map((b) => '<InvoiceLine' + b.split('</InvoiceLine>')[0] + '</InvoiceLine>');
  for (const block of lineBlocks) {
    const tracking = tagText(block, 'SellersLineId');
    if (!tracking) continue;
    const idBlock = block.match(/<BuyersItemIdentification>([\s\S]*?)<\/BuyersItemIdentification>/);
    const code = idBlock ? (tagText(idBlock[1], 'code') || tagText(idBlock[1], 'ID')) : '';
    const charge = num(tagText(block, 'LineExtensionAmount'));
    const tax = num(tagText(block, 'TotalTaxAmount'));
    const c: DhlChargeLine = { code, name: DHL_CHARGE_CODE_NAME[code] ?? code, charge, tax, total: r2(charge + tax) };

    let sh = byTracking.get(tracking);
    if (!sh) {
      sh = {
        shipmentNumber: tracking,
        orderRef: tagText(block, 'BuyersLineId'),
        date: tagText(block, 'ActualDeliveryDateTime') || issueDate,
        product: tagText(block, 'Description'),
        weightKg: num(tagText(block, 'LoadWeight')) || num(tagText(block, 'TenderWeight')),
        charges: [], totalExclVat: 0, totalTax: 0, totalInclVat: 0,
      };
      byTracking.set(tracking, sh);
    }
    // Bổ sung field còn thiếu từ dòng có dữ liệu (vd dòng P mang weight/date/desc).
    if (!sh.orderRef) sh.orderRef = tagText(block, 'BuyersLineId');
    if (!sh.weightKg) sh.weightKg = num(tagText(block, 'LoadWeight')) || num(tagText(block, 'TenderWeight'));
    if (!sh.product) sh.product = tagText(block, 'Description');
    sh.charges.push(c);
    sh.totalExclVat = r2(sh.totalExclVat + charge);
    sh.totalTax = r2(sh.totalTax + tax);
    sh.totalInclVat = r2(sh.totalInclVat + charge + tax);
  }

  const shipments = [...byTracking.values()];
  const shipDates = shipments.map((s) => s.date).filter(Boolean).sort();
  const refs = [...new Set(shipments.map((s) => s.orderRef).filter(Boolean))];
  return {
    billNumber, currency, amountInclVat, amountExclVat, issueDate, dueDate,
    periodStart: shipDates[0] ?? issueDate,
    periodEnd: shipDates[shipDates.length - 1] ?? issueDate,
    note: refs.join(', '),
    shipmentCount: shipments.length,
    shipments,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run features/carrier-rates/ap/dhl-invoice-xml.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit` → no output.

```bash
git add features/carrier-rates/ap/dhl-invoice-xml.ts features/carrier-rates/ap/dhl-invoice-xml.test.ts
git commit -m "feat(ops): parseDhlInvoiceXml — đọc hoá đơn DHL XML đủ+đúng mọi phí"
```

---

### Task 3: Wire `.xml` vào detect + preview + import

**Files:**
- Modify: `features/carrier-rates/ap/invoice-upload.ts`

**Interfaces:**
- Consumes: `parseDhlInvoiceXml` (Task 2); `InvoiceFormat`, `detectInvoiceFormat`, `splitByPhase`, `previewOneInvoice`, `importCarrierInvoices`.

- [ ] **Step 1: detectInvoiceFormat + InvoiceFormat + splitByPhase nhận dhl_xml**

Trong `features/carrier-rates/ap/invoice-upload.ts`:
- `InvoiceFormat`: thêm `'dhl_xml'`:
```ts
export type InvoiceFormat = 'dhl_csv' | 'dhl_xml' | 'fbo_xlsx' | 'invoice_pdf' | 'unsupported';
```
- `detectInvoiceFormat`: thêm trước dòng pdf:
```ts
  if (carrierKey === 'dhl' && ext === '.xml') return 'dhl_xml';
```
- `splitByPhase`: cho `dhl_xml` vào nhóm spreadsheets:
```ts
    if (fmt === 'dhl_csv' || fmt === 'dhl_xml' || fmt === 'fbo_xlsx') spreadsheets.push(f);
```
- Thêm import: `import { parseDhlInvoiceXml } from './dhl-invoice-xml';`

- [ ] **Step 2: previewOneInvoice nhận dhl_xml**

Đổi nhánh `if (fmt === 'dhl_csv') {` thành xử lý cả xml:
```ts
  if (fmt === 'dhl_csv' || fmt === 'dhl_xml') {
    const p = fmt === 'dhl_xml' ? parseDhlInvoiceXml(td(file.bytes)) : parseDhlInvoiceCsv(td(file.bytes));
    if (!p || !p.billNumber) return { ok: false as const, message: 'Không đúng định dạng hoá đơn DHL.' };
    return { ok: true as const, preview: toInvoicePreview({ kind: 'dhl', p, accountCurrency: ctx.currency }) };
  }
```

- [ ] **Step 3: importCarrierInvoices — DHL branch chọn parser theo định dạng file**

Trong `importCarrierInvoices`, nhánh `if (ctx.carrierKey === 'dhl') {`, đổi dòng parse:
```ts
        const isXml = detectInvoiceFormat('dhl', f.filename) === 'dhl_xml';
        const p = isXml ? parseDhlInvoiceXml(td(f.bytes)) : parseDhlInvoiceCsv(td(f.bytes));
```
và `createBill(... file: { bytes: f.bytes, filename: f.filename, contentType: isXml ? 'application/xml' : 'text/csv' } ...)`.
(Giữ nguyên phần còn lại: seen-check, dhlShipmentToBillLine, reconcileDhlBill.)

- [ ] **Step 4: Thông báo format DHL gồm XML**

Sửa message fallback "DHL (CSV)" → "DHL (CSV/XML)" ở `previewOneInvoice` (dòng return cuối) và `importCarrierInvoices`/chỗ unsupported tương ứng.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run lint && npm run build`
Expected: tsc no output; vitest toàn bộ pass; lint 0 errors; build xanh.

- [ ] **Step 6: Commit**

```bash
git add features/carrier-rates/ap/invoice-upload.ts
git commit -m "feat(ops): nhận upload hoá đơn DHL .xml (preview + import) song song CSV"
```

---

## Self-Review

**Spec coverage:**
- §3 mapping (P→base, YL/YO→nonConveyable, FF/FD/CA/SF/MA sẵn có, unknown surface) → Task 1 (bucketOf) + Task 2 (parser emit code). §4.1 parseDhlInvoiceXml → Task 2. §4.1b bucketOf → Task 1. §4.2 detect/preview/import wiring → Task 3. §4.3 fixture inline → Task 2 test. §5 guard (SellersLineId rỗng bỏ, sai→null, unknown surface) → Task 2 + Task 1. §6 test thuần → Task 1+2. Đủ.

**Type consistency:**
- `parseDhlInvoiceXml` trả `DhlInvoicePrefill` (Task 2) = type CSV parser → `dhlShipmentToBillLine`/`reconcileDhlBill` dùng không đổi (Task 3). ✔
- `DhlChargeLine {code,name,charge,tax,total}` (Task 2) = `bucketOf` input (Task 1). ✔
- code 'P'/'YL'/'YO' (Task 2 emit) = bucketOf nhận (Task 1). ✔
- `InvoiceFormat` thêm 'dhl_xml' (Task 3) dùng ở detect/split/preview/import nhất quán. ✔

**Placeholder scan:** không TBD/TODO; mọi step có code/command. ✔
