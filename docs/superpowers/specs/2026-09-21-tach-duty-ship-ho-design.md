# Tách thuế/phí nhập khẩu (duty) khỏi cước ship hộ; chốt luật kỳ bảng kê

**Ngày:** 2026-09-21 · **Trạng thái:** thiết kế, chờ CEO soát · **Quyết định liên quan:** D-057 (markup theo bậc), D-019 (POD trên bill), D-073 (Lark không phải nguồn tiền), 08/09 (bảng kê thu theo giá thực khi đã có bill)

## 1. Vấn đề — bằng chứng từ đối chiếu Kalisa T7 (21/09/2026)

Ba bên lập bảng kê cho cùng một brand, cùng "tháng 7", ra ba con số:

| Bên | Mốc xếp kỳ | Số đơn T7 | Tổng |
|---|---|---|---|
| Đức (Google Sheet) | ngày gửi hàng, tới 24/07 | 26 | 62.597.172đ |
| MMP (bảng kê phát hành) | "ngày có chứng từ" = ngày SMS chốt đối soát | 12 | 19.972.951đ |
| SMS (bảng kê nháp) | ngày báo giá `quoted_at` 03/07–12/08 | 49 | 119.090.677đ |

Đối chiếu 26 đơn của Đức theo mã vận đơn: **17 đơn khớp cả ba bên đến từng đồng; 9 đơn lệch, và 9/9 lệch đều là duty.** Cước + phụ phí không lệch một đồng.

