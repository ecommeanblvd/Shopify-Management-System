# Spec: Dịch vụ bổ sung (addon_fixed) — Direct Signature DHL & FedEx

**Ngày:** 2026-06-11
**Module:** Carrier rates engine + Đối soát phí ship
**Specs nền:** các quyết định reconcile 2026-06 (fuel base per-carrier, per-line rounding FedEx)

## 0. Bối cảnh & quyết định (cùng operator, 2026-06-11)

Direct Signature của DHL đang bị xếp nhầm vào bucket `peak_fixed` chung với
3 dịch vụ Premium 9:00/10:30/12:00 (đang off); phần đối soát phải "gấp" bucket
peak vào dòng signature. FedEx cũng có Direct Signature nhưng chưa được cấu
hình — đối soát chỉ pass-through mù, không kiểm giá.

Bằng chứng dữ liệu (production, 06/2026):
- DHL: **1.193/1.195** bill có Direct Signature → luôn-bật ở mức tài khoản.
  Giá 130.000đ (đến 30/12/2025) → 150.000đ (từ label 05/01/2026). KHÔNG fuel.
- FedEx: **315/1.363** bill (23%) có Direct Signature → opt-in theo TỪNG đơn,
  không dự đoán được từ dữ liệu Shopify. Giá 88.000đ (12/2025) → 92.700đ
  (từ label 05/01/2026). CÓ fuel (fuel base FedEx = net + remote + demand
  + signature — đã xác minh trước đó).

**Quyết định:** loại surcharge mới `addon_fixed` ("Dịch vụ bổ sung") với 2 chế
độ áp dụng:
- `always` — cộng vào mọi quote (DHL Direct Signature).
- `when_billed` — KHÔNG cộng vào quote; chỉ dùng làm GIÁ THAM CHIẾU để đối
  soát kiểm tra khi bill có dòng này (FedEx Direct Signature).

## 1. Schema (`db/schema.ts` + migration)

1. Enum `carrier_surcharge_kind`: thêm giá trị `'addon_fixed'`.
2. Bảng `carrier_surcharges`: thêm cột
   `apply_mode text NOT NULL DEFAULT 'always'` (giá trị `'always' |
   'when_billed'`; chỉ có nghĩa với `addon_fixed`, các kind khác giữ default).
3. **Data migration (cùng file SQL migration, idempotent):**
   - UPDATE 2 dòng DHL Direct Signature hiện tại (kind `peak_fixed`, note chứa
     'Direct Signature') → `kind='addon_fixed', apply_mode='always'`
     (giữ nguyên value/fuelable=false/starts/ends).
   - INSERT 2 dòng FedEx (carrier_account của FedEx hiện hành):
     | value | fuelable | apply_mode | starts_at | ends_at | note |
     |---|---|---|---|---|---|
     | 88.000 | true | when_billed | NULL | 2026-01-05 | Direct Signature — 88k đến trước 05/01/2026 |
     | 92.700 | true | when_billed | 2026-01-05 | NULL | Direct Signature — 92.7k từ 05/01/2026 |
   - 3 dòng Premium 9:00/10:30/12:00 GIỮ NGUYÊN `peak_fixed` (off) — bucket
     peak từ nay chỉ còn nghĩa "Premium delivery".

## 2. Engine (`features/carrier-rates/engine/quote.ts`)

- Breakdown thêm 2 trường:
  - `addons`: tổng các dòng `addon_fixed` applicable có `apply_mode='always'`
    — CỘNG vào total, đi qua logic fuelable per-row như mọi surcharge
    (DHL fuelable=false → ngoài fuel base).
  - `addonReference`: tổng các dòng `addon_fixed` applicable có
    `apply_mode='when_billed'` — KHÔNG cộng vào total, không vào fuel base;
    chỉ là giá tham chiếu cho đối soát (0 khi không có dòng nào).
- `peak` giữ nguyên semantics (sau migration thực tế = 0 vì Premium off).
- Default fuelable cho kind mới: `false` (per-row override quyết định).
- Helper preview surcharge (đoạn switch ~dòng 616) thêm case `addon_fixed`.

