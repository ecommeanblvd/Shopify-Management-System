/**
 * THUẦN: đối chiếu LÝ DO GIAO CHẬM với lịch sử quét UPS (CEO 17/09/2026).
 *
 * Cùng nguyên tắc với FedEx (doi-chieu-fedex.ts): lý do chỉ loại kiện khỏi KPI khi hãng có sự
 * kiện tương ứng. UPS không công bố bảng mã ngoại lệ ổn định như FedEx nên luật đọc MÔ TẢ, và
 * CHỈ trên sự kiện ngoại lệ (loại X). Sự kiện thường như "Clearance in progress" có trên mọi kiện
 * quốc tế — tính nó thì lý do hải quan kiện nào cũng khớp.
 *
 * Nhãn chưa từng gửi: chỉ có sự kiện M (manifest) / MV (nhãn huỷ), không có quét nào khác.
 * Giấy tờ thông quan thiếu vẫn là lỗi nội bộ ở cả hai đầu — không làm bằng chứng hải quan giữ.
 */
import type { DoiChieu, SuKienQuet } from './doi-chieu-fedex';

const THIEU_GIAY_TO = /invoice|document|paperwork|importer|registration|identification|tax ?id|description of (the )?goods|commodity information/i;

const LUAT: Record<string, RegExp> = {
  khach_khong_lien_he: /not available|business (was )?closed|unable to (contact|reach)|no one (was )?(available|home)/i,
  khach_hen_lai: /request(ed)? .*(deliver|date|hold|pick ?up)|(delivery|date) change|rescheduled|access point/i,
  sai_dia_chi_khach: /address.*(incorrect|incomplete|invalid|insufficient)|(incorrect|incomplete|invalid) .*address/i,
  khach_khong_dong_thue: /(duties|duty|taxes|tax|brokerage|charges|payment).*(due|required|not (been )?(paid|received)|outstanding|collect)/i,
  khach_tu_choi_nhan: /refus/i,
  thong_quan_ngoai: /customs|clearance|government agency|regulatory/i,
  thien_tai_ha_tang: /weather|natural disaster|emergency|civil unrest|mechanical|flight .*(delay|cancel)|service disruption|conditions beyond/i,
};

export const coLuatDoiChieuUps = (maLyDo: string | null | undefined): boolean =>
  !!maLyDo && (maLyDo in LUAT || maLyDo === 'khong_gui_hang');

const loai = (e: SuKienQuet) => (e.eventType ?? '').toUpperCase();
const chu = (e: SuKienQuet) => (e.exceptionDescription || e.eventDescription || '').trim();
const bangChungTu = (e: SuKienQuet) =>
  ['UPS', loai(e), e.exceptionCode, chu(e), e.date?.slice(0, 10)].filter(Boolean).join(' · ');

export function doiChieuUps(maLyDo: string, suKien: readonly SuKienQuet[]): DoiChieu {
  if (maLyDo === 'khong_gui_hang') {
    const khac = suKien.find((e) => !['M', 'MV'].includes(loai(e)));
    if (khac) return { ketQua: 'khong_thay', bangChung: null, canhBao: `UPS đã quét kiện — hàng đã đi: ${bangChungTu(khac)}` };
    const nhan = suKien.find((e) => ['M', 'MV'].includes(loai(e)));
    return nhan
      ? { ketQua: 'xac_nhan', bangChung: `Chỉ có nhãn, chưa từng quét: ${bangChungTu(nhan)}` }
      : { ketQua: 'khong_thay', bangChung: null };
  }
  const re = LUAT[maLyDo];
  if (!re) return { ketQua: 'khong_kiem_duoc', bangChung: 'Lý do này không có luật đối chiếu' };
  const ngoaiLe = suKien.filter((e) => loai(e) === 'X');
  const laHaiQuan = maLyDo.startsWith('thong_quan');
  const thieuGiayTo = laHaiQuan ? ngoaiLe.find((e) => THIEU_GIAY_TO.test(chu(e))) : undefined;
  const trung = ngoaiLe.find((e) => re.test(chu(e)) && !(laHaiQuan && THIEU_GIAY_TO.test(chu(e))));
  const canhBao = thieuGiayTo ? `UPS ghi nhận thiếu giấy tờ thông quan — lỗi nội bộ: ${bangChungTu(thieuGiayTo)}` : null;
  if (trung) return { ketQua: 'xac_nhan', bangChung: bangChungTu(trung), canhBao };
  return { ketQua: 'khong_thay', bangChung: null, canhBao };
}
