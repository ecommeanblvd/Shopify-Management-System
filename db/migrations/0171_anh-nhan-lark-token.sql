-- `file_token` của file sau khi tải lên Lark Drive (CEO 25/09).
--
-- Một tấm ảnh chụp cả lô phải gắn vào MỌI dòng của lô đó trên bảng Lark (đo
-- 25/09: 102/135 lô dùng chung đúng một file cho mọi dòng). Không lưu token thì
-- mỗi dòng lại tải lên một bản, vừa tốn vừa đẻ ra nhiều file y hệt nhau trong
-- Drive của đội.
ALTER TABLE wh_anh_nhan ADD COLUMN IF NOT EXISTS lark_file_token text;
