/**
 * THUẦN: dựng bản vá Lark cho hai ô cân + kích thước đóng thùng (Task 9, spec 2026-10-14
 * §3b.3) từ cân/dim nhân sự gõ ở khối Đóng thùng (`features/dong-hang/dong-thung.ts`).
 *
 * Luật "chỉ điền ô trống" dùng lại `oLarkTrong` của `dung-patch.ts` — một định nghĩa "trống"
 * duy nhất cho mọi đường ghi Lark trong hệ thống. NGOẠI LỆ CEO chốt riêng cho tính năng này:
 * hệ thống được phép ghi ĐÈ LẠI đúng những ô NÓ đã từng ghi — nếu không, lượt ghi đầu tiên
 * khoá ô `Weights`/`Dimension ( điền tay)` vĩnh viễn, và một số cân gõ nhầm hay cân lại sau
 * khi đóng thùng khác sẽ không bao giờ sửa được trên Lark, trong khi phí ship của hãng lại
 * tính thẳng từ ô đó.
 *
 * VÒNG SỬA SAU REVIEW (14/10/2026): bằng chứng "đã ghi" KHÔNG còn là một danh sách TÊN CỘT
 * (`doSmsGhi: string[]`) — danh sách đó chỉ chứng minh "hệ thống đã từng ghi cột này", không
 * chứng minh "giá trị đang nằm ở đó vẫn là giá trị hệ thống để lại". Ca hỏng cụ thể: hệ thống
 * ghi `Weights = 2.4`; người soát thấy sai, sửa tay trên Lark thành `3.0`; ai đó bấm lưu đóng
 * thùng lần nữa; danh sách tên cột vẫn chứa `Weights` ⇒ ĐÈ LÊN đúng số người vừa sửa, KHÔNG
 * một cảnh báo nào — đúng ca luật "bỏ qua ô người gõ tay, báo ra" sinh ra để chặn.
 *
 * Nay bằng chứng là `bienNhan: Record<string, unknown>` — biên nhận GIÁ TRỊ đã gửi cho mỗi
 * cột (`{"Weights": 2.4, "Dimension ( điền tay)": "40x30x12"}`, nguồn
 * `shipments.o_lark_do_sms_ghi`, migration 0209). Điền một ô khi nó TRỐNG, hoặc khi giá trị
 * Lark ĐANG GIỮ còn khớp đúng biên nhận của ô đó; khác đi — dù khác vì người sửa hay vì bất kỳ
 * gì — thì dừng và báo ra, giống hệt ca "ô người khác gõ". Đây VẪN là quyết định từ bằng chứng
 * lưu lại, không phải so hai con số NGƯỜI gõ: nó so Lark với CHÍNH biên nhận của hệ thống.
 */
import { oLarkTrong, docSo } from './dung-patch';
import { larkText } from '../parse-pack-row';
import { COT } from './cot';

export interface KienCanDim {
  canKg: number | null;
  daiCm: number | null;
  rongCm: number | null;
  caoCm: number | null;
}

export interface KetQuaXemTruocCanDim {
  patch: Record<string, unknown>;
  canhBao: string[];
}

/** Chuỗi "DxR" hoặc "DxRxC" cho ô `Dimension ( điền tay)`. KHÔNG chèn số `0` giả cho chiều cao
 *  thiếu: thiếu cao là TÍN HIỆU để engine chọn hạng Pak của hãng (túi 2D) — chèn số giả vào
 *  đó là đổi sai hạng cước, không chỉ sai hiển thị. */
function chuoiKichThuoc(daiCm: number, rongCm: number, caoCm: number | null): string {
  return caoCm != null ? `${daiCm}x${rongCm}x${caoCm}` : `${daiCm}x${rongCm}`;
}

/**
 * Giá trị Lark ĐANG GIỮ ở một ô có còn khớp biên nhận hệ thống đã ghi cho đúng ô đó không.
 *
 * So KHÔNG phải bằng `===` thẳng: ô `Weights` là cột SỐ, mà `dung-patch.ts` đã đo thấy CÙNG
 * một ô trả về hai KIỂU khác nhau tuỳ endpoint Lark — `records/search` trả số (`4747300`),
 * `GET records/:id` (đường hàm này đọc, qua `getLogRecordById`) trả CHUỖI (`'4747300'`). Biên
 * nhận luôn lưu kiểu NGUYÊN THUỶ đã gửi (số cho `Weights`, chuỗi cho `Dimension…`) nên so theo
 * KIỂU của biên nhận: số thì đọc Lark ra số bằng `docSo` trước khi so, chuỗi thì đọc bằng
 * `larkText` (bao dung cả ô Lark trả về dạng số) trước khi so.
 */
function khopBienNhan(giaTriLark: unknown, giaTriBienNhan: unknown): boolean {
  if (typeof giaTriBienNhan === 'number') {
    const hienTai = docSo(giaTriLark);
    return hienTai != null && hienTai === giaTriBienNhan;
  }
  if (typeof giaTriBienNhan === 'string') {
    return larkText(giaTriLark) === giaTriBienNhan;
  }
  return false; // biên nhận hình lạ (không phải số/chuỗi) — không đủ cơ sở để coi là khớp.
}

/**
 * XEM TRƯỚC toàn bộ quyết định ghi cân/dim, KHÔNG chạm Lark — thuần, test trực tiếp bằng dữ
 * liệu giả. `ghiCanDimLenLark` (features/dong-hang) suy patch gửi thật TỪ ĐÚNG hàm này, không
 * tính song song, để thứ ghi lên Lark không bao giờ lệch thứ hàm này quyết định.
 */
export function xemTruocGhiCanDim(
  kien: KienCanDim,
  oLark: Record<string, unknown>,
  bienNhan: Record<string, unknown>,
): KetQuaXemTruocCanDim {
  const patch: Record<string, unknown> = {};
  const canhBao: string[] = [];

  // Điền khi ô Lark ĐANG TRỐNG, hoặc khi ô có giá trị NHƯNG giá trị đó còn khớp đúng biên
  // nhận hệ thống đã gửi cho cột này lần trước (xem bình đầu tệp) — không phải khi giá trị
  // mới "trùng" hay "khác" giá trị cũ.
  const duocGhi = (cot: string): boolean => {
    if (oLarkTrong(oLark[cot])) return true;
    if (!(cot in bienNhan)) return false;
    return khopBienNhan(oLark[cot], bienNhan[cot]);
  };

  if (kien.canKg != null) {
    const cot = COT.weights;
    if (duocGhi(cot)) {
      patch[cot] = kien.canKg;
    } else {
      canhBao.push(`${cot}: Lark đang có số khác biên nhận hệ thống (hoặc do người khác gõ) — không ghi đè`);
    }
  }

  if (kien.daiCm != null && kien.rongCm != null) {
    const cot = COT.dimensionDienTay;
    if (duocGhi(cot)) {
      patch[cot] = chuoiKichThuoc(kien.daiCm, kien.rongCm, kien.caoCm);
    } else {
      canhBao.push(`${cot}: Lark đang có chữ khác biên nhận hệ thống (hoặc do người khác gõ) — không ghi đè`);
    }
  }

  return { patch, canhBao };
}
