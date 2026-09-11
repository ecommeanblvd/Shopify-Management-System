/**
 * THUẦN: kiểu dữ liệu + luật xếp loại cho REPORT CHI TIẾT từng tiêu chí Pillar 1
 * (CEO 11/09/2026 — "cần có report cụ thể", muốn xem đơn nào đạt, đơn nào không).
 *
 * Luật xếp loại ở đây PHẢI khớp đúng cách chấm điểm trong `sop-giao-hang.ts` và
 * `lech-can.ts`, nếu không bảng chi tiết sẽ nói khác con số KPI. Có test canh.
 */
import { NGUONG_NGOAI_LE_SOP } from '@/features/shipments/sop-giao-hang';

export type MaTieuChi = '1.1' | '1.2' | '1.3' | '1.4';

export const TEN_TIEU_CHI: Record<MaTieuChi, string> = {
  '1.1': 'Bảo toàn tiền cước',
  '1.2': 'SLA thời gian giao hàng',
  '1.3': 'Đơn giao hoàn hảo',
  '1.4': 'Tuân thủ bảng tra size thùng',
};

/** 1.2 — mỗi kiện rơi vào đúng MỘT nhóm, khớp hàm `cham()` của SOP. */
export type KetQuaSla = 'dat' | 'tre' | 'ngoai_le' | 'loai_tru';
export const NHAN_KET_QUA_SLA: Record<KetQuaSla, string> = {
  dat: 'Đạt',
  tre: 'Trễ',
  ngoai_le: 'Trễ nặng (> 20 ngày)',
  loai_tru: 'Loại khỏi KPI',
};

/**
 * Xếp loại một kiện theo đúng luật chấm: kiện bị loại (lý do ngoài tầm kiểm soát
 * hoặc nước không tính) đứng riêng và KHÔNG vào mẫu số; còn lại so với cam kết,
 * quá ngưỡng ngoại lệ thì tách ra để thấy kiện hỏng nặng.
 */
export function xepLoaiSla(
  soNgay: number, slaNgay: number, biLoaiTru: boolean, nguong = NGUONG_NGOAI_LE_SOP,
): KetQuaSla {
  if (biLoaiTru) return 'loai_tru';
  if (soNgay <= slaNgay) return 'dat';
  return soNgay <= nguong ? 'tre' : 'ngoai_le';
}

export interface DongAmCuoc {
  maDon: string | null;
  nuoc: string | null;
  ngayGui: string | null;
  /** Cước KHÁCH trả, quy về VND. */
  thuKhachVnd: number;
  /** Cước carrier bill thật, VND — số GỐC trên hoá đơn. */
  carrierVnd: number;
  /** Tiền carrier đã trả lại cho kiện của đơn này (credit note đã ghi nhận). */
  thuHoiVnd: number;
  /** carrierVnd − thuHoiVnd: giá vốn THẬT sau giảm trừ. */
  carrierRongVnd: number;
  /** carrierRongVnd − thuKhachVnd. Dương = vẫn còn âm cước sau khi trừ credit. */
  chenhVnd: number;
  /** Kết luận đối soát đã chốt (nếu có): ai sai. */
  phanDinh: string | null;
  /** Số credit note đã ghi cho kiện của đơn, nếu có. */
  soCreditNote: string | null;
}

/**
 * Giá vốn thật của một đơn sau khi trừ tiền carrier đã trả lại, và phần còn âm.
 * Đơn đã được credit phải tính trên số RÒNG — nếu không, một đơn đã đòi lại được
 * gần hết tiền vẫn bị đếm là âm cước và bị quy trách nhiệm oan (CEO 11/09/2026).
 */
export function chenhSauThuHoi(carrierVnd: number, thuHoiVnd: number, thuKhachVnd: number): { carrierRongVnd: number; chenhVnd: number; conAm: boolean } {
  const carrierRongVnd = Math.round(carrierVnd - thuHoiVnd);
  const chenhVnd = Math.round(carrierRongVnd - thuKhachVnd);
  return { carrierRongVnd, chenhVnd, conAm: chenhVnd > 0 };
}

