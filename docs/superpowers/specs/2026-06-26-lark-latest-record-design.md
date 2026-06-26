# Chọn record Lark MỚI NHẤT (created_time) khi 1 đơn xuất hiện nhiều lần — Design

> 1 đơn có thể xuất hiện nhiều record trong file Lark vận hành (vd QC fail → trả brand → gửi lại → QC
> pass). Hệ thống đang lấy record ĐẦU (records[0]) / gộp theo thứ tự Lark trả về / "bất kỳ fail → fail"
> → hiển thị/đối soát dữ liệu CŨ. Cần luôn lấy **record mới nhất theo `created_time`**.

**Ngày:** 2026-06-26
**Trạng thái:** đã duyệt thiết kế, chờ review spec → plan.
**Nhánh:** `feat/lark-latest-record`

## 1. Bối cảnh (hiện trạng)

- `searchRecordsByOrderNumber` / `listAllRecords` / `listAllQcRecords` trả MỌI record khớp; `automatic_fields: false` → KHÔNG có timestamp.
- `getLarkRawFieldsForOrder` (modal): lấy `records[0]` (record đầu, không phải mới nhất).
- `getLarkRecordsForOrder` (card): trả tất cả, không sắp xếp.
- `sync.ts` Part B (snapshot status): fold các record theo **thứ tự Lark trả về** (không theo thời gian).
- `reduceQcStatus`: "bất kỳ record QC Failed → fail" → QC fail rồi pass vẫn ra **fail** (sai).

## 2. Quyết định đã chốt

- "Mới nhất" = record có **`created_time` (Lark)** lớn nhất. (So sánh tương đối → không phụ thuộc đơn vị s/ms.)
- Áp **toàn diện**: QC status, snapshot status, card + modal.
- **Card nhiều record:** record mới nhất hiện đầy đủ; record cũ **thu gọn** (lịch sử).
- **Đơn nhiều KIỆN:** KHÔNG gộp — `pack→shipment` (sync Part A) giữ nguyên (keyed theo `logUniqueCode`, mỗi kiện 1 shipment).
- Thiếu `created_time` → fallback giữ thứ tự mảng (record cuối = mới nhất), tiebreak ổn định.
- Không migration.

## 3. Components

### 3.1 `features/lark/client.ts`
- `LarkRecord` thêm `created_time?: number` (epoch từ Lark).
- `buildOrderNumberSearchBody`: `automatic_fields: true` (để search trả created_time).
- `listAllRecords` + `listAllQcRecords` (GET): đảm bảo response item có `created_time`.
  - **Plan verify:** GET `/records` của Lark Bitable v1 có trả `created_time` mặc định không. NẾU KHÔNG → chuyển 2 hàm này sang endpoint `records/search` (POST, filter rỗng, `automatic_fields: true`, phân trang như cũ). Giữ nguyên chữ ký hàm (trả `LarkRecord[]`), chỉ khác cách fetch.

### 3.2 `features/lark/record-select.ts` (mới, THUẦN + test)
- `larkCreatedTime(rec: LarkRecord): number` → `rec.created_time ?? 0`.
- `pickLatestRecord(records: LarkRecord[]): LarkRecord | null` → record `created_time` lớn nhất; thiếu hết → record cuối mảng; mảng rỗng → null. Tiebreak: index lớn hơn (sau) thắng (ổn định).
- `sortRecordsLatestFirst(records: LarkRecord[]): LarkRecord[]` → copy, sort `created_time` desc (tiebreak giữ thứ tự gốc — record gốc sau đứng trước khi bằng nhau).

### 3.3 `features/lark/detail.ts`
- `getLarkRawFieldsForOrder`: `pickLatestRecord(records)?.fields ?? {}` thay cho `records[0]?.fields`.
- `getLarkRecordsForOrder`: `sortRecordsLatestFirst(records)` trước khi map → trả mới-nhất-đầu. (Type `LarkDetailRecord` không đổi; thứ tự = mới→cũ.)

### 3.4 `components/fulfillment/LarkDetailCard.tsx`
- Record đầu (index 0 = mới nhất): hiện đầy đủ như hiện tại.
- Nếu `records.length > 1`: các record còn lại bọc trong `<details>` (thu gọn) nhãn `Lịch sử (N bản cũ)`; mở ra hiện từng record như cũ. Bỏ nhãn "Kiện / record #i" cũ, thay bằng: record mới nhất không nhãn; trong lịch sử mỗi record có nhãn nhỏ thứ tự.
- Không dùng JS ngoài `<details>` (RSC-friendly).

### 3.5 `features/lark/sync.ts` — Part B (snapshot status)
- Gom record theo `orderId` thành list, **sort theo `created_time` tăng dần** (dùng `larkCreatedTime`), rồi fold như cũ (`s.X ?? prev.X` → bản sau/mới hơn ghi đè khi non-null; delivered-sticky giữ nguyên).
- → kết quả xác định theo thời gian, không theo thứ tự Lark trả về.

### 3.6 `features/lark/sync.ts` + `features/lark/parse-qc-row.ts` — QC
- QC: mỗi đơn lấy `qcCheck` của record QC **created_time mới nhất, non-null** → map status.
- Đổi cách gom: `byNum` lưu `Array<{ qcCheck: string | null; createdTime: number }>` (kèm created_time), rồi chọn latest-non-null.
- Thêm helper thuần ở `parse-qc-row.ts`: `latestQcCheck(items: Array<{ qcCheck: string | null; createdTime: number }>): string | null` (created_time lớn nhất có qcCheck non-null). Map `string → QcStatus` qua hàm map đơn lẻ (tách từ logic `reduceQcStatus` hiện tại: 'QC Failed'→fail, 'Tiếp nhận - chưa QC'→pending, 'QC Pass'→pass, 'Gửi dư'→extra).
- `reduceQcStatus` cũ: giữ lại nếu còn nơi dùng; nếu chỉ sync dùng → thay bằng latest-based (plan kiểm consumer).

## 4. Guard / lỗi

- `created_time` thiếu (mọi nguồn) → fallback thứ tự mảng (record cuối = mới nhất). Không vỡ.
- Đơn 1 record → hành vi như cũ (pickLatest = record đó).
- Đơn nhiều kiện → card hiện kiện mới nhất + lịch sử; shipment vẫn tách theo logUniqueCode.
- QC không có record non-null → status null (như cũ).
- Mọi thay đổi best-effort của sync giữ nguyên (lỗi QC/freeze không chặn logistics).

## 5. Test (TDD)

- `record-select` (thuần): pickLatestRecord chọn max created_time; thiếu created_time → record cuối; rỗng → null; sortRecordsLatestFirst đúng thứ tự desc + ổn định.
- `parse-qc-row` (thuần): latestQcCheck chọn theo created_time (fail cũ + pass mới → pass); bỏ qua null; map status đơn lẻ đúng.
- `detail` (thuần): getLarkRecordsForOrder sắp mới-nhất-đầu (mock records có created_time).
- client/sync/card = integration → verify tsc + vitest + lint + build.

## 6. Ngoài phạm vi

- Pack→shipment (Part A) — giữ nguyên, đơn nhiều kiện không gộp.
- Phân biệt "nhiều kiện" vs "reship" bằng heuristic — không cần; latest theo created_time + giữ Part A là đủ.
- Đổi cron/tần suất sync.
- Backfill created_time cho dữ liệu đã sync (sync chạy lại sẽ tự cập nhật theo latest).
