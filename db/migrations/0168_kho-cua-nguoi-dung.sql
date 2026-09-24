-- Kho làm việc của từng người dùng.
--
-- CEO 24/09: "người dùng làm việc ở kho nào sẽ nhập hàng ở kho đó". Trước đó
-- `ghiNhanChiec` đóng đinh 'GVM' cho mọi phiếu nhận — sai ngay khi có người ở
-- AP hay DM nhận hàng.
--
-- Để NULL được: người chưa gán kho thì rơi về GVM (kho chính), và màn hình nói
-- rõ đang nhận vào kho nào chứ không lặng lẽ đoán.
ALTER TABLE "user" ADD COLUMN kho_mac_dinh text;
