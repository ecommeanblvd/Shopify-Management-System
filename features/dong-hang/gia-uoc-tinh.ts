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
  /**
   * International Processing Fee → ô Lark `Phí xử lý quốc tế` (CEO đổi tên ô này 14/10/2026,
   * trước là `Phí xử lý International`).
   *
   * Nguồn DUY NHẤT hôm nay: UPS Rating API mã `573` (hoá đơn gọi là `FIP`, 58.750đ/lô).
   * Trước 14/10/2026 mã này bị dồn vào `importHandling` cùng phí chuyển thuế `F/D` của UPS —
   * mà luật ghi chỉ điền ô TRỐNG, nên trên kiện có cả hai khoản thì khoản thứ hai bị bỏ qua
   * **không báo gì** (đo trên `1Z2050VDD919649050`). Tách trường là để hai khoản vào hai ô.
   *
   * `null` ở engine và FedEx, CÓ CHỦ Ý — không phải sót:
   *  - engine gộp khoản này vào `countryFixed` cùng 4 khoản khác bản chất, 0/12 dòng
   *    `country_fixed` có `service_key` ⇒ không tách được; số gộp đó ĐÃ vào `importHandling`,
   *    lấy sang đây nữa là cộng HAI LẦN.
   *  - `FedexQuoteSnap` không có trường nào tương ứng (`countryFixed` của FedEx là US/EU
   *    Inbound Processing Fee — phí xử lý hàng NHẬP, đúng ô cũ).
   */
  internationalProcessing: number | null;
  /**
   * Additional Handling → ô Lark `Phụ phí xử lý hàng` (UPS mã `190`, hoá đơn `ADH`).
   *
   * ⚠️ **CHƯA CÓ BẰNG CHỨNG NGUỒN BÁO GIÁ NÀO TRẢ KHOẢN NÀY** (đo 13/10/2026) — ô Lark sẽ
   * trống dài, và đó KHÔNG phải bug. FedEx Rate API: `ADDITIONAL_HANDLING` 0/1.310 phản hồi
   * thô còn lưu trữ. UPS Rating API: không có phản hồi nào được lưu để đếm, mà hoá đơn UPS
   * 0/37 dòng có khoản này. Engine: dòng Additional Handling 423.940đ của UPS là
   * `when_billed` ⇒ nằm trong số GỘP `addonReference`, ngoài `carrierCost`, không tách được.
   * Map sẵn vì mã `190` đã có tên ở `lib/ups/rate.ts` và nguồn có thể trả trong tương lai —
   * lúc đó ô tự đúng, không phải nhớ sửa thêm một chỗ.
   */
  additionalHandling: number | null;
  /**
   * Address Correction → ô Lark `Phí sửa địa chỉ` (CEO đổi tên 14/10/2026, trước là
   * `Phí Address Correction`).
   *
   * ⚠️ **LUÔN `null` Ở CẢ BA NGUỒN HÔM NAY — KHÔNG phải bug.** Bản chất khoản này phát sinh
   * SAU khi hãng giao hụt vì địa chỉ sai, nên báo giá lúc tạo vận đơn không thể biết. Số đo
   * 13/10/2026: `ADDRESS_CORRECTION` 0/1.310 phản hồi FedEx Rate API; UPS Rating API không có
   * mã nào cho khoản này trong `TEN_KHOAN` (9 mã); engine để dòng sai địa chỉ của Aramex (15$)
   * và UPS (300.800đ) ở `when_billed` ⇒ gộp trong `addonReference`, ngoài `carrierCost`.
   * Giữ trường để ngày nào một nguồn trả thì có chỗ đổ, và để ô Lark có khoá map thật thay vì
   * một cột không ai biết thuộc về đâu.
   */
  addressCorrection: number | null;
  /**
   * GoGreen Plus (SAF) của DHL → ô Lark `GoGreen Plus-Basic`. Nguồn là
   * `QuoteBreakdown.perStep` (`per_step_fixed`, 1.900đ/0,5kg bậc cân).
   *
   * Chỉ engine có khoản này; FedEx (`FedexQuoteSnap` không có trường nào — xem
   * `reconcile-diagnose.ts`: *"FedEx has none"*) và UPS (`TEN_KHOAN` 9 mã, không
   * mã SAF nào) đều trả `null` = KHÔNG BIẾT, khác `0` ("hãng có tính, bằng không").
   *
   * Ô Lark đã có sẵn nhưng đường giá ước tính chưa bao giờ điền, nên ~3.800đ/kiện
   * nằm trong ô Tổng mà không ô thành phần nào đựng — 3.033/3.033 kiện DHL.
   */
  gogreen: number | null;
  vat: number | null;
  total: number | null;
  /** Mã khoản của nguồn mà không có nhóm tương ứng ở trên — nêu ra để người nhập
   *  thấy tiền chưa rơi vào đâu, thay vì để nó lặng lẽ biến mất khỏi bảng phân rã
   *  (xem `maLa` ở features/carrier-rates/ap/ups-invoice-xml.ts, cùng cách làm). */
  maLa: string[];
  /**
   * Giá có được hỏi bằng ĐÚNG thông số của vận đơn không (CEO 15/10/2026).
   *
   * `true` = đã đọc loại bao gói / cân / kích thước / cờ nhà dân / ký nhận / ngày gửi từ chính
   * mã vận đơn qua Track API rồi mới hỏi Rate API ⇒ khớp con số hãng hiện trên cổng.
   * `false` = hãng chưa có dữ liệu cho mã (nhãn vừa tạo) nên đã phải DỰNG LẠI lô hàng từ cột
   * của mình — số vẫn dùng được nhưng có thể lệch, và tầng trên PHẢI nói ra.
   *
   * Vắng mặt ở nguồn engine/UPS: chúng vốn không có khái niệm này (bảng giá nội bộ không hỏi
   * hãng, UPS Rating API không tra theo mã vận đơn).
   */
  theoVanDon?: boolean;
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
 * `gogreen` lấy `perStep`. `perStep` là số GỘP mọi dòng `per_step_fixed`, nên map
 * thẳng sang ô GoGreen chỉ đúng khi mọi dòng per_step đều LÀ GoGreen — và đó đúng
 * là hiện trạng: đo `carrier_surcharges` 13/10/2026 có **3/3 dòng `per_step_fixed`**
 * đều là `GoGreen Plus (SAF)` của DHL (1.900đ/0,5kg), và ba dòng là ba BẢN PHIÊN
 * NGÀY của cùng một khoản (2025-01-01→2025-09-29, 2025-09-29→2026-01-01,
 * 2026-01-01→∞) nên `isApplicable` chỉ cho MỘT dòng áp tại một ngày. Hãng khác: 0
 * dòng ⇒ `perStep` = 0 ⇒ luật `<= 0` để ô trống. Ngày nào ai thêm một dòng
 * `per_step_fixed` KHÁC bản chất (không phải GoGreen) thì phải tách `QuoteBreakdown`
 * trước, chứ không để nó lặng lẽ chảy vào ô GoGreen.
 *
 * KHÔNG map ô Lark `Phí rủi ro gia tăng` (Elevated Risk) — CỐ Ý, không phải sót.
 * Engine gộp Elevated Risk vào `countryFixed` cùng 4 khoản khác bản chất (Restricted
 * Destination, phí xử lý hàng nhập US/EU của FedEx, phí xử lý quốc tế UPS, phí hải
 * quan đầu xuất Aramex); đo 12 dòng `country_fixed` thì **0 dòng có `service_key`**,
 * tức không có trường cấu trúc nào tách được — chỉ còn `note` là chữ người gõ tay.
 * Mà `countryFixed` ĐÃ đi vào `importHandling`, nên ghi nó vào ô kia nữa là cộng
 * 918.000đ hai lần trên 370 kiện DHL, đúng vào ô dùng để đối soát. `reconcile-
 * diagnose.ts` chốt cùng quy ước: engine `countryFixed` đối chiếu với TỔNG
 * `elevatedRisk + importHandling` của hoá đơn. Muốn map đúng thì thêm `service_key`
 * cho các dòng `country_fixed` trước.
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
    /* Ba ô mới đều `null` ở engine — xem bình luận của từng trường trong `GiaUocTinh`.
     * Tóm lại: phần "phí xử lý quốc tế" nằm trong số GỘP `countryFixed` (đã vào
     * `importHandling`) nên lấy lại là cộng hai lần; còn Additional Handling và Address
     * Correction là dòng `when_billed` ⇒ engine nhốt trong `addonReference`, ngoài
     * `carrierCost`, không tách được khoản nào. */
    internationalProcessing: null,
    additionalHandling: null,
    addressCorrection: null,
    gogreen: vnd(b.perStep),
    vat: vnd(b.vat),
    total: heSoVnd == null ? null : totalVnd,
    maLa: [],
  };
}

