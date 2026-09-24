-- 0161 — Dải mã bưu chính cho bảng ODA/remote (carrier_remote_postcodes).
--
-- Vì sao: file "Extended Area Surcharge" của UPS (EAS Definitions, 68.549 dòng)
-- mô tả vùng phụ phí bằng DẢI (Thấp–Cao), không phải từng mã. Bung hết ra mã
-- đơn lẻ thì được 16.905.756 dòng — gấp 26 lần danh sách DHL, riêng Bồ Đào Nha
-- có một dải 6441000–7999999 = 1.559.000 mã, Angola là 000000–999999. Không thể
-- bung.
--
-- Cách làm: THÊM (không thay) ba cột dải bên cạnh postcode_pattern. Một dòng
-- hoặc là mã CHÍNH XÁC như cũ (range_start IS NULL), hoặc là một DẢI. Toàn bộ
-- 1.033.986 dòng DHL + FedEx đang có giữ nguyên range_start = NULL nên đường đi
-- của hai hãng đó không đổi một chút nào.
--
-- COLLATE "C" là CỐ Ý: so sánh dải phải là so sánh BYTE, giống hệt toán tử `<`
-- của JavaScript, để engine (khớp trong bộ nhớ) và Postgres (lọc khi nạp) không
-- bao giờ cho hai kết quả khác nhau. Collation ngôn ngữ (en_US.UTF-8) xếp chữ
-- và số theo luật khác, đủ để một mã Canada rơi ra ngoài dải của chính nó.
ALTER TABLE carrier_remote_postcodes
  ADD COLUMN range_start text COLLATE "C",
  ADD COLUMN range_end   text COLLATE "C",
  ADD COLUMN range_len   integer;

COMMENT ON COLUMN carrier_remote_postcodes.range_start IS
  'Đầu dải (bao gồm), đã chuẩn hoá HOA + chỉ [A-Z0-9]. NULL = dòng mã chính xác kiểu cũ.';
COMMENT ON COLUMN carrier_remote_postcodes.range_end IS
  'Cuối dải (bao gồm), cùng độ dài với range_start.';
COMMENT ON COLUMN carrier_remote_postcodes.range_len IS
  'Bề rộng mã của dải. Mã khách nhập được CẮT còn đúng bấy nhiêu ký tự rồi mới so — ZIP+4 "98077-5629" khớp dải 5 ký tự.';

-- Bất biến: ba cột dải cùng có hoặc cùng không; hai đầu dải cùng độ dài; đầu ≤ cuối.
ALTER TABLE carrier_remote_postcodes
  ADD CONSTRAINT carrier_remote_postcodes_dai_ck CHECK (
    (range_start IS NULL AND range_end IS NULL AND range_len IS NULL)
    OR (
      range_start IS NOT NULL AND range_end IS NOT NULL AND range_len IS NOT NULL
      AND range_len BETWEEN 1 AND 16
      AND length(range_start) = range_len
      AND length(range_end) = range_len
      AND range_start <= range_end
    )
  );

-- Đường đi khi nạp: biết mã đích → tìm dải chứa nó.
-- Dải trong một (account, nước, bề rộng) là RỜI NHAU (script import gộp dải
-- chồng nhau cùng tier), nên dải đầu tiên có range_end >= mã chính là ứng viên
-- duy nhất; index xếp theo range_end để truy vấn chỉ cần một lần đi xuống cây.
CREATE INDEX carrier_remote_postcodes_dai_idx
  ON carrier_remote_postcodes (carrier_account_id, country_code, range_len, range_end)
  WHERE range_start IS NOT NULL;

-- Cho kiểm tra "tier nào chưa có giá" ở trang surcharges: đếm dòng theo tier.
-- Không có index này thì phải quét toàn bảng 243 MB mỗi lượt mở trang.
CREATE INDEX carrier_remote_postcodes_tier_idx
  ON carrier_remote_postcodes (carrier_account_id, tier);
