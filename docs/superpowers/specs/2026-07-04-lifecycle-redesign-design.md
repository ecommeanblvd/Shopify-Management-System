# Vòng đời đơn — Redesign UI + fix ngữ nghĩa stage/delay — Design

> Thiết kế lại list + chi tiết vòng đời đơn cho dễ đọc (đang ở stage nào / chờ stage nào),
> và sửa ngữ nghĩa: nhóm đơn cũ "đã ship chưa có tín hiệu giao" thành trạng thái riêng
> (không còn "trễ 100 ngày"), timeline sắp theo thời gian thật + đánh dấu mốc ước lượng.

**Ngày:** 2026-07-04
**Trạng thái:** đã duyệt hướng, chờ plan.
**Nhánh:** `feat/lifecycle-redesign`

## 1. Bối cảnh & triệu chứng

Dashboard vòng đời (P2) + thống kê (P3) đã chạy prod. Vận hành phản ánh 3 vấn đề:

1. **List khó đọc** — không biết đơn đang ở stage nào / chờ stage kế tiếp nào.
2. **"Trễ" khổng lồ khó hiểu** — nhiều đơn hiện "Trễ 100d", có đơn "đã ở 8h" nhưng "trễ 99d".
3. **Timeline chi tiết lộn xộn** — mốc sai thứ tự thời gian, duration `+113d`/`<1h` vô nghĩa.

## 2. Chẩn đoán gốc (dữ liệu thật)

Soi 2 đơn (`#MBLVD28068`, `#MBLVD28180`) trên prod:

| Hiện tượng | Gốc rễ |
|---|---|
| Trễ 100d | Đơn cũ đã `shipped` 18/3, snapshot **không có `deliveredAt`** → `delay = now − (shipped+7d)` ≈ 100d. Số học đúng nhưng vô nghĩa: gần chắc đã giao xong, tracking không cập nhật. |
| "Đã ở 8h" mà "trễ 99d" | "Đã ở" neo mốc vào-stage (`out_for_delivery` bị **first-seen stamp = hôm nay** lúc backfill); "trễ" neo `deliver` deadline (shipped+7d). Hai mốc khác nhau. |
| Timeline sai thứ tự | `qcPassAt` = `synced_at` (first-seen stamp lúc cron thấy); `productionStartAt` = push brand **gần đây** (sau ship); `packedAt` sau `shippedAt` (nguồn fulfillment không nhất quán). UI render thẳng thứ tự cố định. |

→ **Cả lỗi ngữ nghĩa (logic) lẫn trình bày (UI)** — sửa cùng nhau.

## 3. Quyết định đã chốt (brainstorm)

| Chủ đề | Quyết định |
|---|---|
| Đơn cũ ship-chưa-giao | **Trạng thái `stale` ("Nghi mất tín hiệu")**: `currentStage ∈ {shipped,in_transit,out_for_delivery}` ∧ `deliveredAt=null` ∧ `now − shippedAt > STALE_THRESHOLD` → phân loại `stale`, KHÔNG tính overdue. Trễ thật chỉ tính trong khung. |
| Ngưỡng | `STALE_THRESHOLD = 30 ngày` (hằng số, chỉnh trong code; không cần UI cấu hình). |
| Timeline | **Sắp theo thời gian THẬT tăng dần**; mốc ước lượng/first-seen gắn nhãn `≈` + lý do; duration bất thường (âm/không đơn điệu) ẩn thay vì in số vô nghĩa. |
| List | Thanh công đoạn + "Hiện tại → chờ [kế tiếp]" + "đã ở X" + chip trạng thái mới. |
| Chi tiết | Stepper ngang (hero) + banner diễn giải + timeline đã sanitize. |
| Stats (P3) | Loại đơn `stale` khỏi tỉ lệ overdue đoạn `deliver` (không thì bị thổi phồng). |
| DB | **Không migration** — `delay_status` là text tự do, thêm giá trị `'stale'` không đổi schema. Chạy lại cron để repopulate. |

## 4. Thay đổi logic (thuần, test đầy đủ)

### 4.1 `derive.ts` — thêm phân loại `stale`
- `DelayStatus` thêm `'stale'`.
- Hằng `STALE_THRESHOLD_MS = 30 * 24 * 3600_000`.
- Sau khi tính `delayStatus`/`delayHours` hiện có: nếu `currentStage ∈ {shipped,in_transit,out_for_delivery}` ∧ `!deliveredAt` ∧ `shippedAt` ∧ `now − shippedAt > STALE_THRESHOLD_MS` → set `delayStatus='stale'`, `delayHours = ceil((now − shippedAt)/H)` (dùng làm "số ngày đã gửi" khi hiển thị, không phải "giờ trễ").
- Không đổi các nhánh khác; `stale` chỉ **ghi đè** `overdue`/`due_soon`/`on_track` ở đúng điều kiện trên.

