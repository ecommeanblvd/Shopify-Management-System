import { describe, it, expect } from 'vitest';
import { tuEngine, tuKhoanUps, tuFedexQuote } from './gia-uoc-tinh';
import type { QuoteBreakdown } from '@/features/carrier-rates/engine/quote';

describe('tuEngine', () => {
  const b = { base: 100, fuel: 20, remote: 5, demand: 3, residential: 7, vat: 13,
    addonReference: 9, countryFixed: 11, countryFixedReference: 77, discount: 0, perStep: 4,
    /* …phần còn lại của QuoteBreakdown */ } as QuoteBreakdown;

  it('account tính bằng VND (hệ số 1) thì map thẳng từng khoản', () => {
    expect(tuEngine(b, 155, 1)).toMatchObject({ nguon: 'bang-gia', base: 100, fuel: 20,
      remote: 5, demand: 3, residential: 7, importHandling: 11, vat: 13, total: 155 });
  });

  /* C1: `QuoteBreakdown` ở đơn vị cost currency của account (Aramex HN = USD) nhưng MỌI cột
   * chi phí Lark là VND. Không quy đổi là ghi `base = 50` (USD) cạnh ô Tổng 1.877.160 (VND). */
  it('account tính bằng USD thì mọi khoản phải quy về VND cùng hệ số với ô Tổng', () => {
    const g = tuEngine(b, 2_600_000, 26_000);
    expect(g.base).toBe(100 * 26_000);
    expect(g.fuel).toBe(20 * 26_000);
    expect(g.vat).toBe(13 * 26_000);
  });

  /* Không biết quy đổi thế nào thì KHÔNG BIẾT HẾT — kể cả ô Tổng, vì `vndCost` lúc đó cũng
   * chỉ là phỏng đoán best-effort của bảng so cước, không đủ để ghi vào ô tiền VND. */
  it('không biết hệ số quy đổi → mọi khoản và cả tổng đều null, không ghi gì', () => {
    const g = tuEngine(b, 155, null);
    expect([g.base, g.fuel, g.remote, g.demand, g.residential, g.importHandling, g.vat, g.total])
      .toEqual([null, null, null, null, null, null, null, null]);
  });

  /* C1(b): `addonReference` là TỔNG MỌI dòng addon_fixed when_billed — với Aramex là 552,5 USD
   * phí theo ca (pallet/quá cân/ngoại cỡ/DDP/sai địa chỉ) chưa ai thu. Engine không tách được
   * riêng khoản ký nhận ⇒ phải trả null, không được trả một con số gộp. */
  it('ký nhận là null, KHÔNG lấy addonReference gộp', () => {
    expect(tuEngine(b, 155, 1).signature).toBeNull();
  });

  /* C2 (kèm theo): `countryFixedReference` cũng là giá THAM CHIẾU chưa thu — không rơi về nó. */
  it('phí xử lý hàng nhập chỉ lấy countryFixed, không rơi về countryFixedReference', () => {
    const g = tuEngine({ ...b, countryFixed: 0 } as QuoteBreakdown, 155, 1);
    expect(g.importHandling).toBe(0);
  });

  /* D-245 bản 2 (CEO 13/10/2026): ô `Mức giá cơ sở` nhận giá GỐC. Với engine không phải tính
   * gì — `QuoteBreakdown.base` ĐÃ là giá niêm yết (`QUY_UOC_BASE = 'niem_yet'`; quote.ts:
   * "Contract volume discount applies to the PUBLISHED base only"), chiết khấu nằm ở một
   * trường riêng. Test này khoá đúng điều đó lại: vòng sửa trước ghi `base − discount` vào ô
   * và đã bị xoá, nên phải có cái chặn nếu ai định trừ lần nữa. */
  it('base là giá NIÊM YẾT, KHÔNG trừ chiết khấu khỏi nó', () => {
    const g = tuEngine({ ...b, discount: 30 } as QuoteBreakdown, 155, 1);
    expect(g.base).toBe(100); // 100, không phải 70
  });

  /* Chiết khấu của engine phơi ra DƯƠNG (quote.ts: "surfaced as a positive number"), và ô
   * `Chiết khấu || API` cần dương vì luật ghi bỏ mọi khoản `<= 0`. */
  it('chiết khấu ghi nguyên số DƯƠNG của engine', () => {
    expect(tuEngine({ ...b, discount: 30 } as QuoteBreakdown, 155, 1).discount).toBe(30);
  });

  /* `discount` cũng là TIỀN nên phải đi qua cùng hệ số quy đổi như mọi khoản khác — Aramex HN
   * tính bằng USD, để nguyên là ghi 30 (USD) vào ô VND cạnh base 2.600.000 (VND). */
  it('chiết khấu quy về VND cùng hệ số với các khoản khác', () => {
    expect(tuEngine({ ...b, discount: 30 } as QuoteBreakdown, 2_600_000, 26_000).discount)
      .toBe(30 * 26_000);
  });
  it('không biết hệ số quy đổi → chiết khấu cũng null', () => {
    expect(tuEngine({ ...b, discount: 30 } as QuoteBreakdown, 155, null).discount).toBeNull();
  });

  /* GoGreen Plus (SAF) của DHL — ô Lark `GoGreen Plus-Basic` đã có sẵn, trước đây KHÔNG được
   * điền nên ~3.800đ/kiện nằm trong ô Tổng mà không ô thành phần nào đựng (3.033/3.033 kiện
   * DHL có khoản này). Nguồn là `QuoteBreakdown.perStep`.
   *
   * `perStep` GỘP mọi dòng `per_step_fixed`, nên map thẳng nó sang ô GoGreen chỉ đúng khi mọi
   * dòng per_step ĐỀU là GoGreen. Đo `carrier_surcharges` 13/10/2026: **3/3 dòng
   * `per_step_fixed`** đều là `GoGreen Plus (SAF)` của DHL, 1.900đ/0,5kg, và chúng là ba BẢN
   * PHIÊN NGÀY của cùng một khoản (cửa sổ 2025-01-01→2025-09-29, 2025-09-29→2026-01-01,
   * 2026-01-01→∞) nên `isApplicable` chỉ cho MỘT dòng áp tại một ngày — không có chuyện cộng
   * dồn hai phiên bản. Hãng khác: 0 dòng. */
  it('GoGreen lấy từ perStep và quy về VND cùng hệ số', () => {
    expect(tuEngine(b, 155, 1).gogreen).toBe(4);
    expect(tuEngine(b, 2_600_000, 26_000).gogreen).toBe(4 * 26_000);
  });
  it('không biết hệ số quy đổi → GoGreen cũng null, không ghi', () => {
    expect(tuEngine(b, 155, null).gogreen).toBeNull();
  });

  /* Hãng không có dòng `per_step_fixed` nào (FedEx/Aramex/UPS trên bảng giá) ⇒ `perStep` = 0.
   * 0 là thông tin THẬT ("engine không tính khoản này"), nhưng luật ghi ô trống của
   * `patch-gia-uoc-tinh.ts` bỏ mọi khoản `<= 0` nên ô vẫn để trống — đúng ý. Test khoá lại để
   * không ai "sửa" thành `null` rồi tưởng là khác nhau. */
  it('hãng không có dòng per_step → gogreen = 0 (ô vẫn không được ghi vì luật <= 0)', () => {
    expect(tuEngine({ ...b, perStep: 0 } as QuoteBreakdown, 155, 1).gogreen).toBe(0);
  });

  /* CHỐNG TÍNH TRÙNG: `countryFixed` phải chỉ đi vào `importHandling`, KHÔNG được nhân bản
   * sang ô `Phí rủi ro gia tăng`. Engine gộp cả Elevated Risk, Restricted Destination, phí xử
   * lý hàng nhập US/EU, phí xử lý quốc tế UPS và phí hải quan đầu xuất Aramex vào MỘT số
   * `countryFixed` (12 dòng `country_fixed`, **0 dòng có `service_key`** ⇒ không có trường cấu
   * trúc nào tách được), nên ghi nó vào hai ô là cộng 918.000đ hai lần. */
  it('countryFixed chỉ vào importHandling, KHÔNG nhân bản sang khoản nào khác', () => {
    const g = tuEngine(b, 155, 1);
    expect(g.importHandling).toBe(11);
    expect(Object.values(g).filter((v) => v === 11)).toHaveLength(1);
  });

  /* Ô mới `Phí xử lý quốc tế` KHÔNG được lấy từ `countryFixed`. Engine gộp phần "phí xử lý
   * quốc tế UPS 58.750đ" vào đúng số `countryFixed` đó cùng 4 khoản khác bản chất và 0/12 dòng
   * `country_fixed` có `service_key` ⇒ không trường nào tách ra được. `countryFixed` ĐÃ vào
   * `importHandling`, nên đổ nó sang ô mới nữa là cộng HAI LẦN — đúng cái bẫy mà việc tách ô
   * này sinh ra, nên phải có test chặn. */
  it('ba ô mới đều null ở engine — KHÔNG lấy lại countryFixed (sẽ cộng hai lần)', () => {
    const g = tuEngine(b, 155, 1);
    expect([g.internationalProcessing, g.additionalHandling, g.addressCorrection])
      .toEqual([null, null, null]);
  });

  /* Address Correction và Additional Handling của engine nằm trong `addonReference` — số GỘP
   * MỌI dòng `when_billed` (với Aramex là 552,5 USD gồm pallet/quá cân/ngoại cỡ/DDP/sai địa
   * chỉ), KHÔNG vào `carrierCost`. Lấy nó ra là biến phí CHƯA AI THU thành khoản đã phát sinh,
   * đúng lỗi mà `quote-order-carriers.ts:81-84` đã cảnh báo (bug 09/07). */
  it('KHÔNG rơi về addonReference cho hai ô "theo ca" — đó là giá tham chiếu chưa thu', () => {
    const g = tuEngine(b, 155, 1);
    expect(Object.values(g).filter((v) => v === 9)).toHaveLength(0); // addonReference = 9
  });
});

