/**
 * THUẦN: GIẢI TRÌNH đơn âm cước cho tiêu chí 1.1 (CEO 16/09/2026).
 *
 * Tiêu chí 1.1 chỉ trừ đơn âm cước do LỖI NỘI BỘ, nên mỗi đơn âm cước phải được quy về một
 * nguyên nhân. Danh mục dưới đây rút từ chính bảng giải trình T8 của Đức (53 đơn).
 *
 * Hệ thống đã có sẵn gần hết con số cần để xác định nguyên nhân — cân thực, kích thước thùng,
 * cân hãng tính, phí vùng sâu xa, phí sửa địa chỉ, số kiện — nên `goiYLyDo` tự đề xuất, người
 * giải trình chỉ xác nhận hoặc chọn lại và bổ sung phần hệ thống không biết (số đồ, SKU cần sửa
 * cân, ai cung cấp sai địa chỉ, vì sao tách kiện).
 */
import { canQuyDoi, canTinhCuoc, NGUONG_SAI_THUNG } from '@/features/shipments/lech-can';

/**
 * Ai chịu nguyên nhân. CHỈ 'noi_bo' bị trừ KPI 1.1. 'chua_ro' nghĩa là đã chọn lý do nhưng còn
 * thiếu dữ kiện để quy trách nhiệm — vẫn tính là CHƯA PHÂN ĐỊNH, để quản lý chốt.
 */
export type ThuocVeAmCuoc = 'noi_bo' | 'hang' | 'du_lieu_web' | 'bang_gia' | 'khach' | 'brand' | 'chua_ro';

export const NHAN_THUOC_VE_AM_CUOC: Record<ThuocVeAmCuoc, string> = {
  noi_bo: 'Lỗi nội bộ (trừ KPI)',
  hang: 'Hãng tính sai — đòi lại',
  /** Không còn dùng từ 16/09/2026 — sai cân web là lỗi nội bộ. Giữ nhãn để đọc bản ghi cũ. */
  du_lieu_web: 'Cân nặng sản phẩm trên web',
  bang_gia: 'Bảng giá / phụ phí checkout',
  khach: 'Do khách',
  brand: 'Quy định của brand',
  chua_ro: 'Chưa đủ dữ kiện — chờ quản lý chốt',
};

export type NguonSaiDiaChi = 'khach' | 'noi_bo' | 'chua_ro';
export type LyDoTachKien = 'thieu_hang' | 'khach_yeu_cau' | 'do_kich_thuoc' | 'chua_ro';

export interface ChiTietGiaiTrinh {
  /** Số món đồ trong đơn. */
  soDo?: number | null;
  /** SKU cần sửa cân nặng trên web, mỗi dòng một SKU. */
  skuCanSua?: string | null;
  /** Số tiền phụ phí liên quan (vùng sâu xa / sửa địa chỉ). */
  phiVnd?: number | null;
  nguonSaiDiaChi?: NguonSaiDiaChi | null;
  lyDoTach?: LyDoTachKien | null;
  /** Số tiền đang/đã đòi hãng. */
  soTienDoiVnd?: number | null;
  /** Đơn đi line HNC — Đức đánh dấu riêng trong bảng T8. */
  lineHnc?: boolean;
}

export type MaLyDoAmCuoc =
  | 'can_quy_doi_web' | 'hang_tinh_sai_can' | 'phi_vung_sau_xa' | 'phi_sua_dia_chi'
  | 'tach_kien' | 'bang_gia_thap' | 'rule_thung_brand' | 'khac';

export type TruongNhap = 'soDo' | 'skuCanSua' | 'phiVnd' | 'nguonSaiDiaChi' | 'lyDoTach' | 'soTienDoiVnd';

export interface LyDoAmCuoc {
  ma: MaLyDoAmCuoc;
  ten: string;
  /** Việc cần làm để đơn sau không âm nữa — hiện ngay dưới lựa chọn. */
  huongXuLy: string;
  /** Ô cần điền thêm cho lý do này. */
  truong: TruongNhap[];
}

