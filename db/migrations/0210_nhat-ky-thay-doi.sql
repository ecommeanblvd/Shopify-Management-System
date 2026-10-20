-- Nhật ký thay đổi MỨC TỪNG Ô: ai sửa ô nào, trước → sau (spec 2026-10-20 §3).
--
-- Một dòng = MỘT Ô đổi, không phải một bản ghi đổi. Vì sao không lưu snapshot cả hàng dạng
-- jsonb: màn "Lịch sử" phải trả lời "ai sửa cái ô này" — với snapshot thì mỗi lượt đọc phải
-- diff hai jsonb để tìm ra ô nào đổi, và `shopify_orders.raw_payload` vài chục KB sẽ vào nhật
-- ký mỗi lượt cron. Mức ô thì ghi sẵn câu trả lời lúc ghi, đọc chỉ là lọc theo chỉ mục.
--
-- ⚠ TỆP NÀY ÁP TAY. `npm run db:migrate` in thành công mà KHÔNG làm gì — xem
-- db/migrations/README.md. Áp xong phải kiểm `information_schema`, không kiểm là không biết.
--
-- ⚠ TỆP NÀY CỐ Ý KHÔNG CÓ `CREATE TRIGGER`. Trigger bật/gỡ riêng bằng
-- `scripts/nhat-ky-bat-tat.ts`: nếu bật kèm ở đây thì mỗi lượt áp lại di trú là mỗi lượt
-- trigger sống lại trên bảng thật, và không còn đường gỡ một bảng mà không gỡ cả nhật ký.
-- Phần trong tệp này THUẦN CỘNG THÊM: không câu nào đụng vào bảng hay dữ liệu đang có.

CREATE TABLE IF NOT EXISTS nhat_ky_thay_doi (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tên bảng + khoá chính dạng text, KHÔNG phải khoá ngoại thật: nhật ký phải sống sót
  -- sau khi bản ghi gốc bị xoá (ca `DELETE` ghi chính lúc hàng biến mất), nên một FK
  -- `ON DELETE CASCADE` sẽ xoá đúng cái bằng chứng ta cần giữ. Mọi 10 bảng được theo dõi
  -- đều có `id uuid` (đã kiểm `information_schema` 20/10/2026) nên text là mẫu số chung.
  bang        text NOT NULL,
  ban_ghi_id  text NOT NULL,
  -- Bản ghi CHA, ghi sẵn lúc trigger chạy thay vì join lúc đọc. Màn "Lịch sử" của một lô
  -- nhập kho phải cuốn cả thay đổi của từng chiếc (QC xảy ra ở `goods_receipt_items`,
  -- nhưng thứ người ta mở là `goods_receipts`). NULL ở bảng không có cha.
  cha_bang    text,
  cha_id      text,
  -- 'INSERT' | 'UPDATE' | 'DELETE' — nguyên văn `TG_OP` của Postgres.
  thao_tac    text NOT NULL,
  truong      text NOT NULL,
  -- `truoc`/`sau` là TEXT cho mọi kiểu cột (numeric, timestamp, enum, jsonb đều ép về text
  -- qua `to_jsonb(...) ->> cot`). Một bảng nhật ký dùng chung cho 10 bảng không thể có cột
  -- đúng kiểu cho từng cột nguồn, và nhật ký chỉ để ĐỌC cho người xem, không để tính toán.
  -- NULL và chuỗi rỗng là HAI giá trị khác nhau: xoá trắng một ô là hành động của người,
  -- không được nuốt mất.
  truoc       text,
  sau         text,
  -- Danh tính người thao tác, lấy từ biến phiên `app.tac_nhan_id` / `app.tac_nhan_nhan`.
  -- NULL khi chưa ai đặt (cron, psql tay, hoặc đường ghi chưa đi qua Task 4) — cố ý
  -- nullable để một đường ghi quên đặt danh tính vẫn ghi được nhật ký, chứ không đổ lệnh
  -- ghi của người dùng vì thiếu nhãn.
  tac_nhan_id   text,
  tac_nhan_nhan text,
  luc         timestamptz NOT NULL DEFAULT now()
);

-- Tab "Lịch sử" của một bản ghi: mới nhất trước.
CREATE INDEX IF NOT EXISTS nhat_ky_thay_doi_ban_ghi_idx
  ON nhat_ky_thay_doi (bang, ban_ghi_id, luc DESC);

-- Cuốn thay đổi của các dòng con vào màn của bản ghi cha.
CREATE INDEX IF NOT EXISTS nhat_ky_thay_doi_cha_idx
  ON nhat_ky_thay_doi (cha_bang, cha_id, luc DESC);

-- Trang nhật ký toàn bảng (lọc theo bảng, mới nhất trước).
CREATE INDEX IF NOT EXISTS nhat_ky_thay_doi_bang_luc_idx
  ON nhat_ky_thay_doi (bang, luc DESC);