describe('tuKhoanUps', () => {
  it('cộng dồn khoản trùng mã', () => {
    // '375' = Nhiên liệu (mã số thật của Rating API, xem TEN_KHOAN ở lib/ups/rate.ts).
    expect(tuKhoanUps([{ ma: '375', tien: 10 }, { ma: '375', tien: 5 }], 15, null, null).fuel).toBe(15);
  });
  /* Review Focus #3: UPS KHÔNG trả VAT thành khoản riêng. Phải là null, không phải 0. */
  it('UPS không có VAT → vat là null, KHÔNG phải 0', () => {
    expect(tuKhoanUps([{ ma: '375', tien: 10 }], 10, null, null).vat).toBeNull();
  });
  it('khoản UPS không biết xếp đâu thì bỏ qua, không làm hỏng các khoản khác', () => {
    expect(tuKhoanUps([{ ma: 'KHOAN_LA', tien: 99 }, { ma: '375', tien: 10 }], 109, null, null).fuel).toBe(10);
  });
  /* '110' (Xác nhận giao hàng) là mã THẬT của UPS nhưng không có nhóm tương ứng trong
   * GiaUocTinh — phải nêu ra ở maLa, không được biến mất lặng lẽ như tiền không ai biết.
   * (Trước 14/10/2026 test này dùng mã '190'; '190' nay đã có ô riêng trên Lark nên phải
   * chọn một mã KHÁC còn vô chủ, nếu không ta mất hẳn lá chắn cho cơ chế `maLa`.) */
  it('mã thật nhưng chưa có nhóm (110) đi vào maLa, không làm hỏng khoản khác', () => {
    const g = tuKhoanUps([{ ma: '110', tien: 50 }, { ma: '375', tien: 10 }], 60, null, null);
    expect(g.maLa).toEqual(['110']);
    expect(g.fuel).toBe(10);
  });

  /* ───── Ba ô mới trên Lark (CEO đổi tên 14/10/2026) ─────
   *
   * Mã `573` (International Processing Fee / `FIP`, 58.750đ/lô) TRƯỚC ĐÂY chảy vào
   * `importHandling` — tức dùng CHUNG ô `Phí xử lý hàng nhập` với phí chuyển thuế `F/D` của
   * UPS. Luật ghi "chỉ điền ô trống" khiến trên kiện có cả hai khoản thì khoản thứ hai bị bỏ
   * qua KHÔNG BÁO GÌ (đo thật trên `1Z2050VDD919649050`: ô đã có 600.425đ nên 58.750đ biến
   * mất). Test này khoá việc tách ô lại. */
  it('mã 573 vào `internationalProcessing`, KHÔNG còn vào `importHandling`', () => {
    const g = tuKhoanUps([{ ma: '573', tien: 58_750 }, { ma: '375', tien: 10 }], 58_760, null, null);
    expect(g.internationalProcessing).toBe(58_750);
    expect(g.importHandling).toBeNull();
  });

  /* CHỐNG TÍNH TRÙNG — hậu quả tệ nhất của việc tách ô này: nếu ai map `573` vào CẢ HAI nhóm
   * (vì "ô cũ đang có số, giữ cho khỏi hụt") thì cùng một 58.750đ được ghi vào hai ô Lark và
   * người cộng tay ra tổng lớn hơn hoá đơn. Đếm số lần giá trị xuất hiện là cách bắt trực
   * tiếp, giống test `countryFixed` của engine ở trên. */
  it('một khoản 573 chỉ xuất hiện ĐÚNG MỘT nhóm, không nhân bản', () => {
    // `total` cố ý KHÁC 58.750 để phép đếm chỉ bắt các NHÓM KHOẢN, không đếm cả ô Tổng.
    const g = tuKhoanUps([{ ma: '573', tien: 58_750 }], 1_000_000, null, null);
    expect(Object.values(g).filter((v) => v === 58_750)).toHaveLength(1);
  });

  /* Mã `190` (Additional Handling) từ `maLa` thành một nhóm thật. ⚠️ Lưu ý cho người đọc sau:
   * CHƯA CÓ BẰNG CHỨNG Rating API thật sự trả mã này — hoá đơn UPS 0/37 dòng có khoản, và
   * không có phản hồi Rating nào được lưu để đếm. Test dựng khoản bằng tay để khoá ĐƯỜNG ĐI
   * (mã → ô nào) chứ không khẳng định nguồn có trả; ô Lark trống là chuyện bình thường. */
  it('mã 190 vào `additionalHandling` và KHÔNG còn bị gom vào maLa', () => {
    const g = tuKhoanUps([{ ma: '190', tien: 423_940 }, { ma: '375', tien: 10 }], 423_950, null, null);
    expect(g.additionalHandling).toBe(423_940);
    expect(g.maLa).toEqual([]);
  });

  /* `TEN_KHOAN` ở lib/ups/rate.ts có đúng 9 mã và KHÔNG mã nào là Address Correction ⇒ nguồn
   * UPS không nói gì về khoản đó. `null` chứ không 0: ghi 0 lên Lark là khoá ô ở 0 vĩnh viễn,
   * đường ghi từ hoá đơn sau này không điền được số thật vào nữa. */
  it('UPS không có mã Address Correction → addressCorrection là null, KHÔNG phải 0', () => {
    expect(tuKhoanUps([{ ma: '375', tien: 10 }], 10, null, null).addressCorrection).toBeNull();
  });
  /* I1: `base` của UPS nằm ở một field RIÊNG (`DongBaoGiaUps.base`), không trong danh sách
   * khoản. Bỏ rơi nó là ô "Mức giá cơ sở" của UPS không bao giờ được điền. */
  it('base do caller truyền vào (UPS trả ở field riêng), không bị bỏ rơi', () => {
    expect(tuKhoanUps([{ ma: '375', tien: 10 }], 1_100, 1_000, null).base).toBe(1_000);
  });
  /* ĐÍNH CHÍNH 16/10/2026 — ghi chú cũ của tệp này viết "UPS không trả chiết khấu, suy ngược
   * là bịa". SAI: Rating API trả CẢ hai khối trong CÙNG một phản hồi (`BaseServiceCharge` /
   * `TotalCharges` niêm yết ở cấp ngoài, `NegotiatedRateCharges` hợp đồng ở trong). Chiết
   * khấu là hiệu hai con số CÓ THẬT. Đo `1Z2050VDD900243620`: niêm yết 4.949.570 − hợp đồng
   * 1.268.060 = 3.681.510. */
  it('chiết khấu = tổng niêm yết − tổng hợp đồng, DƯƠNG', () => {
    expect(tuKhoanUps([{ ma: '375', tien: 10 }], 1_268_060, 3_028_915, 4_949_570).discount)
      .toBe(3_681_510);
  });
  /* Thiếu khối niêm yết thì KHÔNG BIẾT, không phải "không có chiết khấu": ghi 0 lên Lark là
   * khoá ô ở 0 vĩnh viễn. */
  it('thiếu tổng niêm yết → discount là null, KHÔNG phải 0', () => {
    expect(tuKhoanUps([{ ma: '375', tien: 10 }], 1_100, 1_000, null).discount).toBeNull();
    expect(tuKhoanUps([{ ma: '375', tien: 10 }], 1_100, 1_000, 0).discount).toBeNull();
  });
  /* Ô base phải là giá NIÊM YẾT (quy ước Lark, cùng D-245 của FedEx): Lark điền 3.028.915 cho
   * kiện mà base hợp đồng chỉ 614.760. */
  it('base là giá NIÊM YẾT do caller truyền, không phải giá hợp đồng', () => {
    expect(tuKhoanUps([{ ma: '375', tien: 10 }], 1_268_060, 3_028_915, 4_949_570).base)
      .toBe(3_028_915);
  });

  /* GoGreen là khoản RIÊNG CỦA DHL. `TEN_KHOAN` của UPS (lib/ups/rate.ts) có 9 mã và không mã
   * nào là SAF/GoGreen, nên Rating API KHÔNG NÓI GÌ về khoản này ⇒ `null`, không phải 0: 0 là
   * khẳng định "UPS có tính, bằng không", mà ghi 0 lên Lark là khoá ô ở 0 vĩnh viễn
   * (`dungPatch` sau đó đọc `docSo = 0 ≠ null` nên không bao giờ ghi số hoá đơn thật vào nữa). */
  it('UPS không có khoản GoGreen → gogreen là null, KHÔNG phải 0', () => {
    expect(tuKhoanUps([{ ma: '375', tien: 10 }], 1_100, 1_000, null).gogreen).toBeNull();
  });
});

