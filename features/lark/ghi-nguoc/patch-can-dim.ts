/**
 * THUẦN: dựng bản vá Lark cho hai ô cân + kích thước đóng thùng (Task 9, spec 2026-10-14
 * §3b.3) từ cân/dim nhân sự gõ ở khối Đóng thùng (`features/dong-hang/dong-thung.ts`).
 *
 * Luật "chỉ điền ô trống" dùng lại `oLarkTrong` của `dung-patch.ts` — một định nghĩa "trống"
 * duy nhất cho mọi đường ghi Lark trong hệ thống. NGOẠI LỆ CEO chốt riêng cho tính năng này:
 * hệ thống được phép ghi ĐÈ LẠI đúng những ô NÓ đã từng ghi (`doSmsGhi`) — nếu không, lượt ghi
 * đầu tiên khoá ô `Weights`/`Dimension ( điền tay)` vĩnh viễn, và một số cân gõ nhầm hay cân
 * lại sau khi đóng thùng khác sẽ không bao giờ sửa được trên Lark, trong khi phí ship của
 * hãng lại tính thẳng từ ô đó.
 *
 * Quyết định "ô này tôi đã ghi chưa" dựa vào BẰNG CHỨNG LƯU LẠI (`doSmsGhi`, nguồn
 * `shipments.o_lark_do_sms_ghi`), KHÔNG so giá trị: hai người (nhân sự gõ tay trên Lark và hệ
 * thống) gõ TRÙNG một số không phải là bằng chứng ai ghi — so giá trị để quyết định sẽ coi
 * nhầm một trùng hợp thành "đây là của mình", rồi đè lên đúng số người khác vừa gõ.
 */
import { oLarkTrong } from './dung-patch';
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
 * XEM TRƯỚC toàn bộ quyết định ghi cân/dim, KHÔNG chạm Lark — thuần, test trực tiếp bằng dữ
 * liệu giả. `ghiCanDimLenLark` (features/dong-hang) suy patch gửi thật TỪ ĐÚNG hàm này, không
 * tính song song, để thứ ghi lên Lark không bao giờ lệch thứ hàm này quyết định.
 */
export function xemTruocGhiCanDim(
  kien: KienCanDim,
  oLark: Record<string, unknown>,
  doSmsGhi: string[],
): KetQuaXemTruocCanDim {
  const patch: Record<string, unknown> = {};
  const canhBao: string[] = [];

  // Điền khi ô Lark ĐANG TRỐNG hoặc tên cột nằm trong danh sách hệ thống đã từng ghi — chứ
  // không phải khi giá trị mới "trùng" hay "khác" giá trị cũ (xem bình đầu tệp).
  const duocGhi = (cot: string): boolean => oLarkTrong(oLark[cot]) || doSmsGhi.includes(cot);

  if (kien.canKg != null) {
    const cot = COT.weights;
    if (duocGhi(cot)) {
      patch[cot] = kien.canKg;
    } else {
      canhBao.push(`${cot}: Lark đang có số do người khác gõ — không ghi đè (hệ thống chưa từng ghi ô này)`);
    }
  }

  if (kien.daiCm != null && kien.rongCm != null) {
    const cot = COT.dimensionDienTay;
    if (duocGhi(cot)) {
      patch[cot] = chuoiKichThuoc(kien.daiCm, kien.rongCm, kien.caoCm);
    } else {
      canhBao.push(`${cot}: Lark đang có chữ do người khác gõ — không ghi đè (hệ thống chưa từng ghi ô này)`);
    }
  }

  return { patch, canhBao };
}
