-- Đổi `shipments.o_lark_do_sms_ghi` từ MẢNG tên cột sang BIÊN NHẬN giá trị (Task 9, vòng sửa
-- sau review 2026-10-14). KHÔNG sửa lại `0208` — tệp đó đã áp vào CSDL dùng chung, xem
-- db/migrations/README.md: migration áp TAY, sửa file đã áp là vô nghĩa, phải thêm file mới.
--
-- Vì sao đổi: mảng tên cột chỉ chứng minh "hệ thống đã từng ghi cột này", không chứng minh
-- "giá trị đang nằm ở ô đó vẫn là giá trị hệ thống để lại". Ca hỏng cụ thể review tìm ra: hệ
-- thống ghi `Weights = 2.4`; người soát thấy sai, sửa tay trên Lark thành `3.0`; ai đó bấm lưu
-- đóng thùng lần nữa trên màn này; luật cũ (`danhSach.includes('Weights')`) trả true ⇒ ĐÈ LÊN
-- đúng số người vừa sửa, KHÔNG một cảnh báo nào — đúng ca luật "bỏ qua ô người gõ tay, báo ra"
-- sinh ra để chặn, trên một hệ thống KHÔNG CÓ UNDO, mà phí hãng tính thẳng từ ô đó.
--
-- Sửa: lưu CẢ GIÁ TRỊ đã gửi cho mỗi cột, không chỉ tên cột —
-- `{"Weights": 2.4, "Dimension ( điền tay)": "40x30x12"}`. Lượt ghi sau
-- (`features/lark/ghi-nguoc/patch-can-dim.ts`, hàm `xemTruocGhiCanDim`) chỉ được đè khi giá
-- trị Lark ĐANG GIỮ còn khớp đúng biên nhận của đúng ô đó; khác đi — dù khác vì người sửa hay
-- vì bất kỳ lý do gì — thì dừng và báo ra, giống hệt ca "ô người khác gõ". Vẫn là quyết định
-- từ bằng chứng LƯU LẠI, không phải so hai con số của hai người: so Lark với CHÍNH biên nhận
-- của hệ thống.
--
-- `0208` mới áp hôm nay, giá trị hiện tại của MỌI dòng trên CSDL dùng chung là mảng rỗng `[]`
-- (chưa ai ghi gì qua đường này) — chuyển thẳng thành `{}` an toàn tuyệt đối, không mất bằng
-- chứng nào (không có bằng chứng nào để mất). Nếu lượt nào đó giữa 0208 và 0209 đã ghi được
-- một mảng tên cột THẬT (không phải `[]`) thì câu UPDATE dưới đây CỐ Ý không đụng tới nó — ép
-- một mảng tên cột thành object giá trị không có nguồn số/chuỗi để điền đúng, và registry ấy
-- sẽ chỉ sống lại qua lượt ghi kế tiếp của chính nó (coi như trống, ghi mới, biên nhận mới).
ALTER TABLE shipments
  ALTER COLUMN o_lark_do_sms_ghi SET DEFAULT '{}'::jsonb;

UPDATE shipments
  SET o_lark_do_sms_ghi = '{}'::jsonb
  WHERE o_lark_do_sms_ghi = '[]'::jsonb;
