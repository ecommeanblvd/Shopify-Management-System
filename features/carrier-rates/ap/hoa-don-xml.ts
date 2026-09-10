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
 * Loại hoá đơn điều chỉnh của carrier:
 *   - 'credit' — điều chỉnh GIẢM, carrier trả lại tiền (đây là tiền thu hồi của KPI Pillar 3);
 *   - 'debit'  — điều chỉnh TĂNG hoặc thu thêm, mình phải trả thêm.
 * Căn cứ chính là DẤU của tổng tiền; nội dung hoá đơn chỉ dùng khi tổng bằng 0 (hiếm, hoá đơn thay thế).
 */
export type LoaiHoaDon = 'credit' | 'debit';

export function phanLoaiHoaDon(h: Pick<HoaDonDienTu, 'tongCong' | 'noiDung'>): { loai: LoaiHoaDon; canCu: string } {
  if (h.tongCong < 0) return { loai: 'credit', canCu: 'Tổng tiền âm — carrier trả lại' };
  if (h.tongCong > 0) return { loai: 'debit', canCu: 'Tổng tiền dương — mình phải trả thêm' };
  const nd = (h.noiDung ?? '').toLowerCase();
  if (nd.includes('điều chỉnh giảm')) return { loai: 'credit', canCu: 'Nội dung ghi "điều chỉnh giảm"' };
  return { loai: 'debit', canCu: 'Tổng bằng 0, không thấy dấu hiệu điều chỉnh giảm' };
}

export const NHAN_LOAI: Record<LoaiHoaDon, string> = { credit: 'Credit note (thu hồi)', debit: 'Billing note (trả thêm)' };
