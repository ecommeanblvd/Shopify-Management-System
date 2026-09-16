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
export type KetQuaSla = 'dat' | 'tre' | 'ngoai_le' | 'loai_tru' | 'chua_den_han';
export const NHAN_KET_QUA_SLA: Record<KetQuaSla, string> = {
  dat: 'Đạt',
  tre: 'Trễ',
  ngoai_le: 'Trễ nặng (> 20 ngày)',
  loai_tru: 'Loại khỏi KPI',
  chua_den_han: 'Chưa tới hạn',
};

/**
 * Xếp loại một kiện theo đúng luật chấm: kiện bị loại (lý do ngoài tầm kiểm soát
 * hoặc nước không tính) đứng riêng và KHÔNG vào mẫu số; còn lại so với cam kết,
 * quá ngưỡng ngoại lệ thì tách ra để thấy kiện hỏng nặng.
 */
export function xepLoaiSla(
  soNgay: number, slaNgay: number, biLoaiTru: boolean, nguong = NGUONG_NGOAI_LE_SOP,
  chuaGiao = false,
): KetQuaSla {
  if (biLoaiTru) return 'loai_tru';
  // Kiện CHƯA GIAO: còn trong hạn thì chưa biết gì, đứng ngoài cả tử số lẫn mẫu số; quá hạn rồi
  // thì chắc chắn trễ, không cứu được nữa (CEO 13/09/2026).
  if (chuaGiao) return soNgay <= slaNgay ? 'chua_den_han' : (soNgay <= nguong ? 'tre' : 'ngoai_le');
  if (soNgay <= slaNgay) return 'dat';
  return soNgay <= nguong ? 'tre' : 'ngoai_le';
}

export interface GiaiTrinhDaLuu {
  lyDo: string;
  thuocVe: string;
  chiTiet: import('./giai-trinh-am-cuoc').ChiTietGiaiTrinh;
  ghiChu: string | null;
  /** 'tay' hoặc 'excel' (nạp từ bảng của Đức). */
  nguon: string;
  capNhat: string;
}

export interface DongAmCuoc {
  /** Cần cho nút giải trình. */
  orderId: string;
  /** Số đo hệ thống đã có — hiện ngay trong form để khỏi gõ lại. */
  tinHieu: import('./giai-trinh-am-cuoc').TinHieu;
  /** Lý do hệ thống đề xuất từ `tinHieu`. */
  goiY: import('./giai-trinh-am-cuoc').MaLyDoAmCuoc;
  giaiTrinh: GiaiTrinhDaLuu | null;
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
  /** Cần cho ô chọn lý do chậm ngay trên bảng. null = kiện ship hộ lên từ Lark, chưa có chỗ lưu lý do. */
  shipmentId: string | null;
  /** Kiện đến từ đâu — quyết định có gán được lý do chậm hay không. */
  nguon: 'shopify' | 'ship_ho';
  /** Kiện này của ai (store hoặc brand ship hộ), để nhìn ra nhóm nào đang kéo điểm. */
  thuocVe: string;
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
  /** MÃ lý do (không phải nhãn) — ô chọn cần mã, nhãn tra từ `layLyDo`. */
  lyDoCham: string | null;
  /** true = chưa giao; `soNgay` là số ngày ĐÃ TRÔI QUA, `ngayGiao` để trống. */
  chuaGiao?: boolean;
}

