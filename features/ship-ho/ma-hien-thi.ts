/**
 * THUẦN: trình bày mã đơn ship hộ khi MỘT đơn có HAI mã khuôn giống hệt nhau.
 *
 * Bối cảnh (CEO 12/10/2026, hướng A): mã của bảng LOG (`larkOrderNumber`) là mã CHUẨN để
 * nói chuyện với vận hành và là mã mà hoá đơn carrier ghi; `code` tụt xuống thành khoá kỹ
 * thuật (vẫn là khoá MMP khoá công nợ theo nó — xem D-020, nên KHÔNG đổi giá trị).
 *
 * Vấn đề đọc: hai mã **cùng khuôn `YY-INSLG-SV-NNNN`**, chỉ khác bốn số cuối
 * (`…-0145` vs `…-0954`), và hai bên đánh số độc lập nên 0/180 đơn có hai mã trùng nhau.
 * Đặt cạnh nhau mà để nguyên thì mắt quét bảng đọc nhầm là chắc chắn — nên hàm này tách
 * phần ĐUÔI khác nhau ra để màn hình nhấn đúng chỗ phân biệt, thay vì chỉ đổi màu
 * (màu không được là dấu hiệu duy nhất).
 */

export interface TachMa {
  /** Phần đầu dùng chung, vd `26-INSLG-SV-` — làm mờ. */
  dau: string;
  /** Nhóm số cuối, vd `0954` — phần DUY NHẤT phân biệt hai mã, phải nhấn. */
  duoi: string;
}

/** Tách mã thành đầu + nhóm số cuối. Mã không kết thúc bằng số → đuôi rỗng. */
export function tachMaDon(ma: string): TachMa {
  const m = /^(.*?)(\d+)$/.exec(ma.trim());
  return m ? { dau: m[1], duoi: m[2] } : { dau: ma.trim(), duoi: '' };
}

export interface MaCoNhan extends TachMa {
  ma: string;
  /** `LOG` = mã bảng Lark của vận hành · `HT` = mã khoá kỹ thuật của hệ thống. */
  nhan: 'LOG' | 'HT';
}

export interface MaHienThi {
  /** Mã đứng trước, cỡ lớn. */
  chinh: MaCoNhan;
  /** Mã phụ, cỡ nhỏ. `null` khi không có mã thứ hai để hiện. */
  phu: MaCoNhan | null;
  /** Chưa có mã LOG — nghĩa là đội logistics CHƯA tạo dòng trên bảng Lark (thường vì
   *  chưa đóng hàng). Là thông tin thật, nên màn hình nói ra chứ không để ô trống. */
  thieuMaLog: boolean;
  /** Hai mã CÙNG phần đầu → ô phụ chỉ cần hiện đuôi, vì đuôi là toàn bộ chỗ khác nhau.
   *  Khác phần đầu (vd `INSMS` của đơn SMS tự sinh cạnh `INSLG` của LOG) thì PHẢI hiện đủ —
   *  cắt đi sẽ thành một mã không tồn tại. */
  cungDau: boolean;
}

function coNhan(ma: string, nhan: 'LOG' | 'HT'): MaCoNhan {
  return { ma, nhan, ...tachMaDon(ma) };
}

export function maHienThi(o: { code: string; larkOrderNumber: string | null | undefined }): MaHienThi {
  const lark = o.larkOrderNumber?.trim();
  const code = o.code.trim();
  if (!lark) return { chinh: coNhan(code, 'HT'), phu: null, thieuMaLog: true, cungDau: false };
  // Hai mã bằng nhau (nếu sau này hợp nhất dãy số) thì hiện MỘT lần — nhắc lại cùng một
  // chuỗi hai dòng chỉ làm người đọc tưởng là hai mã khác nhau.
  if (lark === code) return { chinh: coNhan(lark, 'LOG'), phu: null, thieuMaLog: false, cungDau: true };
  const chinh = coNhan(lark, 'LOG');
  const phu = coNhan(code, 'HT');
  return { chinh, phu, thieuMaLog: false, cungDau: chinh.dau === phu.dau && chinh.dau !== '' };
}
