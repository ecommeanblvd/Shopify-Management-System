/**
 * THUẦN: đối chiếu LÝ DO GIAO CHẬM với lịch sử quét của FedEx (CEO 16/09/2026).
 *
 * Vì sao: lý do chậm do chính người bị chấm gán, và lý do "ngoài tầm kiểm soát" rút kiện khỏi mẫu
 * số KPI 1.2. Sáng 16/09 một lượt gán 58 kiện đẩy SLA T8 từ 83,3% lên 95,1%. Từ nay lý do chỉ
 * được loại kiện khi FedEx có sự kiện tương ứng — dữ liệu của hãng làm bằng chứng, không cần ai
 * duyệt tay.
 *
 * Luật đối chiếu bằng MÃ NGOẠI LỆ của FedEx (exceptionCode), hiệu chỉnh trên 60 kiện thật T8:
 *   DE 08 "Customer not available or business closed"      → không liên hệ được / vắng nhà
 *   DE 42 "Business closed - No delivery attempt"            → không liên hệ được
 *   DE 17 "A request was made to change this delivery date"  → khách hẹn lại
 *   RR A12 / HA A13  giữ hàng / chuyển điểm nhận theo yêu cầu → khách hẹn lại
 *   DE 03 "Incorrect address"                                → địa chỉ khách sai
 *   DE 93 "Held, unable to collect payment"                  → khách không đóng thuế
 *   DE 07 "Delivery was refused by the recipient"            → khách từ chối
 *   CD R0055/R0056 yêu cầu từ NHÀ NHẬP KHẨU                  → thiếu giấy tờ đầu nhập
 *   CD / SE giữ hàng ở hải quan                              → hải quan giữ hàng
 *   84 "may be late - local delivery restrictions", thời tiết → hạ tầng / thiên tai
 * R0142 "Description provided is insufficient to classify commodity" là lỗi chứng từ ĐẦU XUẤT
 * của mình — KHÔNG bao giờ làm bằng chứng cho lý do thông quan được loại trừ.
 */

export interface SuKienQuet {
  date?: string | null;
  eventType?: string | null;
  eventDescription?: string | null;
  exceptionCode?: string | null;
  exceptionDescription?: string | null;
}

export type KetQuaDoiChieu = 'xac_nhan' | 'khong_thay' | 'khong_kiem_duoc';

export interface DoiChieu {
  ketQua: KetQuaDoiChieu;
  /** Sự kiện FedEx làm bằng chứng, hoặc lý do không kiểm được. */
  bangChung: string | null;
  /** FedEx cho thấy điều NGƯỢC với lý do đã gán — hiện cho người xem. */
  canhBao?: string | null;
}

interface Luat {
  ma?: string[];
  eventType?: string[];
  moTa?: RegExp;
  /** Mã / mô tả KHÔNG được tính dù khớp eventType. */
  tru?: { ma?: string[]; moTa?: RegExp };
}

/** Mã và mô tả cho thấy lỗi chứng từ của CHÍNH MÌNH (đầu xuất). */
const LOI_CHUNG_TU_MINH = { ma: ['R0142'], moTa: /description provided|commercial invoice|shipper/i };

const LUAT: Record<string, Luat> = {
  khach_khong_lien_he: { ma: ['08', '42'] },
  khach_hen_lai: { ma: ['17', '08', 'A12', 'A13'] },
  sai_dia_chi_khach: { ma: ['03'] },
  khach_khong_dong_thue: { ma: ['93'] },
  khach_tu_choi_nhan: { ma: ['07'] },
  thong_quan_thieu_ct_nhap: { ma: ['R0055', 'R0056'], moTa: /importer/i, tru: LOI_CHUNG_TU_MINH },
  thong_quan_ngoai: { eventType: ['CD', 'SE'], tru: LOI_CHUNG_TU_MINH },
  thien_tai_ha_tang: { ma: ['84'], moTa: /weather|natural disaster|emergency|civil unrest|restrictions/i },
};

/** Lý do này có luật đối chiếu FedEx không (lý do không loại trừ thì không cần đối chiếu). */
export const coLuatDoiChieu = (maLyDo: string | null | undefined): boolean => !!maLyDo && maLyDo in LUAT;

const chu = (e: SuKienQuet) => (e.exceptionDescription || e.eventDescription || '').trim();
const ma = (e: SuKienQuet) => (e.exceptionCode ?? '').trim().toUpperCase();

function bangChungTu(e: SuKienQuet): string {
  return [e.eventType, ma(e), chu(e), e.date?.slice(0, 10)].filter(Boolean).join(' · ');
}

function khop(l: Luat, e: SuKienQuet): boolean {
  const m = ma(e);
  const t = chu(e);
  if (l.tru && ((l.tru.ma ?? []).includes(m) || (l.tru.moTa?.test(t) ?? false))) return false;
  if (l.ma?.includes(m)) return true;
  if (l.eventType?.includes((e.eventType ?? '').toUpperCase())) return true;
  // Mô tả chỉ tính khi sự kiện là ngoại lệ thật (có mã) — tránh khớp câu chào thông thường.
  if (l.moTa && m && l.moTa.test(t)) return true;
  return false;
}

/** Đối chiếu một lý do với lịch sử quét của một kiện. */
export function doiChieuFedex(maLyDo: string, suKien: readonly SuKienQuet[]): DoiChieu {
  const l = LUAT[maLyDo];
  if (!l) return { ketQua: 'khong_kiem_duoc', bangChung: 'Lý do này không có luật đối chiếu' };
  const trung = suKien.find((e) => khop(l, e));
  const loiMinh = maLyDo.startsWith('thong_quan')
    ? suKien.find((e) => LOI_CHUNG_TU_MINH.ma.includes(ma(e)) || (ma(e) !== '' && LOI_CHUNG_TU_MINH.moTa.test(chu(e))))
    : undefined;
  const canhBao = loiMinh ? `FedEx ghi nhận lỗi chứng từ đầu xuất: ${bangChungTu(loiMinh)}` : null;
  if (trung) return { ketQua: 'xac_nhan', bangChung: bangChungTu(trung), canhBao };
  return { ketQua: 'khong_thay', bangChung: null, canhBao };
}
