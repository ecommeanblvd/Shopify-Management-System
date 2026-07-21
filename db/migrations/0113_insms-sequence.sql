-- Sequence cấp số INSMS — KHÔNG BAO GIỜ cấp lại số (bug 21/07: sinh số theo MAX
-- mã đang tồn tại → đơn đổi tên xong số bị nhả ra và cấp lại cho đơn sau, loạn số).
CREATE SEQUENCE IF NOT EXISTS ship_ho_insms_seq START 6;