### 4.2 `display.ts` — helper stage + timeline sanitize
- `nextStage(stage: StageKey): StageKey | null` — stage kế tiếp trong chuỗi chính (`placed→production→qc→packed→shipped→in_transit→out_for_delivery→post_delivery→completed`); terminal/`completed` → null.
- `stageProgress(stage: StageKey): { index: number; total: number }` — vị trí trên chuỗi chính (để vẽ thanh/stepper). Terminal (`refunded_full`,`cancelled`) → index cuối/đánh dấu riêng.
- `statusLabel(delayStatus, delayHours): { text: string; tone: Tone; icon: string }` — gồm `stale` ("Nghi mất tín hiệu"), `overdue` ("Trễ …"), `due_soon` ("Sắp hạn …"), `on_track` ("Đúng hạn"). `tone: 'stale'` thêm vào `Tone`.
- **`buildTimeline` viết lại** nhận `(milestones, syncedAt)` → `TimelineStep[]` với:
  - `at`, `label`, `approx: boolean`, `approxReason: 'first_seen' | 'out_of_order' | null`, `durationHrs: number | null`.
  - **Sắp tăng dần theo `at` thật.**
  - `approx=true` khi: `at` cách `syncedAt` ≤ 24h (first-seen mới ghi) **hoặc** `at` lệch thứ tự so với mốc "spine" đáng tin sau nó.
  - Spine đáng tin: `placedAt`, `shippedAt`, `deliveredAt`, `refundedAt`, `cancelledAt` (mốc nguồn thật).
  - `durationHrs` = hiệu với bước liền trước **chỉ khi cả 2 không approx và đơn điệu**; ngược lại `null` (UI hiện "—" hoặc bỏ).

### 4.3 `stats-logic.ts` — loại `stale` khỏi `deliver`
- `DurationRow` thêm `stale: boolean`.
- Trong `aggregateLifecycle`: với đoạn `deliver`, **bỏ qua** đóng góp của row `stale` (không push vào mảng duration/overdue của `deliver`). Các đoạn khác không đổi.
- `stats-queries.ts`: select thêm `delayStatus`; `stale = delayStatus === 'stale'`.

## 5. UI

### 5.1 List `/f/lifecycle` (`LifecycleTable.tsx`)
- Mỗi dòng (grid): **[Order# + ⚠ nếu exception + store]** · **[thanh công đoạn phủ tới stage hiện tại + "Hiện tại → chờ kế tiếp" + "đã ở X" (hoặc "gửi Nd trước" nếu stale)]** · **[chip trạng thái]**.
- Chip: `Đúng hạn` (success, nhạt) · `Sắp hạn Xh` (warning) · `Trễ Xd Yh` (danger) · `Nghi mất tín hiệu` (trung tính: `surface-2` + border) · exception = icon `⚠` cạnh order#.
- Chips đếm đầu trang: giữ đếm theo stage; đổi cụm delay thành `Quá hạn` / `Sắp hạn` / **`Nghi mất tín hiệu`** (lọc `delayStatus`).

### 5.2 Chi tiết `/f/lifecycle/[orderId]`
- Header: order# (+⚠), store, **"Hiện tại [stage] → chờ [kế tiếp]"**.
- **Stepper ngang** chuỗi chính: xong (điểm đặc) · đang ở (vòng đậm) · chưa tới (nét đứt). Terminal hiển thị nhãn riêng.
- **Banner trạng thái** theo `delayStatus`: `stale` → "Nghi mất tín hiệu giao — bàn giao [ngày], N ngày chưa có cập nhật, cần kiểm tra carrier, không tính trễ SLA."; `overdue`/`due_soon` → deadline + số trễ/còn lại; on_track → deadline.
- **Timeline** dùng `buildTimeline` mới: sắp theo thời gian thật, nhãn `≈` + lý do cho mốc approx, ẩn duration bất thường.

## 6. Test & lỗi

- **`derive.ts`:** thêm case `stale` (shipped >30d không delivered → stale; shipped 5 ngày → vẫn overdue/on_track; delivered → không stale; in_transit/out_for_delivery cũng áp; terminal không đụng).
- **`display.ts`:** `nextStage`/`stageProgress` từng stage; `buildTimeline` sắp đúng thứ tự thời gian, đánh `approx` (first-seen gần syncedAt, out-of-order), ẩn duration khi approx/không đơn điệu; `statusLabel` 4 trạng thái.
- **`stats-logic.ts`:** row `stale` không tính vào `deliver` (n/overdueRate), vẫn tính các đoạn khác.
- **UI:** đọc snapshot, không tính nặng client.

## 7. YAGNI / không làm

- Không migration, không đổi bảng; `stale` là giá trị text.
- Không sửa cách bắt tín hiệu nguồn (không đụng `sync.ts` query) — chỉ phân loại + hiển thị.
- Không auto-complete đơn cũ (đã loại phương án đó).
- Không thêm cấu hình UI cho ngưỡng stale (hằng số code).
- Không đổi cấu trúc P3 stats — chỉ loại `stale` khỏi 1 đoạn.

## 8. Repopulate

Sau khi merge: chạy `npm run cron:sync-lifecycle` (hoặc chờ cron 30') để tính lại `delayStatus` (gồm `stale`) cho 1612 đơn. Thuần upsert `order_lifecycle`, không đụng nguồn.
