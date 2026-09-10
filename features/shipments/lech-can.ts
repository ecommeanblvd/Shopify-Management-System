/**
 * THUẦN: đo lệch giữa cân TÍNH CƯỚC của mình và cân carrier THỰC CHARGE — dùng để chấm tiêu chí "đóng đúng size thùng".
 *
 * CEO 10/09/2026: khoảng lệch ~0,5 kg gần như luôn do chọn thùng bé rồi cố nhét cho vừa, thùng phồng 1–3 mm mỗi chiều
 * nên cân quy đổi dôi lên. Vì vậy lệch ≥ 0,5 kg = một kiện đóng SAI size, không cần bảng tra size thùng riêng.
 *
 * Cân tính cước = max(cân thực, dài × rộng × cao ÷ hệ số quy đổi). Hệ số 5000 đúng với cả 4 carrier account đang bật.
 */
export const HE_SO_QUY_DOI = 5000;
/** Lệch từ mức này trở lên tính là chọn sai thùng. */
export const NGUONG_SAI_THUNG = 0.5;

export interface KienCan {
  /** Cân thực cân được (kg). */
  thucKg: number | null;
  daiCm: number | null; rongCm: number | null; caoCm: number | null;
  /** Cân carrier tính tiền trên hoá đơn (kg). */
  billedKg: number | null;
}

/** Cân quy đổi từ kích thước (kg); 0 khi thiếu chiều nào đó. */
export function canQuyDoi(dai: number | null, rong: number | null, cao: number | null, heSo = HE_SO_QUY_DOI): number {
  if (!dai || !rong || !cao || heSo <= 0) return 0;
  return Math.round((dai * rong * cao / heSo) * 1000) / 1000;
}

/** Cân tính cước phía mình = max(cân thực, cân quy đổi); null khi không có cân thực lẫn kích thước. */
export function canTinhCuoc(k: KienCan, heSo = HE_SO_QUY_DOI): number | null {
  const qd = canQuyDoi(k.daiCm, k.rongCm, k.caoCm, heSo);
  if (k.thucKg == null && qd === 0) return null;
  return Math.max(k.thucKg ?? 0, qd);
}

export type PhanLoaiKien = 'dung' | 'sai_thung' | 'nhe_hon' | 'thieu_du_lieu';

/** Phân loại một kiện: sai thùng khi carrier charge nặng hơn cân của mình từ ngưỡng trở lên. */
export function phanLoaiKien(k: KienCan, heSo = HE_SO_QUY_DOI): { loai: PhanLoaiKien; lech: number | null } {
  const cua = canTinhCuoc(k, heSo);
  if (cua == null || k.billedKg == null) return { loai: 'thieu_du_lieu', lech: null };
  const lech = Math.round((k.billedKg - cua) * 1000) / 1000;
  if (lech >= NGUONG_SAI_THUNG) return { loai: 'sai_thung', lech };
  if (lech <= -NGUONG_SAI_THUNG) return { loai: 'nhe_hon', lech };
  return { loai: 'dung', lech };
}

export interface KetQuaSizeThung {
  /** Kiện đủ dữ liệu để chấm (có cân/kích thước và có cân trên bill). */
  n: number;
  dung: number;
  saiThung: number;
  /** Carrier charge NHẸ hơn cân mình — vẫn tính là đúng size, chỉ đếm để biết. */
  nheHon: number;
  thieuDuLieu: number;
  /** dung / n (nheHon tính vào dung); null khi chưa chấm được kiện nào. */
  tyLeDung: number | null;
  /** Tổng kg dôi ra do đóng sai thùng — phần phải trả thêm cho carrier. */
  kgDoiRa: number;
}

/** Tỉ lệ đóng đúng size thùng của một tập kiện. */
export function chamSizeThung(kien: readonly KienCan[], heSo = HE_SO_QUY_DOI): KetQuaSizeThung {
  let dung = 0, saiThung = 0, nheHon = 0, thieuDuLieu = 0, kgDoiRa = 0;
  for (const k of kien) {
    const { loai, lech } = phanLoaiKien(k, heSo);
    if (loai === 'sai_thung') { saiThung += 1; kgDoiRa += lech ?? 0; }
    else if (loai === 'nhe_hon') { nheHon += 1; }
    else if (loai === 'dung') { dung += 1; }
    else thieuDuLieu += 1;
  }
  const n = dung + saiThung + nheHon;
  return {
    n, dung, saiThung, nheHon, thieuDuLieu,
    tyLeDung: n > 0 ? (dung + nheHon) / n : null,
    kgDoiRa: Math.round(kgDoiRa * 1000) / 1000,
  };
}
