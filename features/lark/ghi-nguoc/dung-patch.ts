/**
 * THUẦN: dựng bản vá cho MỘT dòng Lark LOG-Export từ kiện SMS (spec 2026-09-19 §3, §5).
 *
 * Luật: nguồn không phải hãng → không ghi gì. Trạng thái + Ngày giao thực tế GHI ĐÈ (hãng là
 * sự thật). Ngày giao dự kiến + chi phí CHỈ ĐIỀN Ô TRỐNG. Mọi ô chỉ vào patch khi KHÁC giá trị
 * hiện có. Ô Ops gõ khác SMS được liệt kê ở `lech` để nhật ký — dù có ghi đè hay không.
 */
import { larkText } from '../parse-pack-row';
import { laNguonHang } from '../nguon-hang';
import { COT, COT_CHI_PHI } from './cot';
import { mapTrangThai } from './map-trang-thai';
import { ngayLark, docNgayLark, ngayDuKien } from './ngay-lark';

export interface KienGhiNguoc {
  deliveryStatus: string | null; deliverySource: string | null;
  deliveredAt: Date | null; labelCreatedAt: Date | null; shipCountry: string | null;
}
export interface ChargeGhiNguoc {
  totalAmount: number; base: number | null; discount: number | null; fuel: number | null; remote: number | null;
  demand: number | null; directSignature: number | null; vat: number | null; gogreen: number | null;
  elevatedRisk: number | null; importHandling: number | null; residential: number | null;
}
export interface KetQuaPatch {
  patch: Record<string, unknown>;
  lech: string[];
  nhom: { trangThai: number; ngay: number; chiPhi: number };
}

/** Task 1 (Decisions D-0XX) chốt Ops gõ giá niêm yết hay giá sau chiết khấu vào "Mức giá cơ sở". */
export const QUY_UOC_BASE: 'niem_yet' | 'sau_chiet_khau' = 'niem_yet';

const SAI_SO_DONG = 1;
const docSo = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function dungPatch(kien: KienGhiNguoc, charge: ChargeGhiNguoc | null, oLark: Record<string, unknown>): KetQuaPatch {
  const kq: KetQuaPatch = { patch: {}, lech: [], nhom: { trangThai: 0, ngay: 0, chiPhi: 0 } };
  if (!laNguonHang(kien.deliverySource)) return kq;

  // Trạng thái — ghi đè.
  const tt = mapTrangThai(kien.deliveryStatus);
  if (tt) {
    for (const [cot, moi] of [[COT.category, tt.category], [COT.status, tt.status]] as const) {
      const cu = larkText(oLark[cot]);
      if (cu === moi) continue;
      if (cu != null) kq.lech.push(`${cot}: Lark "${cu}" → hãng "${moi}"`);
      kq.patch[cot] = moi; kq.nhom.trangThai++;
    }
  }

  // Ngày giao thực tế — ghi đè, chỉ khi đã giao.
  if (kien.deliveryStatus === 'delivered' && kien.deliveredAt) {
    const moi = ngayLark(kien.deliveredAt);
    const cu = docNgayLark(oLark[COT.ngayGiaoThucTe]);
    if (cu !== moi) {
      if (cu != null) kq.lech.push(`${COT.ngayGiaoThucTe}: Lark ${new Date(cu).toISOString().slice(0, 10)} → hãng ${new Date(moi).toISOString().slice(0, 10)}`);
      kq.patch[COT.ngayGiaoThucTe] = moi; kq.nhom.ngay++;
    }
  }

  // Ngày giao dự kiến — chỉ điền ô trống.
  if (kien.labelCreatedAt && kien.shipCountry && docNgayLark(oLark[COT.ngayGiaoDuKien]) == null) {
    kq.patch[COT.ngayGiaoDuKien] = ngayDuKien(kien.labelCreatedAt, kien.shipCountry); kq.nhom.ngay++;
  }

  // Chi phí — chỉ điền ô trống, thành phần 0 không ghi.
  if (charge && charge.totalAmount > 0) {
    const base = QUY_UOC_BASE === 'niem_yet' ? charge.base : (charge.base == null ? null : charge.base + (charge.discount ?? 0));
    const khoan: Record<string, number | null> = { ...charge, base };
    for (const [khoa, cot] of Object.entries(COT_CHI_PHI)) {
      const moi = khoan[khoa];
      if (moi == null || moi <= 0) continue;
      const cu = docSo(oLark[cot]);
      if (cu != null) {
        if (Math.abs(cu - moi) > SAI_SO_DONG) kq.lech.push(`${cot}: Lark ${cu} ≠ hoá đơn ${moi} (không ghi đè)`);
        continue;
      }
      kq.patch[cot] = moi; kq.nhom.chiPhi++;
    }
  }
  return kq;
}
