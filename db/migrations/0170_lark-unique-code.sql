-- `WH - Unique code (k xóa)` của Lark, đọc ngược về lúc tạo record (CEO 25/09).
--
-- Cột `Định danh` bên Lark là công thức ghép 4 phần:
--   Order Number final - Lineitem SKU final - Import Inventory type - WH Unique code
-- Ba phần đầu mình tự có; phần cuối là AutoNumber do Lark sinh, mình KHÔNG
-- đoán được. Không lưu nó thì Sổ nhập bên mình vĩnh viễn không dựng lại được
-- đúng `Định danh` để đối chiếu với Lark.
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS lark_unique_code text;
