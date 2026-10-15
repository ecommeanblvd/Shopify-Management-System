/**
 * I/O: chọn NGUỒN giá theo hãng của kiện rồi gọi đúng nguồn đó, trả về MỘT hình
 * chung `GiaUocTinh` (xem gia-uoc-tinh.ts) để Task sau ghi lên Lark.
 *
 * Vì sao cần tầng chọn nguồn riêng: FedEx/UPS có API giá SỐNG (đúng giá hợp đồng
 * đang hiệu lực), còn lại chỉ có bảng giá nội bộ. Gọi nhầm đường — vd lấy bảng
 * giá cho FedEx trong khi vốn có giá sống đúng hơn — là tự bỏ qua nguồn chính
 * xác mà không ai biết.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import {
  dauVaoTuInput, quoteShipmentToCache, xetCacheQuote, type QuoteShipmentInput,
} from '@/features/carrier-rates/fedex-quote-cache';
import { baoGiaUpsShop, chonMucReNhat, chonMucTheoMa } from '@/lib/ups/rate';
import { baoGiaBangGiaMotHang } from '@/features/carrier-rates/compare/quote-order-carriers';
import { laNhaDan } from '@/features/carrier-rates/residential-from-class';
import { countrySupportsDirectSignature } from '@/features/carrier-rates/direct-signature';
import { hangTheoMaVanDon } from '@/lib/ma-van-don';
import { layThongSoVanDon } from '@/lib/fedex/track';
import { layThongSoVanDonUps } from '@/lib/ups/track';
import { soatVungXa } from './soat-vung-xa';
import type { FedexQuoteSnap } from '@/features/shipments/fedex-quote-compare';
import { tuEngine, tuKhoanUps, tuFedexQuote, type GiaUocTinh } from './gia-uoc-tinh';
import { nguonCanDim } from './nguon-can-dim';

/**
 * THUẦN: hãng nào có API giá sống thì đi API, còn lại (gồm hãng `null`/chưa biết)
 * đi bảng giá — KHÔNG phải lỗi, chỉ là chưa có đường sống cho hãng đó (xem brief
 * Task 4, Review Focus #5: Aramex/DHL vẫn ra giá đúng qua 1.800/1.520 ô bảng giá).
 */
