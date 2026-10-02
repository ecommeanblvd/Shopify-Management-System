/**
 * THUẦN: loại phụ phí của hãng → DÒNG TRÊN BẢNG KÊ mà brand nhìn thấy.
 *
 * Có HAI bộ từ vựng trong hệ thống và chúng không trùng nhau: brand thấy nhãn bảng kê
 * (dựng ở `features/ship-ho/price-structure.ts`), còn `carrier_surcharges.kind` là cách engine
 * chia nhỏ. Trang dẫn nguồn gom theo DÒNG BẢNG KÊ, vì brand đi từ dòng họ đang nhìn trên hoá
 * đơn ngược về căn cứ — không đi từ cấu trúc dữ liệu của mình.
 *
 * DANH SÁCH CHO PHÉP, KHÔNG phải loại trừ. `markup_percent` là LÃI của MEAN (dữ liệu thật
 * 02/10/2026: FedEx 4 dòng, DHL 4 dòng) — lộ ra là lộ lãi. Với danh sách cho phép, thêm một
 * `kind` mới vào enum thì nó mặc định KHÔNG lên trang; với danh sách loại trừ thì nó lọt ra
 * ngoài mà không ai thấy.
 *
 * `processing` (Phí xử lý đơn hàng) CỐ Ý không có ở đây: `price-structure.ts` dựng dòng đó với
 * `costVnd: null, billVnd: null` — không hãng nào thu MEAN khoản này, nên nó không phải
 * pass-through và không có "nguồn hãng" để dẫn. Trang nói rõ chuyện đó ở cuối.
 */
export type DongBangKe =
  | 'fuel' | 'remote' | 'demand' | 'residential' | 'signature' | 'vat' | 'other';

export interface MoTaLoai {
  dong: DongBangKe;
  nhan: string;
  cachTinh: string;
}

export const NHAN_DONG: Record<DongBangKe, string> = {
  fuel: 'Phụ phí xăng dầu',
  remote: 'Phụ phí vùng sâu vùng xa',
  demand: 'Phụ phí nhu cầu cao điểm',
  residential: 'Giao địa chỉ nhà dân',
  signature: 'Ký nhận (direct signature)',
  vat: 'VAT',
  other: 'Phụ phí khác',
};

const CHO_PHEP: Record<string, MoTaLoai> = {
  fuel_percent: { dong: 'fuel', nhan: NHAN_DONG.fuel, cachTinh: 'Phần trăm trên cước cơ bản, hãng công bố theo tuần' },
  remote_fixed: { dong: 'remote', nhan: NHAN_DONG.remote, cachTinh: 'Tiền cố định mỗi đơn, hoặc theo kg — lấy mức cao hơn' },
  demand_per_kg: { dong: 'demand', nhan: NHAN_DONG.demand, cachTinh: 'Tiền theo kg, áp theo nước đến' },
  residential_fixed: { dong: 'residential', nhan: NHAN_DONG.residential, cachTinh: 'Tiền cố định mỗi đơn' },
  vat_percent: { dong: 'vat', nhan: NHAN_DONG.vat, cachTinh: 'Phần trăm trên tổng' },
  peak_fixed: { dong: 'other', nhan: 'Phụ phí cao điểm', cachTinh: 'Tiền cố định mỗi đơn' },
  per_kg_fixed: { dong: 'other', nhan: 'Phụ phí theo trọng lượng', cachTinh: 'Tiền theo kg' },
  per_step_fixed: { dong: 'other', nhan: 'Phụ phí theo bậc trọng lượng', cachTinh: 'Tiền mỗi bậc cân' },
  country_fixed: { dong: 'other', nhan: 'Phụ phí theo nước đến', cachTinh: 'Tiền cố định mỗi đơn' },
  packaging_fixed: { dong: 'other', nhan: 'Phí bao bì', cachTinh: 'Tiền cố định mỗi đơn' },
};

export function loaiChoPhep(kind: string, serviceKey: string | null): MoTaLoai | null {
  /* `addon_fixed` rẽ theo `service_key`: `direct_signature` là dòng "Ký nhận" trên bảng kê
   * (price-structure gộp nó vào cột `signature`), còn addon khác gom vào "Phụ phí khác".
   * Cùng một `kind`, hai dòng — nên không ánh xạ được bằng `kind` đơn thuần. */
  if (kind === 'addon_fixed') {
    return serviceKey === 'direct_signature'
      ? { dong: 'signature', nhan: NHAN_DONG.signature, cachTinh: 'Tiền cố định mỗi đơn, chỉ khi đơn chọn ký nhận' }
      : { dong: 'other', nhan: 'Dịch vụ cộng thêm', cachTinh: 'Tiền cố định, chỉ khi đơn chọn dịch vụ đó' };
  }
  return CHO_PHEP[kind] ?? null;
}
