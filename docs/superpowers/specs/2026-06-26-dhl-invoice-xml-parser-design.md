# Parser hoá đơn DHL dạng XML (nhận cả XML + CSV) — Design

> File hoá đơn DHL gốc là **XML** (AccountisXML), đầy đủ + chính xác. Hệ thống hiện chỉ nhận CSV (bản
> convert, đọc thiếu order + sai số → phải re-upload → mất đối soát). Thêm parser XML đọc thẳng file
> gốc; giữ CSV cũ.

**Ngày:** 2026-06-26
**Trạng thái:** đã duyệt hướng (nhận cả XML+CSV), chờ review spec → plan.
**Nhánh:** `feat/dhl-invoice-xml`

## 1. Bối cảnh (từ điều tra bug)

Upload CSV lần đầu đọc thiếu 2 order + sai số tiền (vd tracking 3483557033: CSV cho 2.592.573, đúng
phải 2.596.677). Đối chiếu XML (chuẩn): total shipment = Σ`LineExtensionAmount` + Σ`TotalTaxAmount` =
2.596.677 ✓. CSV là nguồn lossy. → Đọc thẳng XML để đủ + đúng ngay lần đầu (không cần re-upload →
không bật cờ "billed đổi" làm mất đối soát).

## 2. Cấu trúc XML (AccountisXML DHL)

- `<Invoice>`: `<ID>` = billNumber; `<LegalTotal><TaxInclusiveTotalAmount>` = amount; `<TaxExclusiveTotalAmount>`;
  `<TaxTotal><TotalTaxAmount>`; `<IssueDate>`; `<PaymentMeans><PaymentDueDate>`; `<Currency>` (amountCurrencyID trên LineExtensionTotalAmount = VND).
- Nhiều `<InvoiceLine>` (1 dòng = 1 khoản phí của 1 shipment). Group theo `<SellersLineId>` (= tracking).
  Mỗi InvoiceLine:
  - `<SellersLineId>` = trackingNumber.
  - `<BuyersLineId>` = orderRef (mã đơn, vd `#MBLVD27669`).
  - `<BuyersItemIdentification><ID>` = mã phí: **P**=freight, **FF**=fuel, **SF/FD/CA/OO/YL/MA**=phụ phí.
  - `<LineExtensionAmount>` = tiền khoản (excl VAT); `<TotalTaxAmount>` = thuế khoản.
  - `<Description>` (chỉ P có "EXPRESS WORLDWIDE…"); `<ActualDeliveryDateTime>` = ngày giao; `<LoadWeight>`/`<TenderWeight>` = cân.
- Per shipment: totalExclVat = Σ amt; totalTax = Σ tax; totalInclVat = Σ(amt+tax); weightKg = LoadWeight (fallback TenderWeight).

## 3. Quyết định đã chốt

- **Nhận cả XML và CSV** cho DHL. XML parser xuất cùng type `DhlInvoicePrefill` → downstream (bills-actions, reconcileDhlBill) KHÔNG đổi.
- Parser **hand-rolled** (không thêm lib, đồng bộ style CSV parser). Group InvoiceLine theo SellersLineId.
- **MỤC TIÊU CỐT LÕI: đọc ĐÚNG + ĐỦ MỌI loại phí để đối soát** (không chỉ total). XML là nguồn đối soát; PDF/CSV chỉ là bằng chứng đính kèm cho người đọc.
- Mỗi InvoiceLine → 1 `DhlChargeLine { code: itemID, name: DHL_CHARGE_CODE_NAME[itemID] ?? itemID, charge: amt, tax, total: amt+tax }`. `bucketOf` (dùng chung) đã map sẵn theo code: `FF→fuel, FD→gogreen, CA→elevatedRisk, MA→addressCorrection, SF→directSignature`.
- **Mở rộng `bucketOf`** (dhl-billed-map.ts) cho mã chỉ có ở XML, theo CODE (name XML rỗng):
  - `code === 'P'` → `base` (XML dùng 'P' cho cước/freight thay vì 'WEIGHT' của CSV; 'P' chỉ phát sinh từ XML nên an toàn).
  - `code === 'YL' || code === 'YO'` → `nonConveyable` (hiện chỉ nhận theo name).
- Mã KHÔNG nhận diện (vd `OO`) → vào `unknown` (cảnh báo cho operator), **KHÔNG bỏ, KHÔNG nhét bừa**.
- `classifyDhlProduct`: dòng duties/taxes vẫn tách (công nợ, không vào engine freight) như CSV.
- Không migration.

