/**
 * SOP thời gian giao hàng + chấm KPI cho đội logistics (CEO 10/09/2026).
 *
 * Mức cam kết đặt theo dữ liệu THỰC 2026 (3.452 kiện đã ghi nhận giao, xem tab "Tiêu chuẩn giao"): mỗi nhóm tuyến lấy số
 * ngày mà hiện đội đang đạt khoảng 90 %, để KPI vừa sát thực tế vừa còn chỗ siết. Cột "mục tiêu" là mức quý sau phải đạt.
 *
 * KPI = tỉ lệ đơn giao trong ≤ SLA trên tổng đơn ĐÃ GHI NHẬN GIAO của kỳ. Đơn trễ tách hai loại để biết trách nhiệm:
 *   - trễ vận chuyển: quá SLA nhưng ≤ ngưỡng ngoại lệ (20 ngày) — thuộc về line ship + ops;
 *   - ngoại lệ: quá 20 ngày, gần như luôn là không liên hệ được khách hoặc kẹt thông quan (D-065).
 * Cả hai đều tính là TRỄ trong KPI chính; tách ra chỉ để quy nguyên nhân, không để miễn trừ.
 *
 * Việt Nam bị loại khỏi SOP: là tuyến nội địa và dữ liệu ngày giao hiện có 17/23 kiện do ops đánh dấu hàng loạt cùng ngày.
 */

export const NGUONG_NGOAI_LE_SOP = 20;
/** Nước không đưa vào KPI (kèm lý do) — rà lại khi dữ liệu sạch. */
export const NUOC_LOAI_TRU: Record<string, string> = {
  VN: 'Tuyến nội địa, dữ liệu ngày giao chưa tin được (ops đánh dấu hàng loạt)',
};

export interface NhomSop {
  ma: string;
  ten: string;
  /** ISO-2 các nước thuộc nhóm; rỗng = nhóm hứng phần còn lại. */
  nuoc: string[];
  /** Số ngày cam kết: giao trong ngần này (tính từ ngày gửi) là ĐÚNG HẠN. */
  slaNgay: number;
  /** Tỉ lệ trễ tối đa cho phép (0..1). Vượt mức này là nhóm KHÔNG đạt KPI. */
  loiToiDa: number;
  /** Mức ngày phải đạt ở quý sau — để đội có đích siết xuống. */
  mucTieuNgay: number;
  /** Vì sao đặt mức đó (hiện trên UI để đội hiểu con số ở đâu ra). */
  canCu: string;
}

