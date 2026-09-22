-- Kiện GỘP nhiều đơn: Lark ghi "#MBLVD30321#MBLVD30322" trên một dòng. SMS gắn kiện vào đơn
-- đầu, các đơn còn lại lưu ở đây để màn Đóng hàng hiện "đi chung với ..." (CEO 22/09/2026).
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS don_di_chung text[];
