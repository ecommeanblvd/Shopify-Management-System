/**
 * THUẦN: luật của bước ĐÓNG THÙNG (CEO 30/09/2026). Không I/O.
 *
 * Luồng CEO mô tả: lúc QC các bạn cân sản phẩm rồi đặt thử vào hộp để chọn loại hộp vừa, và
 * điền cân DỰ KIẾN SAU ĐÓNG cho từng món. Tới bước này mới chọn thùng thật và cân CẢ KIỆN.
 */

/** Cân một kiện ngoài dải này là gõ nhầm. Kiện nặng nhất từng đi chưa tới 30 kg. */
export const CAN_KIEN_TOI_DA_KG = 70;
export const KICH_THUOC_TOI_DA_CM = 300;

export interface NhapDongThung {
  hop: string;
  canKg: string;
  dai: string; rong: string; cao: string;
}

export interface KetQuaKiemNhap {
  ok: boolean;
  loi: string[];
  /** Chỉ có khi `ok` — số đã chuẩn hoá để ghi. */
  sach?: { hop: string; canKg: number; dai: number | null; rong: number | null; cao: number | null };
}

const so = (v: string): number | null => {
  const t = v.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Kiểm ô nhập trước khi ghi.
 *
 * Cân là BẮT BUỘC — đó là lý do bước này tồn tại. Kích thước tuỳ chọn: nhiều kiện dùng túi,
 * không có kích thước nào để đo, và bắt nhập là bắt người ta bịa số.
 *
 * Kích thước nhập thì phải đủ CẢ BA chiều — HOẶC đủ dài + rộng mà bỏ trống cao (túi niêm
 * phong/túi zip trong kho chỉ có hai số, không có "cao" để đo). Thiếu dài hoặc rộng thì vẫn
 * là lỗi trong mọi trường hợp, có hay không có cao — một chiều lẻ kiểu đó không tính được
 * cân quy đổi, mà lưu nửa vời thì màn sau tưởng có dữ liệu.
 *
 * Cao bỏ trống được ghi là `null` (xem `sach` bên dưới) — đó CHÍNH LÀ tín hiệu mà
 * `inferPackagingFromDims` (features/shipments/parse-packaging.ts) dùng để chọn hạng cước
 * Pak thay vì Package. Đây là CỐ Ý, không phải tai nạn — ĐỪNG "dọn" null thành 0 ở đây hay
 * bất cứ đâu khác đọc lại giá trị này. Vì vậy cao = 0 KHÔNG được coi là "bỏ trống": không có
 * kiện nào mỏng 0 cm, đó là gõ nhầm, nên vẫn phải báo lỗi như mọi kích thước ≤ 0 khác.
 */
export function kiemNhapDongThung(v: NhapDongThung): KetQuaKiemNhap {
  const loi: string[] = [];
  const hop = v.hop.trim();
  if (!hop) loi.push('Chưa chọn thùng đã dùng');

  const can = so(v.canKg);
  if (can == null) loi.push('Chưa cân cả kiện');
  else if (Number.isNaN(can)) loi.push('Cân không phải số');
  else if (can <= 0) loi.push('Cân phải lớn hơn 0');
  else if (can > CAN_KIEN_TOI_DA_KG) loi.push(`Cân ${can} kg vượt ${CAN_KIEN_TOI_DA_KG} kg — kiểm lại xem có gõ nhầm không`);

  const dai = so(v.dai);
  const rong = so(v.rong);
  const cao = so(v.cao);
  const ba = [dai, rong, cao];
  const soONhap = ba.filter((x) => x != null).length;

  const duDaiRong = dai != null && rong != null;
  const chiThieuCao = duDaiRong && cao == null;
  if (soONhap > 0 && soONhap < 3 && !chiThieuCao) {
    loi.push('Nhập kích thước thì phải đủ cả ba chiều, hoặc đủ dài + rộng cho thùng dạng túi — thiếu dài hoặc rộng thì không tính được cân quy đổi');
  }
  for (const x of ba) {
    if (x == null) continue;
    if (Number.isNaN(x) || x <= 0) { loi.push('Kích thước phải là số lớn hơn 0'); break; }
    if (x > KICH_THUOC_TOI_DA_CM) { loi.push(`Kích thước vượt ${KICH_THUOC_TOI_DA_CM} cm — kiểm lại`); break; }
  }

  if (loi.length > 0) return { ok: false, loi };
  return {
    ok: true, loi: [],
    sach: {
      hop,
      canKg: Math.round((can as number) * 1000) / 1000,
      // Tới đây soONhap chỉ còn 0, 2 (đủ dài+rộng, thiếu cao) hoặc 3 — mọi tổ hợp lẻ khác
      // đã bị chặn ở trên.
      dai: soONhap >= 2 ? dai : null,
      rong: soONhap >= 2 ? rong : null,
      cao: soONhap === 3 ? cao : null,
    },
  };
}

/**
 * So cân thật với tổng cân dự kiến từ QC — để người đóng thấy ngay mình gõ nhầm.
 *
 * KHÔNG chặn lưu: tổng dự kiến cộng hộp của TỪNG món, nên nhiều món gộp một thùng thì nó cao
 * hơn cân thật một cách hợp lệ. Chỉ nhắc khi lệch quá lớn theo cả hai chiều.
 */
export const NGUONG_CANH_BAO = 0.5;

/**
 * Dựng `dims` để hiện lại khi MỞ LẠI bước Đóng thùng, từ ba cột `sms_dim_*` (chuỗi số của cột
 * numeric, hoặc null).
 *
 * Chỉ ĐÒI dài + rộng — KHÔNG đòi cao. Túi lưu `cao = null` (xem `kiemNhapDongThung`); đòi đủ cả
 * ba sẽ coi mọi túi là "chưa đóng", làm mất luôn dài+rộng đã lưu khi mở lại kiện (bug thật: kho
 * có bốn cỡ túi, 28×42/38×52/25×35/35×45, nên đây là đường ĐI THƯỜNG, không phải cạnh hiếm).
 * Thiếu dài HOẶC rộng thì cả bộ coi như chưa đóng — một chiều lẻ không tính được cân quy đổi.
 */
export function dimsDongThungTuCot(
  smsL: string | null, smsW: string | null, smsH: string | null,
): { l: number; w: number; h: number | null } | null {
  if (smsL == null || smsW == null) return null;
  return { l: Number(smsL), w: Number(smsW), h: smsH != null ? Number(smsH) : null };
}

export interface KetQuaKiemBox {
  ok: boolean;
  loi: string[];
  /** Chỉ có khi `ok` — số đã chuẩn hoá để ghi vào `box_dong_goi`. */
  sach?: { ten: string; ma: string; daiCm: number; rongCm: number; caoCm: number | null };
}

/**
 * Kiểm ô nhập của màn quản lý danh mục box (`QuanLyBox`) trước khi `luuBox` ghi — cùng khuôn
 * với `kiemNhapDongThung` ở trên để hai màn đọc giống nhau: chiều cao bỏ trống vẫn hợp lệ (đó
 * là tín hiệu "box không có cao", tức túi — xem `KICH_THUOC_TOI_DA_CM`/ghi chú phía trên), còn
 * gõ 0 hoặc số âm luôn là lỗi.
 *
 * `dsTenDaCo`: tên các box KHÁC đã có trong danh mục. Trùng tên là lỗi vì `box_dong_goi.ten`
 * là cột UNIQUE (khớp Lark theo tên — xem `tron-box.ts`); nơi gọi (`luuBox`) tự loại tên của
 * chính box đang sửa ra khỏi danh sách này trước khi gọi, để sửa một box mà không đổi tên
 * không bị báo trùng với chính nó.
 *
 * BẮT BUỘC (không có giá trị mặc định) — cùng lý do `dsBox` ở `KhoiDongThung` không có `= []`:
 * một bản vá lỡ gọi `kiemBox(v)` thiếu tham số này sẽ ÂM THẦM tắt luật kiểm trùng tên (không
 * lỗi kiểu, không crash, chỉ là luật ngưng áp dụng mà không ai nhận ra). Buộc truyền tay để
 * thiếu dây là `tsc` báo lỗi NGAY tại chỗ gọi.
 *
 * `ma` cũng BẮT BUỘC — cùng guard `isNotNull(dinh_danh)` mà truy vấn phía kho đã có
 * (`docDanhMucBox`, features/dong-hang/queries.ts): một box `ma = ''` vẫn lên được lưới
 * `ChonBox`, người chọn nó thì ô "Thùng đã dùng" bị điền rỗng và bị báo "Chưa chọn thùng đã
 * dùng" ngay sau khi vừa chọn — một box không dùng được thì không được mời chọn, chặn ngay ở
 * đây, trước khi nó kịp lưu vào danh mục.
 */
export function kiemBox(
  v: { ten: string; ma: string; daiCm: string; rongCm: string; caoCm: string },
  dsTenDaCo: string[],
): KetQuaKiemBox {
  const loi: string[] = [];
  const ten = v.ten.trim();
  if (!ten) loi.push('Chưa nhập tên box');
  else if (dsTenDaCo.some((t) => t.trim() === ten)) loi.push('Tên box này đã có trong danh mục');

  const ma = v.ma.trim();
  if (!ma) loi.push('Chưa nhập mã vật tư');

  const dai = so(v.daiCm);
  const rong = so(v.rongCm);
  const cao = so(v.caoCm);

  // Dài và rộng là BẮT BUỘC — một box không đo được hai chiều này thì không lên lưới chọn
  // được. Cao tuỳ chọn (túi).
  if (dai == null) loi.push('Chưa nhập chiều dài');
  if (rong == null) loi.push('Chưa nhập chiều rộng');

  for (const x of [dai, rong, cao]) {
    if (x == null) continue;
    if (Number.isNaN(x) || x <= 0) { loi.push('Kích thước phải là số lớn hơn 0'); break; }
    if (x > KICH_THUOC_TOI_DA_CM) { loi.push(`Kích thước vượt ${KICH_THUOC_TOI_DA_CM} cm — kiểm lại`); break; }
  }

  if (loi.length > 0) return { ok: false, loi };
  return {
    ok: true, loi: [],
    sach: { ten, ma, daiCm: dai as number, rongCm: rong as number, caoCm: cao },
  };
}

export function canhBaoLechCan(canThuc: number, tongDuKien: number | null): string | null {
  if (tongDuKien == null || tongDuKien <= 0) return null;
  const lech = (canThuc - tongDuKien) / tongDuKien;
  if (lech > NGUONG_CANH_BAO) {
    return `Nặng hơn dự kiến ${Math.round(lech * 100)} % (dự kiến ${tongDuKien} kg) — kiểm lại xem có gõ nhầm không`;
  }
  if (lech < -NGUONG_CANH_BAO) {
    return `Nhẹ hơn dự kiến ${Math.round(-lech * 100)} % (dự kiến ${tongDuKien} kg) — kiểm xem đã đủ món chưa`;
  }
  return null;
}
