import { Box, BoLai, LoaiBox } from './danh-muc-box';
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
  /**
   * Mã Lark đang ghi, chỉ khi nó khác `ma` SMS đã khoá — cùng tinh thần `lech` nhưng cho
   * `ma`, KHÔNG gộp vào `lech` (`lech` chỉ tả kích thước, giữ nguyên nghĩa đó).
   *
   * `ma`/`loai` bị khoá cùng kích thước vì lý do CEO chốt là "một lô đổi mã Lark sau đó vẫn
   * SẼ LỘ ra qua `lech`" — nhưng `lech` chỉ so kích thước, nên một lô re-code mã (ví dụ
   * `INS-BAG-…` → `MEAN-BOX-…`) mà kích thước không đổi sẽ không lộ qua `lech`, và box khoá
   * cứ thế im lặng dùng mã cũ dù Lark đã đổi mã. `lechMa` là tín hiệu RIÊNG cho đúng trường hợp
   * đó — Lark đổi gì cũng chỉ hiện ra đây, KHÔNG ghi đè `ma` đã khoá.
   */
  lechMa: string | null;
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
 * `ma`, `loai` VÀ kích thước của SMS cùng THẮNG và KHOÁ — cả ba tả MỘT thùng vật lý, nên
 * không được ghép `ma`/`loai` hiện tại của Lark với số đo cũ của người (reviewer round 1:
 * `ma` quyết định tính phí BOX/PAK/BAG, ghép sai làm lệch tiền). Lark đổi gì sau đó không
 * ghi đè, chỉ lộ ra ở `lech` để người xem biết kho đang báo số khác. Box chưa ai sửa tay
 * thì Lark vẫn là nguồn cho mọi trường (vì Lark luôn có bản mới nhất từ lô nhập gần nhất,
 * còn SMS lúc đó chỉ là bản mirror cũ).
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
        lechMa: null,
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
        lechMa: null,
      });
      continue;
    }

    // Đã khoá — ma, loai, kích thước đi cùng nhau từ SMS: ba cái này tả MỘT thùng vật lý,
    // ghép mã hiện tại của Lark với số đo cũ của người là đúng cái sai mà luật này chặn.
    // Lark đổi gì cũng chỉ hiện qua `lech`/`lechMa`, không ghi đè.
    const kichThuocSms: BaChieu = { daiCm: smsBox.daiCm, rongCm: smsBox.rongCm, caoCm: smsBox.caoCm };
    const lech = cungKichThuoc(larkBox.kichThuoc, kichThuocSms) ? null : larkBox.kichThuoc;
    const lechMa = larkBox.ma === smsBox.ma ? null : larkBox.ma;

    ketQua.push({
      ten: larkBox.ten,
      ma: smsBox.ma,
      loai: smsBox.loai,
      kichThuoc: kichThuocSms,
      larkRecordIds: larkBox.larkRecordIds,
      id: smsBox.id,
      suaTay: true,
      an: smsBox.an,
      lech,
      lechMa,
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
      lechMa: null,
    });
  }

  return ketQua;
}

/**
 * Lọc khỏi `boLai` những dòng kho mà tên đã có một dòng `box_dong_goi` DÙNG ĐƯỢC (`tuSms`, đã
 * qua lọc dài/rộng/ma trong `docDanhMucBox`) — nghĩa là ai đó đã điền tay và lưu box này vào
 * danh mục rồi, dù dòng kho GỐC vẫn còn xung đột (kích thước không đọc được, hoặc hai dòng
 * cùng tên khác kích thước — lý do `gomBox` đẩy nó vào `boLai` ngay từ đầu, và lý do đó không
 * tự hết chỉ vì người ta đã sửa).
 *
 * KHÔNG lọc thì một reject đã sửa vẫn nằm lại "chưa dùng được" MÃI MÃI (bản thân dòng kho thô
 * không đổi), và vật này hiện ĐÚP — vừa ở đây vừa ở khối box dùng được của `tronBox` (chính nó
 * đã lên `box` qua nhánh "box chỉ còn ở SMS", vì `box_dong_goi.ten` khớp tên dòng kho này).
 */
export function locBoLaiDaSua(boLai: BoLai[], tuSms: BoxSms[]): BoLai[] {
  const daCoTrongHeThong = new Set(tuSms.map((b) => b.ten));
  return boLai.filter((r) => !daCoTrongHeThong.has(r.ten));
}
