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
  /** Khoá tra bảng tuần xăng dầu. `null` = chưa gán hãng. */
  carrierAccountId: string | null;
  pickedUpAt: Date | string | null;
  shippedAt: string | null;
  /** `null` = chưa có hoá đơn hãng → hai phép kiểm fuel không áp dụng. */
  bill: {
    base: number; discount: number; remote: number; demand: number;
    signature: number; residential: number; addressCorrection: number;
    /** CHỊU fuel — thiếu nó thì mẫu số hụt và %suy ra sai (xem `gocFuelTrenBill`). */
    additionalHandling?: number;
    fuel: number;
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

/**
 * Dung sai khi so %fuel suy từ hoá đơn với mức hãng công bố.
 *
 * Hãng làm tròn TIỀN, nên % giải ngược ra lệch vài phần nghìn: đơn Aramex SV-0142 thật ra
 * 30,002% so với mức công bố 30%. Dùng 0,001 là chặn nhầm đơn đã phát hành trót lọt — bắt được
 * ở lượt chạy chỉ-đếm 03/10/2026.
 *
 * 0,05 cùng con số với `phanTramFuelDangTin`: hai tuần liền kề chênh nhau ít nhất 0,25%, nên
 * sai một tuần vẫn bị bắt, còn làm tròn của hãng thì không.
 */
export const SAI_SO_TUAN = 0.05;

/** Hiện tới 3 chữ số thập phân, nhưng bỏ số 0 thừa — thông báo in "30,00% vs 30,00%" là vô dụng. */
const pct = (n: number) => n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/**
 * Bảng tuần xăng dầu THEO TỪNG HÃNG.
 *
 * Mỗi hãng công bố mức riêng: ngày 21/09/2026 FedEx là 51,75% còn Aramex là 30%. Dùng chung
 * một bảng là so đơn Aramex với mức FedEx — bản đầu của cổng này mắc đúng lỗi đó và chặn nhầm
 * hai đơn Aramex đã phát hành trót lọt (phát hiện ở lượt chạy chỉ-đếm 03/10/2026).
 */
export type TuanTheoHang = ReadonlyMap<string, readonly TuanFuel[]>;

export function kiemCongChotKy(don: readonly DonKiemCong[], tuanTheoHang: TuanTheoHang): LoiCong[] {
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
    /* Không biết bảng tuần của hãng này thì BỎ QUA phép so, không so bừa với hãng khác.
     * Thiếu dữ liệu là thiếu dữ liệu — không phải bằng chứng sai. */
    const tuan = d.carrierAccountId ? tuanTheoHang.get(d.carrierAccountId) : undefined;
    const congBo = ngay && tuan ? pctTuanCuaNgay(tuan, ngay) : null;
    if (congBo != null && Math.abs(congBo - suy) > SAI_SO_TUAN) {
      loi.push({ code: d.code, ma: 'fuel_lech_tuan',
        ly: `đi hàng ${ngay} thuộc tuần ${pct(congBo)}% nhưng hoá đơn tính ${pct(suy)}%` });
    }
  }
  return loi;
}