type NhomUps = 'fuel' | 'remote' | 'demand' | 'signature' | 'residential' | 'importHandling'
  | 'internationalProcessing' | 'additionalHandling';

/**
 * Mã khoản UPS (Rating API, số — xem TEN_KHOAN ở lib/ups/rate.ts) → nhóm của
 * GiaUocTinh. So khớp không phân biệt hoa thường / khoảng trắng thừa (`ma` do
 * UPS trả, phòng khi có đệm) — nhưng UPS chỉ thật sự trả MÃ SỐ, không trả mô tả
 * chữ, nên bảng này chỉ chứa mã số.
 *
 * '434' (Phụ phí cao điểm) xếp vào `demand` — cùng họ với Demand Surcharge của
 * FedEx, GiaUocTinh không có cột "peak" riêng. '110' (Xác nhận giao hàng) vẫn
 * KHÔNG có nhóm tương ứng — mã nào không có trong bảng này bị tuKhoanUps gom vào
 * `maLa` (xem dưới), KHÔNG lặng lẽ bỏ qua.
 *
 * HAI THAY ĐỔI ngày 14/10/2026, cả hai vì CEO tạo ô riêng trên Lark:
 *  - '573' (International Processing Fee, `FIP`) chuyển từ `importHandling` sang
 *    `internationalProcessing`. Trước đó nó dùng CHUNG ô `Phí xử lý hàng nhập` với phí chuyển
 *    thuế `F/D` của UPS; luật "chỉ điền ô trống" khiến khoản thứ hai bị bỏ qua không báo gì
 *    (kiện `1Z2050VDD919649050`). Để nguyên map cũ sau khi CEO tạo ô mới thì hoặc ô mới trống
 *    mãi, hoặc ai đó map thêm và cùng một 58.750đ được cộng hai lần ở hai ô.
 *  - '190' (Additional Handling) từ `maLa` thành `additionalHandling`. CHƯA có bằng chứng
 *    Rating API thật sự trả mã này (hoá đơn UPS 0/37 dòng) — map trước để khi nó xuất hiện
 *    thì tiền vào đúng ô, chứ không nằm trong `maLa` chờ người đọc nhật ký.
 *
 * KHÔNG có mã nào cho Address Correction: `TEN_KHOAN` ở lib/ups/rate.ts có đúng 9 mã và không
 * mã nào là khoản đó ⇒ `addressCorrection` của nguồn UPS luôn `null`.
 */
