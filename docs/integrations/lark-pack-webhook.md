# Webhook Lark → SMS: kiện đóng xong (`POST /api/lark/pack`)

Spec: `docs/superpowers/specs/2026-09-22-dong-hang-chon-line-design.md`

Vấn đề gốc: cron `sync-lark` (mỗi giờ) đưa dòng Lark về SMS chậm **2,3 giờ (trung vị) / 4,3 giờ (90%)** — đo 14 ngày. 100% dòng khi về SMS đã có `Couriers` do Đức chọn thủ công trên Lark, nên màn SMS đọc từ cron vô dụng cho việc chọn line lúc đóng hàng. Webhook này để Lark tự đẩy dòng ngay khi đóng xong, Đức chọn line trên màn `/f/dong-hang` trước khi Ops tạo nhãn.

## Env (Railway, service Shopify-Management-System)
- `LARK_PACK_WEBHOOK_SECRET` — chuỗi ngẫu nhiên 32 ký tự (`openssl rand -hex 16`), cùng giá trị điền vào header rule Lark. Thiếu biến này → mọi request trả 503.
- `LARK_PACK_DRY=1` — chạy thử: đọc + phân loại, KHÔNG ghi DB. Bỏ biến (không đặt) khi chạy thật.
- Cần sẵn `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_BASE_APP_TOKEN`, `LARK_LOG_TABLE_ID` (đã có trên service web, dùng chung với cron `sync-lark`).

## Cấu hình Lark (base "Operation Work files 2026 (NEW)" → bảng LOG-Export → Automation)
1. Trigger: **When record matches conditions** — `Weights` is not empty AND `Dimension ( điền tay)` is not empty AND `Select VTĐG1` is not empty AND `Attachment` is not empty AND `Tracking Number` is empty.
2. Action: **Send HTTP request** — Method POST, URL `https://shopify-management-system-production.up.railway.app/api/lark/pack`,
   Headers: `Content-Type: application/json`, `X-Lark-Pack-Secret: <secret>`,
   Body: `{"record_id": "{{record_id}}", "log_unique_code": "{{Log Unique code}}"}`.
3. Bật rule. Kiểm: sửa một dòng đã đủ điều kiện → trang `/f/jobs` thấy job `lark-pack-webhook` vừa chạy, `/f/dong-hang` thấy kiện xuất hiện.

## Mã HTTP

Nguyên tắc: mã lỗi phản ánh "Lark có nên retry không" (rule Lark tự thử lại khi HTTP request thất bại). Không có mã nào lộ chi tiết lỗi nội bộ ra response — chi tiết nằm ở `job_runs` (job `lark-pack-webhook`).

| Mã | Khi nào | Body `error` |
|---|---|---|
| 200 | Mọi kết quả nghiệp vụ, kể cả `khong_khop` / `bo_qua` — Lark KHÔNG cần retry | — (trả `{ ketQua, ... }`) |
| 400 | Thiếu `record_id`, hoặc body không phải JSON | `thiếu record_id` / `body không phải JSON` |
| 401 | Header `X-Lark-Pack-Secret` sai (so timing-safe) | `sai secret` |
| 413 | Body > 4 KB (chặn theo `Content-Length` trước khi đọc, và lại theo độ dài thật sau khi đọc) | `body quá 4KB` |
| 502 | Lark API lỗi/timeout khi SMS đọc lại record — **Lark nên retry** | `Lark API lỗi, hãy thử lại` |
| 503 | Thiếu env `LARK_PACK_WEBHOOK_SECRET` | `chưa cấu hình LARK_PACK_WEBHOOK_SECRET` |
| 500 | Lỗi hệ thống khác (DB…) — không lộ message thật ra ngoài | `lỗi hệ thống, xem job_runs lark-pack-webhook` |

Kết quả nghiệp vụ (`ketQua`) trong body 200: `tao` | `cap_nhat` | `khong_khop` | `bo_qua`, kèm `shipmentId?`, `logUniqueCode?`, `lyDo?`, `ms`, `dry`.

## Kiểm tay

```
curl -sS -X POST "$URL/api/lark/pack" -H "Content-Type: application/json" -H "X-Lark-Pack-Secret: $SECRET" -d '{"record_id":"recXXXX"}'
```

Chạy thử an toàn: đặt `LARK_PACK_DRY=1` trước, curl một `record_id` thật → xem `ketQua` đúng mà không ghi DB (`job_runs` ghi `dry: true`). Bỏ biến, redeploy, gửi lại để ghi thật.

