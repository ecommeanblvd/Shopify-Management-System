import type { DongDon } from './types';

export interface ChiPhiDong {
  /** Số món KHÔNG quay lại kho bán được — đây mới là chi phí thật. */
  daTieu: number;
  /** Số món mượn chưa trả: để riêng, KHÔNG trộn vào chi phí đã tiêu. */
  dangTreo: number;
  /** null khi dòng thiếu giá vốn — KHÔNG được coi là 0 đồng. */
  tienChiPhi: number | null;
  /** Tiền tệ của chính dòng đó. Không mặc định về VND. */
  tienTe: string | null;
  thieuGiaVon: boolean;
}

/**
 * THUẦN: chi phí của MỘT dòng hàng.
 *
 * Luật (spec §7.3): chi phí = giá vốn của hàng KHÔNG quay lại kho bán được.
 * Hàng tặng luôn tính. Hàng mượn trả về và nhập lại kho thì không tính, vì nó
 * vẫn bán được. Hàng mượn trả về mà hỏng không nhập lại thì có tính. Hàng mượn
 * chưa trả nằm ở cột "đang treo" riêng.
 */
export function chiPhiMotDong(d: DongDon): ChiPhiDong {
  const daTieu = d.hinhThuc === 'muon' ? d.soLuong - d.soLuongNhapLai : d.soLuong;
  const dangTreo = d.hinhThuc === 'muon' ? d.soLuong - d.soLuongDaTra : 0;
  const thieuGiaVon = d.giaVon == null || d.giaVon.trim() === '';
  const tienChiPhi = thieuGiaVon ? null : daTieu * Number(d.giaVon);
  const tienTe = thieuGiaVon ? null : (d.giaVonTienTe ?? 'VND');
  return { daTieu, dangTreo, tienChiPhi, tienTe, thieuGiaVon };
}

export interface TongChiPhi {
  /**
   * Cộng dồn THEO TỪNG LOẠI TIỀN. sku_costs có cả VND lẫn USD (đo 23/09/2026:
   * 4.105 dòng VND, 10 dòng USD), cộng thẳng hai loại vào một số là sai câm.
   * Quy về VND là việc của tầng báo cáo, dùng tỷ giá tháng.
   */
  theoTienTe: Record<string, number>;
  soMonDaTieu: number;
  soMonDangTreo: number;
  /** Đếm riêng để báo cáo nói thẳng, không im lặng bỏ qua. */
  soDongThieuGiaVon: number;
}

/** THUẦN: cộng dồn nhiều dòng. Dòng thiếu giá vốn không cộng tiền nhưng ĐƯỢC ĐẾM. */
export function tongChiPhi(ds: readonly DongDon[]): TongChiPhi {
  const theoTienTe: Record<string, number> = {};
  let soMonDaTieu = 0, soMonDangTreo = 0, soDongThieuGiaVon = 0;
  for (const d of ds) {
    const c = chiPhiMotDong(d);
    soMonDaTieu += c.daTieu;
    soMonDangTreo += c.dangTreo;
    if (c.thieuGiaVon) { soDongThieuGiaVon++; continue; }
    theoTienTe[c.tienTe!] = (theoTienTe[c.tienTe!] ?? 0) + c.tienChiPhi!;
  }
  return { theoTienTe, soMonDaTieu, soMonDangTreo, soDongThieuGiaVon };
}

/**
 * THUẦN: số ngày trễ so với hạn trả. Âm là chưa tới hạn, 0 là đúng hạn,
 * dương là đã quá hạn. Cả hai tham số là chuỗi ngày dạng YYYY-MM-DD.
 */
export function soNgayTre(hanTra: string | null, homNay: string): number | null {
  if (!hanTra) return null;
  const MS = 86_400_000;
  return Math.round((Date.parse(`${homNay}T00:00:00Z`) - Date.parse(`${hanTra}T00:00:00Z`)) / MS);
}
