/**
 * THUẦN: một đơn ship hộ có tự báo giá được không, và dòng báo giá nào là của
 * ĐÚNG hãng đã gửi đơn đó. Không I/O.
 *
 * Vì sao phải khoá theo hãng của đơn: `estimateForBrand` cứng FedEx, còn đơn về
 * từ Lark nhận hãng theo dạng mã vận đơn (D-073) nên có cả Aramex và UPS. Báo
 * giá FedEx cho một kiện Aramex thì `carrier_cost_vnd` trông vẫn hợp lệ, nhưng
 * đối soát sau đó lấy hoá đơn Aramex trừ đi bảng giá FedEx — ra một con số
 * delta vô nghĩa mà không ai nhìn thấy là sai. Thà bỏ trống còn hơn điền bậy:
 * mọi nhánh không chắc chắn đều trả lý do, KHÔNG rơi về hãng mặc định.
 */

export interface DonCanBaoGia {
  id: string;
  carrierKey: string | null;
  country: string | null;
  weightKg: string | null;
  smsWeightKg: string | null;
  /** Đã có ước tính thì thôi — hàm này chỉ LẤP CHỖ TRỐNG, không bao giờ ghi đè. */
  carrierCostVnd: string | null;
  postcode: string | null;
  city: string | null;
  dimLengthCm: string | null; dimWidthCm: string | null; dimHeightCm: string | null;
  smsDimLengthCm: string | null; smsDimWidthCm: string | null; smsDimHeightCm: string | null;
  /** Kiểu `date` → Drizzle trả CHUỖI. Xem ngayHopLe. */
  shippedAt: Date | string | null;
}

export type LyDoBoQua = 'da_co_uoc_tinh' | 'khong_ro_hang' | 'thieu_nuoc' | 'thieu_can';

export interface DauVaoBaoGia {
  country: string;
  weightKg: number;
  postcode: string | null;
  city: string | null;
  dimensions: { lengthCm: number; widthCm: number; heightCm: number } | null;
  /** Cân dùng để báo giá đến từ đâu — để nhật ký nói được vì sao ra số đó. */
  canTheo: 'sms' | 'khai';
  /**
   * Mốc tính giá = NGÀY GỬI. Kiện đã đi rồi thì ước tính phải đứng cùng mốc với
   * thứ nó sẽ bị đem ra so: hoá đơn của hãng, vốn tính theo bảng giá và xăng dầu
   * của TUẦN GIAO. Lấy hôm nay thì `delta` khi đối soát lệch đúng bằng chênh
   * xăng dầu giữa hai mốc — loại sai lệch đã đo được ở đơn 0094 (46% vs 46,5%).
   * Cũng phải cùng mốc với giá thu, nếu không lãi/lỗ một đơn là phép trừ lệch kỳ.
   */
  asOf?: Date;
}

/** Ngày gửi → Date dùng được, hoặc null. Chuỗi rỗng / ngày rác → null (rơi về
 *  bảng giá hiện hành) chứ không đẻ ra Invalid Date làm engine tính sai lặng lẽ. */
