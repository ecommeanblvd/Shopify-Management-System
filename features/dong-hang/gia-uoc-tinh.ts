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
import { fedexImpliedBase, type FedexQuoteSnap } from '@/features/shipments/fedex-quote-compare';

export interface GiaUocTinh {
  nguon: 'fedex-api' | 'ups-api' | 'bang-gia';
  /**
   * Cước nền **GIÁ GỐC — CHƯA trừ chiết khấu** (CEO chốt 13/10/2026, D-245 bản 2).
   *
   * Vòng sửa trước đặt ô này là giá NET (đã trừ chiết khấu) và đã bị xoá. Lý do đảo chiều:
   * ô Lark `Giá chiết khấu` là **công thức của Lark**, với FedEx nó tính
   * `Tổng − base − fuel − ký nhận − …`; bảng được thiết kế để nhận base GỐC, nên đưa base net
   * vào là làm công thức đó ra một số chiết khấu vô nghĩa. Đo trên 4.591 bản ghi đã điền cả
   * base lẫn tổng: **2.878 dòng gõ base > tổng (tức gốc — ĐÚNG)** vs 1.251 dòng gõ net.
   */
  base: number | null;
  /**
   * Số CHIẾT KHẤU hãng cắt khỏi cước nền, **DƯƠNG**, ghi vào ô Lark `Chiết khấu || API`.
   *
   * Dương chứ không âm vì hai lẽ: (1) cả hai nguồn API đều trả dương —
   * `lib/fedex/rate.ts` khai `discount: totalFreightDiscount (số dương = đã giảm)` và
   * `QuoteBreakdown.discount` là *"a positive number"*; (2) luật ghi ô trống bỏ mọi khoản
   * `<= 0` (xem patch-gia-uoc-tinh.ts), nên nếu theo quy ước ÂM của `shipment_charges.discount`
   * (đo thật: 2.898/2.898 dòng có chiết khấu đều âm) thì ô này sẽ KHÔNG BAO GIỜ được ghi mà
   * chẳng ai thấy gì sai.
   *
   * `null` = nguồn không nói gì về chiết khấu (UPS) — khác `0` ("hãng có cắt, bằng không").
   */
  discount: number | null;
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
 *
 * `base` dùng THẲNG `b.base` vì mô hình engine coi nó là giá **NIÊM YẾT**
 * (`QUY_UOC_BASE = 'niem_yet'`, quote.ts: *"Contract volume discount applies to the PUBLISHED
 * base only"*) — đúng nghĩa "base gốc" mà ô Lark cần, không phải trừ gì thêm. `b.discount` là
 * khoản cắt khỏi đúng base đó, engine phơi ra DƯƠNG nên ghi thẳng sang `discount`.
 * `contract_discount_pct` hiện **0 dòng** trên cả 5 account (đo thật) ⇒ hôm nay số này là 0 ⇒
 * ô `Chiết khấu || API` không được ghi (luật `<= 0`); map vẫn phải có để ngày ai thêm dòng
 * chiết khấu thì ô tự đúng, không phải nhớ sửa thêm một chỗ.
 */
export function tuEngine(b: QuoteBreakdown, totalVnd: number, heSoVnd: number | null): GiaUocTinh {
  const vnd = (x: number): number | null => (heSoVnd == null ? null : x * heSoVnd);
  return {
    nguon: 'bang-gia',
    base: vnd(b.base),
    discount: vnd(b.discount),
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
 *
 * `discount` LUÔN `null`: Rating API chỉ trả khối `NegotiatedRateCharges` (xem `LoUps` ở
 * lib/ups/rate.ts) gồm `TotalCharge` / `BaseServiceCharge` / `ItemizedCharges` — không có
 * trường chiết khấu nào, và `BaseServiceCharge` ĐÃ là *"cước nền theo giá HỢP ĐỒNG"*, tức
 * UPS đưa luôn giá sau thương lượng chứ không đưa cặp (niêm yết, trừ bao nhiêu). Suy ngược
 * chiết khấu bằng cách gọi thêm một lượt giá niêm yết rồi trừ là BỊA ra một con số không có
 * trong nguồn — ô `Chiết khấu || API` của UPS để TRỐNG, và base của UPS vì vậy là base gốc
 * *theo nghĩa của UPS* (không còn gì để trừ ra nữa).
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
    discount: null,
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
 * `fedex_rate_quotes` đã giữ sẵn từng PHỤ PHÍ (Rate API, giá hợp đồng) — các khoản đó chỉ đổi
 * tên trường sang hình chung, KHÔNG tính lại gì. Riêng `base` phải SUY RA, vì FedEx không trả:
 *
 *   base GỐC = `fedexImpliedBase(q)` + |`q.discount`|
 *
 * Từng mảnh của công thức, kèm số đo (13/10/2026, đọc `fedex_rate_quotes` + `shipment_charges`):
 *   - Cột `base_charge` (`srd.totalBaseCharge` của Rate API) **NULL 1.310/1.310 dòng** — Rate
 *     API không trả base cho giá ACCOUNT. Vì vậy tham số `base` của bản trước đã bị BỎ: nó
 *     luôn `null` nên ô "Mức giá cơ sở" của FedEx không bao giờ được điền, mà hãng chiếm
 *     2.809/4.276 kiện — nhân sự vẫn phải gõ tay đúng ô quan trọng nhất của hãng lớn nhất.
 *     Không rơi về nó khi nào nó có số: với rate ACCOUNT, FedEx trả base ĐÃ chiết khấu, tức
 *     một ngày API điền cột đó là ô Lark lặng lẽ quay về nghĩa NET — đúng cái sai vừa gỡ.
 *   - `fedexImpliedBase(q)` = `totalNetCharge − mọi phụ phí − vat` ra base **NET**, vì
 *     `totalNetCharge` vốn đã sau chiết khấu. Kiểm trên dòng có cả quote lẫn hoá đơn:
 *     `impliedBase` == `shipment_charges.base + discount` (hoá đơn lưu chiết khấu ÂM) **khớp
 *     từng đồng**, và `impliedBase + |discount|` == `shipment_charges.base` (base gốc của hoá
 *     đơn) khớp từng đồng 5/8 dòng mẫu, lệch 0,1–5 % ở 3 dòng còn lại (quote và hoá đơn khác
 *     ngày/khác cân tính cước).
 *   - `|q.discount|`: `fedex_rate_quotes.discount` lưu **DƯƠNG** — đo 1.309 dòng dương,
 *     1 dòng bằng 0, **0 dòng âm**; `lib/fedex/rate.ts` khai cùng nghĩa
 *     (`totalFreightDiscount (số dương = đã giảm)`). Vẫn bọc `Math.abs` vì quy ước dấu KHÁC
 *     NHAU giữa hai bảng cùng hệ (`shipment_charges.discount` âm 2.898/2.898) — nhánh này
 *     phải đúng dù dấu có bị đảo sau một lượt import khác.
 *
 * Thiếu `totalNetCharge` hoặc thiếu `discount` ⇒ `base` là **`null`**, KHÔNG đoán: thiếu
 * `totalNetCharge` thì chẳng có gì để trừ; thiếu `discount` thì `impliedBase` là số NET và ghi
 * nó vào ô gốc là lặp lại đúng lỗi của vòng trước. Ô trống còn sửa được bằng tay, ô đã ghi sai
 * thì không.
 */
export function tuFedexQuote(q: FedexQuoteSnap): GiaUocTinh {
  const baseNet = fedexImpliedBase(q);
  const discount = q.discount == null ? null : Math.abs(q.discount);
  return {
    nguon: 'fedex-api',
    base: baseNet == null || discount == null ? null : baseNet + discount,
    discount,
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
