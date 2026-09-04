-- Nhật ký chạy của mọi tác vụ nền.
--
-- Vì sao cần: rà soát 04/09 phát hiện 5 tác vụ chết âm thầm 13–70 ngày mà không
-- ai biết — retry outbox MMP chưa từng chạy lần nào, track-shipments đứng im 58
-- ngày. Repo có 13 file railway.cron-*.json nhưng chỉ 1 khai cronSchedule, nên
-- đọc cấu hình không biết cái nào thật sự có lịch. Cách duy nhất đáng tin là bắt
-- chính tác vụ đó ghi lại dấu vết mỗi lần chạy.
CREATE TABLE IF NOT EXISTS job_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key      text NOT NULL,
  started_at   timestamp NOT NULL DEFAULT now(),
  finished_at  timestamp,
  -- 'running' = đã bắt đầu chưa xong (hoặc chết giữa chừng, không ai cập nhật lại)
  status       text NOT NULL DEFAULT 'running',
  duration_ms  integer,
  -- Số liệu tác vụ tự trả về (đã đồng bộ bao nhiêu đơn, dọn bao nhiêu dòng…)
  summary      jsonb,
  error        text,
  created_at   timestamp NOT NULL DEFAULT now()
);

COMMENT ON TABLE job_runs IS 'Mỗi lần chạy của một tác vụ nền ghi 1 dòng. Trang /f/jobs đọc bảng này để biết tác vụ nào quá hạn.';

-- Truy vấn chính của trang giám sát: lần chạy gần nhất của từng job.
CREATE INDEX IF NOT EXISTS job_runs_key_started_idx ON job_runs (job_key, started_at DESC);
CREATE INDEX IF NOT EXISTS job_runs_started_idx ON job_runs (started_at DESC);