function ngayHopLe(v: Date | string | null): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const soDuong = (v: string | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const boBa = (l: string | null, w: string | null, h: string | null) => {
  const a = soDuong(l), b = soDuong(w), c = soDuong(h);
  return a != null && b != null && c != null ? { lengthCm: a, widthCm: b, heightCm: c } : null;
};

export function chonDauVaoBaoGia(o: DonCanBaoGia):
  | { ok: true; dauVao: DauVaoBaoGia }
  | { ok: false; lyDo: LyDoBoQua } {
  if (o.carrierCostVnd != null) return { ok: false, lyDo: 'da_co_uoc_tinh' };

  const hang = (o.carrierKey ?? '').trim();
  if (hang === '') return { ok: false, lyDo: 'khong_ro_hang' };

  const country = (o.country ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, lyDo: 'thieu_nuoc' };

  // Inecso đo lại thì số đo SMS thắng số brand khai — cùng luật với màn so sánh
  // hãng (carrier-select-actions), để giá dự tính và giá staff nhìn thấy là một.
  const sms = soDuong(o.smsWeightKg);
  const canTheo: 'sms' | 'khai' = sms != null ? 'sms' : 'khai';
  const weightKg = sms ?? soDuong(o.weightKg);
  if (weightKg == null) return { ok: false, lyDo: 'thieu_can' };

  const dimensions = canTheo === 'sms'
    ? boBa(o.smsDimLengthCm, o.smsDimWidthCm, o.smsDimHeightCm)
    : boBa(o.dimLengthCm, o.dimWidthCm, o.dimHeightCm);

  const asOf = ngayHopLe(o.shippedAt);

  return {
    ok: true,
    dauVao: {
      country, weightKg, postcode: o.postcode, city: o.city, dimensions, canTheo,
      ...(asOf ? { asOf } : {}),
    },
  };
}

export interface DongBaoGia {
  carrierKey: string;
  ok: boolean;
  vndCost?: number;
  breakdown?: unknown;
  error?: string;
}

export function chonDongTheoHang(rows: readonly DongBaoGia[], carrierKey: string):
  | { ok: true; vndCost: number; breakdown: unknown }
  | { ok: false; lyDo: 'hang_khong_co_account' | 'hang_bao_gia_loi'; chiTiet?: string } {
  const row = rows.find((r) => r.carrierKey === carrierKey);
  if (!row) return { ok: false, lyDo: 'hang_khong_co_account' };
  if (!row.ok || row.vndCost == null || !Number.isFinite(row.vndCost)) {
    return row.error === undefined
      ? { ok: false, lyDo: 'hang_bao_gia_loi' }
      : { ok: false, lyDo: 'hang_bao_gia_loi', chiTiet: row.error };
  }
  return { ok: true, vndCost: row.vndCost, breakdown: row.breakdown };
}

/* ────────────────────────────────────────────────────────────────────────────
 * GIÁ THU (charged_vnd) — nguồn khác hẳn giá dự tính.
 *
 * CEO 24/09: "Giá dự tính là lấy theo line thật chúng ta đi, còn báo giá thì
 * theo bảng giá của brand". Hai con số đến từ hai nguồn khác nhau MỘT CÁCH CÓ
 * CHỦ Ý: `carrier_cost_vnd` bám hãng đã chở kiện đó, còn `charged_vnd` bám bảng
 * giá công bố trừ bậc chiết khấu của brand (platinum/gold/silver — xem
 * tier-pricing). Ta đi hãng nào là việc nội bộ, không đổi giá brand phải trả.
 *
 * Hệ quả cho người sửa sau: `estimateForBrand` cứng FedEx và ĐIỀU ĐÓ ĐÚNG ở đây.
 * Nhưng nó cũng trả về `internal.carrierCostVnd` của FedEx — TUYỆT ĐỐI không ghi
 * số đó đè lên `carrier_cost_vnd`, nếu không line thật sẽ bị xoá mất.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DonCanGiaThu {
  id: string;
  partnerBrandSlug: string | null;
  /** Đã có giá thu thì thôi — giá đã báo brand là con số hợp đồng. */
  chargedVnd: string | null;
  country: string | null;
  weightKg: string | null;
  smsWeightKg: string | null;
  dimLengthCm: string | null; dimWidthCm: string | null; dimHeightCm: string | null;
  smsDimLengthCm: string | null; smsDimWidthCm: string | null; smsDimHeightCm: string | null;
  /** Cột `shipped_at` của ship hộ là kiểu `date` → Drizzle trả CHUỖI
   *  ('2026-09-01'), không phải Date. Nhận cả hai rồi tự ép, vì truyền thẳng
   *  chuỗi xuống engine làm nổ `effectiveDate.toISOString is not a function`. */
  shippedAt: Date | string | null;
  packagingType: string | null;
}

export type LyDoBoQuaGiaThu = 'da_co_gia_thu' | 'khong_ro_brand' | 'thieu_nuoc' | 'thieu_can';

export interface DauVaoGiaThu {
  brandSlug: string;
  country: string;
  weightKg: number;
  dimensions: { lengthCm: number; widthCm: number; heightCm: number } | null;
  packagingType: 'bag' | 'box' | null;
  /** Mốc tính giá = NGÀY GỬI, không phải hôm nay: fuel đổi theo tuần, tính lại
   *  đơn gửi ba tuần trước bằng fuel tuần này là thu sai tiền brand. */
  asOf?: Date;
}

export function chonDonTinhGiaThu(o: DonCanGiaThu):
  | { ok: true; dauVao: DauVaoGiaThu }
  | { ok: false; lyDo: LyDoBoQuaGiaThu } {
  if (o.chargedVnd != null) return { ok: false, lyDo: 'da_co_gia_thu' };

  const brandSlug = (o.partnerBrandSlug ?? '').trim();
  if (brandSlug === '') return { ok: false, lyDo: 'khong_ro_brand' };

  const country = (o.country ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, lyDo: 'thieu_nuoc' };

  const sms = soDuong(o.smsWeightKg);
  const weightKg = sms ?? soDuong(o.weightKg);
  if (weightKg == null) return { ok: false, lyDo: 'thieu_can' };

  const dimensions = sms != null
    ? boBa(o.smsDimLengthCm, o.smsDimWidthCm, o.smsDimHeightCm)
    : boBa(o.dimLengthCm, o.dimWidthCm, o.dimHeightCm);

  const pk = o.packagingType === 'bag' || o.packagingType === 'box' ? o.packagingType : null;

  const asOf = ngayHopLe(o.shippedAt);

  return {
    ok: true,
    dauVao: {
      brandSlug, country, weightKg, dimensions, packagingType: pk,
      ...(asOf ? { asOf } : {}),
    },
  };
}
