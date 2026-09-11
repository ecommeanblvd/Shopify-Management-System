/**
 * PHẠM VI chấm Pillar 1 của vị trí Logistics Operations Specialist.
 *
 * Pillar 1 đo việc VẬN HÀNH CHO MEAN BLVD nên chỉ tính đơn của store MEAN BLVD
 * (CEO 11/09/2026). Đơn của brand khác — hiện là Tinh Atelier — đi theo luồng
 * SHIP HỘ và được đối chiếu tiền bill với tiền thu ở phần ship hộ, không trộn vào
 * KPI vận hành: trộn vào thì một chính sách giá của brand khác sẽ kéo điểm của
 * nhân sự MEAN, mà nhân sự không có quyền sửa giá đó.
 *
 * Đo tháng 8/2026 khi tách ra: đơn âm cước 72 → 52 đơn, tiền 43,5tr → 16,7tr;
 * phần chênh 26,7tr còn lại là của Tinh Atelier.
 */
export const STORE_VAN_HANH = 'meanblvd.myshopify.com';
