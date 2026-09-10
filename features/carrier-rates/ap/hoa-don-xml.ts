import { createHash } from 'node:crypto';

/**
 * THUẦN: đọc hoá đơn điện tử Việt Nam (chuẩn TT78/NĐ123, thẻ <HDon><DLHDon><TTChung>) → số, ngày, tiền.
 *
 * Dùng cho credit note của carrier: CEO 10/09/2026 chốt **một hoá đơn VAT là một credit note**, tiền thu hồi lấy
 * "Tổng cộng tiền thanh toán" và cộng theo NGÀY HOÁ ĐƠN (không phải ngày ops bấm ghi nhận).
 * Credit note mang số ÂM trên hoá đơn; hàm trả nguyên dấu, nơi dùng tự lấy trị tuyệt đối khi cần.
 */
export interface HoaDonDienTu {
  /** Số hoá đơn (SHDon), vd '465'. */
  soHoaDon: string;
  /** Ký hiệu đầy đủ: mẫu số + ký hiệu, vd '1K26THA'. */
  kyHieu: string;
  /** Ngày lập (NLap) dạng YYYY-MM-DD. */
  ngay: string;
  /** Tổng tiền chưa thuế (TgTCThue). */
  truocThue: number;
  /** Tiền thuế GTGT (TgTThue). */
  tienThue: number;
  /** Tổng cộng tiền thanh toán (TgTTTBSo) — âm với credit note. */
  tongCong: number;
  /** Tên người bán (carrier). */
  benBan: string;
  /** Nội dung dòng hàng đầu tiên — thường chứa mã tham chiếu carrier. */
  noiDung: string;
}

const lay = (xml: string, tag: string, tuViTri = 0): string | null => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  m.lastIndex = tuViTri;
  const r = m.exec(xml);
  return r ? r[1].trim() : null;
};
const laySo = (xml: string, tag: string): number => {
  const v = lay(xml, tag);
  const n = v == null ? NaN : Number(v.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Đọc XML hoá đơn điện tử; null khi không phải file hoá đơn hợp lệ. */
export function docHoaDonXml(xml: string): HoaDonDienTu | null {
  if (!xml || !/<SHDon>/.test(xml) || !/<NLap>/.test(xml)) return null;
  const soHoaDon = lay(xml, 'SHDon') ?? '';
  const ngay = (lay(xml, 'NLap') ?? '').slice(0, 10);
  if (!soHoaDon || !/^\d{4}-\d{2}-\d{2}$/.test(ngay)) return null;
  const mau = lay(xml, 'KHMSHDon') ?? '';
  const kh = lay(xml, 'KHHDon') ?? '';
  return {
    soHoaDon,
    kyHieu: `${mau}${kh}`,
    ngay,
    truocThue: laySo(xml, 'TgTCThue'),
    tienThue: laySo(xml, 'TgTThue'),
    tongCong: laySo(xml, 'TgTTTBSo'),
    benBan: lay(xml, 'Ten') ?? '',
    noiDung: (lay(xml, 'THHDVu') ?? '').replace(/\s+/g, ' ').trim(),
  };
}

/** Mã tham chiếu carrier trong nội dung hoá đơn (DHL: HANR000284295, HANR000284299). */
export function maThamChieu(noiDung: string): string[] {
  return [...new Set((noiDung.match(/\b[A-Z]{3,4}\d{6,}\b/g) ?? []))];
}

/**
 * Loại chứng từ carrier gửi về:
 *   - 'credit'  — hoá đơn ĐIỀU CHỈNH GIẢM, carrier trả lại tiền (tiền thu hồi của KPI Pillar 3);
 *   - 'debit'   — hoá đơn ĐIỀU CHỈNH TĂNG (billing note), mình phải trả thêm;
 *   - 'cuoc_ky' — hoá đơn CƯỚC KỲ bình thường (không phải điều chỉnh) → thuộc luồng công nợ, không vào bảng điều chỉnh.
 *
 * Phải tách 'cuoc_ky' vì email hoá đơn cước kỳ của carrier có XML + CSV y hệt email điều chỉnh; chỉ nhìn dấu tổng tiền
 * thì hoá đơn cước kỳ (dương) sẽ bị xếp nhầm thành billing note.
 */
export type LoaiHoaDon = 'credit' | 'debit';
export type LoaiChungTu = LoaiHoaDon | 'cuoc_ky';

const CO_DIEU_CHINH = /điều chỉnh/i;
const GIAM = /điều chỉnh giảm/i;

export function phanLoaiHoaDon(h: Pick<HoaDonDienTu, 'tongCong' | 'noiDung'>): { loai: LoaiChungTu; canCu: string } {
  const nd = h.noiDung ?? '';
  if (GIAM.test(nd)) return { loai: 'credit', canCu: 'Nội dung ghi "điều chỉnh giảm"' };
  if (h.tongCong < 0) return { loai: 'credit', canCu: 'Tổng tiền âm — carrier trả lại' };
  if (CO_DIEU_CHINH.test(nd)) return { loai: 'debit', canCu: 'Nội dung ghi điều chỉnh, tổng tiền dương — mình trả thêm' };
  return { loai: 'cuoc_ky', canCu: 'Không thấy chữ "điều chỉnh" và tổng tiền dương — hoá đơn cước kỳ bình thường' };
}

export const NHAN_LOAI: Record<LoaiChungTu, string> = {
  credit: 'Credit note (thu hồi)',
  debit: 'Billing note (trả thêm)',
  cuoc_ky: 'Hoá đơn cước kỳ',
};

/**
 * Vân tay NỘI DUNG hoá đơn — dùng chặn tải trùng. Cố tình KHÔNG lấy tên tệp: cùng một hoá đơn lưu dưới tên khác vẫn
 * phải nhận ra là trùng. Mô tả được chuẩn hoá khoảng trắng để khác biệt do xuống dòng không tạo vân tay mới.
 */
export function bamHoaDon(h: Pick<HoaDonDienTu, 'kyHieu' | 'soHoaDon' | 'ngay' | 'truocThue' | 'tienThue' | 'tongCong' | 'noiDung'>): string {
  const chuoi = [
    h.kyHieu.trim().toUpperCase(),
    h.soHoaDon.trim(),
    h.ngay,
    h.truocThue, h.tienThue, h.tongCong,
    (h.noiDung ?? '').replace(/\s+/g, ' ').trim(),
  ].join('|');
  return createHash('sha256').update(chuoi, 'utf8').digest('hex');
}
