-- Token file Lark của ảnh lỗi QC — tải MỘT lần rồi dùng lại.
--
-- Ảnh lỗi QC chưa bao giờ lên Lark: `dungPayloadSauQcKhongDat` chỉ gửi đúng cột `QC Check`.
-- Đội kho đã chụp đủ (đo 02/10/2026: 7/7 dòng lỗi đều có ảnh) nhưng không ảnh nào tới bảng vận
-- hành. Giờ đẩy lên cột `Ảnh chụp lỗi QC fail` đã có sẵn trên Lark.
--
-- Nhớ token để không tải lại cùng một tấm ảnh mỗi lượt ghi — tải lại là đẻ ra hàng loạt bản y
-- hệt nhau trong Drive của đội, đúng lỗi mà `wh_anh_nhan.lark_file_token` đã tránh.
ALTER TABLE wh_loi_qc
  ADD COLUMN IF NOT EXISTS lark_file_token text;