## 4. Components

### 4.1 `features/carrier-rates/ap/dhl-invoice-xml.ts` (mới, THUẦN + test)
- `parseDhlInvoiceXml(text: string): DhlInvoicePrefill | null` — trả cùng shape `DhlInvoicePrefill` (import type từ `./dhl-invoice-csv`).
  - Lấy Invoice-level fields (billNumber/currency/amountInclVat/amountExclVat/issueDate/dueDate=PaymentDueDate hoặc issueDate+ngày). Thiếu billNumber/issueDate → null.
  - Tách các `<InvoiceLine>` (split + regex field), group theo SellersLineId → `DhlShipment[]`:
    `{ shipmentNumber, orderRef, date, product, weightKg, charges: DhlChargeLine[], totalExclVat, totalTax, totalInclVat }`.
  - charges: mỗi InvoiceLine → `{ code, name, charge: amt, tax, total: amt+tax }` theo map §3.
  - period từ min/max shipment date; note = refs/shipNos như CSV parser.
- Helper thuần `dhlXmlFieldsFromLine` / `parseInvoiceLines` để test từng phần.
- Hằng `DHL_CHARGE_CODE_NAME: Record<string,string>` (P/FF/SF/FD/CA/OO/YL/MA → tên đọc được; map tối thiểu, code lạ → chính nó).

### 4.1b `features/carrier-rates/ap/dhl-billed-map.ts` (mở rộng `bucketOf`)
- Thêm vào `bucketOf`: `if (code === 'P') return 'base';` (sau nhánh `WEIGHT`); `if (code === 'YL' || code === 'YO') return 'nonConveyable';` (cạnh nhánh nonConveyable theo name).
- Không đổi các nhánh hiện có (CSV vẫn dùng 'WEIGHT'/name như cũ).
- Test bổ sung trong `dhl-billed-map.test.ts`: charge code 'P' → base; 'YL' → nonConveyable; 'OO' → unknown.

### 4.2 `features/carrier-rates/ap/invoice-upload.ts` (sửa)
- `detectInvoiceFormat`: thêm `if (carrierKey === 'dhl' && ext === '.xml') return 'dhl_xml';` (thêm `'dhl_xml'` vào `InvoiceFormat`).
- `previewOneInvoice` + `importCarrierInvoices`: nhánh `dhl_xml` → `parseDhlInvoiceXml(text)` (giống nhánh `dhl_csv`, chỉ khác hàm parse). `splitByPhase`: `dhl_xml` vào nhóm spreadsheets (đi đường tạo bill như CSV).
- Thông báo lỗi format: "Không đúng định dạng hoá đơn DHL (CSV/XML)".

### 4.3 Test fixture
- Inline XML string (2-3 shipment, mỗi shipment nhiều dòng phí gồm P/FF/SF + 1 shipment có CA), + Invoice header, trong file test — phản ánh đúng cấu trúc §2 (không nhồi file 1.2MB vào repo).

## 5. Guard / lỗi

- XML không đúng (thiếu `<Invoice>`/`<ID>`/`<IssueDate>`) → `parseDhlInvoiceXml` trả null → "Không đúng định dạng".
- SellersLineId rỗng ở 1 line → bỏ line đó (không tạo shipment rỗng) + đếm cảnh báo.
- Số tiền parse lỗi → 0 (như CSV `num`).
- Không đổi reconcile/đối soát logic — chỉ thêm nguồn parse đúng.

## 6. Test (TDD)

- `parseDhlInvoiceXml` (thuần): group đúng N shipment theo SellersLineId; total = Σamt+Σtax (vd 2.596.677); orderRef/weight/date đúng; charges có P→WEIGHT, FF→fuel; Invoice-level (billNumber/amount/issueDate).
- `detectInvoiceFormat` nhận `.xml` cho dhl.
- import/preview routing = integration → verify tsc/vitest/build.

## 7. Ngoài phạm vi

- Bỏ CSV (giữ song song).
- Đổi cờ "billedChangedSinceReview"/dung sai (fix gốc bằng parse đúng; nếu sau vẫn cần dung sai → spec riêng).
- Sửa số đã sai trong DB cho 2 bill cũ (sẽ tự đúng khi re-upload XML; xử lý vận hành riêng).
- Parse PDF để đối soát (PDF/CSV chỉ là bằng chứng đính kèm; nguồn đối soát là XML).
