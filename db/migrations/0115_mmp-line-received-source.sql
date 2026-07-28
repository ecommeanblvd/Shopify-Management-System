-- Phân biệt nguồn ngày nhập hàng: 'lark' (ops ghi thật) vs 'estimate_fulfill'
-- (ước từ mốc fulfill Shopify cho đơn TA cũ trước khi bảng Lark WH tồn tại).
ALTER TABLE "mmp_line_received" ADD COLUMN "source" text NOT NULL DEFAULT 'lark';
