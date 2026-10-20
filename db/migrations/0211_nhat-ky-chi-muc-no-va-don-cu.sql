-- Hai chỉ mục cho hai truy vấn của nhật ký thay đổi mà 0210 KHÔNG phục vụ (soát cuối I3).
--
-- Ba chỉ mục của 0210 đều dẫn đầu bằng `bang` hoặc `cha_bang`, nên hai câu dưới đây không
-- có cách nào dùng chúng và chạy seq scan cả bảng:
--
--   1. `demChuaGanDanhTinh()` (features/nhat-ky/queries.ts) lọc
--      `tac_nhan_id IS NULL AND tac_nhan_nhan IS NULL` rồi `GROUP BY bang`. Nó chạy MỖI
--      LƯỢT mở `/f/nhat-ky` — đây là con số nợ hiện trên đầu trang.
--   2. `demCu()` / lượt dọn của `scripts/nhat-ky-don-cu.ts` lọc `luc < now() - 12 months`.
--
-- Ở ngưỡng spec §8 (200k dòng/ngày × 12 tháng ≈ 73 triệu dòng) mỗi lượt mở trang là một
-- lượt quét cả bảng. LÀM NGAY BÂY GIỜ vì bảng còn 0 dòng (kiểm 20/10/2026): `CREATE INDEX`
-- trên bảng rỗng xong tức thì và không khoá ai. Cùng hai câu lệnh này ở 73 triệu dòng là
-- một lượt khoá ghi hàng phút trên bảng mà trigger của kho đang ghi vào.
--
-- Vì sao KHÔNG `CONCURRENTLY`: `CREATE INDEX CONCURRENTLY` không chạy được trong giao dịch,
-- và cái giá nó mua (không khoá ghi) bằng 0 trên một bảng rỗng. Ngày nào phải thêm chỉ mục
-- cho bảng này lúc nó đã lớn thì mới cần tới nó.
--
-- ⚠ TỆP NÀY ÁP TAY. `npm run db:migrate` in thành công mà KHÔNG làm gì — xem
-- db/migrations/README.md. Áp xong kiểm `pg_indexes`, không kiểm là không biết.
-- Phần trong tệp này THUẦN CỘNG THÊM: không câu nào đụng vào dữ liệu đang có.

-- Chỉ mục MỘT PHẦN, không phải `(tac_nhan_id, tac_nhan_nhan, bang)` đầy đủ: dòng chưa gắn
-- danh tính là MÓN NỢ, tức là phần nhỏ dần của bảng (đường ghi đi qua `ghiVoi()` thì có
-- danh tính). Chỉ mục một phần chỉ chứa đúng những dòng nợ nên nó nhỏ, và `GROUP BY bang`
-- đọc được thẳng từ nó mà không chạm bảng. Điều kiện `WHERE` phải khớp ĐÚNG TỪNG CHỮ với
-- câu ở `demChuaGanDanhTinh()`, không thì planner không nhận ra là dùng được.
CREATE INDEX IF NOT EXISTS nhat_ky_thay_doi_no_danh_tinh_idx
  ON nhat_ky_thay_doi (bang)
  WHERE tac_nhan_id IS NULL AND tac_nhan_nhan IS NULL;

-- `(luc)` TĂNG DẦN, cố ý khác ba chỉ mục của 0210 (chúng đều `luc DESC` và đều có tiền tố
-- `bang`/`cha_bang`): lượt dọn đi từ dòng CŨ NHẤT và không lọc theo bảng nào, nên nó cần
-- đúng đầu tăng dần của `luc`. `min(luc)` của `demCu()` cũng lấy được từ đây mà không quét.
CREATE INDEX IF NOT EXISTS nhat_ky_thay_doi_luc_idx
  ON nhat_ky_thay_doi (luc);
