# Cổng API external (app khác pull dữ liệu từ SMS)

## Auth

Mọi endpoint dưới `/api/external/*` yêu cầu API key (env `EXTERNAL_API_KEY` trên Railway):

```
Authorization: Bearer <EXTERNAL_API_KEY>
# hoặc
x-api-key: <EXTERNAL_API_KEY>
```

Sai/thiếu key → `401 { "error": "unauthorized" }`. Chưa cấu hình env → `503`.
Base URL: domain SMS trên Railway. Tất cả GET, JSON, tiền tệ VND (trừ rate-cards theo cost currency của account).

## 1. GET `/api/external/ship-report?months=6`

Báo cáo ship: P&L theo tháng + phụ phí. `months` ∈ {3, 6, 12} (mặc định 6).

```jsonc
{
  "generatedAt": "…", "monthsBack": 6, "currency": "VND",
  "pnl": {
    "months": [ // 1 dòng total + mỗi segment (shopify|ship_ho) mỗi tháng
      { "month": "2026-07", "segment": "total", "orders": 218,
        "revenueVnd": 407145180, "costVnd": 35273706, "marginVnd": 371871474,
        "marginPct": 91.3, "billedPct": 13.8 } // billedPct thấp = margin chưa đáng tin (bill chưa về)
    ],
    "breakdownByMonth": { "2026-07": [ { "carrierKey": "fedex", "country": "US", "orders": 80, "revenueVnd": 0, "costVnd": 0, "marginVnd": 0, "marginPct": null } ] }
  },
  "surcharges": {
    "summary": [ { "type": "demand", "label": "Phụ phí nhu cầu (demand)", "totalVnd": 41653750, "shipments": 520, "avgVnd": 80103, "pctOfShipments": 24.1 } ],
    "topRoutesByType": { "demand": [ { "country": "US", "carrierKey": "fedex", "totalVnd": 0, "shipments": 0, "avgVnd": 0 } ] }
  }
}
```

## 2. GET `/api/external/transit-stats?days=30`

Tiến độ ship trung bình theo quốc gia × line. `days` ∈ {7, 14, 30, 90} (mặc định 14).
Window = đơn TẠO VẬN ĐƠN trong N ngày; ngày giao từ POD bill carrier + tracking + Lark.

```jsonc
{
  "windowDays": 30,
  "routes":   [ { "carrierKey": "fedex", "country": "US", "shippedN": 120, "deliveredN": 45, "avgDays": 4.2, "minDays": 2.1, "maxDays": 9.0 } ],
  "carriers": [ { "carrierKey": "fedex", "shippedN": 380, "deliveredN": 130, "avgDays": 4.6, "medianDays": 4.1 } ],
  "matrix":   { "carriers": ["fedex", "dhl"], "rows": [ { "country": "US", "byCarrier": { "fedex": { "avgDays": 4.2, "deliveredN": 45 } } } ] },
  "latestDeliveryAt": "…" // độ trễ nguồn dữ liệu giao
}
```

Lưu ý: POD về theo kỳ bill tuần → window 7/14 ngày luôn thiếu đơn mới giao chưa lên bill.

## 3. GET `/api/external/rate-cards`

Bảng giá carrier CURRENT (hiệu lực hôm nay: `effective_from ≤ today ≤ effective_to|∞`), giá MUA VÀO (không markup).

```jsonc
{
  "cards": [ {
    "carrierKey": "fedex", "accountName": "HNC FedEx", "cardLabel": "…",
    "effectiveFrom": "2026-07-01", "effectiveTo": null, "currency": "VND",
    "zones": [ { "zone": "US", "countries": ["US"],
      "tiers": [ { "upperKg": 0.5, "packageType": "package", "price": 481433 } ] } ]
  } ]
}
```

## Vận hành

- Key cấp 1 app 1 key khi cần thêm app → nâng lên bảng api_keys (chưa cần).
- Đổi key: `railway variables --set "EXTERNAL_API_KEY=..."` + cập nhật app tiêu thụ (không có dual-accept — hẹn giờ đổi cùng lúc).
- Dữ liệu nguồn giống hệt trang `/f/ship-report` trong SMS (cùng module tính).
