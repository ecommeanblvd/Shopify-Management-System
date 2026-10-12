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
  /** Mã khoản của nguồn mà không có nhóm tương ứng ở trên — nêu ra để người nhập
   *  thấy tiền chưa rơi vào đâu, thay vì để nó lặng lẽ biến mất khỏi bảng phân rã
   *  (xem `maLa` ở features/carrier-rates/ap/ups-invoice-xml.ts, cùng cách làm). */
  maLa: string[];
}

/**
 * Engine (bảng giá nội bộ) → hình chung.
 *
 * ĐƠN VỊ TIỀN là cái bẫy chính ở đây. `QuoteBreakdown` nằm ở **cost currency của
 * account** (quote.ts: *"in the carrier's cost currency"*), còn MỌI cột chi phí
 * trên Lark là **VND**. `cost_currency` của Aramex HN là USD (đo thật), nên bản
 * đầu ghi `base = 50` (USD) cạnh ô Tổng 1.877.160 (VND) — hai đơn vị trong một
 * khối ô, không ai sửa lại được. Vì vậy mọi khoản phải đi qua `heSoVnd`, lấy
 * đúng hệ số mà `vndCost` dùng (xem `heSoVnd` ở quote-order-carriers.ts — KHÔNG
 * tự chế hệ số thứ hai). `heSoVnd == null` = không biết quy thế nào ⇒ trả `null`
 * HẾT, kể cả `total`: thà không ghi gì còn hơn ghi một con số sai đơn vị.
 *
 * `signature` LUÔN `null` ở nguồn này. `QuoteBreakdown` chỉ có hai số gộp:
 * `addons` (apply_mode='always', ĐÃ nằm trong total) và `addonReference` (tổng
 * MỌI dòng addon_fixed when_billed chưa vào total) — không tách được riêng
 * khoản ký nhận. Bản đầu lấy `addonReference` và với Aramex ra **552,5 USD**:
 * pallet không xếp chồng 315 + quá cân 110 + ngoại cỡ 82,5 + DDP 30 + sai địa
 * chỉ 15 — toàn phí THEO CA chưa ai thu, cộng lại gọi là "phí ký nhận". Chính
 * `quote-order-carriers.ts:81-84` đã cảnh báo đúng bẫy này (bug 09/07). Không
 * tách được khoản đúng thì trả "không biết", KHÔNG trả một con số gộp sai.
 *
 * `importHandling` chỉ lấy `countryFixed` (dòng đã vào total), KHÔNG rơi về
 * `countryFixedReference` — cùng một lý do: reference là *giá tham chiếu chưa
 * thu*, ghi nó vào ô chi phí là biến một khoản chưa phát sinh thành khoản đã có.
 */
export function tuEngine(b: QuoteBreakdown, totalVnd: number, heSoVnd: number | null): GiaUocTinh {
  const vnd = (x: number): number | null => (heSoVnd == null ? null : x * heSoVnd);
  return {
    nguon: 'bang-gia',
    base: vnd(b.base),
    fuel: vnd(b.fuel),
    remote: vnd(b.remote),
    demand: vnd(b.demand),
    signature: null,
    residential: vnd(b.residential),
    importHandling: vnd(b.countryFixed),
    vat: vnd(b.vat),
    total: heSoVnd == null ? null : totalVnd,
    maLa: [],
  };
}

type NhomUps = 'fuel' | 'remote' | 'demand' | 'signature' | 'residential' | 'importHandling';

/**
 * Mã khoản UPS (Rating API, số — xem TEN_KHOAN ở lib/ups/rate.ts) → nhóm của
 * GiaUocTinh. So khớp không phân biệt hoa thường / khoảng trắng thừa (`ma` do
 * UPS trả, phòng khi có đệm) — nhưng UPS chỉ thật sự trả MÃ SỐ, không trả mô tả
 * chữ, nên bảng này chỉ chứa mã số.
 *
 * '434' (Phụ phí cao điểm) xếp vào `demand` — cùng họ với Demand Surcharge của
 * FedEx, GiaUocTinh không có cột "peak" riêng. '110' (Xác nhận giao hàng) và
 * '190' (Phụ phí xử lý chung, không theo nước) không có nhóm tương ứng — mã nào
 * không có trong bảng này bị tuKhoanUps gom vào `maLa` (xem dưới), KHÔNG lặng lẽ
 * bỏ qua.
 */
