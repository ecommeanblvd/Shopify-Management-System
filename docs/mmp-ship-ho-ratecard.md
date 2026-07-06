# SMS → MMP — Rate card ship hộ (per-brand, pull)

**Mục đích:** MMP lấy **bảng giá ship hộ brand-facing** của từng brand đã duyệt từ
SMS, lưu vào DB brand, và hiển thị cho brand biết bảng giá đang được áp dụng.

**Mô hình:** **MMP pull** (MMP gọi SMS) — giống hệt các endpoint ship hộ đang chạy
(`/api/mmp/ship-ho/estimate`, `/countries`, …). MMP **KHÔNG cần dựng receiver mới**;
chỉ thêm 1 lời gọi + lưu kết quả. SMS không đẩy chủ động.

> Endpoint này dùng **đúng scheme HMAC + secret** mà MMP đã dùng cho
> `/api/mmp/ship-ho/estimate` (`MMP_WEBHOOK_SECRET`, ký `${timestamp}.${body}`).
> Không cấu hình gì mới phía SMS.

---

## 1. Request (MMP → SMS)

- **Method:** `POST`
- **URL:** `https://<sms-host>/api/mmp/ship-ho/ratecard`
- **Headers:**
  - `content-type: application/json`
  - `x-mean-signature: sha256=<hex>` — HMAC (xem §4)
  - `x-mean-timestamp: <unix seconds>`
- **Body:**
  ```json
  { "brandSlug": "tinh-atelier" }
  ```
  - `brandSlug`: brand cần lấy bảng giá (= vendor Shopify, cùng nguồn `brandSlug`
    dùng ở brand-request/orders — nhất quán).

---

## 2. Response (SMS → MMP)

- **200** — thành công:
  ```jsonc
  {
    "ok": true,
    "ratecard": {
      "brandSlug": "tinh-atelier",
      "service": "express",              // Express Delivery (FedEx)
      "currency": "VND",
      "markupPercent": 30,               // markup riêng của brand này
      "version": "a1b2c3d4e5f6",         // hash nội dung — xem §3
      "generatedAt": "2026-07-06T10:00:00.000Z",
      "effectiveDate": "2026-07-06",
      "tiers": [0.5, 1, 1.5, 2, 2.5, 3, /* … tới ~30kg */],
      "zones": [
        {
          "label": "Zone A",
          "countries": ["TH", "SG", "MY", "HK", /* … ISO-2 */],
          "cells": [
            { "tierUpperKg": 0.5, "offerVnd": 520000 },
            { "tierUpperKg": 1,   "offerVnd": 585000 }
            // … 1 ô / mốc cân
          ]
        }
        // … 1 mục / zone
      ],
      "countryZones": [
        { "code": "TH", "name": "Thailand", "zone": "Zone A" }
        // … 1 dòng / nước (tra nhanh nước → zone)
      ],
      "surcharges": [
        { "kind": "remote_fixed",      "label": "Phụ phí vùng xa (ODA …)",  "detail": "Tier A: 350.000₫/lô · …" },
        { "kind": "residential_fixed", "label": "Phụ phí địa chỉ dân cư",    "detail": "95.410₫/lô" },
        { "kind": "processing_fixed",  "label": "Phí xử lý đơn hàng",        "detail": "50.000₫" },
        { "kind": "vat_percent",       "label": "VAT",                      "detail": "8%" }
      ],
      "processingFeeVnd": 50000,
      "fuelUrl": "https://www.fedex.com/en-vn/shipping/fuel-surcharge.html",
      "notes": [
        "Giá dự kiến theo cân nặng & kích thước khai báo; hóa đơn cuối tính theo cân & phụ phí thực tế.",
        "Phụ phí xăng dầu áp theo tuần giao hàng của đơn vị vận chuyển.",
        "Đã gồm VAT."
      ]
    }
  }
  ```

### Ý nghĩa các trường (QUAN TRỌNG khi hiển thị)
- **`zones[].cells[].offerVnd`** = **giá brand phải trả cho cước cơ bản** theo (zone × mốc cân),
  ĐÃ gồm markup của brand. Tra: nước → zone (bảng `countryZones`), cân → mốc (`tiers`,
  lấy mốc `tierUpperKg` ĐẦU TIÊN ≥ cân tính cước). SMS **không gửi giá vốn/margin**.
- **`surcharges`** = các khoản CỘNG THÊM ngoài cước cơ bản (vùng xa, dân cư, phí xử lý
  đơn hàng, VAT…). `detail` là chuỗi mô tả sẵn để hiển thị. **`processingFeeVnd`** là
  phí xử lý đơn hàng cố định (50.000₫/đơn) tách riêng để MMP tính/hiển thị nếu cần.
- **`fuelUrl`** = phụ phí xăng dầu KHÔNG bake vào `offerVnd` (đổi theo tuần); hiển thị
  link để brand tự tra, và nêu rõ hóa đơn cuối gồm fuel thực tế (đã có trong `notes`).
- **`tiers`** đơn vị **kg**; **tiền** đơn vị **VND** nguyên (không thập phân).

### Lỗi
| HTTP | body `code` | Nghĩa |
| --- | --- | --- |
| 400 | `bad_input` | thiếu `brandSlug` |
| 401 | — | sai/thiếu chữ ký HMAC hoặc lệch timestamp > 300s |
| 403 | `brand_not_approved` | brand không tồn tại / chưa `active` / chưa bật self-service |
| 422 | `no_carrier` | SMS chưa cấu hình được bảng giá FedEx |
| 500 | — | SMS chưa set `MMP_WEBHOOK_SECRET` |

---

## 3. Phát hiện thay đổi bằng `version`

`version` là hash 12-hex của **nội dung** rate card (KHÔNG gồm `generatedAt`). Cùng nội
dung → cùng `version` dù gọi lúc khác nhau. MMP **lưu `version` theo brand**; lần pull sau
nếu `version` không đổi thì bảng giá y nguyên (không cần ghi lại/thông báo brand). `version`
đổi khi: giá cước FedEx đổi, markup brand đổi, hoặc phụ phí đổi.

> Fuel KHÔNG nằm trong `version` (là link, đổi theo tuần) — đừng coi fuel là "rate card đổi".

## 4. HMAC (giống `/api/mmp/ship-ho/estimate`)

```
signedPayload = `${x-mean-timestamp}.${rawBody}`      // rawBody = đúng chuỗi JSON gửi đi
signature     = HMAC_SHA256(MMP_WEBHOOK_SECRET, signedPayload)   // hex
header        = `x-mean-signature: sha256=<hex>`
```
- Ký **body thô** (đừng parse rồi re-serialize — lệch byte).
- Timestamp lệch > **300s** → SMS từ chối (chống replay).
- Đây là scheme MMP đã dùng cho estimate → **tái dùng nguyên hàm ký sẵn có**.

---

## 5. MMP nên gọi khi nào (gợi ý)

Vì là pull, MMP tự quyết nhịp gọi. Khuyến nghị:
1. **Khi duyệt brand** (brand chuyển sang được dùng ship hộ) → pull + lưu để hiển thị ngay.
2. **Khi brand mở trang bảng giá** → pull (cache ngắn 5–15 phút) để luôn mới.
3. **Định kỳ hằng ngày** cho mọi brand đã duyệt → so `version`, chỉ ghi DB + báo brand khi đổi.

Brand chưa duyệt trả `403` — MMP bỏ qua/không hiển thị.
