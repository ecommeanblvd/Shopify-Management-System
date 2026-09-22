-- Dòng LOG-Export bị Ops XOÁ trên Lark. Sync là một chiều và không bao giờ xoá dữ liệu (một
-- lỗi lập trình không được phép quét sạch bảng), nên kiện cũ nằm lại trong SMS và vẫn hiện
-- trên màn Đóng hàng dù Lark không còn (CEO hỏi về #MBLVD29915 / PK-21357, 22/09/2026).
-- Đánh dấu thay vì xoá: giữ lịch sử, chỉ ẩn khỏi việc đang làm.
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS lark_mat_dong_luc timestamp;