export const LY_DO_AM_CUOC: LyDoAmCuoc[] = [
  { ma: 'can_quy_doi_web', ten: 'Cân quy đổi thùng cao hơn cân khai trên web',
    huongXuLy: 'Sửa cân nặng các SKU trên web theo cân quy đổi của thùng thực tế', truong: ['soDo', 'skuCanSua'] },
  { ma: 'hang_tinh_sai_can', ten: 'Hãng tính cân / kích thước sai',
    huongXuLy: 'Mở khiếu nại ở Đối soát phí ship', truong: ['soTienDoiVnd'] },
  { ma: 'phi_vung_sau_xa', ten: 'Phí vùng sâu xa chưa thu ở checkout',
    huongXuLy: 'Bật phụ phí vùng sâu xa cho khu vực này trong bảng giá checkout', truong: ['phiVnd'] },
  { ma: 'phi_sua_dia_chi', ten: 'Phí sửa địa chỉ',
    huongXuLy: 'Xác định ai cung cấp sai địa chỉ; nếu lỗi khách thì đòi lại khách', truong: ['phiVnd', 'nguonSaiDiaChi'] },
  { ma: 'tach_kien', ten: 'Tách nhiều kiện, khách chỉ trả phí một lần',
    huongXuLy: 'Ghi rõ vì sao phải tách kiện', truong: ['lyDoTach'] },
  { ma: 'bang_gia_thap', ten: 'Không phát sinh phụ phí, cước checkout thấp hơn bill',
    huongXuLy: 'Rà lại bảng giá checkout của tuyến này', truong: [] },
  { ma: 'rule_thung_brand', ten: 'Brand quy định dùng thùng lớn hơn cần',
    huongXuLy: 'Tính cân tối thiểu theo quy định của brand vào cân sản phẩm trên web', truong: ['soDo', 'skuCanSua'] },
  { ma: 'khac', ten: 'Khác — ghi rõ ở ghi chú',
    huongXuLy: 'Quản lý đọc ghi chú và chốt trách nhiệm', truong: [] },
];

const THEO_MA = new Map(LY_DO_AM_CUOC.map((l) => [l.ma, l]));
export const layLyDoAmCuoc = (ma: string | null | undefined): LyDoAmCuoc | null =>
  (ma ? THEO_MA.get(ma as MaLyDoAmCuoc) ?? null : null);

/**
 * Quy trách nhiệm từ lý do + dữ kiện. Người giải trình KHÔNG tự chọn ô này — tránh việc tự
 * phân xử lỗi của chính mình; quản lý muốn khác thì đổi ở đây, một chỗ duy nhất.
 */
export function quyTrachNhiem(ma: MaLyDoAmCuoc, ct: ChiTietGiaiTrinh = {}): ThuocVeAmCuoc {
  switch (ma) {
    // CEO 16/09/2026: "Lỗi sai cân vẫn là lỗi nội bộ và là việc Đức phải notice và báo cho anh
    // để sửa mỗi tháng." Cân web thấp làm checkout báo cước thiếu — phát hiện và báo là việc của
    // vị trí logistics, nên trừ KPI. Sửa cân thì làm ở trang Sửa cân sản phẩm.
    case 'can_quy_doi_web': return 'noi_bo';
    case 'hang_tinh_sai_can': return 'hang';
    case 'phi_vung_sau_xa': return 'bang_gia';
    case 'bang_gia_thap': return 'bang_gia';
    case 'rule_thung_brand': return 'brand';
    case 'phi_sua_dia_chi':
      return ct.nguonSaiDiaChi === 'khach' ? 'khach' : ct.nguonSaiDiaChi === 'noi_bo' ? 'noi_bo' : 'chua_ro';
    case 'tach_kien':
      return ct.lyDoTach === 'thieu_hang' ? 'noi_bo'
        : ct.lyDoTach === 'khach_yeu_cau' ? 'khach'
        : ct.lyDoTach === 'do_kich_thuoc' ? 'bang_gia' : 'chua_ro';
    default: return 'chua_ro';
  }
}

/** Đã phân định xong chưa — 'chua_ro' vẫn tính là chưa. */
export const daPhanDinh = (t: ThuocVeAmCuoc | null | undefined): boolean => t != null && t !== 'chua_ro';

/* ───────── Tín hiệu hệ thống đo được ───────── */

export interface KienDo { thucKg: number | null; daiCm: number | null; rongCm: number | null; caoCm: number | null; billedKg: number | null }

export interface TinHieu {
  soKien: number;
  kien: KienDo[];
  /**
   * Cân của đơn trên web — con số bộ tính cước checkout đã dùng (`ship_weight_kg`, hoặc bản ghi
   * đè nếu có). Đây là tín hiệu ĐÚNG cho lý do "cân web thấp": so hãng tính với cân này, không
   * phải với cân thực. Đo T8: so với cân thực thì sót các ca lệch 0,1–0,4kg mà Đức đã chỉ ra.
   */
  canWebKg?: number | null;
  phiVungSauXaVnd: number;
  phiSuaDiaChiVnd: number;
}

