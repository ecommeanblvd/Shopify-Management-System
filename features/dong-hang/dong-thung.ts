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
 * Kích thước nhập thì phải nhập ĐỦ BA chiều: một chiều lẻ không tính được cân quy đổi, mà
 * lưu nửa vời thì màn sau tưởng có dữ liệu.
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

  const ba = [so(v.dai), so(v.rong), so(v.cao)];
  const soONhap = ba.filter((x) => x != null).length;
  if (soONhap > 0 && soONhap < 3) {
    loi.push('Nhập kích thước thì phải đủ cả ba chiều — thiếu một chiều thì không tính được cân quy đổi');
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
      dai: soONhap === 3 ? (ba[0] as number) : null,
      rong: soONhap === 3 ? (ba[1] as number) : null,
      cao: soONhap === 3 ? (ba[2] as number) : null,
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
