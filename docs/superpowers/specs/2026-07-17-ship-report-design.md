# Ship Report — POD từ bill + P&L + Phân tích phụ phí

**Ngày:** 2026-07-17 · **Trạng thái:** CEO đã duyệt (A+B+C, bỏ D bảng kê)

## Bối cảnh & vấn đề

- Dữ liệu ngày giao (delivered_at) gần như đứng im: 14 ngày có 179 đơn ship đi nhưng chỉ 2 đơn có ngày giao. FedEx Track API 403, TrackingMore hết quota, Lark cập nhật theo đợt → bảng transit trên Dashboard méo.
- File bill FedEx FBO có sẵn cột **"Ngày/Thời gian/Tên trong bằng chứng giao hàng" (POD)** — nguồn ngày giao chính thức, không phụ thuộc API ngoài.
- Chưa có báo cáo P&L mảng ship và phân tích phụ phí.

## Quyết định đã chốt

1. **POD bill là chuẩn — ghi đè** ngày giao từ Lark/fallback khi lệch (sửa cả 25 đơn bị dồn 07/07).
2. Báo cáo đặt ở **trang riêng `/f/ship-report`** (tab P&L + tab Phụ phí), Dashboard gắn card tóm tắt.
3. Quyền xem: `view_carrier_rates`.

## A. POD từ bill FBO

- `fedex-fbo-parse`: đọc thêm META `podDate` ("ngày trong bằng chứng giao hàng", dạng 20260707), `podTime` ("thời gian trong bằng chứng giao hàng", "11:27"), `podName`. Pure fn `parseFboPod(date, time)` → Date | null.
- Migration 0109: `carrier_bill_lines` + `pod_at timestamp`, `pod_name text`.
- FBO import ghi 2 cột này (lines vốn delete+reinsert khi re-import → re-upload file cũ tự điền POD).
- `features/shipments/apply-pod.ts` — `applyPodDeliveries()` (core không-auth, idempotent):
  - `shipments`: theo tracking, `delivered_at = pod_at` (+ `delivery_source='carrier_bill'`) khi lệch/thiếu.
  - `ship_ho_orders`: set `delivered_at`, status delivered, bắn event MMP nếu đổi (nguồn `carrier_bill`).
- Chạy sau mỗi lần import bill + trong cron hourly.
- Backfill: bill mới nhất parse lại từ file gốc; bill cũ cần re-upload file (line cũ không lưu POD).

## B. `/f/ship-report` — tab P&L

- **Thu**: Shopify = `totalShipping` (phí ship khách trả SAU giảm) quy VND; Ship hộ = `actualChargedVnd ?? chargedVnd`.
- **Chi**: Shopify = `shipment_charges.totalAmount` (billed, loại duty); Ship hộ = `actualCarrierCostVnd ?? carrierCostVnd`.
- Bảng theo **tháng** (mốc `label_created_at` / ship date): số đơn, thu, chi, margin, margin %, tách segment Shopify / Ship hộ / Tổng. Chọn 1 tháng → breakdown carrier × quốc gia. Filter: range tháng, carrier, segment. Đơn chưa có bill: dùng chi phí dự tính, đánh dấu tỉ lệ phủ bill.
- Pure fn aggregation trong `features/ship-report/pnl.ts` + unit test; queries tách `queries.ts`.

## C. `/f/ship-report` — tab Phụ phí

- Nguồn: `shipment_charges` (residential, directSignature, remote, demand, addressCorrection, importHandling, gogreen…) + `carrier_bill_lines` (ship hộ: signature/other/remote/demand).
- Mỗi loại phụ phí: tổng VND, số đơn dính, % đơn, TB/đơn; filter tháng/carrier/quốc gia. Bảng top tuyến theo loại (vd US×residential) → căn cứ chỉnh quote + đàm phán HNC.
- Pure fn `features/ship-report/surcharges.ts` + test.

## Dashboard

Card tóm tắt tháng hiện tại (thu / chi / margin, badge % phủ bill) link `/f/ship-report`.

## Kiểm định

- Unit test cho parser POD + aggregation P&L + phụ phí.
- Verify prod: POD backfill xong đối chiếu transit 14d (kỳ vọng delivered ≫ 2); tổng P&L đối chiếu chọn mẫu 1 tháng bằng SQL tay.