-- Hàm trigger DÙNG CHUNG cho mọi bảng. Mỗi bảng chỉ khác ở ba đối số do
-- `features/nhat-ky/sinh-trigger.ts` chốt vào câu `CREATE TRIGGER`:
--   TG_ARGV[0] = danh sách cột được theo dõi, nối bằng dấu phẩy, không khoảng trắng;
--   TG_ARGV[1] = tên cột khoá ngoại trỏ về cha, '' nghĩa là bảng này không có cha;
--   TG_ARGV[2] = tên bảng cha, cùng quy ước '' .
-- Vì sao hàm không tự quyết cột nào được ghi: quyết định đó nằm ở `cot-theo-doi.ts` nơi
-- `vitest` kiểm được. Hàm này không có cách nào sinh dòng cho cột ngoài TG_ARGV[0].
--
-- `search_path` ghim cứng: hàm chạy dưới search_path của người gọi, nên một bảng tạm tên
-- `nhat_ky_thay_doi` trong `pg_temp` sẽ hứng mất nhật ký nếu không ghim.
CREATE OR REPLACE FUNCTION nhat_ky_ghi() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- `to_jsonb(hàng)` gọi MỘT lần rồi lấy `->> ten_cot`: nó đưa mọi kiểu cột về text theo
  -- cùng một luật (numeric, timestamp, enum, jsonb), nên hàm không cần biết kiểu của cột
  -- nào. Với jsonb, text trả về là dạng chuẩn hoá của Postgres (thứ tự khoá, khoảng trắng
  -- đã chuẩn), nên so sánh là so NGHĨA chứ không so cách gõ.
  cot      text[] := string_to_array(TG_ARGV[0], ',');
  cot_cha  text   := nullif(TG_ARGV[1], '');
  bang_cha text   := nullif(TG_ARGV[2], '');
  j_cu     jsonb;
  j_moi    jsonb;
  j_moc    jsonb;   -- hàng dùng để lấy id/cha: NEW nếu còn, không thì OLD (ca DELETE)
  ban_ghi  text;
  cha      text;
  -- `true` = missing_ok: chưa ai đặt biến thì trả NULL thay vì ném lỗi. Đặt biến là việc
  -- của Task 4; ở Task 3 hai giá trị này LUÔN NULL và đó là hành vi đúng.
  -- `nullif(..., '')` vì một phiên đã đặt rồi reset sẽ trả chuỗi rỗng, không phải NULL.
  ai       text   := nullif(current_setting('app.tac_nhan_id', true), '');
  nhan     text   := nullif(current_setting('app.tac_nhan_nhan', true), '');
BEGIN
  IF TG_OP <> 'INSERT' THEN
    j_cu := to_jsonb(OLD);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    j_moi := to_jsonb(NEW);
  END IF;

  j_moc   := coalesce(j_moi, j_cu);
  ban_ghi := j_moc ->> 'id';
  IF cot_cha IS NOT NULL THEN
    cha := j_moc ->> cot_cha;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Chỉ cột CÓ GIÁ TRỊ: một hàng mới 38 cột mà 20 cột NULL thì 20 dòng "NULL → NULL"
    -- chỉ làm ngập nhật ký, không nói thêm điều gì.
    INSERT INTO nhat_ky_thay_doi
      (bang, ban_ghi_id, cha_bang, cha_id, thao_tac, truong, truoc, sau, tac_nhan_id, tac_nhan_nhan)
    SELECT TG_TABLE_NAME, ban_ghi, bang_cha, cha, TG_OP, c, NULL, j_moi ->> c, ai, nhan
      FROM unnest(cot) AS c
     WHERE j_moi ->> c IS NOT NULL;

  ELSIF TG_OP = 'UPDATE' THEN
    -- `IS DISTINCT FROM` chứ không phải `<>`: NULL <> 'x' ra NULL (coi như không đổi), nên
    -- `<>` sẽ nuốt mất đúng hai ca người hay làm nhất — điền vào ô trống và xoá trắng một ô.
    -- Lọc này cũng là lý do cron chạm `updated_at` không sinh dòng nào: cột mốc đã bị
    -- `cot-theo-doi.ts` loại khỏi TG_ARGV[0], mà cột còn lại thì không đổi giá trị.
    INSERT INTO nhat_ky_thay_doi
      (bang, ban_ghi_id, cha_bang, cha_id, thao_tac, truong, truoc, sau, tac_nhan_id, tac_nhan_nhan)
    SELECT TG_TABLE_NAME, ban_ghi, bang_cha, cha, TG_OP, c, j_cu ->> c, j_moi ->> c, ai, nhan
      FROM unnest(cot) AS c
     WHERE (j_cu ->> c) IS DISTINCT FROM (j_moi ->> c);

  ELSE -- DELETE
    INSERT INTO nhat_ky_thay_doi
      (bang, ban_ghi_id, cha_bang, cha_id, thao_tac, truong, truoc, sau, tac_nhan_id, tac_nhan_nhan)
    SELECT TG_TABLE_NAME, ban_ghi, bang_cha, cha, TG_OP, c, j_cu ->> c, NULL, ai, nhan
      FROM unnest(cot) AS c
     WHERE j_cu ->> c IS NOT NULL;
  END IF;

  -- Trigger `AFTER ... FOR EACH ROW`: Postgres bỏ qua giá trị trả về, NULL là quy ước.
  RETURN NULL;
END;
$$;
