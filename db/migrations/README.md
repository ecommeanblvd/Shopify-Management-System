# Migration ở repo này áp dụng TAY

**`npm run db:migrate` KHÔNG áp dụng gì cả, và vẫn in `migrations applied successfully`.**

Sổ `meta/_journal.json` dừng ở `0138`, trong khi thư mục này đã tới `0201`. `drizzle-kit migrate`
chỉ chạy những tệp có mặt trong sổ, nên với mọi migration từ `0139` trở đi nó không thấy gì để
làm — và báo thành công. Railway cũng không chạy migration lúc deploy: không có bước nào trong
`nixpacks.toml` hay `railway.json`.

Đo 08/10/2026 sau khi tin câu báo thành công đó: `db/migrations/0201_mon-lark-nhan.sql` đã được
"apply successfully" mà hai cột `mon_dinh_danh` / `mon_record_id` KHÔNG hề có trên CSDL, trong
khi mã đọc chúng đã deploy — ô tìm món của màn Nhận hàng đổ lỗi tới khi áp dụng tay.

## Cách làm đúng

1. Viết tệp `NNNN_ten-viec.sql` trong thư mục này. **Luôn** dùng `IF NOT EXISTS` / `IF EXISTS`
   để chạy lại không hỏng.
2. Chạy nội dung tệp đó **thẳng vào CSDL** (`DATABASE_URL` trong `.env` trỏ PRODUCTION).
3. **Kiểm `information_schema`** rằng cột/bảng/index đã có thật. Không kiểm là không biết.
4. Chỉ sau đó mới push mã đọc tới thứ vừa thêm — ngược thứ tự là production chạy mã thiếu cột.

## KHÔNG backfill sổ migration

Thêm 63 mục `0139`–`0201` vào `meta/_journal.json` sẽ làm lượt `drizzle-kit migrate` kế tiếp
chạy LẠI toàn bộ chúng. Nhiều tệp trong đó không idempotent (`ADD COLUMN` không có
`IF NOT EXISTS`, `INSERT` dữ liệu hạt giống), nên lượt đó sẽ đổ giữa đường và để CSDL ở trạng
thái nửa vời. Giữ nguyên sổ; dùng quy trình tay ở trên.