describe('tuFedexQuote', () => {
  /** Dòng `fedex_rate_quotes` đủ khoản; mỗi test chỉ đổi phần mình nói tới. */
  const q = { totalNetCharge: 500, fuel: 50, fuelPercent: 47.75, remote: 0, demand: 10,
    residential: 0, signature: 20, countryFixed: 30, vat: 40, discount: 100,
    service: 'IP', rateZone: 'H' } as const;

  /* Các khoản PHỤ PHÍ đã có sẵn trong dòng quote — chỉ đổi tên trường, KHÔNG tính lại gì. */
  it('map thẳng các khoản phụ phí đã lưu, nguồn là fedex-api', () => {
    expect(tuFedexQuote(q)).toMatchObject({ nguon: 'fedex-api', fuel: 50, demand: 10,
      signature: 20, importHandling: 30, vat: 40, total: 500 });
  });

  /* D-245 bản 2: ô `Mức giá cơ sở` nhận base GỐC. FedEx không trả nó (`base_charge` NULL
   * 1.310/1.310 dòng) nên phải suy: `impliedBase` = 500 − 50 − 0 − 10 − 0 − 20 − 30 − 40 = 350
   * là base NET (vì `totalNetCharge` đã sau chiết khấu); cộng chiết khấu 100 ra GỐC = 450.
   * Kiểm trên dữ liệu thật: `impliedBase + |discount|` == `shipment_charges.base` khớp từng
   * đồng 5/8 dòng mẫu có cả quote lẫn hoá đơn. */
  it('base = cước nền suy ra CỘNG chiết khấu → ra giá GỐC, không phải net', () => {
    const g = tuFedexQuote(q);
    expect(g.base).toBe(450);
    expect(g.base).toBeGreaterThan(350); // chặn việc ai đó đổi ngược về net
  });

  /* Chiết khấu FedEx lưu DƯƠNG (đo: 1.309 dòng dương, 1 dòng = 0, 0 dòng âm) và ô Lark cần
   * dương (luật ghi bỏ `<= 0`). */
  it('discount ghi số DƯƠNG', () => {
    expect(tuFedexQuote(q).discount).toBe(100);
  });

  /* Hai bảng cùng hệ lưu chiết khấu hai dấu KHÁC NHAU (`shipment_charges.discount` âm
   * 2.898/2.898 dòng). Nếu một lượt import nào đổi dấu bên `fedex_rate_quotes` thì phép
   * `base + discount` sẽ TRỪ đi — ra base net, đúng cái sai vừa gỡ. `Math.abs` chặn cả hai
   * hậu quả đó, nên phải có test khoá lại. */
  it('chiết khấu lưu ÂM vẫn ra cùng base gốc và cùng số chiết khấu dương', () => {
    const g = tuFedexQuote({ ...q, discount: -100 });
    expect(g.base).toBe(450);
    expect(g.discount).toBe(100);
  });

  /* Thiếu chiết khấu thì `impliedBase` chỉ là base NET — ghi nó vào ô gốc là lặp lại lỗi của
   * vòng trước, mà số đã ghi lên Lark thì không sửa lại được bằng máy. Thà ô trống. */
  it('discount null → base null (KHÔNG ghi base net vào ô giá gốc)', () => {
    const g = tuFedexQuote({ ...q, discount: null });
    expect(g.base).toBeNull();
    expect(g.discount).toBeNull();
  });

  /* Không có tổng thì không có gì để trừ ra base — `fedexImpliedBase` trả null, đừng đoán. */
  it('totalNetCharge null → base null', () => {
    expect(tuFedexQuote({ ...q, totalNetCharge: null }).base).toBeNull();
  });

  /* Chiết khấu = 0 là thông tin THẬT ("hãng không cắt gì"), khác hẳn `null`: base vẫn suy
   * được, chỉ ô `Chiết khấu || API` là không có gì để ghi (luật `<= 0` lo việc đó). */
  it('discount = 0 vẫn suy được base (0 là biết, khác null)', () => {
    const g = tuFedexQuote({ ...q, discount: 0 });
    expect(g.base).toBe(350);
    expect(g.discount).toBe(0);
  });

  /* `FedexQuoteSnap` không có trường GoGreen/SAF nào, và `reconcile-diagnose.ts` đã khẳng định
   * cùng điều ("DHL GoGreen is a `per_step_fixed` surcharge — FedEx has none"). Nguồn không
   * nói gì ⇒ `null`.
   *
   * Quan trọng hơn: `gogreen` KHÔNG được lọt vào `fedexImpliedBase`. Base của FedEx là số SUY
   * RA bằng `tổng − mọi phụ phí − VAT`; thêm một khoản vào phép trừ đó mà FedEx không thật sự
   * thu là làm ô `Mức giá cơ sở` nhỏ đi đúng bằng khoản bịa thêm. Test chốt base vẫn là 450. */
  it('FedEx không có khoản GoGreen → gogreen null và base suy ra KHÔNG bị trừ thêm', () => {
    const g = tuFedexQuote(q);
    expect(g.gogreen).toBeNull();
    expect(g.base).toBe(450);
  });

  /* Ba ô mới (14/10/2026) đều `null` ở FedEx, và base suy ra KHÔNG được đổi.
   *
   * Vì sao `null`: `countryFixed` của FedEx là `ANCILLARY_FEE` = US/EU **Inbound** Processing
   * Fee ⇒ thuộc ô `Phí xử lý hàng nhập`, KHÔNG phải ô `Phí xử lý quốc tế` (ô đó dành cho khoản
   * `FIP` của UPS — hai khoản tên na ná, khác hãng khác nghĩa). Hai khoản còn lại: đếm trên
   * 1.310 phản hồi Rate API THÔ còn lưu trữ thì `ADDITIONAL_HANDLING` 0 lần và
   * `ADDRESS_CORRECTION` 0 lần — `FedexQuoteSnap` vì vậy không có trường nào.
   *
   * Phần `base` quan trọng không kém: base của FedEx là số SUY RA bằng `tổng − mọi phụ phí −
   * VAT`. Ai thêm một trong ba khoản mới vào `fedexImpliedBase` là làm ô `Mức giá cơ sở` nhỏ
   * đi đúng bằng khoản FedEx không thu. Chốt base vẫn 450. */
  it('ba ô mới đều null ở FedEx và base suy ra vẫn 450 (không khoản nào lọt vào phép trừ)', () => {
    const g = tuFedexQuote(q);
    expect([g.internationalProcessing, g.additionalHandling, g.addressCorrection])
      .toEqual([null, null, null]);
    expect(g.base).toBe(450);
  });

  /* `countryFixed` của FedEx chỉ được vào MỘT ô. Nếu ai "giúp" bằng cách đổ nó sang ô
   * `Phí xử lý quốc tế` cho khỏi trống thì 30 đồng đó nằm ở hai ô và tổng cộng tay sai. */
  it('countryFixed của FedEx chỉ vào importHandling, không nhân bản sang ô mới', () => {
    const g = tuFedexQuote(q);
    expect(g.importHandling).toBe(30);
    expect(Object.values(g).filter((v) => v === 30)).toHaveLength(1);
  });
});
