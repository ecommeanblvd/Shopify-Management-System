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
import { quoteShipmentToCache } from '@/features/carrier-rates/fedex-quote-cache';
import { baoGiaUpsShop, chonMucReNhat } from '@/lib/ups/rate';
import { baoGiaBangGiaMotHang, congVat, phanTramVatCuaHang } from '@/features/carrier-rates/compare/quote-order-carriers';
import { laNhaDan } from '@/features/carrier-rates/residential-from-class';
import { countrySupportsDirectSignature } from '@/features/carrier-rates/direct-signature';
import { hangTheoMaVanDon } from '@/lib/ma-van-don';
import type { FedexQuoteSnap } from '@/features/shipments/fedex-quote-compare';
import { tuEngine, tuKhoanUps, tuFedexQuote, type GiaUocTinh } from './gia-uoc-tinh';

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
 * thức suy ra nó. Kèm `base` (cột `base_charge`, không nằm trong `FedexQuoteSnap`
 * dùng chung) và `tienTe` để caller tự gác đơn vị tiền.
 */
async function docFedexQuoteSnap(
  shipmentId: string,
): Promise<{ snap: FedexQuoteSnap; base: number | null; tienTe: string } | null> {
  const [q] = await db.select({
    service: schema.fedexRateQuotes.service, currency: schema.fedexRateQuotes.currency,
    totalNetCharge: schema.fedexRateQuotes.totalNetCharge, fuel: schema.fedexRateQuotes.fuel,
    baseCharge: schema.fedexRateQuotes.baseCharge,
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
    base: num(q.baseCharge),
    tienTe: q.currency,
  };
}

/**
 * Giá ước tính của MỘT kiện, theo đúng hãng của kiện đó. `null` khi bất kỳ bước
 * nào hỏng (thiếu cân/nước, DB lỗi, hãng không trả lời…) — KHÔNG ném, vì tầng
 * gọi (Task 5) phải lưu được mã vận đơn kể cả khi chưa lấy được giá; cron sẽ
 * thử lại sau.
 *
 * Cân + kích thước lấy từ CỘT ĐÃ ĐÓNG của kiện (`shipments.actual_weight_kg` /
 * `dim_*`), KHÔNG rơi về cân Shopify brand khai như `baoGiaKien` làm khi chưa
 * cân — kiện đã dán mã vận đơn nghĩa là đã đóng xong, số brand khai luôn bị
 * thổi lên so với số đã đo thật.
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
export async function layGiaUocTinh(shipmentId: string): Promise<GiaUocTinh | null> {
  try {
    const [k] = await db.select({
      trackingNumber: schema.shipments.trackingNumber,
      weightKg: schema.shipments.actualWeightKg,
      l: schema.shipments.dimLengthCm, w: schema.shipments.dimWidthCm, h: schema.shipments.dimHeightCm,
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

    const weightKg = k.weightKg != null ? Number(k.weightKg) : null;
    if (!k.country || !weightKg) return null; // chưa đóng xong (thiếu cân thật) hoặc thiếu nước

    const dims = k.l != null && k.w != null && k.h != null
      ? { length: Number(k.l), width: Number(k.w), height: Number(k.h) } : undefined;
    const shipDate = k.labelCreatedAt ?? k.createdAt;
    const isResidential = laNhaDan(k.addrClass, k.country);
    const carrierKey = hangTheoMaVanDon(k.trackingNumber) ?? k.carrierKey ?? k.selectedCarrierKey ?? null;
    const nguon = nguonGiaCho(carrierKey);

    if (nguon === 'fedex-api') {
      /* ĐỌC LẠI dòng cache trước, chỉ quote khi CHƯA có. `quoteShipmentToCache`
       * `onConflictDoUpdate` theo `shipmentId` ⇒ gọi vô điều kiện là GHI ĐÈ dòng
       * quote đã lưu bằng input khác hẳn (script backfill ưu tiên `billingWeightKg`
       * của hoá đơn và lấy cờ từ `shipment_charges`; đường này dùng cân đã đóng +
       * `countrySupportsDirectSignature`) — 1.224 kiện đã đối soát sẽ đổi mốc so
       * sánh mà không ai biết. `scripts/backfill-fedex-quotes.ts` khai đúng luật
       * này: "Bỏ qua đơn đã cache trừ khi --refresh". */
      const daCo = await docFedexQuoteSnap(shipmentId);
      if (!daCo) {
        const r = await quoteShipmentToCache({
          shipmentId, originHub: k.originHub, country: k.country, postcode: k.postcode, city: k.city,
          weightKg, dims, shipDate,
          // D-044: phí ký nhận FedEx khai apply_mode='always' trừ nước được miễn —
          // countrySupportsDirectSignature đã gói đúng luật đó. KHÔNG hardcode false.
          signatureOptIn: countrySupportsDirectSignature(k.country),
          recipientResidential: isResidential,
        });
        if (!r.ok) return null;
      }
      const q = daCo ?? await docFedexQuoteSnap(shipmentId);
      if (!q) return null;
      // Mọi cột chi phí Lark là VND. Dòng quote mang đơn vị FedEx trả về — khác VND
      // thì KHÔNG ghi gì, thà trống còn hơn một con số sai đơn vị không sửa lại được.
      if (q.tienTe !== 'VND') return null;
      return tuFedexQuote(q.snap, q.base);
    }

    if (nguon === 'ups-api') {
      const soTaiKhoan = process.env.UPS_ACCOUNT_NUMBER;
      if (!soTaiKhoan) return null;
      const r = await baoGiaUpsShop({
        soTaiKhoan, nuocDen: k.country, maBuuChinh: k.postcode, thanhPho: k.city,
        canKg: weightKg, kichThuocCm: dims ? { dai: dims.length, rong: dims.width, cao: dims.height } : null,
        nhaDan: isResidential,
      });
      if (!r.ok) return null;
      const re = chonMucReNhat(r.ds);
      if (!re) return null;
      if (re.tienTe !== 'VND') return null; // như nhánh FedEx: sai đơn vị thì không ghi
      /* UPS trả tiền CHƯA VAT ở MỌI mức (lib/ups/rate.ts) nên `re.tong` KHÔNG thể
       * ghi thẳng vào ô Tổng: FedEx ghi `totalNetCharge` (gồm VAT) và engine ghi
       * total gồm VAT — ba nguồn vào CÙNG một ô thì phải cùng một nghĩa. %VAT lấy
       * của ACCOUNT (`phanTramVatCuaHang`), đúng cách bảng so cước đang làm; không
       * tra được account thì VAT là KHÔNG BIẾT ⇒ không ghi gì cho kiện này. */
      const phanTram = await phanTramVatCuaHang('ups', shipDate, { country: k.country, postcode: k.postcode });
      if (phanTram == null) return null;
      const tongCoVat = congVat(re.tong, phanTram);
      const g = tuKhoanUps(re.khoan, tongCoVat, re.base);
      // VAT = chênh giữa tổng đã VAT và tổng chưa VAT, để ô VAT và ô Tổng khớp nhau
      // tuyệt đối (suy VAT từ tổng các khoản đã nhóm sẽ lệch khi có mã lạ — xem maLa).
      return { ...g, vat: tongCoVat - Math.round(re.tong) };
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