const NHOM_THEO_MA_UPS: Record<string, NhomUps> = {
  '375': 'fuel',
  '376': 'remote',
  '377': 'remote',
  '434': 'demand',
  '121': 'signature',
  '190': 'additionalHandling',
  '270': 'residential',
  '573': 'internationalProcessing',
};

/**
 * UPS → hình chung, theo ĐÚNG quy ước Lark đang dùng (đo 16/10/2026, chốt bằng số liệu chứ
 * không phải bằng ý thích).
 *
 * Mọi Ô KHOẢN lấy giá NIÊM YẾT, ô TỔNG lấy giá HỢP ĐỒNG, chiết khấu là hiệu hai tổng:
 *
 *   kiện `1Z2050VDD900243620`, dịch vụ 65:
 *     base niêm yết 3.028.915   = Lark "Mức giá cơ sở"        3.028.915 ✓
 *     nhiên liệu     1.661.215   = Lark "Phụ phí nhiên liệu"   1.661.215 ✓
 *     demand/resi/ký nhận/FIP    = Lark, khớp từng đồng         ✓
 *     tổng HỢP ĐỒNG  1.268.060   = Lark "INS | Chi phí Tổng"   1.268.060 ✓
 *   kiểm chéo `1Z2050VDD901552400` khớp cả 6 khoản.
 *
 * Bản trước ghi base HỢP ĐỒNG (614.760 cho chính kiện trên) — lệch gần 5 lần, và đó là một
 * trong bốn lý do UPS khớp Lark **0/37 kiện**. Cùng quy ước với FedEx (D-245: ô base là giá
 * GỐC, chưa trừ chiết khấu), không phải quy ước riêng cho UPS.
 *
 * `vat` LUÔN `null` và người gọi KHÔNG được cộng VAT vào tổng: ô VAT của kiện UPS trên Lark
 * để TRỐNG, và tổng hợp đồng khớp Lark y nguyên khi không cộng gì. Bản trước cộng 8% VAT của
 * tài khoản vào ô Tổng — lỗi thứ tư.
 *
 * `discount` = `tongNiemYet - tong`, DƯƠNG. UPS trả cả hai khối trong CÙNG một phản hồi nên
 * đây là phép trừ hai con số có thật, không phải suy bừa (đính chính ghi chú cũ của chính tệp
 * này, vốn viết là "bịa" — sai).
 *
 * Mã không nhận ra được gom vào `maLa` thay vì bỏ qua lặng lẽ — một khoản tiền thật của UPS
 * mà không ai biết nó rơi đâu là lỗi âm thầm.
 */