/** Bảng SOP. Thứ tự = thứ tự hiện trên báo cáo. Nhóm cuối (nuoc rỗng) hứng mọi nước còn lại. */
export const NHOM_SOP: NhomSop[] = [
  {
    ma: 'chau-a', ten: 'Châu Á', slaNgay: 5, loiToiDa: 0.10, mucTieuNgay: 4,
    nuoc: ['HK', 'SG', 'JP', 'MY', 'TW', 'PH', 'KR', 'ID', 'KH', 'LA', 'BN', 'MO', 'CN'],
    canCu: '2026: Hồng Kông 94 % · Nhật 92 % · Singapore 90 % · Malaysia 95 % · Philippines 88 % đơn giao trong 5 ngày',
  },
  {
    ma: 'bac-my-anh-uc', ten: 'Bắc Mỹ · Anh · Úc', slaNgay: 7, loiToiDa: 0.10, mucTieuNgay: 6,
    nuoc: ['US', 'CA', 'GB', 'AU', 'NZ', 'MX'],
    canCu: '2026: Mỹ 91 % · Canada 93 % · Anh 93 % · Úc 89 % đơn giao trong 7 ngày',
  },
  {
    ma: 'chau-au', ten: 'Châu Âu', slaNgay: 8, loiToiDa: 0.12, mucTieuNgay: 7,
    nuoc: ['DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'CH', 'PT', 'AT', 'DK', 'SE', 'NO', 'IE', 'FI', 'LU', 'GR', 'CZ', 'PL', 'HU', 'RO', 'BG', 'HR', 'SK', 'SI', 'LT', 'LV', 'EE', 'CY', 'MT', 'IS'],
    canCu: '2026: Đức 91 % · Pháp 89 % · Tây Ban Nha 87 % · Thụy Sĩ 100 % đơn giao trong 8 ngày',
  },
  {
    ma: 'uae', ten: 'UAE (tuyến Vùng Vịnh nhanh)', slaNgay: 8, loiToiDa: 0.12, mucTieuNgay: 7,
    nuoc: ['AE'],
    canCu: '2026: UAE 89 % đơn giao trong 8 ngày, nhanh hơn hẳn phần còn lại của Vùng Vịnh',
  },
  {
    ma: 'trung-dong', ten: 'Trung Đông còn lại', slaNgay: 11, loiToiDa: 0.10, mucTieuNgay: 10,
    nuoc: ['SA', 'QA', 'KW', 'IL', 'BH', 'OM', 'JO', 'EG', 'LB', 'TR'],
    canCu: '2026: Ả Rập Xê Út 86 % · Qatar 88 % · Kuwait 89 % · Israel 87 % đơn giao trong 10 ngày, lên ~92 % ở 11 ngày',
  },
  {
    ma: 'khac', ten: 'Các nước còn lại', slaNgay: 12, loiToiDa: 0.15, mucTieuNgay: 10,
    nuoc: [],
    canCu: '45 nước mẫu nhỏ (98 kiện cả năm) — nới hơn, siết lại khi một nước đủ 20 kiện',
  },
];

const THEO_NUOC = new Map<string, NhomSop>(NHOM_SOP.flatMap((n) => n.nuoc.map((cc) => [cc, n] as const)));
const NHOM_CUOI = NHOM_SOP[NHOM_SOP.length - 1];

/** Nhóm SOP của một nước; nước lạ rơi vào nhóm cuối. */
export const nhomCuaNuoc = (cc: string): NhomSop => THEO_NUOC.get(cc.trim().toUpperCase()) ?? NHOM_CUOI;

export interface KienGiao { country: string; soNgay: number }

export interface DiemKpi {
  /** Số kiện đã ghi nhận giao trong kỳ. */
  n: number;
  dungHan: number;
  /** Quá SLA nhưng chưa tới ngưỡng ngoại lệ — trách nhiệm line + ops. */
  treVanChuyen: number;
  /** Quá ngưỡng ngoại lệ — không liên hệ được khách / kẹt thông quan. */
  ngoaiLe: number;
  /** dungHan / n; null khi kỳ chưa có kiện nào. */
  tyLeDungHan: number | null;
  /** (n − dungHan) / n; null khi kỳ chưa có kiện nào. */
  tyLeTre: number | null;
  /** Đạt KPI khi tỉ lệ trễ ≤ loiToiDa của nhóm. Kỳ chưa có kiện → null (không chấm). */
  dat: boolean | null;
}

export interface DongKpiNhom extends DiemKpi { nhom: NhomSop; theoNuoc: DongKpiNuoc[] }
export interface DongKpiNuoc extends DiemKpi { country: string }

function cham(kien: readonly KienGiao[], slaNgay: number, loiToiDa: number, nguong: number): DiemKpi {
  const n = kien.length;
  let dungHan = 0, treVanChuyen = 0, ngoaiLe = 0;
  for (const k of kien) {
    if (k.soNgay <= slaNgay) dungHan += 1;
    else if (k.soNgay <= nguong) treVanChuyen += 1;
    else ngoaiLe += 1;
  }
  if (n === 0) return { n, dungHan, treVanChuyen, ngoaiLe, tyLeDungHan: null, tyLeTre: null, dat: null };
  const tyLeTre = (n - dungHan) / n;
  return { n, dungHan, treVanChuyen, ngoaiLe, tyLeDungHan: dungHan / n, tyLeTre, dat: tyLeTre <= loiToiDa };
}

/**
 * THUẦN: chấm KPI từng nhóm SOP (kèm chi tiết từng nước trong nhóm). Nước trong `NUOC_LOAI_TRU` bị bỏ khỏi mọi phép tính.
 * Nhóm không có kiện nào trong kỳ vẫn xuất hiện với dat = null để đội thấy tuyến đó chưa có dữ liệu.
 */
export function chamKpi(kien: readonly KienGiao[], nguong = NGUONG_NGOAI_LE_SOP): DongKpiNhom[] {
  const hopLe = kien.filter((k) => !(k.country.toUpperCase() in NUOC_LOAI_TRU));
  return NHOM_SOP.map((nhom) => {
    const cua = hopLe.filter((k) => nhomCuaNuoc(k.country) === nhom);
    const nuocs = [...new Set(cua.map((k) => k.country.toUpperCase()))];
    const theoNuoc = nuocs
      .map((country) => ({ country, ...cham(cua.filter((k) => k.country.toUpperCase() === country), nhom.slaNgay, nhom.loiToiDa, nguong) }))
      .sort((a, b) => b.n - a.n);
    return { nhom, ...cham(cua, nhom.slaNgay, nhom.loiToiDa, nguong), theoNuoc };
  });
}

/** Gộp mọi nhóm thành một dòng tổng — dùng cho thẻ KPI chung của đội. */
export function tongKpi(dong: readonly DongKpiNhom[]): DiemKpi & { soNhomDat: number; soNhomCham: number } {
  const n = dong.reduce((s, d) => s + d.n, 0);
  const dungHan = dong.reduce((s, d) => s + d.dungHan, 0);
  const treVanChuyen = dong.reduce((s, d) => s + d.treVanChuyen, 0);
  const ngoaiLe = dong.reduce((s, d) => s + d.ngoaiLe, 0);
  const cham = dong.filter((d) => d.dat === false).length;
  return {
    n, dungHan, treVanChuyen, ngoaiLe,
    tyLeDungHan: n > 0 ? dungHan / n : null,
    tyLeTre: n > 0 ? (n - dungHan) / n : null,
    dat: n > 0 ? cham === 0 : null,
    soNhomDat: dong.filter((d) => d.dat === true).length,
    soNhomCham: cham,
  };
}
