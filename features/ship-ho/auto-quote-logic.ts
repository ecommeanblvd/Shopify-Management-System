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

  return {
    ok: true,
    dauVao: { country, weightKg, postcode: o.postcode, city: o.city, dimensions, canTheo },
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
