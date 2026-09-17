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
 *   CD / SE giữ hàng ở hải quan, KHÔNG vì giấy tờ            → hải quan giữ hàng
 *   84 "may be late - local delivery restrictions", thời tiết → hạ tầng / thiên tai
 *     (CEO 16/09/2026 xác nhận 84 là hãng gặp sự cố thật nên chuyển chậm)
 *
 *   CHỈ có sự kiện OC "Label created", không có quét nào khác → nhãn chưa từng gửi (đơn test/huỷ)
 *
 * GIẤY TỜ THÔNG QUAN THIẾU là lỗi nội bộ ở CẢ HAI ĐẦU (CEO 16/09/2026). Vì vậy mọi sự kiện hải
 * quan đòi giấy tờ — R0055/R0056 yêu cầu từ nhà nhập khẩu, R0142 mô tả hàng không đủ, hay mô tả
 * nhắc tới giấy tờ — KHÔNG làm bằng chứng cho "hải quan giữ hàng", và còn bật cảnh báo.
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

/** Hải quan giữ vì THIẾU GIẤY TỜ — ở đầu nào cũng là lỗi nội bộ. */
const THIEU_GIAY_TO = {
  ma: ['R0055', 'R0056', 'R0142'],
  moTa: /description provided|commercial invoice|shipper|importer|registration|identification number|documentation|document/i,
};

const LUAT: Record<string, Luat> = {
  khach_khong_lien_he: { ma: ['08', '42'] },
  khach_hen_lai: { ma: ['17', '08', 'A12', 'A13'] },
  sai_dia_chi_khach: { ma: ['03'] },
  khach_khong_dong_thue: { ma: ['93'] },
  khach_tu_choi_nhan: { ma: ['07'] },
  thong_quan_ngoai: { eventType: ['CD', 'SE'], tru: THIEU_GIAY_TO },
  thien_tai_ha_tang: { ma: ['84'], moTa: /weather|natural disaster|emergency|civil unrest|restrictions/i },
};

/** Lý do đối chiếu bằng cách KHÔNG có gì xảy ra, thay vì tìm một sự kiện. */
const LUAT_DAC_BIET = new Set(['khong_gui_hang']);

/** Lý do này có luật đối chiếu FedEx không (lý do không loại trừ thì không cần đối chiếu). */
export const coLuatDoiChieu = (maLyDo: string | null | undefined): boolean =>
  !!maLyDo && (maLyDo in LUAT || LUAT_DAC_BIET.has(maLyDo));

/**
 * Nhãn chưa từng gửi: có ít nhất một sự kiện OC ("Shipment information sent to FedEx" / Label
 * created) và KHÔNG có sự kiện nào khác. Chỉ một lần quét lấy hàng thôi là hàng đã đi thật.
 */
function doiChieuKhongGuiHang(suKien: readonly SuKienQuet[]): DoiChieu {
  const khac = suKien.find((e) => (e.eventType ?? '').toUpperCase() !== 'OC');
  if (khac) {
    return { ketQua: 'khong_thay', bangChung: null, canhBao: `FedEx đã quét kiện — hàng đã đi: ${bangChungTu(khac)}` };
  }
  const oc = suKien.find((e) => (e.eventType ?? '').toUpperCase() === 'OC');
  if (!oc) return { ketQua: 'khong_thay', bangChung: null };
  return { ketQua: 'xac_nhan', bangChung: `Chỉ có nhãn, chưa từng quét: ${bangChungTu(oc)}` };
}

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
  if (maLyDo === 'khong_gui_hang') return doiChieuKhongGuiHang(suKien);
  const l = LUAT[maLyDo];
  if (!l) return { ketQua: 'khong_kiem_duoc', bangChung: 'Lý do này không có luật đối chiếu' };
  const trung = suKien.find((e) => khop(l, e));
  const thieuGiayTo = maLyDo.startsWith('thong_quan')
    ? suKien.find((e) => THIEU_GIAY_TO.ma.includes(ma(e)) || (ma(e) !== '' && THIEU_GIAY_TO.moTa.test(chu(e))))
    : undefined;
  const canhBao = thieuGiayTo ? `FedEx ghi nhận thiếu giấy tờ thông quan — lỗi nội bộ: ${bangChungTu(thieuGiayTo)}` : null;
  if (trung) return { ketQua: 'xac_nhan', bangChung: bangChungTu(trung), canhBao };
  return { ketQua: 'khong_thay', bangChung: null, canhBao };
}
