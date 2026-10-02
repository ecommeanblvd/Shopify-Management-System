-- Tệp bằng chứng vùng xa: CHỌN từng tệp để gửi brand, mặc định KHÔNG gửi.
--
-- Trang `/pp/<token>` trước đó hiện MỌI tệp của hãng mà brand đã đi. Hôm nay 8 tệp đều là danh
-- sách mã bưu chính hoặc bảng phụ phí — trừ một tệp: "DHL Service & Rate Guide 2025" có nguyên
-- bảng CƯỚC xuất khẩu theo vùng (kg × Vùng 1–8). Chưa brand nào đi DHL nên chưa ai mở được,
-- nhưng luật "mọi tệp của hãng đó" nghĩa là tệp up lên sau này tự động lên trang, im lặng.
--
-- `DEFAULT false` là phần quan trọng nhất: tệp mới mặc định KHÔNG ra ngoài, phải có người tick.
ALTER TABLE carrier_remote_evidence
  ADD COLUMN IF NOT EXISTS chia_se_brand boolean NOT NULL DEFAULT false;
