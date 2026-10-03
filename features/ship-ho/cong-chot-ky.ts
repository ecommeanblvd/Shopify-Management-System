/**
 * THUẦN: cổng rà soát trước khi phát hành một kỳ bảng kê. Không I/O.
 *
 * Vì sao cần: trước 03/10/2026 kỳ được phát hành mà không có phép kiểm nào về ngày hay về
 * %phụ phí — và một con số sai (52,65% ở #KLS1998) đã kịp ra tới bảng gửi brand.
 *
 * Trả DANH SÁCH đơn hỏng kèm lý do, không trả một câu chung: người sửa cần biết đơn nào.
 */
import { ngayDiHang } from './ngay-di-hang';
import { pctTuanCuaNgay, type TuanFuel } from './tuan-fuel';
import { gocFuelTrenBill, phanTramFuelDangTin } from './goc-fuel-bill';

export type MaLoiCong = 'thieu_ngay_di' | 'fuel_lech_tuan' | 'fuel_ngoai_luoi';
export interface LoiCong { code: string; ma: MaLoiCong; ly: string }

export interface DonKiemCong {
  code: string;
  tenHang: string | null;
  pickedUpAt: Date | string | null;
  shippedAt: string | null;
  /** `null` = chưa có hoá đơn hãng → hai phép kiểm fuel không áp dụng. */
  bill: {
    base: number; discount: number; remote: number; demand: number;
    signature: number; residential: number; addressCorrection: number; fuel: number;
  } | null;
}

/** Hãng có API tra lịch sử quét. Aramex HN không có (CEO chốt 03/10). */
const CO_NGUON = ['fedex', 'ups', 'dhl'];

/**
 * Hãng này có tra được ngày lấy hàng không.
 *
 * Không biết tên hãng → trả `true` để cổng CHẶN. Hai đơn trong dữ liệu thật thiếu
 * `carrier_account_id`; coi chúng là "không có nguồn" rồi cho qua là lấy an toàn giả.
 */
export function hangCoNguonTra(tenHang: string | null): boolean {
  if (!tenHang) return true;
  const t = tenHang.toLowerCase();
  return CO_NGUON.some((h) => t.startsWith(h));
}

const pct = (n: number) => n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function kiemCongChotKy(don: readonly DonKiemCong[], tuan: readonly TuanFuel[]): LoiCong[] {
  const loi: LoiCong[] = [];
  for (const d of don) {
    const { ngay } = ngayDiHang(d);
    if (hangCoNguonTra(d.tenHang) && d.pickedUpAt == null) {
      loi.push({ code: d.code, ma: 'thieu_ngay_di',
        ly: `chưa tra được ngày hãng lấy hàng (${d.tenHang ?? 'không rõ hãng'})` });
      continue;
    }
    if (!d.bill || !(d.bill.fuel > 0)) continue;
    const goc = gocFuelTrenBill(d.bill);
    if (!(goc > 0)) continue;
    const suy = Math.round((d.bill.fuel / goc) * 100 * 1000) / 1000;
    if (!phanTramFuelDangTin(suy)) {
      loi.push({ code: d.code, ma: 'fuel_ngoai_luoi',
        ly: `%xăng dầu suy từ hoá đơn = ${pct(suy)}% — không phải bội của 0,25%, nhiều khả năng mẫu số thiếu một khoản chịu fuel` });
      continue;
    }
    const congBo = ngay ? pctTuanCuaNgay(tuan, ngay) : null;
    if (congBo != null && Math.abs(congBo - suy) > 0.001) {
      loi.push({ code: d.code, ma: 'fuel_lech_tuan',
        ly: `đi hàng ${ngay} thuộc tuần ${pct(congBo)}% nhưng hoá đơn tính ${pct(suy)}%` });
    }
  }
  return loi;
}
