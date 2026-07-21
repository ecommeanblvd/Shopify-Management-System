-- Cước chiều HÀNG HOÀN trên bill (orderRef dạng "#MBLVD28712_ R" / "RETURN OF <tracking>")
-- gắn về ĐƠN GỐC — hiện ở đối soát + P&L thay vì nằm vô danh ở "tracking chưa khớp".
ALTER TABLE "carrier_bill_lines" ADD COLUMN IF NOT EXISTS "return_of_order_id" uuid REFERENCES "shopify_orders"("id") ON DELETE SET NULL;
