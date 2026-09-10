-- Bảng KPI Logistics Operations Specialist (Quy chế Lương & KPI bản 1.2) cần vài số liệu hệ thống KHÔNG tự biết:
-- quản lý quy trách nhiệm đơn âm cước, kết quả audit size thùng của Kho, hai hạng mục 3B, clawback, và số thực thu
-- do Kế toán xác nhận. Lưu theo kỳ (tháng lịch) để mỗi tháng xuất bảng lương là ra ngay, không nhập lại.
CREATE TABLE kpi_logistics_thang (
  ky text PRIMARY KEY,
  so_don_am_cuoc_loi integer NOT NULL DEFAULT 0,
  ty_le_size_thung numeric(5, 4),
  ro_ri_giam boolean NOT NULL DEFAULT false,
  khac_phuc_goc boolean NOT NULL DEFAULT false,
  gate_override boolean,
  gate_ghi_chu text,
  thu_hoi_ke_toan_vnd numeric(16, 2),
  clawback_vnd numeric(16, 2) NOT NULL DEFAULT 0,
  nguon_sla text NOT NULL DEFAULT 'sop',
  ghi_chu text,
  updated_by text REFERENCES "user"(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
