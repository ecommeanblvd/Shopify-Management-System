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
import { quoteOrderAcrossCarriers } from '@/features/carrier-rates/compare/quote-order-carriers';
import { laNhaDan } from '@/features/carrier-rates/residential-from-class';
import { countrySupportsDirectSignature } from '@/features/carrier-rates/direct-signature';
import { hangTheoMaVanDon } from '@/lib/ma-van-don';
import type { FedexQuoteSnap } from '@/features/shipments/fedex-quote-compare';
import { tuEngine, tuKhoanUps, tuFedexQuote, vatSuyRa, type GiaUocTinh } from './gia-uoc-tinh';

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
 * thức suy ra nó.
 */
async function docFedexQuoteSnap(shipmentId: string): Promise<FedexQuoteSnap | null> {
  const [q] = await db.select({
    service: schema.fedexRateQuotes.service,
    totalNetCharge: schema.fedexRateQuotes.totalNetCharge, fuel: schema.fedexRateQuotes.fuel,
    fuelPercent: schema.fedexRateQuotes.fuelPercent, remote: schema.fedexRateQuotes.remote,
    demand: schema.fedexRateQuotes.demand, residential: schema.fedexRateQuotes.residential,
    signature: schema.fedexRateQuotes.signature, countryFixed: schema.fedexRateQuotes.countryFixed,
    vat: schema.fedexRateQuotes.vat, discount: schema.fedexRateQuotes.discount,
    rateZone: schema.fedexRateQuotes.rateZone,
  }).from(schema.fedexRateQuotes).where(eq(schema.fedexRateQuotes.shipmentId, shipmentId)).limit(1);
  if (!q) return null;
  return {
    service: q.service, totalNetCharge: num(q.totalNetCharge), fuel: num(q.fuel),
    fuelPercent: num(q.fuelPercent), remote: num(q.remote), demand: num(q.demand),
    residential: num(q.residential), signature: num(q.signature), countryFixed: num(q.countryFixed),
    vat: num(q.vat), discount: num(q.discount), rateZone: q.rateZone,
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
 * Hãng của kiện suy theo DẠNG mã vận đơn vừa dán (`hangTheoMaVanDon`), không
 * theo hãng nhân sự CHỌN TAY (`shopifyOrders.selectedCarrierKey`): đây đúng là
 * lý do hàm đó tồn tại (CEO 19/09/2026) — chọn tay có thể sai (mã 1Z… từng bị
 * ghi nhầm FedEx), còn mã vận đơn hãng đã phát hành thì không thể sai dạng.
 * Dạng mã lạ/chưa dán mã mới rơi về hãng đã chọn tay.
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
    const carrierKey = hangTheoMaVanDon(k.trackingNumber) ?? k.selectedCarrierKey ?? null;
    const nguon = nguonGiaCho(carrierKey);

    if (nguon === 'fedex-api') {
      const r = await quoteShipmentToCache({
        shipmentId, originHub: k.originHub, country: k.country, postcode: k.postcode, city: k.city,
        weightKg, dims, shipDate,
        // D-044: phí ký nhận FedEx khai apply_mode='always' trừ nước được miễn —
        // countrySupportsDirectSignature đã gói đúng luật đó. KHÔNG hardcode false.
        signatureOptIn: countrySupportsDirectSignature(k.country),
        recipientResidential: isResidential,
      });
      if (!r.ok) return null;
      const snap = await docFedexQuoteSnap(shipmentId);
      if (!snap) return null;
      return tuFedexQuote(snap);
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
      // UPS không trả VAT thành khoản riêng (xem lib/ups/rate.ts) → suy ra bằng vatSuyRa.
      const g = tuKhoanUps(re.khoan, re.tong);
      return { ...g, vat: vatSuyRa(g) };
    }

    // bang-gia: cùng cách baoGiaKien gọi quoteOrderAcrossCarriers, không mở
    // thêm addon when_billed nào (mặc định đã đúng cho so sánh bằng bảng giá).
    const rows = await quoteOrderAcrossCarriers({
      country: k.country, weightKg, postcode: k.postcode, city: k.city,
      dimensions: dims ? { lengthCm: dims.length, widthCm: dims.width, heightCm: dims.height } : null,
      effectiveDate: shipDate,
      isResidential,
    });
    const row = carrierKey ? rows.find((r) => r.carrierKey === carrierKey) : undefined;
    if (!row || !row.ok || !row.breakdown || row.vndCost == null) return null;
    return tuEngine(row.breakdown, row.vndCost);
  } catch {
    return null;
  }
}
