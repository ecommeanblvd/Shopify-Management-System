# Carrier Rate Cards — RESUME STATE (đọc file này để tiếp tục sau khi context bị tóm tắt)

**Cập nhật:** 2026-06-08 · **Branch:** `feat/carrier-rate-cards-versioning` (chưa push, chưa đụng production)
**Spec:** `docs/superpowers/specs/2026-06-08-carrier-rate-cards-versioning-design.md`
**Plan:** `docs/superpowers/plans/2026-06-08-carrier-rate-cards-versioning.md`

## ✅ ĐÃ XONG (committed)
Phase 1–6 của plan đã implement + commit. Engine `quote.ts` KHÔNG đụng.
- `carrier_rate_cards` + `rate_card_id` (migration `db/migrations/0035_misty_forge.sql`, data-safe, đã fix `NULL::date`).
- `features/carrier-rates/engine/rate-cards.ts` (`pickRateCardForDate`, `listRateCards`) + test 5/5.
- `load.ts`: `loadAccountSnapshot(accountId, effectiveDate=now)` chọn card theo ngày, nạp cells `where rate_card_id`.
- `reconcile.ts`: pre-load 1 snapshot/card/carrier, chọn theo `labelCreatedAt`; reasons `no_rate_card`/`no_ship_date`.
- `matrix-actions.ts`: `loadMatrix(accountId, cardId)`, `setCell/clearCell/importMatrix` mang `rateCardId` (+ fix latent `package_type` trong onConflict).
- `rate-cards-actions.ts` (list/create/getCurrent) + `rate-cards-windows.ts` (`windowsOverlap`, pure) + test 3/3.
- `matrix/page.tsx`: card selector + create-card UI.
- `scripts/verify-carrier-surcharge-windows.ts`.
- **Checks:** typecheck PASS, lint 0 error, 588 unit tests xanh.

## ✅ ĐÃ VERIFY (staging = clone production)
- Postgres **18** local (cài qua brew `postgresql@18`). Production cũng PG 18.4.
- Dump prod → DB `staging`. Migrate (áp `0035` trực tiếp bằng psql). 0 orphan cells, 2 card "Current (migrated)" 2020-01-01→open.
- **No-regression CHỨNG MINH:** baseline (`main`) == after (branch) cho cả 2 carrier:
  - FedEx: matched 1187, Σ Billed 1,826,978,238, Σ Engine 1,616,959,425, Δ 210,018,813 (11.50%).
  - DHL: matched 1017, Σ Billed 2,278,770,944, Σ Engine 2,243,359,385, Δ 35,411,559 (1.55%).
- **Bug đã bắt+fix trên staging:** bare `NULL` → text, lệch cột date → đổi `NULL::date` (commit `3e3ecb4`).

## 🔧 CÁCH KẾT NỐI LẠI STAGING (session sau)
```bash
export PGBIN=/opt/homebrew/opt/postgresql@18/bin
export LC_ALL="en_US.UTF-8"
$PGBIN/pg_ctl -D /opt/homebrew/var/postgresql@18 -l /tmp/pg18.log start   # nếu chưa chạy
export STAGING='postgresql://macos@localhost:5432/staging'
# reconcile: DATABASE_URL="$STAGING" npx tsx scripts/reconcile-shipments.ts --carrier=fedex --top=20
# (db:migrate npm script nuốt env do `dotenv --`; dùng psql -f hoặc `DATABASE_URL=.. npx drizzle-kit migrate`)
```
- FedEx account id (staging & prod giống): `5683f3c0-9249-40c1-a3e7-d967f0d62c29`
- Prod DATABASE_URL (public): `postgresql://postgres:YeRVWvHmwxEoqvMoApJYfGCWkmHyeGfi@crossover.proxy.rlwy.net:58260/railway`
- 4 stores: cici-mean, meanblvd, mirermirer-official, tinhatelier. shipment_charges=2204 (meanblvd 2197), shipments=2204.
- App production: https://shopify-management-system-production.up.railway.app — login Lmtiep@gmail.com / `12345678`. Screenshot tool: `SNAP_EMAIL=.. SNAP_PASSWORD=.. npx tsx scripts/snap.ts <url> /tmp/x.png` (xem ảnh bằng Read).

## 📐 QUY ƯỚC IMPORT MATRIX (đã giải mã từ data 2026)
Cấu trúc FedEx account: 22 zones ("Zone A".."Zone Z"), 59 tiers (0.5..1500kg), cells package=1298 + pak=110.
- **Dải nhẹ (0.5–20.5kg):** lưu trực tiếp Package + Pak từ PDF.
- **Dải nặng per-kg (21-44,45-70,71-99,100-299,300-499,500-999,1000-99999):** cell = `perKgRate × tier.upperKg`, Package only. (Verified: Zone A tier 25 = 3,007,500 = 120,300/kg×25.)
- **Zone map:** PDF "A" → DB label "Zone A".

