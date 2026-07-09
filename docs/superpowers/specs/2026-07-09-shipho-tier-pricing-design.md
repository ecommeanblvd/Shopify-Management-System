# Bảng giá chiết khấu tier cho đối tác ship hộ — Design

**Chốt với CEO 09/07/2026.**

## Mục tiêu
Thay markup tự do per-partner bằng mô hình **bảng giá gốc (rack) − chiết khấu theo tier**:
- Bảng giá gốc = cước cơ bản × **markup 40%** (kèm fuel + VAT trên phần đó).
- Chiết khấu theo volume, sàn markup hiệu dụng **20%**.
- Offer cho brand trình bày dạng **giá gốc + % chiết khấu** (anchor cao, giảm theo cam kết).

## Bảng tier (hằng số trong code — nguồn sự thật)
| Tier | Đơn/tháng (tháng trước) | CK trên giá gốc | Markup hiệu dụng |
|---|---|--:|--:|
| Standard | < 20 | 0% | 40% |
| Bronze | 20–49 | 4% | 34.4% |
| Silver | 50–99 | 7% | 30.2% |
| Gold | 100–199 | 10% | 26% |
| Platinum | ≥ 200 | 14.2857% (=1−1.2/1.4) | **20%** (sàn, exact) |

- `strategic` flag trên partner → luôn Platinum bất kể volume.
- Ưu tiên resolve: **strategic > override (admin ép) > auto (volume tháng trước) > standard**.

## Phạm vi chiết khấu
CK CHỈ đánh vào bảng cước gốc (base đã markup + fuel/VAT trên phần đó). Phụ phí thực
(vùng xa/nhà dân/ký nhận…) + phí xử lý 50k = passthrough, KHÔNG CK → sàn 20% đảm bảo
toán học ở mọi đơn.

## Kiến trúc (hướng A — lớp tier thuần, engine giá giữ nguyên)
1. **`features/ship-ho/tier-pricing.ts` (THUẦN)**: SHIP_HO_TIERS, `tierForVolume(n)`,
   `resolveTier({strategic, overrideCode, autoCode})`, `effectiveMarkupPercent(discountPct)`
   = (1.4×(1−d/100)−1)×100. + test.
2. **Migration 0106** `ship_ho_partners` += `strategic bool default false`,
   `tier_code text default 'standard'`, `tier_override_code text null`,
   `tier_updated_at timestamptz`. Cột `markup_percent` cũ ngừng dùng cho pricing
   (giữ đọc tham khảo).
3. **estimateForBrand**: markup hiệu dụng suy từ tier → đưa vào `computeBrandCharge`
   như cũ (engine lõi không đổi số).
4. **Lines hiển thị** (`computeBrandCharge` nhận thêm opts `rack`): dòng
   `Cước cơ bản (bảng giá gốc)` = base×1.4 all-in; dòng ÂM `Chiết khấu {Tier} (−d%)`
   = phần chênh; các dòng khác giữ nguyên; VAT residual tự cân → tổng == chargedVnd.
5. **Auto-tier**: cron hourly sẵn có — khi sang tháng mới, đếm đơn ship hộ tháng
   trước per brand → ghi `tier_code` + `tier_updated_at`.
6. **MMP ratecard** (D-014): cell thêm `rackVnd`; top-level `tierName`, `discountPct`;
   `offerVnd = rack×(1−d)`. Version hash tự đổi → MMP nhận bản mới. Doc cập nhật.
7. **Admin UI** trang Đối tác: badge tier + volume tháng trước + toggle Strategic +
   select override (quyền manage_ship_ho).
8. **Không tính lại đơn đã báo giá** (giá đã chào là hợp đồng). Backfill: chạy
   auto-tier ngay lần đầu theo volume tháng trước; brand nhà tick Strategic tay.

## Test
Bảng tier + ngưỡng biên (19/20/49/50/99/100/199/200), effectiveMarkup exact
(0→40, 14.2857→20.0000), resolve ưu tiên, lines có dòng CK âm + tổng khớp, cron
window tháng trước.
