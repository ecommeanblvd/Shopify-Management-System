-- Kiện giao chậm bất thường: hệ thống chỉ tách được theo NGƯỠNG NGÀY, không biết vì sao chậm (D-065/D-067).
-- CEO duyệt 10/09/2026 thêm cột lý do để (1) báo cáo tách "không liên hệ được khách" với "kẹt thông quan",
-- (2) KPI nhân sự loại trừ đúng những lý do Quy chế mục VII coi là ngoài tầm kiểm soát.
ALTER TABLE shipments ADD COLUMN ly_do_cham text;--> statement-breakpoint
ALTER TABLE shipments ADD COLUMN ly_do_cham_ghi_chu text;--> statement-breakpoint
ALTER TABLE shipments ADD COLUMN ly_do_cham_by text REFERENCES "user"(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE shipments ADD COLUMN ly_do_cham_at timestamp;