export interface DongChungTu {
  nguon: 'shopify' | 'ship_ho';
  thuocVe: string;
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

/** Câu nhắc phạm vi — KHÁC NHAU theo tiêu chí, xem `pham-vi.ts`. */
export const PHAM_VI_THEO_MA: Record<MaTieuChi, string> = {
  '1.1': 'Chỉ tính đơn của MEAN BLVD: tiêu chí này so bill với cước KHÁCH trả ở checkout, đơn brand khác trả theo bảng giá deal nên đối chiếu ở phần ship hộ.',
  '1.2': 'Tính MỌI kiện mình chạy, gồm cả ship hộ — store brand retail và đơn lên từ Lark. Cột Thuộc cho biết kiện của nhóm nào.',
  '1.3': 'Tính MỌI kiện có hoá đơn carrier, gồm cả ship hộ. Cột Thuộc cho biết kiện của nhóm nào.',
  '1.4': 'Chỉ tính đơn của MEAN BLVD: kiện brand retail mình kiểm hàng và đo cân, đo kích thước nhưng thùng là của brand.',
};

export const CACH_DO: Record<MaTieuChi, string> = {
  '1.1': 'Đơn có cước carrier RÒNG (bill trừ tiền đã đòi lại được bằng credit note) vẫn lớn hơn cước thu của khách, tính theo kiện gửi trong kỳ. Đơn đã được carrier trả lại đủ tiền sẽ tự rời danh sách. Cột Phân định là kết luận đối soát đã chốt; chỉ đơn được chốt là lỗi nội bộ mới bị trừ KPI, đơn do hãng sai hoặc chưa xét thì không.',
  '1.2': 'Mọi kiện GỬI trong kỳ, gồm cả kiện ship hộ và cả kiện CHƯA giao. Kiện chưa giao mà đã quá cam kết thì tính TRỄ vì không còn cứu được; còn trong hạn thì đứng ngoài cả tử số lẫn mẫu số. Không làm vậy thì kiện gửi rồi mãi không tới sẽ vô hình và tỉ lệ đúng hạn luôn đẹp hơn thực tế. Số ngày tính từ lúc tạo vận đơn tới lúc khách nhận; kiện ship hộ lên từ Lark chỉ có NGÀY gửi nên tính từ đầu ngày đó. Cam kết lấy theo nước, hãng nào có thước riêng thì theo hãng. Kiện có lý do chậm ngoài tầm kiểm soát bị loại khỏi mẫu số theo mục VII — kiện Lark chưa có chỗ lưu lý do nên không kiện nào được loại.',
  '1.3': 'Kiện phát sinh phí sửa địa chỉ trên hoá đơn carrier — dấu hiệu nhập sai hoặc thiếu thông tin người nhận. Mẫu số là toàn bộ kiện có hoá đơn trong kỳ, gồm cả kiện ship hộ (phí lấy từ khoản addressCorrection trên hoá đơn thật).',
  '1.4': 'So cân mình tự tính (lớn hơn giữa cân thực và cân quy đổi kích thước) với cân carrier thật sự charge. Lệch từ 0,5 kg trở lên coi là chọn sai thùng, vì thùng chật phồng ra làm tăng cân quy đổi.',
};

/** Đếm theo kết quả để hiện dòng tóm tắt trên đầu bảng chi tiết. */
export function demKetQuaSla(dong: readonly DongSla[]): Record<KetQuaSla, number> & { tinhKpi: number; tyLeDat: number | null } {
  const d = { dat: 0, tre: 0, ngoai_le: 0, loai_tru: 0, chua_den_han: 0 } as Record<KetQuaSla, number>;
  for (const x of dong) d[x.ketQua] += 1;
  const tinhKpi = d.dat + d.tre + d.ngoai_le;
  return { ...d, tinhKpi, tyLeDat: tinhKpi > 0 ? d.dat / tinhKpi : null };
}

/* ───────── LỌC HIỂN THỊ (CEO 14/09/2026) ─────────
 * Trên màn hình chỉ hiện đơn CÓ VẤN ĐỀ — người xem mở bảng này để xử lý, không phải để đọc
 * hết. Bản CSV thì đầy đủ cả đạt lẫn không đạt, vì đó mới là hồ sơ đối chiếu con số.
 *
 * CHỈ 'tre' và 'ngoai_le' là việc phải xử lý. Ba nhóm còn lại đều KHÔNG:
 *   - 'dat'          — xong rồi;
 *   - 'chua_den_han' — kiện đang bay đúng hạn, chưa có gì để làm;
 *   - 'loai_tru'     — đã đứng ngoài mẫu số, chấm điểm không đụng tới nó nữa. Hiện ra chỉ làm
 *                      dài danh sách việc bằng thứ không phải việc (CEO 14/09/2026: "sao lại
 *                      có các đơn loại khỏi KPI mà vẫn hiện"). Số lượng vẫn nằm ở dòng tóm tắt
 *                      và toàn bộ dòng vẫn có trong CSV.
 */
export const laCoVanDe = (k: KetQuaSla): boolean => k === 'tre' || k === 'ngoai_le';

/** Thứ tự trong CSV: đạt lên đầu để soát nhanh khối lớn, rồi tới các nhóm cần xử lý. */
const THU_TU_CSV: Record<KetQuaSla, number> = { dat: 0, chua_den_han: 1, loai_tru: 2, tre: 3, ngoai_le: 4 };

export function xepChoCsv(dong: readonly DongSla[]): DongSla[] {
  return [...dong].sort((a, b) =>
    THU_TU_CSV[a.ketQua] - THU_TU_CSV[b.ketQua] || b.soNgay - a.soNgay);
}

/** 1.4 — kiện có vấn đề là kiện KHÔNG đóng đúng size. */
export const laSizeCoVanDe = (p: DongSizeThung['phanLoai']): boolean => p !== 'dung';

/* ───────── 1.1: trạng thái phân định của một đơn âm cước (CEO 16/09/2026) ─────────
 * PHẢI khớp đúng bộ đếm trong `queries.ts`: đơn đã phân định khi đối soát đã chốt trạng thái,
 * HOẶC có giải trình quy được trách nhiệm. Lỗi nội bộ đến từ một trong hai nguồn.
 */
type DongPhanDinh = Pick<DongAmCuoc, 'phanDinh' | 'giaiTrinh'>;

export const laLoiNoiBo = (d: DongPhanDinh): boolean =>
  Boolean(d.phanDinh?.includes('internal_error')) || d.giaiTrinh?.thuocVe === 'noi_bo';

/** Còn phải giải trình: đối soát chưa chốt VÀ chưa có giải trình quy được trách nhiệm. */
export const canGiaiTrinh = (d: DongPhanDinh): boolean =>
  !d.phanDinh && (!d.giaiTrinh || d.giaiTrinh.thuocVe === 'chua_ro');
