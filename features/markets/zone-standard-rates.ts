/**
 * Dựng danh sách rate cho một zone mới trên Shopify theo ĐÚNG khuôn đang chạy
 * của MEAN BLVD: mỗi bậc cân là một rate cùng tên "Standard shipping", phân
 * biệt bằng điều kiện cân.
 *
 * Vì sao không đẩy thẳng bảng giá hệ thống: hệ thống đặt tên rate theo hãng và
 * bậc cân ("FedEx IP (0–0.5 kg)"), còn cửa hàng đang dùng một tên duy nhất.
 * Trộn hai quy ước sẽ khiến khách thấy hàng chục lựa chọn ship trùng nhau ở
 * bước thanh toán.
 */
export interface GiaHeThong { price: number; currency: string }
export interface RateStandard { minKg: number; maxKg: number; price: number; currency: string }

/** Ưu tiên hãng theo đúng thứ tự các zone đang chạy dùng. */
const UU_TIEN_HANG = ['FedEx IP', 'DHL Express'] as const;

export function bacCanTuTenRate(ten: string): { hang: string; min: number; max: number } | null {
  const m = ten.match(/^(.+?)\s*\(\s*([\d.]+)\s*[–-]\s*([\d.]+)\s*kg\s*\)$/i);
  if (!m) return null;
  const min = Number(m[2]); const max = Number(m[3]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { hang: m[1].trim(), min, max };
}

export function dungRateStandard(rates: Record<string, GiaHeThong>): RateStandard[] {
  const theoBac = new Map<number, { max: number; theoHang: Map<string, GiaHeThong> }>();
  for (const [ten, gia] of Object.entries(rates)) {
    const b = bacCanTuTenRate(ten);
    if (!b) continue;
    const cur = theoBac.get(b.min) ?? { max: b.max, theoHang: new Map<string, GiaHeThong>() };
    cur.theoHang.set(b.hang, gia);
    theoBac.set(b.min, cur);
  }

  const bacs = [...theoBac.entries()].sort((a, b) => a[0] - b[0]);
  const out: RateStandard[] = [];
  let tren = -1; // mốc trên của bậc liền trước
  for (const [min, { max, theoHang }] of bacs) {
    const hang = UU_TIEN_HANG.find((h) => theoHang.has(h)) ?? [...theoHang.keys()][0];
    const gia = theoHang.get(hang)!;
    // Bậc đầu giữ mốc gốc; các bậc sau bắt đầu ngay trên mốc trên của bậc
    // trước (cộng 0,01) để không đơn nào khớp hai bậc cùng lúc. Nếu bảng giá
    // khuyết một bậc thì giữ mốc gốc, đừng kéo bậc sau xuống lấp chỗ trống —
    // làm vậy là tự đặt giá cho khoảng cân mà hãng chưa báo giá.
    const minKg = tren < 0 ? min : Math.max(Math.round((tren + 0.01) * 100) / 100, min);
    out.push({ minKg, maxKg: max, price: gia.price, currency: gia.currency });
    tren = max;
  }
  return out;
}
