import { Box, LoaiBox } from './danh-muc-box';
import { BaChieu } from './kich-thuoc-box';

/** Một dòng box của hệ thống (bảng `box_dong_goi`), đã tách ba chiều thành số. */
export interface BoxSms {
  id: string;
  ten: string;
  ma: string;
  loai: LoaiBox;
  daiCm: number;
  rongCm: number;
  caoCm: number | null;
  suaTay: boolean;
  an: boolean;
}

/** Box hiện ra cho người dùng sau khi trộn Lark + SMS theo luật bản-sửa-tay-thắng. */
export interface BoxHien extends Box {
  id: string | null;
  suaTay: boolean;
  an: boolean;
  /** Số Lark đang ghi, chỉ khi nó khác số SMS đã khoá. Chỉ để báo, KHÔNG dùng để ghi đè. */
  lech: BaChieu | null;
}

function cungKichThuoc(a: BaChieu, b: BaChieu): boolean {
  return a.daiCm === b.daiCm && a.rongCm === b.rongCm && a.caoCm === b.caoCm;
}

/**
 * THUẦN: Trộn danh mục box kéo từ Lark (`tuLark`) với bảng box của hệ thống (`tuSms`)
 * thành danh sách hiện ra cho người dùng.
 *
 * Khớp hai bên theo TÊN (`ten`), không theo `larkRecordIds`/`record_id`: mirror kho
 * (`lark_wh_inventory`) là mirror có XOÁ — mỗi lô nhập là một dòng riêng, record_id của
 * nó biến mất khi lô đó bị xoá. Khớp theo record_id sẽ làm mất bản sửa tay ngay khi kho
 * đổi lô, đúng cái luật này sinh ra để ngăn.
 *
 * Luật bản-sửa-tay-thắng (CEO chốt): khi một box đã bị sửa tay trong SMS (`suaTay = true`),
 * số đo của SMS THẮNG và KHOÁ — Lark đổi số sau đó không ghi đè, chỉ lộ ra ở `lech` để
 * người xem biết kho đang báo số khác. Box chưa ai sửa tay thì Lark vẫn là nguồn số đo
 * (vì Lark luôn có bản mới nhất từ lô nhập gần nhất, còn SMS lúc đó chỉ là bản mirror cũ).
 *
 * Box chỉ còn ở một bên (Lark đã xoá lô, hoặc người tự thêm box trong SMS) vẫn phải hiện —
 * không được biến mất. `an` chỉ là cờ ẩn trên màn hình, không loại box khỏi kết quả.
 */
export function tronBox(tuLark: Box[], tuSms: BoxSms[]): BoxHien[] {
  const smsTheoTen = new Map<string, BoxSms>();
  for (const b of tuSms) smsTheoTen.set(b.ten, b);

  const daKhopVoiLark = new Set<string>();
  const ketQua: BoxHien[] = [];

  for (const larkBox of tuLark) {
    const smsBox = smsTheoTen.get(larkBox.ten);
    daKhopVoiLark.add(larkBox.ten);

    if (!smsBox) {
      // Lark có, SMS chưa biết gì về box này — hiện nguyên số Lark.
      ketQua.push({
        ...larkBox,
        id: null,
        suaTay: false,
        an: false,
        lech: null,
      });
      continue;
    }

    if (!smsBox.suaTay) {
      // Chưa ai khoá — Lark vẫn là nguồn số đo.
      ketQua.push({
        ten: larkBox.ten,
        ma: larkBox.ma,
        loai: larkBox.loai,
        kichThuoc: larkBox.kichThuoc,
        larkRecordIds: larkBox.larkRecordIds,
        id: smsBox.id,
        suaTay: false,
        an: smsBox.an,
        lech: null,
      });
      continue;
    }

    // Đã khoá — số SMS thắng; Lark đổi số chỉ hiện qua `lech`.
    const kichThuocSms: BaChieu = { daiCm: smsBox.daiCm, rongCm: smsBox.rongCm, caoCm: smsBox.caoCm };
    const lech = cungKichThuoc(larkBox.kichThuoc, kichThuocSms) ? null : larkBox.kichThuoc;

    ketQua.push({
      ten: larkBox.ten,
      ma: larkBox.ma,
      loai: larkBox.loai,
      kichThuoc: kichThuocSms,
      larkRecordIds: larkBox.larkRecordIds,
      id: smsBox.id,
      suaTay: true,
      an: smsBox.an,
      lech,
    });
  }

  // Box chỉ còn ở SMS: Lark đã xoá lô cũ, hoặc người tự thêm tay — vẫn phải hiện.
  for (const smsBox of tuSms) {
    if (daKhopVoiLark.has(smsBox.ten)) continue;
    ketQua.push({
      ten: smsBox.ten,
      ma: smsBox.ma,
      loai: smsBox.loai,
      kichThuoc: { daiCm: smsBox.daiCm, rongCm: smsBox.rongCm, caoCm: smsBox.caoCm },
      larkRecordIds: [],
      id: smsBox.id,
      suaTay: smsBox.suaTay,
      an: smsBox.an,
      lech: null,
    });
  }

  return ketQua;
}