export interface DanhGiaKien {
  thucKg: number | null;
  quyDoiKg: number;
  /** Cân tính cước phía mình = max(thực, quy đổi). */
  cuaMinhKg: number | null;
  billedKg: number | null;
  /** billed − của mình. Dương lớn = hãng tính nặng hơn kiện thật. */
  lechKg: number | null;
}

export function danhGiaKien(k: KienDo): DanhGiaKien {
  const quyDoiKg = canQuyDoi(k.daiCm, k.rongCm, k.caoCm);
  const cuaMinhKg = canTinhCuoc({ thucKg: k.thucKg, daiCm: k.daiCm, rongCm: k.rongCm, caoCm: k.caoCm, billedKg: k.billedKg });
  const lechKg = cuaMinhKg == null || k.billedKg == null ? null : Math.round((k.billedKg - cuaMinhKg) * 100) / 100;
  return { thucKg: k.thucKg, quyDoiKg: Math.round(quyDoiKg * 100) / 100, cuaMinhKg, billedKg: k.billedKg, lechKg };
}

/**
 * Đề xuất lý do từ tín hiệu. Thứ tự ưu tiên = nguyên nhân rõ nhất trước:
 * tách kiện → sửa địa chỉ → hãng tính nặng hơn kiện thật → phí vùng sâu xa →
 * cân quy đổi đẩy lên → còn lại là bảng giá.
 */
export function goiYLyDo(t: TinHieu): MaLyDoAmCuoc {
  if (t.soKien > 1) return 'tach_kien';
  if (t.phiSuaDiaChiVnd > 0) return 'phi_sua_dia_chi';
  const dg = t.kien.map(danhGiaKien);
  if (dg.some((d) => d.lechKg != null && d.lechKg >= NGUONG_SAI_THUNG)) return 'hang_tinh_sai_can';
  if (t.phiVungSauXaVnd > 0) return 'phi_vung_sau_xa';
  if (webThapHonBill(t)) return 'can_quy_doi_web';
  // Không có cân web thì mới lùi về so với cân thực, với ngưỡng rộng để khỏi báo nhầm.
  if (t.canWebKg == null && dg.some((d) => d.billedKg != null && d.thucKg != null && d.billedKg - d.thucKg >= NGUONG_SAI_THUNG)) return 'can_quy_doi_web';
  return 'bang_gia_thap';
}

/** Tổng cân hãng tính của mọi kiện; null khi chưa kiện nào có số trên bill. */
export function tongBilledKg(t: TinHieu): number | null {
  const co = t.kien.filter((k) => k.billedKg != null);
  return co.length ? Math.round(co.reduce((s, k) => s + (k.billedKg ?? 0), 0) * 100) / 100 : null;
}

/** Hãng tính nặng hơn cân khai trên web — tức checkout đã báo cước theo cân thấp hơn thực tế. */
export function webThapHonBill(t: TinHieu): boolean {
  const b = tongBilledKg(t);
  return t.canWebKg != null && b != null && b - t.canWebKg > 0.05;
}

/** Mọi dấu hiệu bắt được, để hiện thành nhãn — một đơn có thể dính nhiều thứ cùng lúc. */
export function dauHieu(t: TinHieu): string[] {
  const ra: string[] = [];
  if (t.soKien > 1) ra.push(`${t.soKien} kiện`);
  if (t.phiSuaDiaChiVnd > 0) ra.push(`sửa địa chỉ ${Math.round(t.phiSuaDiaChiVnd).toLocaleString('vi-VN')}đ`);
  if (t.phiVungSauXaVnd > 0) ra.push(`vùng sâu xa ${Math.round(t.phiVungSauXaVnd).toLocaleString('vi-VN')}đ`);
  for (const d of t.kien.map(danhGiaKien)) {
    if (d.lechKg != null && d.lechKg >= NGUONG_SAI_THUNG) ra.push(`hãng tính ${d.billedKg}kg, kiện thật ${d.cuaMinhKg}kg`);
  }
  if (webThapHonBill(t)) ra.push(`web khai ${t.canWebKg}kg, hãng tính ${tongBilledKg(t)}kg`);
  return ra;
}