export function nguonGiaCho(carrierKey: string | null): 'fedex-api' | 'ups-api' | 'bang-gia' {
  if (carrierKey === 'fedex') return 'fedex-api';
  if (carrierKey === 'ups') return 'ups-api';
  return 'bang-gia';
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

/**
 * Cùng cách `reconcile-view.ts` đọc `fedex_rate_quotes` sang `FedexQuoteSnap` —
 * chỉ đổi tên cột, KHÔNG tính lại gì, để một con số FedEx chỉ có đúng một công
 * thức suy ra nó. Kèm `tienTe` để caller tự gác đơn vị tiền.
 *
 * KHÔNG đọc cột `base_charge` nữa (bỏ 13/10/2026): nó NULL 1.310/1.310 dòng và với rate
 * ACCOUNT thì FedEx trả base đã chiết khấu, nên base GỐC được suy trong `tuFedexQuote`
 * (`impliedBase + |discount|`) — xem bình luận ở đó. Chọn một đường duy nhất ra ô
 * "Mức giá cơ sở", không để hai nghĩa "base" cùng chảy vào một ô.
 */
async function docFedexQuoteSnap(
  shipmentId: string,
): Promise<{ snap: FedexQuoteSnap; tienTe: string; raw: unknown } | null> {
  const [q] = await db.select({
    service: schema.fedexRateQuotes.service, currency: schema.fedexRateQuotes.currency,
    raw: schema.fedexRateQuotes.raw,
    totalNetCharge: schema.fedexRateQuotes.totalNetCharge, fuel: schema.fedexRateQuotes.fuel,
    fuelPercent: schema.fedexRateQuotes.fuelPercent, remote: schema.fedexRateQuotes.remote,
    demand: schema.fedexRateQuotes.demand, residential: schema.fedexRateQuotes.residential,
    signature: schema.fedexRateQuotes.signature, countryFixed: schema.fedexRateQuotes.countryFixed,
    vat: schema.fedexRateQuotes.vat, discount: schema.fedexRateQuotes.discount,
    rateZone: schema.fedexRateQuotes.rateZone,
  }).from(schema.fedexRateQuotes).where(eq(schema.fedexRateQuotes.shipmentId, shipmentId)).limit(1);
  if (!q) return null;
  return {
    snap: {
      service: q.service, totalNetCharge: num(q.totalNetCharge), fuel: num(q.fuel),
      fuelPercent: num(q.fuelPercent), remote: num(q.remote), demand: num(q.demand),
      residential: num(q.residential), signature: num(q.signature), countryFixed: num(q.countryFixed),
      vat: num(q.vat), discount: num(q.discount), rateZone: q.rateZone,
    },
    tienTe: q.currency,
    raw: q.raw,
  };
}

/**
 * Giá ước tính của MỘT kiện, theo đúng hãng của kiện đó. `null` khi bất kỳ bước
 * nào hỏng (thiếu cân/nước, DB lỗi, hãng không trả lời…) — KHÔNG ném, vì tầng
 * gọi (Task 5) phải lưu được mã vận đơn kể cả khi chưa lấy được giá; cron sẽ
 * thử lại sau.
 *
 * Cân + kích thước lấy từ CỘT ĐÃ ĐÓNG của kiện (`shipments.sms_*` ưu tiên,
 * rơi về `actual_weight_kg` / `dim_*` của Lark qua `nguonCanDim` — xem
 * `nguon-can-dim.ts`), KHÔNG rơi về cân Shopify brand khai như `baoGiaKien`
 * làm khi chưa cân — kiện đã dán mã vận đơn nghĩa là đã đóng xong, số brand
 * khai luôn bị thổi lên so với số đã đo thật.
 *
 * SMS thắng Lark: số gõ trong hệ thống dùng được NGAY, không chờ cron Lark
 * (tới 1 giờ) đồng bộ ngược lên — CEO chốt 14/10/2026, cùng chủ đích với
 * `nguonCanKien` (`van-don.ts:100`) cho hộp thoại Lên vận đơn, nhưng `nguonCanDim`
 * chọn theo TỪNG Ô (cân/dài/rộng/cao) độc lập chứ không theo nguyên khối — một
 * cân gõ SMS có thể đi cùng kích thước Lark nếu dim SMS chưa có.
 *
 * Hãng của kiện suy theo thứ tự ba bậc, mỗi bậc đáng tin kém hơn bậc trước:
 *   1. DẠNG mã vận đơn vừa dán (`hangTheoMaVanDon`) — bằng chứng mạnh nhất vì
 *      đó là mã HÃNG ĐÃ PHÁT HÀNH thật; không thể sai dạng (FedEx 12 số, DHL
 *      10 số, Aramex 11 số, UPS "1Z"+16 ký tự, tách bạch hoàn toàn).
 *   2. `shipments.carrierKey` — cột cả hệ thống đang khoá theo (đối soát, bộ
 *      lọc, nối dòng hoá đơn đều đọc nó), đồng bộ từ cột `Couriers` do đội
 *      logistics tự điền trên Lark: ghi nhận của người vận hành về hãng đã
 *      gửi thật, đáng tin hơn `selectedCarrierKey` vì đó là việc đã xảy ra,
 *      không phải ý định lúc so cước.
 *   3. `shopifyOrders.selectedCarrierKey` — hãng nhân sự CHỌN TAY lúc so cước,
 *      chỉ dùng khi cả hai bậc trên đều không có (mã lạ/chưa dán VÀ Lark chưa
 *      ghi `Couriers`). Chọn tay có thể sai (mã 1Z… từng bị ghi nhầm FedEx,
 *      CEO 19/09/2026) nên luôn xếp cuối.
 */
export async function layGiaUocTinh(
  shipmentId: string,
  /**
   * Mã vận đơn nhân sự VỪA DÁN, dùng cho bước XEM TRƯỚC (chưa lưu vào CSDL).
   *
   * Thiếu tham số này thì bảng xem trước và lượt ghi thật có thể ra HAI con số khác nhau:
   * bậc 1 của phép suy hãng là DẠNG mã vận đơn, mà lúc xem trước `shipments.tracking_number`
   * còn trống ⇒ xem trước suy hãng theo `carrier_key`/`selected_carrier_key`, còn lượt ghi
   * (sau khi lưu mã) suy theo dạng mã. Kiện ghi hãng sai (mã 1Z… mà cột ghi fedex — đã xảy
   * ra, CEO 19/09/2026) sẽ cho nhân sự xem giá FedEx rồi ghi giá UPS lên Lark.
   */
  trackingDuTinh?: string | null,
): Promise<GiaUocTinh | null> {
  try {
    const [k] = await db.select({
      trackingNumber: schema.shipments.trackingNumber,
      weightKg: schema.shipments.actualWeightKg,
      l: schema.shipments.dimLengthCm, w: schema.shipments.dimWidthCm, h: schema.shipments.dimHeightCm,
      smsWeightKg: schema.shipments.smsWeightKg,
      smsL: schema.shipments.smsDimLengthCm, smsW: schema.shipments.smsDimWidthCm, smsH: schema.shipments.smsDimHeightCm,
      originHub: schema.shipments.originHub,
      labelCreatedAt: schema.shipments.labelCreatedAt, createdAt: schema.shipments.createdAt,
      country: schema.shopifyOrders.shipCountry, postcode: schema.shopifyOrders.shipPostcode,
      city: schema.shopifyOrders.shipCity, addrClass: schema.shopifyOrders.addrClass,
      carrierKey: schema.shipments.carrierKey,
      selectedCarrierKey: schema.shopifyOrders.selectedCarrierKey,
    }).from(schema.shipments)
      .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
      .where(eq(schema.shipments.id, shipmentId)).limit(1);
    if (!k) return null;

    const canDim = nguonCanDim(
      { canKg: k.smsWeightKg, daiCm: k.smsL, rongCm: k.smsW, caoCm: k.smsH },
      { canKg: k.weightKg, daiCm: k.l, rongCm: k.w, caoCm: k.h },
    );
    const weightKg = canDim.canKg;
    if (!k.country || !weightKg) return null; // chưa đóng xong (thiếu cân thật) hoặc thiếu nước

    // Cao thiếu (ở cả SMS và Lark) → KHÔNG dựng `dims`, giống hệt cách cũ khi `k.h` null: thiếu
    // cao là dấu hiệu chọn giá Pak thay Package ở bước tính cước, không phải lỗi vá bằng 0.
    const dims = canDim.daiCm != null && canDim.rongCm != null && canDim.caoCm != null
      ? { length: canDim.daiCm, width: canDim.rongCm, height: canDim.caoCm } : undefined;
    const shipDate = k.labelCreatedAt ?? k.createdAt;
    const isResidential = laNhaDan(k.addrClass, k.country);
    const carrierKey = hangTheoMaVanDon(trackingDuTinh ?? k.trackingNumber)
      ?? k.carrierKey ?? k.selectedCarrierKey ?? null;
    const nguon = nguonGiaCho(carrierKey);

    if (nguon === 'fedex-api') {
      /* ĐỌC THÔNG SỐ THẬT CỦA VẬN ĐƠN TRƯỚC (CEO 15/10/2026). Trước đây đường này dựng lại lô
       * hàng từ cột của mình rồi hỏi giá, nên ra một số KHÁC số hãng hiện trên cổng cho chính
       * mã đó — `878631025811`: cổng 1.378.588đ, hệ thống 1.496.487đ. Sai ba đầu vào cùng lúc:
       *   - loại bao gói: không khai ⇒ hãng tính thang HỘP, mà nhãn khai Túi FedEx (FEDEX_PAK);
       *   - cờ nhà dân: suy từ `addr_class` = RESIDENTIAL ⇒ cộng 84.400 + nhiên liệu, hãng ghi
       *     `residential: false` trên chính nhãn đó và KHÔNG thu;
       *   - kích thước: CSDL giữ 40×31×2 của danh mục vật tư, nhãn ghi 36×27×6.
       * Hỏi lại Rate API bằng đúng thông số của nhãn thì khớp TỪNG ĐỒNG với màn hình hãng.
       *
       * ĐÍNH CHÍNH 16/10/2026 — lấy của Track BỐN thứ thôi (bao gói, dịch vụ, cờ nhà dân, ký
       * nhận) cộng ngày gửi; CÂN và KÍCH THƯỚC vẫn của mình. Lý do ở ngay dưới, chỗ `weightKg`.
       *
       * Track API KHÔNG trả tiền (đã soát sạch cây phản hồi — xem `ThongSoVanDonFedex`), nên
       * vẫn phải qua Rate API; nhưng hỏi bằng đầu vào của chính vận đơn thì không còn là dựng
       * lại, mà là tái lập lượt tính giá của hãng.
       *
       * Rơi về dữ liệu của mình theo TỪNG Ô, không vứt cả khối: FedEx che bớt thông tin tuỳ
       * kiện, và thiếu kích thước không có nghĩa loại bao gói cũng sai. Hãng chưa có dữ liệu
       * cho mã (nhãn vừa tạo) ⇒ `thongSo` null ⇒ chạy y như cũ, nhưng `theoVanDon: false` để
       * tầng trên NÓI RA là số này dựng lại. */
      const maTra = trackingDuTinh ?? k.trackingNumber;
      const thongSo = maTra ? await layThongSoVanDon(maTra) : null;

      /* Dựng đầu vào MỘT LẦN rồi dùng cho cả phép so dấu lẫn lượt quote — hai chỗ tự dựng
       * riêng là mở đường cho chúng lệch nhau (`shipDate` chẳng hạn). */
      const dauVao: QuoteShipmentInput = {
        shipmentId, originHub: k.originHub, country: k.country, postcode: k.postcode,
        /* Thành phố lấy TÊN HÃNG ĐÃ CHUẨN HOÁ trên nhãn, không lấy tên khách gõ trên Shopify.
         * FedEx tra phụ phí VÙNG SÂU XA theo tên của nó: cùng mã bưu chính 52728, "Al
         * Bukayriyah" (Shopify) ra 1.678.505 không có khoản vùng xa, còn "BUKAYRIYAH" (nhãn)
         * ra 2.576.930 kèm OUT_OF_DELIVERY_AREA 550.000 — đúng số nhân sự đọc từ cổng rồi gõ
         * lên Lark (đo `878423234737`, 16/10/2026). Một chữ "Al" thừa ăn mất 898.425đ. */
        city: thongSo?.thanhPho ?? k.city,
        /* CÂN và KÍCH THƯỚC lấy của MÌNH, KHÔNG lấy của Track — đây là chỗ đã sai một vòng
         * (16/10/2026). Track trả số FedEx ĐÃ CÂN ĐO LẠI ở trạm, không phải số khai lúc tạo
         * nhãn: đo trên 7 kiện lệch thì nhãn ghi 1,77kg / 0,45kg / 43×33×12 trong khi kho khai
         * 1,8kg / 0,8kg / 42×30×10. Mà con số cần điền lên Lark là GIÁ LÚC TẠO VẬN ĐƠN (CEO
         * chốt 15/10/2026) — giá sau cân đo lại là việc của đối soát hoá đơn, không phải của
         * màn Đóng hàng.
         *
         * Thử cả hai đường trên 7 kiện lệch: lấy cân/dim của Track khớp ô base 1/7, lấy cân/dim
         * khai báo khớp 7/7. `thongSo.canKg` và `thongSo.kichThuocCm` vẫn giữ trong hình dữ
         * liệu vì chúng chính là thứ cần cho cảnh báo "hãng đo lại, PAK thành Package" sau này. */
        weightKg,
        dims,
        shipDate: thongSo?.ngayGui ? new Date(`${thongSo.ngayGui}T00:00:00Z`) : shipDate,
        /* D-044: phí ký nhận FedEx khai apply_mode='always' trừ nước được miễn —
         * `countrySupportsDirectSignature` gói đúng luật đó, nhưng nó là phép SUY THEO NƯỚC.
         * `specialHandlings` của nhãn là dịch vụ ĐÃ MUA THẬT, nên thắng. */
        signatureOptIn: thongSo ? thongSo.kyNhanTrucTiep : countrySupportsDirectSignature(k.country),
        recipientResidential: thongSo?.nhaDan ?? isResidential,
        packagingType: thongSo?.loaiBaoGoi ?? undefined,
        serviceType: thongSo?.dichVu ?? undefined,
      };

      /* ĐỌC LẠI dòng cache trước. `quoteShipmentToCache` `onConflictDoUpdate` theo
       * `shipmentId` ⇒ gọi vô điều kiện là GHI ĐÈ dòng quote đã lưu bằng input khác hẳn
       * (script backfill ưu tiên `billingWeightKg` của hoá đơn và lấy cờ từ
       * `shipment_charges`; đường này dùng cân đã đóng + `countrySupportsDirectSignature`) —
       * 1.224 kiện đã đối soát sẽ đổi mốc so sánh mà không ai biết.
       *
       * NHƯNG dùng lại VÔ ĐIỀU KIỆN cũng sai, và sai âm thầm (CEO báo 15/10/2026): dòng cache
       * đóng băng con số của lần quote ĐẦU TIÊN, nên chạy phân tích lúc cân/kích thước chưa
       * chốt là kiện đó mang giá của cân cũ mãi mãi — cân sửa sau không bao giờ vào giá, mà
       * màn hình vẫn nói "API giá sống của FedEx".
       *
       * Luật hiện tại, hai vế:
       *   1. Dấu đầu vào trong `raw` còn KHỚP (`con-dung`, xem `DauVaoQuote`) → dùng lại,
       *      không gọi hãng.
       *   2. Lệch dấu, HOẶC không có dấu (mọi dòng tạo trước 15/10/2026) → quote lại, NHƯNG
       *      CHỈ KHI kiện chưa có dòng hoá đơn nào. Có hoá đơn nghĩa là dòng quote này đang
       *      là MỐC ĐỐI SOÁT; đổi mốc để làm đẹp một ô Lark là đổi đúng thứ dùng để bắt lỗi
       *      hãng. Đo 15/10/2026: 1.314 dòng cache thì **1.310 dòng thuộc kiện ĐÃ có hoá
       *      đơn** (toàn bộ phần backfill tính từ cân tính phí của hoá đơn) ⇒ vế này không
       *      chạm dòng nào trong số đó; 4 dòng còn lại đúng là 4 dòng do màn Đóng hàng tạo,
       *      và chúng được quote lại một lần để có dấu, từ đó về sau đi theo vế 1. */
      const daCo = await docFedexQuoteSnap(shipmentId);
      let dungLai = daCo != null;
      if (daCo && xetCacheQuote(daCo.raw, dauVaoTuInput(dauVao)) !== 'con-dung') {
        const [coHoaDon] = await db.select({ id: schema.shipmentCharges.id })
          .from(schema.shipmentCharges)
          .where(eq(schema.shipmentCharges.shipmentId, shipmentId)).limit(1);
        dungLai = coHoaDon != null;
      }
      if (!dungLai) {
        const r = await quoteShipmentToCache(dauVao);
        /* Quote lại hỏng mà dòng cũ không chứng minh được là tính cho đúng đầu vào này ⇒
         * KHÔNG rơi về dòng cũ: trả "chưa lấy được giá" (nhân sự vẫn lưu được mã vận đơn,
         * cron thử lại sau) còn hơn đưa họ một con số của cân khác mà không nói gì. */
        if (!r.ok) return null;
      }
      const q = dungLai ? daCo : await docFedexQuoteSnap(shipmentId);
      if (!q) return null;
      // Mọi cột chi phí Lark là VND. Dòng quote mang đơn vị FedEx trả về — khác VND
      // thì KHÔNG ghi gì, thà trống còn hơn một con số sai đơn vị không sửa lại được.
      if (q.tienTe !== 'VND') return null;
      const gFedex = tuFedexQuote(q.snap);
      return {
        ...gFedex,
        theoVanDon: thongSo != null,
        /* Lá chắn cho cửa sổ hãng chưa có dữ liệu tra cứu: lúc đó thành phố rơi về tên
         * Shopify, và FedEx tra phụ phí vùng xa theo TÊN CỦA NÓ nên khoản tiền có thể biến
         * mất không báo gì (ca `#MIR1028`, 898.425đ). Chỉ cảnh báo, không đổi số. */
        canhBaoVungXa: await soatVungXa({
          carrierKey: 'fedex', country: k.country, postcode: k.postcode,
          thanhPho: dauVao.city ?? null, remoteDaBao: gFedex.remote, ngay: dauVao.shipDate,
        }),
      };
    }

    if (nguon === 'ups-api') {
      const soTaiKhoan = process.env.UPS_ACCOUNT_NUMBER;
      if (!soTaiKhoan) return null;

      /* Đọc thông số THẬT của nhãn trước, đúng như nhánh FedEx. Đo 16/10/2026: giá UPS khớp
       * số điền tay trên Lark **0/37 kiện**, và ba trong bốn nguyên nhân nằm ở đây. */
      const maTraUps = trackingDuTinh ?? k.trackingNumber;
      const ts = maTraUps ? await layThongSoVanDonUps(maTraUps) : null;

      const r = await baoGiaUpsShop({
        soTaiKhoan, nuocDen: k.country, maBuuChinh: k.postcode,
        /* Tên thành phố HÃNG chuẩn hoá — cùng lý do như FedEx: hãng tra phụ phí theo tên của
         * nó, tên khách gõ trên Shopify có thể trượt bảng. */
        thanhPho: ts?.thanhPho ?? k.city,
        /* CÂN của mình; KÍCH THƯỚC lấy của NHÃN — và đây là chỗ UPS làm KHÁC FedEx, có lý do
         * đo được chứ không phải tuỳ tiện:
         *
         *   UPS  : 40/40 kiện cân trên nhãn TRÙNG cân hệ thống  ⇒ Track trả số KHAI BÁO
         *   FedEx: 14/40 kiện KHÁC (0,45 · 1,68 · 0,59 · 1,4 kg) ⇒ Track trả số hãng ĐO LẠI
         *
         * UPS không cân đo lại (hoặc không công bố), nên thứ Track trả chính là thứ nhân sự
         * gõ ở cổng UPS — tức đúng đầu vào của con số hãng hiện lên lúc tạo vận đơn. Đo 60
         * ngày: 22/55 kiện có dim nhãn KHÁC dim hệ thống, 5 ca trong đó ĐỔI BẬC CÂN và cả 5
         * đều cùng một cặp — hệ thống ghi 40×31×2 (số danh mục vật tư) còn nhãn ghi 41×33×3.
         * Lấy dim hệ thống là tính thiếu một bậc cho đúng 5 kiện đó.
         *
         * Cân vẫn của mình vì hai bên luôn bằng nhau (40/40) — không có gì để tranh, và giữ
         * nguồn cân một chỗ thì khi UPS bắt đầu cân lại ta không âm thầm đổi nghĩa con số. */
        canKg: weightKg,
        kichThuocCm: ts?.kichThuocCm
          ?? (dims ? { dai: dims.length, rong: dims.width, cao: dims.height } : null),
        nhaDan: isResidential,
      });
      if (!r.ok) return null;

      /* ĐÚNG DỊCH VỤ CỦA NHÃN, không phải mức rẻ nhất. `chonMucReNhat` chỉ còn là lối thoát
       * khi hãng chưa có dữ liệu tra cứu — và khi đó `theoVanDon: false` để tầng trên nói ra.
       * Đo trên `1Z2050VDD900243620`: UPS trả bốn mức có base niêm yết 3.210.570 / 2.099.725 /
       * 3.210.570 / 3.028.915; Lark điền 3.028.915 — đúng mức 65 của nhãn, KHÔNG phải mức rẻ
       * nhất (08). Lấy nhầm mức là sai giá của cả kiện mà không có dấu hiệu gì. */
      const re = chonMucTheoMa(r.ds, ts?.maDichVu ?? null) ?? chonMucReNhat(r.ds);
      if (!re) return null;
      if (re.tienTe !== 'VND') return null; // như nhánh FedEx: sai đơn vị thì không ghi

      /* KHÔNG cộng VAT. Ô VAT của kiện UPS trên Lark để TRỐNG, và tổng HỢP ĐỒNG khớp ô Tổng
       * của Lark y nguyên khi không cộng gì (1.268.060 và 1.652.990 trên hai kiện đo). Bản
       * trước cộng %VAT của tài khoản vào ô Tổng — một trong bốn lỗi làm UPS lệch 37/37. */
      const gUps = tuKhoanUps(re.khoanNiemYet, Math.round(re.tong), re.baseNiemYet || null, re.tongNiemYet || null);
      return {
        ...gUps,
        theoVanDon: ts != null,
        canhBaoVungXa: await soatVungXa({
          carrierKey: 'ups', country: k.country, postcode: k.postcode,
          thanhPho: ts?.thanhPho ?? k.city, remoteDaBao: gUps.remote, ngay: shipDate,
        }),
      };
    }

    // bang-gia: gọi ĐÚNG hãng của kiện, KHÔNG qua quoteOrderAcrossCarriers — hàm
    // đó luôn kèm một lượt báo giá SỐNG UPS bị vứt đi (chi phí ẩn, lượt soát Task 4),
    // nhân lên theo từng kiện khi cron quét hàng loạt kiện Aramex/DHL.
    if (!carrierKey) return null;
    const row = await baoGiaBangGiaMotHang(carrierKey, {
      country: k.country, weightKg, postcode: k.postcode, city: k.city,
      dimensions: dims ? { lengthCm: dims.length, widthCm: dims.width, heightCm: dims.height } : null,
      effectiveDate: shipDate,
      isResidential,
    });
    if (!row || !row.ok || !row.breakdown || row.vndCost == null) return null;
    return tuEngine(row.breakdown, row.vndCost, row.heSoVnd ?? null);
  } catch {
    return null;
  }
}
