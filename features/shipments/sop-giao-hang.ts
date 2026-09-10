/**
 * SOP thời gian giao hàng + chấm KPI đội logistics (CEO 10/09/2026, siết lại 10/09/2026 chiều).
 *
 * Nguyên tắc CEO chốt: **số ngày cam kết phải đúng bằng số nói với khách** nên phải ngắn như một tuyến express — không
 * lấy mức dễ đạt. Bù lại, tỉ lệ lỗi cho phép mở rộng lúc đầu rồi siết dần theo quý (`LO_TRINH_LOI`), để đội có đường đi
 * lên thay vì bị đánh trượt ngay.
 *
 * Hai tầng cam kết:
 *   - `slaNgay` của NƯỚC = con số nói với khách (trung bình cả tuyến, không phân biệt hãng);
 *   - `theoLine` = mức nội bộ của từng hãng trên chính tuyến đó. Aramex nhanh hơn hẳn ở Vùng Vịnh nên phải bị chấm
 *     bằng thước riêng, không núp sau mức chung.
 *
 * Mức lấy từ phân bố thật 2026 (xem tab "Tiêu chuẩn giao"), đặt quanh mức hiện đạt 65–85 % — tức phải cải thiện mới đạt.
 * KPI = tỉ lệ kiện giao trong ≤ SLA trên tổng kiện ĐÃ GHI NHẬN GIAO của kỳ. Kiện quá `NGUONG_NGOAI_LE_SOP` ngày vẫn tính
 * là trễ (tách riêng chỉ để quy nguyên nhân — D-065/D-067).
 */

export const NGUONG_NGOAI_LE_SOP = 20;
export const NUOC_LOAI_TRU: Record<string, string> = {
  VN: 'Tuyến nội địa, dữ liệu ngày giao chưa tin được (ops đánh dấu hàng loạt)',
};

/** Lộ trình siết tỉ lệ lỗi: rộng lúc khởi động rồi giảm dần theo quý. Áp theo NGÀY BẮT ĐẦU kỳ chấm. */
export const LO_TRINH_LOI: Array<{ tu: string; loiToiDa: number; nhan: string }> = [
  { tu: '2026-01-01', loiToiDa: 0.35, nhan: 'Khởi động — hết Q4/2026' },
  { tu: '2027-01-01', loiToiDa: 0.28, nhan: 'Q1/2027' },
  { tu: '2027-04-01', loiToiDa: 0.22, nhan: 'Q2/2027' },
  { tu: '2027-07-01', loiToiDa: 0.15, nhan: 'Q3/2027' },
  { tu: '2027-10-01', loiToiDa: 0.10, nhan: 'Từ Q4/2027' },
];

/** Mức lỗi tối đa áp cho một ngày (ISO). Trước mốc đầu tiên thì dùng chính mốc đầu. */
export function loiToiDaTaiNgay(ngayISO: string): { loiToiDa: number; nhan: string } {
  let ap = LO_TRINH_LOI[0];
  for (const m of LO_TRINH_LOI) if (ngayISO >= m.tu) ap = m;
  return { loiToiDa: ap.loiToiDa, nhan: ap.nhan };
}