- 6 đơn SMS/MMP có duty, Đức chưa có (3.868.575đ): hoá đơn duty FedEx phát hành 17/08–08/09, SMS nhập 04–18/09 — sau khi Đức lập file.
- 2 đơn Đức có duty, SMS/MMP chưa có (#KLS1990 736.241đ, #KLS1993 328.802đ): hoá đơn duty chưa được nhập vào SMS → **đang thu thiếu Kalisa 1.065.043đ**.

Gốc của cả hai: **duty đến trên hoá đơn FedEx riêng, 3–6 tuần sau cước**, nhưng SMS cộng nó vào cùng một con số `actual_charged_vnd` với cước. Hệ quả: số tiền một đơn đổi sau khi đã kê; bảng kê ba bên không thể trùng; markup/lãi thuần bị pha khoản thu hộ.

## 2. Quyết định (CEO chốt 21/09/2026)

1. **Kỳ bảng kê CƯỚC xếp theo ngày gửi hàng** (`shipped_at`), chỉ đưa đơn **đã đối soát hoá đơn xong** (`reconcile_status = 'reconciled'`). Đơn gửi trong kỳ chưa có hoá đơn: liệt kê ở mục "Chờ hoá đơn" cuối bảng kê, **không cộng vào tổng**, tự sang kỳ sau. Bỏ mốc `quoted_at` và bỏ luật "chưa có bill thì thu giá báo" (08/09) — từ nay bảng kê chỉ thu giá thực.
2. **Kỳ bảng kê DUTY xếp theo ngày hoá đơn FedEx** (`carrier_bills.issue_date`, thiếu thì `period_start`). Hoá đơn về kỳ nào thu kỳ đó, bất kể đơn gửi khi nào.
3. **Không thu thêm gì trên duty.** Thu đúng số FedEx ứng hộ trên hoá đơn: không markup, không nhiên liệu, không VAT, không phí xử lý.
4. **Hợp đồng MMP:** `finalChargedVnd` chỉ còn cước; duty đi trường riêng và sự kiện riêng; bảng kê phát hành bằng `statement.issued`. **SMS là bên duy nhất lập bảng kê; MMP ngừng tự tính kỳ.** Không có điều này thì ba bên vẫn lệch dù SMS đổi luật.

## 3. Mô hình dữ liệu

### 3.1 `ship_ho_orders`

| Cột | Đổi |
|---|---|
| `actual_charged_vnd` | **Chỉ còn cước** (cước cơ bản đã markup + phụ phí vận chuyển + phí xử lý hàng NK + nhiên liệu + phí xử lý đơn + VAT). Không gồm duty. |
| `actual_duty_vnd` numeric **(mới)** | Tổng duty FedEx ứng hộ cho đơn, từ `carrier_bill_lines.duty` của mọi dòng khớp mã vận đơn. NULL = chưa có hoá đơn duty. |
| `duty_bill_numbers` text[] **(mới)** | Số hoá đơn FedEx đã cộng vào `actual_duty_vnd` — để biết hoá đơn nào đã tính, hoá đơn mới về thì cộng thêm. |
| `duty_statement_id` uuid **(mới)**, FK `ship_ho_statements.id` | Bảng kê duty đơn thuộc về. Một đơn có thể vừa có `statement_id` (cước) vừa có `duty_statement_id`. |
| `actual_bill_breakdown.sell.chargedVnd` | = cước, khớp `actual_charged_vnd`. `sell.dutyVnd` giữ để hiển thị. |

`charged_vnd` (giá báo) chưa bao giờ có duty — không đổi.

### 3.2 `ship_ho_statements`

| Cột | Đổi |
|---|---|
| `type` enum `ship_ho_statement_type ('freight','duty')` **(mới)**, default `'freight'` | Loại bảng kê. |
| `period_start` / `period_end` | Với `freight`: khoảng **ngày gửi hàng**. Với `duty`: khoảng **ngày hoá đơn FedEx**. |
| `order_count`, `total_charged_vnd` | Với `duty`: số đơn có dòng duty và tổng duty. Tên cột giữ nguyên để không đụng UI công nợ. |

### 3.3 Không đổi

`carrier_bill_lines.duty` đã tách cột riêng từ 21/07 — nguồn duy nhất của duty. `shipment_charges` không liên quan ship hộ.

## 4. Luật tính

### 4.1 Cước thực (`reconciledBrandCharge`)

`chargedVnd = markedBase + transport + customs + fuel + processing + vat` — **bỏ `+ duty`**. Hàm vẫn trả `dutyVnd` để caller ghi riêng. Dòng "Thuế/hải quan (theo bill)" **rời khỏi `lines`** của cước; xuất hiện ở bảng kê duty.

### 4.2 Duty thực

`actual_duty_vnd = Σ carrier_bill_lines.duty` của mọi dòng có `tracking_number` khớp đơn (kể cả dòng chỉ có duty, không có cước). Ghi **độc lập với đối soát cước**:

- Hoá đơn duty về **sau** cước (thường gặp): ghi `actual_duty_vnd`, thêm số hoá đơn vào `duty_bill_numbers`, **không** đụng `actual_charged_vnd`, không đổi `reconcile_status`, không phá đóng băng (`donDaDongBang` chỉ so cước).
- Hoá đơn duty về **trước** cước: vẫn ghi duty; cước giữ luật cũ (`dutyOnly` → chưa re-bill).
- Cùng đơn có 2 hoá đơn duty (hiếm, khi FedEx điều chỉnh): cộng dồn, cả hai số hoá đơn vào mảng.

### 4.3 Giá đưa vào bảng kê

- `freight`: `giaThuBangKe` → **chỉ** `actual_charged_vnd` khi `reconciled`; không còn nhánh giá báo. Đơn chưa reconciled không vào tổng.
- `duty`: `actual_duty_vnd` của đơn có hoá đơn duty trong kỳ và `duty_statement_id IS NULL`.

### 4.4 Gom bảng kê (`generateStatement(brand, type, start, end)`)

- `freight`: đơn `partner = brand`, `shipped_at ∈ [start,end]`, `reconcile_status = 'reconciled'`, `statement_id IS NULL`, `status ∈ (shipped, delivered)`, không phải `khong_gui_hang` đã xác nhận. Kèm danh sách **"Chờ hoá đơn"**: cùng điều kiện nhưng chưa reconciled — chỉ hiển thị, không gán `statement_id`.
- `duty`: đơn `partner = brand`, có dòng `carrier_bill_lines.duty > 0` khớp mã vận đơn với hoá đơn `issue_date ∈ [start,end]`, `duty_statement_id IS NULL`. Mỗi dòng bảng kê = mã đơn + mã brand (`brand_reference`) + mã vận đơn + số hoá đơn FedEx + ngày hoá đơn + số tiền.
- Tính lại nháp (`tinhLaiTongBangKe`) theo `type`. Bảng kê `issued`/`paid` đứng yên như cũ.

## 5. Hợp đồng với MMP (sửa `docs/integrations/mmp-ship-ho-api.md`)

| Sự kiện | Đổi |
|---|---|
| `order.reconciled` | `finalChargedVnd` = **cước** (không duty). Thêm `dutyVnd` (number, 0 nếu chưa có hoá đơn duty) và `totalWithDutyVnd = finalChargedVnd + dutyVnd` để MMP hiển thị tổng nếu muốn. `previousChargedVnd`/`deltaVnd` so trên cước. |
| `order.duty_charged` **(mới)** | Bắn mỗi khi `actual_duty_vnd` đổi. `data: { dutyVnd (tổng hiện tại), addedVnd (khoản vừa cộng), fedexInvoiceNumber, invoiceDate, note: "Thuế/phí nhập khẩu FedEx ứng hộ, thu đúng nguyên giá, không markup/VAT" }`. Idempotent theo `fedexInvoiceNumber`. |
| `statement.issued` **(triển khai — trước đây chỉ có trong doc)** | Bắn khi bảng kê chuyển `issued`. `data: { statementId, type: "freight"\|"duty", periodStart, periodEnd, periodBasis: "shipped_at"\|"fedex_invoice_date", orders: [{ code, mmpRef, brandReference, trackingNumber, amountVnd, fedexInvoiceNumber?, invoiceDate? }], totalVnd, orderCount, dueDate }`. `code = brandSlug`, `mmpRef = brandSlug` (theo quy ước sự kiện cấp brand). |
| `statement.paid` | Bắn khi chuyển `paid`. `data: { statementId, type, paidAt }`. |

**Yêu cầu phía MMP:** (1) hiển thị duty là dòng riêng trên đơn, không cộng vào "cước"; (2) **ngừng tự lập bảng kê theo "ngày có chứng từ"**, render bảng kê từ `statement.issued`; (3) xử lý `order.cancelled` (đã gửi 19/09).

**Chuyển tiếp:** gác sau env `MMP_TACH_DUTY=1`. Khi bật, SMS bắn lại `order.reconciled` cho 61 đơn có duty với `finalChargedVnd` mới (giảm đúng bằng duty) kèm `dutyVnd`, và `order.duty_charged` cho từng đơn. Bật **sau khi MMP xác nhận đã nhận trường mới** — bật trước thì brand thấy giá "giảm" vô cớ. `nenBanGiaCuoi` so trên cước mới nên sẽ tự bắn khi bật.

## 6. Giao diện SMS

- **Trang Bảng kê** (`/f/ship-ho/statements`): chọn **loại** khi tạo; cột Loại và Mốc kỳ trong danh sách; bảng kê `freight` có mục "Chờ hoá đơn" ở cuối; bảng kê `duty` có cột Số hoá đơn FedEx, Ngày hoá đơn.
- **Xuất Excel** cho cả hai loại, đúng cột trên — thay file Google Sheet Đức đang làm tay. Bảng kê duty xuất kèm cột mã vận đơn để brand tra tờ khai.
- **Chi tiết đơn / bảng đối soát**: cước và duty là hai con số riêng; tổng brand phải trả = cước + duty ghi rõ là tổng của hai.
- **Công nợ theo brand** (`arByPartner`): cộng cả hai loại, hiện tách "cước / duty".

## 7. Chuyển đổi dữ liệu (một lượt, có dry-run)

1. 61 đơn có `actual_bill_breakdown.duty > 0` (Kalisa 58, Tom Fried 2, Lekieu 1): `actual_duty_vnd = duty`, `actual_charged_vnd -= duty`, `sell.chargedVnd -= duty`, `duty_bill_numbers` = số hoá đơn có dòng duty. Cả 61 đều chưa nằm trong bảng kê đã phát hành (3 bảng kê SMS đều nháp) → không phải sửa số đã gửi brand.
2. Tính lại 3 bảng kê nháp theo luật mới; bảng kê Kalisa `0dcc5f5c` đổi mốc từ `quoted_at` sang `shipped_at` — CEO chọn lại kỳ (đề xuất T7 = 01–31/07 và T8 = 01–31/08 riêng, thay bảng 03/07–12/08).
3. Đức nhập hai hoá đơn duty còn thiếu của #KLS1990 và #KLS1993 vào Đối soát phí ship → hệ thống tự ghi duty.
4. **Kiểm trước khi phát hành bảng kê duty đầu tiên:** báo cáo dòng `carrier_bill_lines.duty > 0` chưa gắn được đơn ship hộ nào theo mã vận đơn. Kiểm 21/09: 74 dòng / 82,2 triệu chưa gắn, nhưng phần lớn là kiện **MEAN BLVD nhà** (#MBLVD…, 2025) và 43 dòng khớp `shipments` theo mã vận đơn mà thiếu `shipment_id` — đó là chi phí của mình, **ngoài phạm vi thu brand**, nhưng cần nối lại cho đối soát nội bộ (việc riêng). Với ship hộ, chỉ dòng có `order_number` dạng mã Lark/brand mà không khớp mới là thu thiếu.

## 8. Cấu trúc code

```
db/migrations/0147_tach-duty.sql          cột mới §3.1, enum + cột type §3.2
features/ship-ho/reconcile-charge.ts      chargedVnd bỏ duty; dutyVnd trả riêng
features/ship-ho/duty.ts (mới, thuần+DB)  tinhDutyTuBill(lines) → {dutyVnd, billNumbers}; ghiDutyChoDon(orderId) — cộng dồn theo số hoá đơn, bắn order.duty_charged
features/ship-ho/reconcile-actions.ts     re-bill: ghi actual_charged (cước) + gọi ghiDutyChoDon; dutyOnly vẫn ghi duty
features/ship-ho/statement-logic.ts       giaThuBangKe chỉ giá thực; giaDutyBangKe; summarize theo type
features/ship-ho/statement-core.ts        tinhLaiTongBangKe theo type
features/ship-ho/statement-actions.ts     generateStatement(brand, type, start, end); setStatementStatus bắn statement.issued/paid
features/ship-ho/statement-queries.ts     chờ-hoá-đơn; dòng duty kèm hoá đơn; arByPartner tách loại
features/ship-ho/statement-export.ts (mới) xuất xlsx hai loại
features/ship-ho/mmp-events-map.ts + docs/integrations/mmp-ship-ho-api.md
components/ship-ho/StatementsManager.tsx  chọn loại, cột mới, nút xuất
scripts/chuyen-doi/tach-duty.ts           §7.1–7.2, có --dry
```

## 9. Kiểm thử (thuần)

- `reconciledBrandCharge`: `chargedVnd` không đổi khi `dutyVnd` đổi; `dutyVnd` trả đúng; `lines` không còn dòng duty.
- `tinhDutyTuBill`: cộng dồn nhiều dòng; hoá đơn đã có trong `duty_bill_numbers` không cộng lại; dòng duty 0 bỏ qua.
- `giaThuBangKe`: chưa reconciled → null (không còn fallback giá báo).
- Chọn đơn cho `freight`: theo `shipped_at`, loại chưa reconciled sang "chờ hoá đơn", loại `khong_gui_hang` xác nhận.
- Chọn đơn cho `duty`: theo `issue_date` hoá đơn, không lấy đơn đã có `duty_statement_id`.
- Payload `statement.issued` cộng `orders[].amountVnd` = `totalVnd`.
- Script chuyển đổi: `actual_charged + actual_duty` sau = `actual_charged` trước, trên 61 đơn.

## 10. Ngoài phạm vi

- Phí xử lý thu hộ (CEO: không thu).
- `statement.overdue`, nhắc nợ.
- Nối 43 dòng duty kiện MEAN BLVD vào `shipments` (việc đối soát nội bộ riêng).
- Ghi duty lên Lark.
