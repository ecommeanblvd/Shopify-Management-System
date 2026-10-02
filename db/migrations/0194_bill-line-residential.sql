-- Tách "Giao nhà dân" khỏi cột "Ký nhận" trên dòng hoá đơn hãng.
--
-- Hoá đơn FedEx TÁCH SẴN hai khoản (`fedex-fbo-parse.ts` đọc ra `residential` riêng), nhưng
-- `fboApLine` cộng dồn chúng vào một cột vì bảng này không có chỗ cho residential. Hồi 21/07
-- có người tách riêng address_correction / import_handling / duty thành cột nhưng bỏ sót khoản
-- này. Hệ quả: `residentialVnd` bằng 0 trên 141/141 đơn đã đối soát của MỌI brand, và 43 đơn
-- đang có tiền giao nhà dân nằm trong dòng ký nhận trên bảng đối soát gửi brand.
--
-- Có một đường vá tạm đọc residential từ `shipment_charges`, nhưng đơn ship hộ không có dòng
-- trong `shipments` nên subquery luôn trả NULL — vá ở đúng chỗ dữ liệu sinh ra thay vì đi vòng.
ALTER TABLE carrier_bill_lines
  ADD COLUMN IF NOT EXISTS residential numeric(14,2);