## Lưới bù

Cron `sync-lark` mỗi giờ vẫn chạy nguyên như cũ (`chuKyPhut = 24h` trong `registry.ts` — hậu quả nếu job đứng yên: "Kiện đóng xong không về SMS tức thì — Đức phải chọn line trên Lark"): rule Lark tắt/lỗi thì kiện vẫn về, chỉ chậm 1–4 giờ thay vì tức thì. Kiện webhook nhận nhưng không khớp được đơn (`orderNumber` không tra ra `shopify_orders`) nằm ở bảng `lark_pack_cho_khop` (hiển thị thành khối đỏ "Không khớp đơn SMS" đầu màn `/f/dong-hang`), tự xoá khi cron hoặc webhook lần sau khớp được.

## Idempotent

Rule có thể bắn lại cùng `record_id` (Ops sửa cân sau khi đã đủ điều kiện). Khớp theo `log_unique_code` → lần sau là `cap_nhat`, không tạo đôi kiện. Hai request đồng thời cùng `record_id` được khoá trong bộ nhớ tiến trình (`Map<record_id, Promise>`) cộng `onConflictDoNothing` ở tầng DB.

---

## Yêu cầu chỉnh rule (13/10/2026) — cân gõ xong vẫn chờ cả tiếng

**Ca gốc.** Phong đóng `#MBLVD30388` (`PK-21928`), gõ cân lên Lark rồi mở `/f/dong-hang` ngay thì ô cân trống. Cân về sau đó, qua cron `sync-lark`, không qua webhook.

**Đã đo.**

| | |
|---|---|
| Cú gọi webhook cho `recvvrrEOx4yos` | 13/10 **09:36** (giờ VN), `ketQua: cap_nhat` — là một lần sửa KHÁC, không phải lần gõ cân |
| Cú gọi webhook cuối cùng trong ngày | 16:07 |
| Lượt cron kéo về | 17:16 |
| `Select VTĐG1` của dòng này | RỖNG (tới giờ vẫn rỗng) |

Phủ sóng theo ngày (kiện đóng xong / có cú gọi webhook): 13/10 12÷12 · 12/10 19÷17 · 09/10 9÷4 · 08/10 14÷0 · 07/10 16÷0. Rule bắt đầu chạy thật từ 09/10 (trước đó sai secret, xem phần đầu tài liệu).

**Nguyên nhân.** Trigger "When record matches conditions" chỉ bắn lúc dòng CHUYỂN TỪ không-khớp sang khớp, mà điều kiện đang đòi **cả năm** ô cùng đúng. Nhân sự gõ cân trước, chọn hộp và đính ảnh sau — ở khoảnh khắc gõ cân dòng chưa đủ bộ nên không bắn. Lúc đủ bộ thì cân đã về bằng cron rồi. Dòng không bao giờ chọn hộp (68/70 kiện gần đây `Select VTĐG1` rỗng) thì không bao giờ bắn vì lý do đó.

**Cần Đức làm — sửa điều kiện rule trên Lark** (base "Operation Work files 2026 (NEW)" → bảng LOG-Export → Automation), giữ nguyên phần Action:

- Điều kiện: chỉ còn **`Weights` is not empty** AND **`Tracking Number` is empty**.
- Gỡ ba điều kiện `Dimension ( điền tay)` / `Select VTĐG1` / `Attachment`.

Gỡ được vì chúng không bảo vệ gì: SMS đọc lại record từ Lark chứ không tin body, vá đúng những ô Lark đang có, và lượt bắn sau là `cap_nhat` chứ không tạo đôi kiện (xem mục "Idempotent"). Dòng thiếu kích thước/hộp về sớm vẫn hơn về muộn — cron và các lượt bắn sau tự bù nốt. Số lượt tăng không đáng kể: 12–19 kiện/ngày.

**Cần Đức gửi kèm.** Ảnh chụp rule đang chạy (trigger + đủ các điều kiện). Hiện tài liệu này ghi năm điều kiện nhưng rule thật vẫn bắn cho dòng có `Select VTĐG1` rỗng — tức tài liệu và thực tế đang lệch, chưa rõ lệch chỗ nào. Có ảnh thì sửa tài liệu cho khớp.

**Kiểm sau khi sửa.** Gõ cân vào một dòng chưa có mã vận đơn → `/f/jobs` phải thấy job `lark-pack-webhook` chạy trong vòng một phút → `/f/dong-hang` tải lại phải thấy cân. Không thấy job chạy thì rule chưa bắn, không phải SMS lỗi.
