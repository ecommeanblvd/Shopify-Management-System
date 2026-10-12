-- Phí xử lý quốc tế của UPS — CỘT RIÊNG (CEO 12/10/2026: "để nguyên International Processing
-- Fee theo đúng của UPS, và phí này chỉ hiện với các đơn đi UPS").
--
-- Hoá đơn UPS đầu tiên về (`100000813108`, 06/10/2026, 69.119.131đ): khoản `ACC/FIP` xuất hiện
-- ở 33/37 lô, tổng 1.938.750đ — gần như phí thường trực của tuyến quốc tế, không phải ca lẻ.
-- Nhét vào `other` là mất tên; nhét vào `import_handling` là trộn với phí xử lý hàng NHẬP của
-- FedEx vốn khác bản chất (phí đầu nhập khi hàng trả về). Cùng lý lẽ cột `additional_handling`
-- thêm cho FedEx ở migration 0200.
--
-- KHÔNG nằm trong gốc tính nhiên liệu — đo trên chính hoá đơn này: fuel/cước-niêm-yết cho ra
-- cùng một tỉ lệ trong cùng ngày (15/09 hai lô đều 11,855% · 22/09 đều 12,079% · 28/09 bốn lô
-- 13,152–13,223%), còn cộng FIP vào gốc thì tán ra. Lưu ý UPS tính nhiên liệu trên cước TRƯỚC
-- chiết khấu, khác FedEx (sau chiết khấu + một loạt phụ phí).
ALTER TABLE carrier_bill_lines
  ADD COLUMN IF NOT EXISTS international_processing numeric(14,2);