/** Mức mặc định theo miền, dùng cho nước chưa đủ dữ liệu để đặt riêng. */
export interface MienSop { ma: string; ten: string; nuoc: string[]; slaNgay: number }
export const MIEN_SOP: MienSop[] = [
  { ma: 'chau-a', ten: 'Châu Á', slaNgay: 5, nuoc: ['HK', 'SG', 'JP', 'MY', 'TW', 'PH', 'KR', 'ID', 'TH', 'KH', 'LA', 'BN', 'MO', 'CN', 'IN'] },
  { ma: 'bac-my-anh-uc', ten: 'Bắc Mỹ · Anh · Úc', slaNgay: 6, nuoc: ['US', 'CA', 'GB', 'AU', 'NZ', 'MX'] },
  { ma: 'chau-au', ten: 'Châu Âu', slaNgay: 6, nuoc: ['DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'CH', 'PT', 'AT', 'DK', 'SE', 'NO', 'IE', 'FI', 'LU', 'GR', 'CZ', 'PL', 'HU', 'RO', 'BG', 'HR', 'SK', 'SI', 'LT', 'LV', 'EE', 'CY', 'MT', 'IS'] },
  { ma: 'vung-vinh', ten: 'Vùng Vịnh · Trung Đông', slaNgay: 7, nuoc: ['AE', 'SA', 'QA', 'KW', 'BH', 'IL', 'OM', 'JO', 'EG', 'LB', 'TR'] },
  { ma: 'khac', ten: 'Các nước còn lại', slaNgay: 10, nuoc: [] },
];
const MIEN_THEO_NUOC = new Map<string, MienSop>(MIEN_SOP.flatMap((m) => m.nuoc.map((cc) => [cc, m] as const)));
const MIEN_CUOI = MIEN_SOP[MIEN_SOP.length - 1];
export const mienCuaNuoc = (cc: string): MienSop => MIEN_THEO_NUOC.get(cc.trim().toUpperCase()) ?? MIEN_CUOI;

export interface CamKetNuoc {
  /** Số ngày nói với khách cho tuyến này. */
  slaNgay: number;
  /** Mức nội bộ từng hãng; hãng không khai thì chấm bằng `slaNgay` của nước. */
  theoLine?: Record<string, number>;
  /** Căn cứ đặt mức (hiện trên UI). */
  canCu: string;
}

/**
 * Cam kết từng nước — chỉ khai nước đã đủ dữ liệu 2026 (≥10 kiện đã giao). Nước khác dùng mức của miền.
 * Số trong `theoLine` luôn ≤ `slaNgay` khi hãng đó nhanh hơn mặt bằng tuyến.
 */
export const CAM_KET_NUOC: Record<string, CamKetNuoc> = {
  HK: { slaNgay: 3, canCu: 'FedEx đang giao 90 % trong 3 ngày' },
  SG: { slaNgay: 4, canCu: 'FedEx 83 % · DHL 88 % trong 4 ngày' },
  JP: { slaNgay: 4, theoLine: { dhl: 3 }, canCu: 'FedEx 76 % trong 4 ngày; DHL 76 % trong 3 ngày' },
  MY: { slaNgay: 4, canCu: 'FedEx 82 % · DHL 89 % trong 4 ngày' },
  TW: { slaNgay: 4, canCu: 'FedEx 70 % trong 4 ngày, 100 % trong 5' },
  PH: { slaNgay: 4, canCu: 'FedEx 73 % · DHL 89 % trong 4 ngày' },
  US: { slaNgay: 5, canCu: 'FedEx 79 % · DHL 82 % trong 5 ngày' },
  CA: { slaNgay: 5, theoLine: { dhl: 4 }, canCu: 'FedEx 83 % trong 5 ngày; DHL 80 % trong 4 ngày' },
  GB: { slaNgay: 5, theoLine: { dhl: 4 }, canCu: 'FedEx 73 % trong 5 ngày; DHL 76 % trong 4 ngày' },
  AU: { slaNgay: 5, canCu: 'FedEx 71 % · DHL 87 % trong 5 ngày' },
  DE: { slaNgay: 5, theoLine: { dhl: 4 }, canCu: 'FedEx 86 % trong 5 ngày; DHL 75 % trong 4 ngày' },
  ES: { slaNgay: 5, canCu: 'FedEx 80 % trong 5 ngày' },
  FR: { slaNgay: 6, canCu: 'FedEx 73 % trong 6 ngày (tuyến chậm nhất Tây Âu)' },
  PT: { slaNgay: 6, canCu: 'FedEx 71 % trong 5 ngày, 86 % trong 7' },
  AE: { slaNgay: 6, theoLine: { aramex: 4 }, canCu: 'FedEx 75 % trong 6 ngày; Aramex 60 % trong 4, 90 % trong 6' },
  SA: { slaNgay: 7, theoLine: { aramex: 4 }, canCu: 'FedEx 65 % · DHL 68 % trong 7 ngày; Aramex 83 % trong 4 ngày' },
  QA: { slaNgay: 7, theoLine: { aramex: 4 }, canCu: 'FedEx 65 % trong 7 ngày; Aramex 75 % trong 4 ngày' },
  KW: { slaNgay: 7, theoLine: { aramex: 5 }, canCu: 'FedEx 63 % trong 7 ngày; Aramex 78 % trong 5 ngày' },
  BH: { slaNgay: 7, canCu: 'FedEx 75 % trong 7 ngày' },
  IL: { slaNgay: 8, theoLine: { aramex: 6 }, canCu: 'FedEx 80 % trong 8 ngày (tuyến chậm nhất); Aramex 50 % trong 6' },
};

/** Cam kết với khách cho một nước. */
export function slaCuaNuoc(cc: string): number {
  const k = cc.trim().toUpperCase();
  return CAM_KET_NUOC[k]?.slaNgay ?? mienCuaNuoc(k).slaNgay;
}
/** Cam kết nội bộ của một hãng trên tuyến đó; không khai riêng thì bằng mức của nước. */
export function slaCuaLine(cc: string, line: string): number {
  const k = cc.trim().toUpperCase();
  return CAM_KET_NUOC[k]?.theoLine?.[line.trim().toLowerCase()] ?? slaCuaNuoc(k);
}

export interface KienGiao { country: string; line: string; soNgay: number }

export interface DiemKpi {
  n: number; dungHan: number; treVanChuyen: number; ngoaiLe: number;
  tyLeDungHan: number | null; tyLeTre: number | null; dat: boolean | null;
}
export interface DongKpiLine extends DiemKpi { line: string; slaNgay: number }
export interface DongKpiNuoc extends DiemKpi { country: string; slaNgay: number; canCu: string | null; theoLine: DongKpiLine[] }

function cham(kien: readonly KienGiao[], sla: number, loiToiDa: number, nguong: number): DiemKpi {
  const n = kien.length;
  let dungHan = 0, treVanChuyen = 0, ngoaiLe = 0;
  for (const k of kien) {
    if (k.soNgay <= sla) dungHan += 1;
    else if (k.soNgay <= nguong) treVanChuyen += 1;
    else ngoaiLe += 1;
  }
  if (n === 0) return { n, dungHan, treVanChuyen, ngoaiLe, tyLeDungHan: null, tyLeTre: null, dat: null };
  const tyLeTre = (n - dungHan) / n;
  return { n, dungHan, treVanChuyen, ngoaiLe, tyLeDungHan: dungHan / n, tyLeTre, dat: tyLeTre <= loiToiDa };
}

/**
 * THUẦN: chấm KPI theo NƯỚC (mức cam kết với khách) và trong mỗi nước theo TỪNG HÃNG (mức nội bộ của hãng).
 * `ngayKy` (ISO) quyết định mức lỗi tối đa lấy từ `LO_TRINH_LOI`. Nước trong `NUOC_LOAI_TRU` bị bỏ.
 */
export function chamKpi(kien: readonly KienGiao[], ngayKy: string, nguong = NGUONG_NGOAI_LE_SOP): DongKpiNuoc[] {
  const { loiToiDa } = loiToiDaTaiNgay(ngayKy);
  const hopLe = kien.filter((k) => !(k.country.trim().toUpperCase() in NUOC_LOAI_TRU));
  const nuocs = [...new Set(hopLe.map((k) => k.country.trim().toUpperCase()))];
  return nuocs
    .map((country) => {
      const cua = hopLe.filter((k) => k.country.trim().toUpperCase() === country);
      const sla = slaCuaNuoc(country);
      const lines = [...new Set(cua.map((k) => k.line.trim().toLowerCase()))];
      const theoLine = lines
        .map((line) => ({
          line, slaNgay: slaCuaLine(country, line),
          ...cham(cua.filter((k) => k.line.trim().toLowerCase() === line), slaCuaLine(country, line), loiToiDa, nguong),
        }))
        .sort((a, b) => b.n - a.n);
      return { country, slaNgay: sla, canCu: CAM_KET_NUOC[country]?.canCu ?? null, ...cham(cua, sla, loiToiDa, nguong), theoLine };
    })
    .sort((a, b) => b.n - a.n);
}

/** Gộp mọi nước thành một dòng tổng cho thẻ KPI chung. */
export function tongKpi(dong: readonly DongKpiNuoc[], ngayKy: string): DiemKpi & { soNuocDat: number; soNuocCham: number; loiToiDa: number } {
  const { loiToiDa } = loiToiDaTaiNgay(ngayKy);
  const n = dong.reduce((s, d) => s + d.n, 0);
  const dungHan = dong.reduce((s, d) => s + d.dungHan, 0);
  const cham = dong.filter((d) => d.dat === false).length;
  const tyLeTre = n > 0 ? (n - dungHan) / n : null;
  return {
    n, dungHan,
    treVanChuyen: dong.reduce((s, d) => s + d.treVanChuyen, 0),
    ngoaiLe: dong.reduce((s, d) => s + d.ngoaiLe, 0),
    tyLeDungHan: n > 0 ? dungHan / n : null,
    tyLeTre,
    dat: tyLeTre == null ? null : tyLeTre <= loiToiDa,
    soNuocDat: dong.filter((d) => d.dat === true).length,
    soNuocCham: cham,
    loiToiDa,
  };
}