export function tuKhoanUps(
  /** Khoản theo giá NIÊM YẾT (`khoanNiemYet`), KHÔNG phải khoản hợp đồng. */
  khoan: KhoanBaoGiaUps[],
  /** Tổng theo giá HỢP ĐỒNG — số cuối cùng phải trả, cũng là số Lark điền ở ô Tổng. */
  total: number,
  /** Cước nền theo giá NIÊM YẾT (`baseNiemYet`). */
  base: number | null,
  /** Tổng theo giá NIÊM YẾT — để suy chiết khấu. `null` = UPS không trả khối niêm yết. */
  tongNiemYet: number | null,
): GiaUocTinh {
  const congDon: Partial<Record<NhomUps, number>> = {};
  const maLa: string[] = [];
  for (const k of khoan) {
    const nhom = NHOM_THEO_MA_UPS[k.ma.trim().toUpperCase()];
    if (!nhom) { maLa.push(k.ma); continue; }
    congDon[nhom] = (congDon[nhom] ?? 0) + k.tien;
  }
  /* Chiết khấu chỉ có nghĩa khi CÓ CẢ HAI tổng. Thiếu khối niêm yết thì `null` = không biết,
   * KHÔNG phải 0 — ghi 0 vào ô là khoá ô ở 0 vĩnh viễn (luật dựng patch). */
  const discount = tongNiemYet == null || tongNiemYet <= 0 ? null : tongNiemYet - total;
  return {
    nguon: 'ups-api',
    base,
    discount,
    fuel: congDon.fuel ?? null,
    remote: congDon.remote ?? null,
    demand: congDon.demand ?? null,
    signature: congDon.signature ?? null,
    residential: congDon.residential ?? null,
    /* `importHandling` KHÔNG còn nhận mã `573` từ 14/10/2026 (nó sang
     * `internationalProcessing`). Không mã UPS nào còn trỏ vào nhóm này, nên ô
     * `Phí xử lý hàng nhập` của kiện UPS từ nay LUÔN trống — đúng ý: khoản UPS thật sự thu
     * tên là *International Processing*, và `Phí xử lý hàng nhập` là ô của phí nhập US/EU
     * (FedEx) + phí hải quan đầu xuất (Aramex). Giữ dòng này (thay vì bỏ hẳn khỏi `NhomUps`)
     * để ngày nào UPS trả một mã đúng nghĩa "xử lý hàng nhập" thì có chỗ đổ. */
    importHandling: congDon.importHandling ?? null,
    internationalProcessing: congDon.internationalProcessing ?? null,
    additionalHandling: congDon.additionalHandling ?? null,
    /* UPS Rating API không có mã nào cho Address Correction (`TEN_KHOAN`: 9 mã) ⇒ nguồn KHÔNG
     * NÓI GÌ. `null` chứ không 0, cùng lý do như `gogreen` dưới đây. */
    addressCorrection: null,
    /* GoGreen là khoản riêng của DHL — `TEN_KHOAN` của UPS (9 mã) không có mã SAF nào, nên
     * nguồn này KHÔNG NÓI GÌ về khoản đó. `null` chứ không 0: ghi 0 lên Lark là khoá ô ở 0
     * vĩnh viễn, đường ghi từ hoá đơn sau đó không điền được số thật vào nữa. */
    gogreen: null,
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
    /* Ba ô mới đều `null` ở FedEx. `countryFixed` của FedEx là `ANCILLARY_FEE` = US/EU Inbound
     * Processing Fee ⇒ thuộc ô `Phí xử lý hàng nhập`, KHÔNG phải `Phí xử lý quốc tế` (ô đó là
     * khoản `FIP` của UPS). Còn Additional Handling và Address Correction thì
     * `FedexQuoteSnap` không có trường nào, và đếm trên 1.310 phản hồi Rate API thô còn lưu
     * trữ: `ADDITIONAL_HANDLING` 0 lần, `ADDRESS_CORRECTION` 0 lần — Rate API chưa bao giờ
     * trả hai khoản này. Cũng vì vậy chúng KHÔNG được lọt vào `fedexImpliedBase`: thêm một
     * khoản FedEx không thu vào phép trừ là làm ô `Mức giá cơ sở` nhỏ đi đúng bằng số bịa. */
    internationalProcessing: null,
    additionalHandling: null,
    addressCorrection: null,
    /* `FedexQuoteSnap` không có trường GoGreen/SAF nào (`reconcile-diagnose.ts`: *"DHL GoGreen
     * is a `per_step_fixed` surcharge — FedEx has none"*). Thêm khoản này vào
     * `fedexImpliedBase` sẽ làm ô `Mức giá cơ sở` nhỏ đi đúng bằng một khoản FedEx không thu. */
    gogreen: null,
    vat: q.vat,
    total: q.totalNetCharge,
    maLa: [],
  };
}
