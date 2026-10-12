/**
 * THUẦN: chuẩn hoá giá ước tính của một kiện về MỘT hình chung, bất kể nguồn là
 * engine bảng giá nội bộ, UPS Rating API, hay dòng FedEx quote đã lưu sẵn.
 *
 * Mỗi khoản là `null` khi nguồn KHÔNG nói gì về nó — khác hẳn `0` ("hãng có tính,
 * bằng không"). Việc ghi ngược lên Lark (task sau) dựa đúng vào phân biệt này để
 * không ghi số 0 vào ô mà mình thực ra không biết.
 */
import type { QuoteBreakdown } from '@/features/carrier-rates/engine/quote';
import type { KhoanBaoGiaUps } from '@/lib/ups/rate';
import type { FedexQuoteSnap } from '@/features/shipments/fedex-quote-compare';

export interface GiaUocTinh {
  nguon: 'fedex-api' | 'ups-api' | 'bang-gia';
  base: number | null;
  fuel: number | null;
  remote: number | null;
  demand: number | null;
  signature: number | null;
  residential: number | null;
  importHandling: number | null;
  vat: number | null;
  total: number | null;
}

/**
 * Engine (bảng giá nội bộ) luôn có ý kiến về MỌI khoản — không khớp dòng phụ phí
 * nào thì engine tự ra 0, không phải "không biết" — nên tuEngine không bao giờ
 * đẻ ra null, chỉ map thẳng.
 *
 * Ký nhận lấy `addonReference` (addon when_billed của FedEx) — đây là giá THAM
 * CHIẾU, không phải `addons` (addon apply_mode='always', đã vào total): lấy nhầm
 * `addons` là lấy một khoản KHÁC đã cộng dồn trong `total`, sai hẳn ý nghĩa cột.
 * Phí xử lý hàng nhập ưu tiên `countryFixed`; `countryFixed` = 0 (không nước nào
 * áp dụng ở lô này) mới rơi về `countryFixedReference` — giá tham chiếu khi nước
 * đích không nằm trong phạm vi country_fixed hiện hành.
 */
export function tuEngine(b: QuoteBreakdown, total: number): GiaUocTinh {
  return {
    nguon: 'bang-gia',
    base: b.base,
    fuel: b.fuel,
    remote: b.remote,
    demand: b.demand,
    signature: b.addonReference,
    residential: b.residential,
    importHandling: b.countryFixed !== 0 ? b.countryFixed : b.countryFixedReference,
    vat: b.vat,
    total,
  };
}

type NhomUps = 'fuel' | 'remote' | 'demand' | 'signature' | 'residential' | 'importHandling';

/**
 * Mã khoản UPS → nhóm của GiaUocTinh. Nhận cả mã số của Rating API (xem TEN_KHOAN
 * ở lib/ups/rate.ts — '375' Nhiên liệu, '377' Vùng sâu vùng xa…) và tên mô tả viết
 * hoa mà một số luồng khác trong repo dùng làm `ma` (ví dụ 'FUEL SURCHARGE', cùng
 * quy ước với các parser hoá đơn khác). So khớp không phân biệt hoa thường.
 *
 * '434' (Phụ phí cao điểm) xếp vào `demand` — cùng họ với Demand Surcharge của
 * FedEx, GiaUocTinh không có cột "peak" riêng. '110' (Xác nhận giao hàng) và '190'
 * (Phụ phí xử lý chung, không theo nước) không có nhóm tương ứng — mã nào không có
 * trong bảng này thì tuKhoanUps bỏ qua, không suy ra 0 cho nhóm nào.
 */
const NHOM_THEO_MA_UPS: Record<string, NhomUps> = {
  '375': 'fuel',
  'FUEL SURCHARGE': 'fuel',
  '376': 'remote',
  '377': 'remote',
  '434': 'demand',
  '121': 'signature',
  '270': 'residential',
  '573': 'importHandling',
};

/**
 * UPS Rating API không trả `base` trong danh sách khoản (nó nằm ở
 * `DongBaoGiaUps.base`, một field riêng không đi qua hàm này) và không trả VAT
 * thành khoản riêng (xem chú thích lib/ups/rate.ts: "Tiền trả về là CHƯA VAT") —
 * nên `base` và `vat` luôn là `null`, không phải suy từ khoan[].
 */
export function tuKhoanUps(khoan: KhoanBaoGiaUps[], total: number): GiaUocTinh {
  const congDon: Partial<Record<NhomUps, number>> = {};
  for (const k of khoan) {
    const nhom = NHOM_THEO_MA_UPS[k.ma.trim().toUpperCase()];
    if (!nhom) continue; // mã lạ: bỏ qua, không làm hỏng các khoản đã nhận ra
    congDon[nhom] = (congDon[nhom] ?? 0) + k.tien;
  }
  return {
    nguon: 'ups-api',
    base: null,
    fuel: congDon.fuel ?? null,
    remote: congDon.remote ?? null,
    demand: congDon.demand ?? null,
    signature: congDon.signature ?? null,
    residential: congDon.residential ?? null,
    importHandling: congDon.importHandling ?? null,
    vat: null,
    total,
  };
}

/**
 * `fedex_rate_quotes` đã giữ sẵn từng khoản (Rate API, giá hợp đồng) — chỉ đổi tên
 * trường sang hình chung, KHÔNG tính lại gì. Tính lại (vd suy base từ total trừ
 * phụ phí) là đẻ ra con số thứ hai cho cùng một kiện, trong khi `fedexImpliedBase`
 * đã tồn tại riêng cho mục đích đối soát — không nhân bản logic đó ở đây.
 */
export function tuFedexQuote(q: FedexQuoteSnap): GiaUocTinh {
  return {
    nguon: 'fedex-api',
    base: null,
    fuel: q.fuel,
    remote: q.remote,
    demand: q.demand,
    signature: q.signature,
    residential: q.residential,
    importHandling: q.countryFixed,
    vat: q.vat,
    total: q.totalNetCharge,
  };
}

/** %VAT dùng khi nguồn không tự báo VAT — đo trên hoá đơn UPS (xem vatSuyRa). */
export const VAT_PHAN_TRAM = 0.08;

/**
 * VAT đã có thì giữ nguyên (ngay cả khi bằng 0 — hãng có tính, chỉ là bằng không).
 * Chưa có thì suy ra = VAT_PHAN_TRAM × tổng mọi khoản DỊCH VỤ đã biết (base, fuel,
 * remote, demand, signature, residential, importHandling) — GiaUocTinh không có
 * cột thuế nhập khẩu riêng để trừ ra, nên "mọi khoản dịch vụ" ở đây là toàn bộ các
 * khoản khác ngoài vat/total. Không có khoản nào biết → null, không ra 0 (0 sẽ bị
 * hiểu lầm là "VAT bằng không" ở bước ghi Lark).
 */
export function vatSuyRa(g: GiaUocTinh): number | null {
  if (g.vat !== null && g.vat !== undefined) return g.vat;
  const khoanDichVu = [g.base, g.fuel, g.remote, g.demand, g.signature, g.residential, g.importHandling];
  const daBiet = khoanDichVu.filter((v): v is number => v !== null && v !== undefined);
  if (daBiet.length === 0) return null;
  const goc = daBiet.reduce((a, b) => a + b, 0);
  return Math.round(goc * VAT_PHAN_TRAM);
}