export interface DongSla {
  maDon: string | null;
  tracking: string | null;
  nuoc: string;
  line: string;
  ngayGui: string;
  ngayGiao: string;
  soNgay: number;
  /** Cam kết của NƯỚC — đây là thước CHẤM ĐIỂM, khớp `tongKpi` (cộng theo mức nước). */
  slaNgay: number;
  /** Thước nội bộ của hãng trên tuyến đó, có thể chặt hơn mức nước. CHỈ để tham khảo,
   *  không dùng chấm điểm — nếu dùng sẽ ra số khác bảng KPI. */
  slaLineNgay: number;
  ketQua: KetQuaSla;
  lyDoCham: string | null;
}

export interface DongChungTu {
  maDon: string | null;
  tracking: string | null;
  nuoc: string | null;
  ngayGui: string | null;
  phiSuaDiaChiVnd: number;
  tongBillVnd: number;
}

export interface DongSizeThung {
  maDon: string | null;
  tracking: string | null;
  ngayGui: string | null;
  canThucKg: number | null;
  canQuyDoiKg: number | null;
  canTinhCuocKg: number | null;
  canBillKg: number | null;
  /** canBillKg − canTinhCuocKg. Dương = carrier tính nặng hơn mình dự tính. */
  lechKg: number | null;
  phanLoai: 'dung' | 'sai_thung' | 'nhe_hon' | 'thieu_du_lieu';
}

export interface ChiTietKpi {
  ma: MaTieuChi;
  tu: string;
  den: string;
  /** Câu giải thích cách đo, hiện ngay trên bảng để người bị chấm biết số ở đâu ra. */
  cachDo: string;
  amCuoc?: DongAmCuoc[];
  sla?: DongSla[];
  chungTu?: DongChungTu[];
  sizeThung?: DongSizeThung[];
}

/** Câu nhắc phạm vi, gắn vào mọi tiêu chí để không ai hiểu nhầm là gồm cả brand khác. */
export const PHAM_VI = 'Chỉ tính đơn của MEAN BLVD. Đơn brand khác (Tinh Atelier) đi luồng ship hộ và được đối chiếu tiền bill với tiền thu ở phần ship hộ.';

export const CACH_DO: Record<MaTieuChi, string> = {
  '1.1': 'Đơn có cước carrier RÒNG (bill trừ tiền đã đòi lại được bằng credit note) vẫn lớn hơn cước thu của khách, tính theo kiện gửi trong kỳ. Đơn đã được carrier trả lại đủ tiền sẽ tự rời danh sách. Cột Phân định là kết luận đối soát đã chốt; chỉ đơn được chốt là lỗi nội bộ mới bị trừ KPI, đơn do hãng sai hoặc chưa xét thì không.',
  '1.2': 'Mọi kiện GỬI trong kỳ và ĐÃ giao xong. Số ngày tính từ lúc tạo vận đơn tới lúc khách nhận. Cam kết lấy theo nước, hãng nào có thước riêng thì theo hãng. Kiện có lý do chậm ngoài tầm kiểm soát bị loại khỏi mẫu số theo mục VII.',
  '1.3': 'Kiện phát sinh phí sửa địa chỉ trên hoá đơn carrier — dấu hiệu nhập sai hoặc thiếu thông tin người nhận. Mẫu số là toàn bộ kiện có hoá đơn trong kỳ.',
  '1.4': 'So cân mình tự tính (lớn hơn giữa cân thực và cân quy đổi kích thước) với cân carrier thật sự charge. Lệch từ 0,5 kg trở lên coi là chọn sai thùng, vì thùng chật phồng ra làm tăng cân quy đổi.',
};

/** Đếm theo kết quả để hiện dòng tóm tắt trên đầu bảng chi tiết. */
export function demKetQuaSla(dong: readonly DongSla[]): Record<KetQuaSla, number> & { tinhKpi: number; tyLeDat: number | null } {
  const d = { dat: 0, tre: 0, ngoai_le: 0, loai_tru: 0 } as Record<KetQuaSla, number>;
  for (const x of dong) d[x.ketQua] += 1;
  const tinhKpi = d.dat + d.tre + d.ngoai_le;
  return { ...d, tinhKpi, tyLeDat: tinhKpi > 0 ? d.dat / tinhKpi : null };
}