const NHOM_THEO_MA_UPS: Record<string, NhomUps> = {
  '375': 'fuel',
  '376': 'remote',
  '377': 'remote',
  '434': 'demand',
  '121': 'signature',
  '270': 'residential',
  '573': 'importHandling',
};

/**
 * UPS Rating API không trả `base` trong DANH SÁCH khoản — nó nằm ở
 * `DongBaoGiaUps.base`, một field riêng — nên `base` phải được caller truyền
 * vào. Bản đầu không truyền và để `base: null`: ô "Mức giá cơ sở" của UPS không
 * bao giờ được điền, mà gốc tính VAT cũng mất phần lớn nhất nên VAT suy ra nhỏ
 * hơn thực tế nhiều lần (test cũ xanh vì nó tự truyền `base: 1000`).
 *
 * `vat` vẫn `null` ở đây: UPS không trả VAT thành khoản riêng (lib/ups/rate.ts:
 * "Tiền trả về là CHƯA VAT") — caller cộng VAT theo %VAT CỦA TÀI KHOẢN, không
 * phải một con số 8% cứng ở tệp này.
 *
 * Mã không nhận ra được gom vào `maLa` thay vì bỏ qua lặng lẽ — một khoản tiền
 * thật của UPS mà không ai biết nó rơi đâu là lỗi âm thầm, giống cách `maLa` ở
 * features/carrier-rates/ap/ups-invoice-xml.ts nêu mã lạ cho người nhập thấy.
 */
export function tuKhoanUps(khoan: KhoanBaoGiaUps[], total: number, base: number | null): GiaUocTinh {
  const congDon: Partial<Record<NhomUps, number>> = {};
  const maLa: string[] = [];
  for (const k of khoan) {
    const nhom = NHOM_THEO_MA_UPS[k.ma.trim().toUpperCase()];
    if (!nhom) { maLa.push(k.ma); continue; }
    congDon[nhom] = (congDon[nhom] ?? 0) + k.tien;
  }
  return {
    nguon: 'ups-api',
    base,
    fuel: congDon.fuel ?? null,
    remote: congDon.remote ?? null,
    demand: congDon.demand ?? null,
    signature: congDon.signature ?? null,
    residential: congDon.residential ?? null,
    importHandling: congDon.importHandling ?? null,
    vat: null,
    total,
    maLa,
  };
}

/**
 * `fedex_rate_quotes` đã giữ sẵn từng khoản (Rate API, giá hợp đồng) — chỉ đổi tên
 * trường sang hình chung, KHÔNG tính lại gì. Tính lại (vd suy base từ total trừ
 * phụ phí) là đẻ ra con số thứ hai cho cùng một kiện, trong khi `fedexImpliedBase`
 * đã tồn tại riêng cho mục đích đối soát — không nhân bản logic đó ở đây.
 *
 * `base` ĐỌC từ cột `fedex_rate_quotes.base_charge` (caller truyền vào — nó không
 * nằm trong `FedexQuoteSnap`, kiểu dùng chung với đối soát). Bản đầu để `null`
 * nên ô "Mức giá cơ sở" KHÔNG BAO GIỜ được điền cho FedEx — hãng chiếm 2.809/4.276
 * kiện, tức nhân sự vẫn phải gõ tay đúng ô quan trọng nhất của hãng lớn nhất.
 * Vẫn KHÔNG dùng `fedexImpliedBase` ở đây: đó là số SUY RA cho đối soát, lấy nó
 * làm số ghi lên Lark là trộn hai định nghĩa "base" vào cùng một ô.
 */
export function tuFedexQuote(q: FedexQuoteSnap, base: number | null): GiaUocTinh {
  return {
    nguon: 'fedex-api',
    base,
    fuel: q.fuel,
    remote: q.remote,
    demand: q.demand,
    signature: q.signature,
    residential: q.residential,
    importHandling: q.countryFixed,
    vat: q.vat,
    total: q.totalNetCharge,
    maLa: [],
  };
}