## 3. Đối soát (`features/shipments/reconcile.ts`, `reconcile-diagnose.ts`)

- `reconcile.ts`: engine row thêm `addons` + `addonReference`; trường
  `peak` thôi không còn được fold vào dòng signature.
- Dòng so sánh **signature** đổi nguồn engine: `engine.signature = addons`
  (DHL: 130k/150k như cũ — chỉ đổi đường đi, KHÔNG đổi số).
- `reconcile-diagnose.ts` — nhánh billed có `directSignature > 0` mà
  `engine.addons = 0` (trường hợp FedEx when_billed):
  - Nếu `billed.directSignature === addonReference` (giá khớp bảng):
    cause `PHI_TUY_CHON` như cũ, note ghi rõ "Direct Signature đúng bảng giá
    (X đ)" — fuel trên signature đã được công thức fuel-base FedEx xử lý sẵn.
  - Nếu KHÁC giá tham chiếu (`addonReference > 0` nhưng lệch số):
    cause `PHI_TUY_CHON` **không** được cấp; phần lệch rơi vào residual như
    một mismatch thật, note "Direct Signature sai bảng giá: bill X ≠ Y".
  - `addonReference = 0` (chưa cấu hình cho carrier đó): giữ hành vi
    pass-through hiện tại (không chặt hơn với carrier chưa khai giá).
- DHL không đổi hành vi: 2 bill không có signature (engine vẫn cộng 150k)
  tiếp tục hiện lệch như hiện nay — đã là known case.
- Cache reconcile: sau khi migrate data phải bust (cơ chế `?refresh=1`
  hiện có); ghi chú trong plan bước verify.

## 4. UI

1. `components/carrier-rates/QuoteForm.tsx`: thêm dòng breakdown
   "Dịch vụ bổ sung" (`breakdown.addons`, muted khi 0). Dòng
   "Peak / premium" giữ nguyên.
2. `components/carrier-rates/SurchargeEditDialog.tsx`: select kind thêm
   `addon_fixed` (label "Dịch vụ bổ sung (cố định/lô hàng)"); khi chọn kind
   này hiện thêm select "Chế độ áp dụng": Luôn cộng vào quote (`always`) /
   Chỉ kiểm khi bill có (`when_billed`).
3. Trang listing surcharge của carrier (nơi đang nhóm theo kind): nhóm mới
   "Dịch vụ bổ sung" hiển thị các dòng addon_fixed với badge chế độ.
4. `components/shipping-reconcile/ReconcileDetailPanel.tsx`: dòng signature
   giữ label hiện có; cột engine lấy từ `addons`; khi diagnose ghi note
   sai-bảng-giá thì note hiện như các note khác hiện nay.

## 5. Không đổi

- 3 dòng Premium (`peak_fixed`, off), GoGreen (`per_step_fixed`), ER/demand/
  remote/fuel — nguyên trạng.
- Công thức fuel base hai carrier (đã đúng từ trước).
- Per-line rounding FedEx.

## 6. Kiểm thử (TDD)

- `quote.test.ts`: (a) addon `always` cộng vào total, fuelable=false ngoài
  fuel base; (b) addon `when_billed` KHÔNG vào total, xuất hiện ở
  `addonReference`; (c) gate ngày starts/ends của addon.
- `reconcile-diagnose` tests: (a) FedEx bill có signature đúng 92.700 + fuel
  → verdict passthrough/PHI_TUY_CHON; (b) sai giá (vd 100.000) → residual
  mismatch, note sai bảng giá; (c) DHL behavior không đổi (so dòng signature
  với addons 150k).
- Migration: chạy trên DB thật qua drizzle migrate; verify bằng query đếm
  (2 dòng DHL đổi kind, 2 dòng FedEx mới, 3 dòng Premium giữ peak_fixed);
  chạy lại reconcile fleet → tổng số khớp KHÔNG giảm (DHL giữ nguyên,
  FedEx có thể tăng độ chính xác phân loại).
