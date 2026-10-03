-- Sheet đối soát của brand — nơi hệ thống ghi tab theo kỳ.
--
-- Tài khoản dịch vụ KHÔNG tạo được sheet mới (kiểm 03/10/2026: Drive trả `storageQuotaExceeded`
-- vì nó không có dung lượng Drive riêng). Nên sheet do CEO tạo và chia sẻ quyền writer cho
-- sms-sheet-manager@shopify-management-510413.iam.gserviceaccount.com, rồi dán id vào đây.
-- NULL = brand chưa có sheet; chốt kỳ vẫn chạy, chỉ báo việc.
ALTER TABLE ship_ho_partners
  ADD COLUMN IF NOT EXISTS doi_soat_sheet_id text;

-- Sheet "Đối soát Fulfillment Kalisa" đã có và đã chia sẻ.
UPDATE ship_ho_partners
   SET doi_soat_sheet_id = '1eY33WoNpC8_wxuGS8FKqOu8sNG0I_bHAo-Kf4nbrruc'
 WHERE brand_slug = 'kalisa' AND doi_soat_sheet_id IS NULL;
