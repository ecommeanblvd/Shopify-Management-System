-- Một món chỉ có MỘT dòng việc kho trong SMS. Nhờ vậy hai người cùng nhận một món thì chỉ
-- một lần đẩy sang Lark, không đẻ dòng thứ hai trên bảng kho (review 22/09/2026: tìm-rồi-tạo
-- qua hai lượt gọi mạng không tự nó chống được chạy đua).
DELETE FROM wh_nhan_kcs a USING wh_nhan_kcs b
  WHERE a.mon_dinh_danh = b.mon_dinh_danh AND a.luc < b.luc;
CREATE UNIQUE INDEX IF NOT EXISTS wh_nhan_kcs_mon_uniq ON wh_nhan_kcs (mon_dinh_danh);