## 📄 NGUỒN BẢNG GIÁ 2025
- PDF: `/Users/macos/Downloads/FedEx Express - Bảng giá tham khảo 2025- INECSO c1 từ 28.10.26.pdf`
- Effective **28 October 2025**. DÙNG **International Priority (IP)**, KHÔNG phải IPE.
- poppler đã cài. Trích: `pdftotext -layout "<pdf>" /tmp/fedex2025.txt`. IP Export ở dòng ~339–585; Zone Chart ~1141+.

## 🪟 WINDOW CARD (user chốt: theo effective date PDF, đến khi có bản mới)
- **FedEx 2025** (PDF này): `2025-10-28 → 2026-01-04`.
- **FedEx 2026** (card "Current (migrated)" hiện tại, giữ rates 2026): đổi thành `2026-01-05 → open`.
- **Pre-28-Oct-2025:** user sẽ gửi bảng cũ hơn sau → tạm thời đơn trước 28-Oct = `no_rate_card`.
- DHL 2025: user sẽ gửi sau.

## ✅ IMPORTER 2025 — XONG (committed `1064d68`) + ĐÃ CHẠY TRÊN STAGING
- Parser thuần: `features/carrier-rates/import/fedex-2025-rates.ts` (`parseIpExport` + `toCells`) + test 10/10.
- Script dry-run: `scripts/import-fedex-2025.ts` — self-check 1298 package + 110 pak + 9 spot-check PDF; `--apply` mới ghi.
- Convention khớp 2026: light Package/Pak trực tiếp; heavy Package = perKg × tier.upperKg; Envelope bỏ; rate đã NET (không trừ discount).
- **Trên staging đã làm:** card `FedEx IP 2025` (`02ff1855-8257-4bd2-a8fc-6ba9dc898b1e`, 2025-10-28→2026-01-04) + đổi card cũ thành `FedEx IP 2026` (2026-01-05→open). Import 1298+110 cells OK. Reconcile chọn đúng card theo ship date.

## ⚠️ KẾT QUẢ RECONCILE 2025 + CAVEAT QUAN TRỌNG (đọc kỹ)
Cửa sổ 2025-10-28→2026-01-04, 129 đơn FedEx matched, Σ Billed 203,746,047:
- Trước (rate 2026): Σ Engine 165,811,815 · Δ 37,934,232 (18.62%).
- Sau (rate 2025 đúng): Σ Engine 156,008,968 · Δ 47,737,079 (23.43%).
- **Δ TĂNG không phải tiền thu hồi.** Base 2025 thật sự thấp hơn 2026 (engine giảm ~9.8M). Δ còn lại bị thổi phồng vì **THIẾU WINDOW FUEL 2025**: `carrier_surcharges` fuel_percent sớm nhất = 2026-03-09 (script `backfill-fedex-historical-fuel.ts` chỉ giữ 13 tuần gần nhất), nên engine tính 0% fuel cho toàn bộ đơn trước 2026-03. ⇒ **Không audit thu hồi 2025 được cho tới khi có window fuel/demand 2025.**

## 📋 VIỆC CÒN LẠI (đã sắp lại ưu tiên)
1. **[BLOCKER cho audit 2025] Window fuel 2025 cho FedEx & DHL** — fuel_percent hiện chỉ phủ từ 2026-03-09. Cần nguồn fuel% hằng tuần 2025-10→2026-03 (FedEx AEM history / DHL) rồi prepend các dòng closed `starts_at/ends_at`. Sau đó reconcile lại 2025 mới có nghĩa.
2. Rà surcharge **demand/remote 2025** (FedEx & DHL) nếu khác 2026 — thêm dòng `endsAt ≤ cutover`. VAT 8% giữ nguyên cả 2 năm.
3. **Action sửa-window-card qua UI** (user đã ĐỒNG Ý) — production cần để đặt window không cần SQL tay. (`updateRateCard` trong rate-cards-actions.ts + inline edit ở matrix/page.tsx.)
4. **Apply migration `0035` lên PRODUCTION** (đã chứng minh an toàn) — chỉ sau khi user xác nhận backup/PITR. `psql -f db/migrations/0035_misty_forge.sql` hoặc drizzle migrate. Rồi lặp lại quy trình tạo card 2025 + import trên production (importer dùng account-id giống nhau).
5. Nhận bảng **FedEx pre-28-Oct-2025** + **DHL 2025** từ user → thêm card tương ứng.

## ⚠️ LƯU Ý
- Engine `quote.ts` là vùng toán đã verify với invoice — KHÔNG sửa.
- Mọi thay đổi: TDD + commit từng bước + typecheck/lint/test trước khi báo xong (yêu cầu của user).
- Chưa push branch, chưa migrate production.
