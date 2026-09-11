/**
 * THUẦN: tách một `QuoteBreakdown` thành các dòng phí có nhãn tiếng Việt để bảng
 * so sánh carrier mở ra xem chi tiết (CEO 11/09/2026).
 *
 * Phạm vi là CƯỚC TRẢ CARRIER (`carrierCost`), không phải giá thu khách: bảng so
 * sánh dùng để chọn hãng đi hàng nên đóng gói và markup của shop KHÔNG nằm ở đây.
 * Đẳng thức bắt buộc (có test canh):
 *   carrierCost = cước gốc − chiết khấu + mọi phụ phí + nhiên liệu + VAT
 */
import type { QuoteBreakdown } from '../engine/quote';

export interface DongPhi {
  ma: string;
  nhan: string;
  /** Đã nhân hệ số quy đổi (account tính tiền USD → VND) nếu caller truyền. */
  giaTri: number;
  /** Phần trăm hoặc chú thích ngắn hiện cạnh nhãn. */
  ghiChu?: string;
}

export interface ChiTietCuoc {
  /** Các dòng CÓ cộng vào cước, bỏ dòng bằng 0. */
  dong: DongPhi[];
  /** Tổng các dòng trên = cước trả carrier. */
  tong: number;
  /** Tổng dòng khớp `carrierCost` (sai số < 1 đơn vị tiền). Sai = engine đổi cách
   *  tính mà bảng chưa cập nhật → UI phải cảnh báo thay vì hiện số sai. */
  khop: boolean;
  /** Dòng CHỈ tham chiếu, KHÔNG cộng vào cước (phụ phí chỉ thu khi carrier bill). */
  thamChieu: DongPhi[];
  canNang: { thuc: number; quyDoi: number; tinhCuoc: number; dungQuyDoi: boolean };
}

const pct = (v: number) => (v ? `${v}%` : undefined);

/**
 * @param heSo quy đổi về VND cho account tính tiền ngoại tệ (vndCost / carrierCost).
 */
export function chiTietCuoc(b: QuoteBreakdown, heSo = 1): ChiTietCuoc {
  const q = (v: number) => v * heSo;
  const ung: Array<DongPhi | null> = [
    { ma: 'base', nhan: 'Cước gốc theo zone và bậc cân', giaTri: q(b.base) },
    b.discount ? { ma: 'discount', nhan: 'Chiết khấu hợp đồng', giaTri: -q(b.discount), ghiChu: pct(b.discountPercent) } : null,
    { ma: 'remote', nhan: 'Phụ phí vùng sâu vùng xa (ODA)', giaTri: q(b.remote) },
    { ma: 'residential', nhan: 'Phụ phí giao địa chỉ nhà dân', giaTri: q(b.residential) },
    { ma: 'countryFixed', nhan: 'Phí xử lý hàng nhập của nước đến', giaTri: q(b.countryFixed) },
    { ma: 'demand', nhan: 'Phụ phí nhu cầu cao (demand surcharge)', giaTri: q(b.demand) },
    { ma: 'peak', nhan: 'Phụ phí mùa cao điểm', giaTri: q(b.peak) },
    { ma: 'perKg', nhan: 'Phụ phí tính theo kg', giaTri: q(b.perKg) },
    { ma: 'perStep', nhan: 'Phụ phí tính theo bước cân', giaTri: q(b.perStep) },
    { ma: 'addons', nhan: 'Phụ phí cố định khác (ký nhận…)', giaTri: q(b.addons) },
    { ma: 'fuel', nhan: 'Nhiên liệu', giaTri: q(b.fuel), ghiChu: pct(b.fuelPercent) },
    { ma: 'vat', nhan: 'Thuế giá trị gia tăng', giaTri: q(b.vat), ghiChu: pct(b.vatPercent) },
  ];
  const dong = ung.filter((d): d is DongPhi => d !== null && Math.round(d.giaTri) !== 0);
  const tong = dong.reduce((s, d) => s + d.giaTri, 0);

  const thamChieu: DongPhi[] = [];
  if (b.addonReference) {
    thamChieu.push({
      ma: 'addonReference', nhan: 'Phụ phí chỉ thu khi carrier bill', giaTri: q(b.addonReference),
      ghiChu: b.addonExcludedForCountry ? 'nước này được miễn' : 'không cộng vào cước',
    });
  }
  if (b.countryFixedReference) {
    thamChieu.push({ ma: 'countryFixedReference', nhan: 'Phí xử lý hàng nhập — chỉ đối chiếu hoá đơn', giaTri: q(b.countryFixedReference), ghiChu: 'không cộng vào cước' });
  }

  return {
    dong, tong,
    khop: Math.abs(tong - q(b.carrierCost)) < 1,
    thamChieu,
    canNang: {
      thuc: b.actualWeightKg, quyDoi: b.dimWeightKg, tinhCuoc: b.chargeableWeightKg,
      dungQuyDoi: b.dimWeightKg > b.actualWeightKg,
    },
  };
}

/** Dịch ghi chú kỹ thuật của engine sang câu người đọc được. Không khớp thì giữ nguyên. */
export function dichGhiChu(note: string): string {
  const m = (re: RegExp) => note.match(re);
  let x: RegExpMatchArray | null;
  if ((x = m(/^remote_match:(\w+)(?:\s*\((.+)\))?$/))) {
    const theo = x[1] === 'postcode' ? 'mã bưu chính' : x[1] === 'city' ? 'tên thành phố' : x[1];
    return `Địa chỉ nằm trong vùng sâu, khớp theo ${theo}${x[2] ? ` (${x[2]})` : ''}`;
  }
  if ((x = m(/^dim_weight \((.+)\)$/))) return `Cân quy đổi theo kích thước lớn hơn cân thực: ${x[1]}`;
  if ((x = m(/^chargeable_rounded \((.+)\)$/))) return `Cân tính cước làm tròn lên: ${x[1]}`;
  if ((x = m(/^weight_exceeds_top_tier \((.+)\)$/))) return `Vượt bậc cân cao nhất của bảng giá (${x[1]}), dùng bậc cuối`;
  if ((x = m(/^zone_postcode_override \((.+)\)$/))) return `Mã bưu chính này được gán riêng sang zone ${x[1]}`;
  if (note === 'pak') return 'Tính theo giá phong bì/Pak';
  if (note === 'pak_fallback_to_package') return 'Không có giá Pak ở bậc này, dùng giá Package';
  return note;
}
