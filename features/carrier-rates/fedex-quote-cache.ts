/**
 * Quote FedEx Rate API cho 1 shipment rồi cache (bảng fedex_rate_quotes).
 * "Giá đúng" (giá hợp đồng) để đối soát billed(thực) vs FedEx theo từng dòng.
 *
 * Dịch vụ mặc định: cố định 1 loại (shop đi 1 dịch vụ) — đổi qua env
 * FEDEX_DEFAULT_SERVICE. Quote theo ĐÚNG ngày ship → giá lịch sử.
 */
import { db, schema } from '@/db/client';
import { quoteRate, type RateQuoteResult } from '@/lib/fedex/rate';
import { effectivePostcode } from '@/lib/fedex/postal';

/** Dịch vụ FedEx mặc định để đối soát. Đổi 1 chỗ nếu shop dùng loại khác. */
export const FEDEX_DEFAULT_SERVICE = process.env.FEDEX_DEFAULT_SERVICE || 'FEDEX_INTERNATIONAL_PRIORITY';

const HUB_POSTAL: Record<string, string> = { HN: '100000', SG: '700000' };

export interface QuoteShipmentInput {
  shipmentId: string;
  originHub: string | null;
  country: string;
  postcode: string | null;
  /** Thành phố — dùng cho nước không-postcode (Vùng Vịnh) + phân giải vùng xa. */
  city?: string | null;
  weightKg: number;
  /** Kích thước (cm) — THIẾU thì quote theo cân thực (nhiều đơn không nhập dim). */
  dims?: { length: number; width: number; height: number };
  shipDate: Date;
  /** Đơn có dùng ký nhận → quote kèm SIGNATURE_OPTION để cột API có giá ký nhận. */
  signatureOptIn?: boolean;
  /** Địa chỉ nhà dân (US/CA) → quote kèm RESIDENTIAL_DELIVERY để cột API có phí
   *  residential. Suy từ billed có residential (hoặc classify = RESIDENTIAL). */
  recipientResidential?: boolean;
  /** Loại bao gói FedEx — xem `RateQuoteInput.packagingType`. Bỏ trống là hãng tính thang
   *  HỘP, nên kiện túi phải khai 'FEDEX_PAK'. */
  packagingType?: string;
  /** Dịch vụ thật của vận đơn. Bỏ trống → hỏi mọi dịch vụ rồi lấy dịch vụ mặc định. */
  serviceType?: string;
}

export interface QuoteWeightInput {
  /** Cân TÍNH PHÍ từ hoá đơn FBO (chính xác nhất — đúng số FedEx đã tính). */
  billingWeightKg?: number | null;
  /** Cân thực của shipment. */
  actualWeightKg?: number | null;
  /** Cân đơn Shopify (fallback cuối khi thiếu cả dim lẫn cân thực). */
  shopifyWeightKg?: number | null;
  dims?: { length: number; width: number; height: number };
}

/** Chọn cân + dims để quote theo ưu tiên (yêu cầu nghiệp vụ):
 *  1. Billing weight hoá đơn → dùng thẳng (đã là cân tính phí cuối, KHÔNG dims).
 *  2. Có dims → cân thực (hoặc Shopify) + dims → FedEx tự lấy max(thực, dim).
 *  3. Không dims → cân thực; thiếu thì cân Shopify. Pure. */
export function resolveQuoteWeight(input: QuoteWeightInput): {
  weightKg: number; dims?: { length: number; width: number; height: number };
} {
  if (input.billingWeightKg && input.billingWeightKg > 0) {
    return { weightKg: input.billingWeightKg };
  }
  const base = (input.actualWeightKg && input.actualWeightKg > 0)
    ? input.actualWeightKg
    : (input.shopifyWeightKg && input.shopifyWeightKg > 0 ? input.shopifyWeightKg : 0.5);
  return { weightKg: base, dims: input.dims };
}

/** Chọn quote ACCOUNT của dịch vụ mặc định; thiếu thì lấy ACCOUNT đầu tiên. Pure. */
export function pickQuote(quotes: RateQuoteResult[], service: string): RateQuoteResult | null {
  const acc = quotes.filter((q) => q.rateType === 'ACCOUNT');
  return acc.find((q) => q.serviceType === service) ?? acc[0] ?? null;
}

/**
 * ĐẦU VÀO đã dùng để quote, đóng dấu NGAY TRONG `raw` dưới khoá `dauVaoQuote`.
 *
 * Vì sao cần: `fedex_rate_quotes` chỉ có một dòng cho mỗi kiện và người đọc nó (vd
 * `lay-gia-uoc-tinh.ts`) không có cách nào biết dòng đó được tính cho cân/kích thước NÀO.
 * `billing_weight_kg` KHÔNG trả lời được câu đó: đấy là cân TÍNH PHÍ do FedEx trả về, đã làm
 * tròn lên bậc và đã lấy max với cân thể tích — đo thật kiện `878637519277` cân 0,3 kg mà
 * `billing_weight_kg` là 0,5. So cân hiện tại với nó thì kiện nào cũng "lệch".
 *
 * Nằm trong `raw` (jsonb) chứ không thành cột riêng: thêm cột là thêm một di trú PHẢI áp tay
 * lên CSDL thật trước khi deploy, cho một việc chỉ cần đọc-ghi thẳng. Không có gì trong hệ
 * thống đọc `raw` ngoài chỗ này (đã soát), nên thêm một khoá cạnh phản hồi hãng là cộng thêm,
 * không phá ai.
 *
 * Dòng CŨ (trước 15/10/2026) không có dấu này ⇒ `xetCacheQuote` trả `khong-biet-dau-vao` và
 * người gọi phải GIỮ NGUYÊN dòng đó. Đúng chủ ý: 1.310 dòng cũ phần lớn do
 * `scripts/backfill-fedex-quotes.ts` tạo từ cân tính phí của HOÁ ĐƠN và đang là mốc đối soát
 * của 1.224 kiện — quote lại là đổi mốc so sánh mà không ai biết.
 */
export interface DauVaoQuote {
  /** Phiên bản của dấu. Dấu phiên bản khác (hoặc không có) = KHÔNG BIẾT đầu vào, vì bản cũ
   *  thiếu trường và so thiếu trường là kết luận "còn dùng được" cho một dòng có thể đã sai.
   *  Bản 2 (15/10/2026) thêm `packagingType` + `serviceType`. */
  v: number;
  weightKg: number;
  dims: { length: number; width: number; height: number } | null;
  /** YYYY-MM-DD — đúng chuỗi đã gửi cho Rate API. */
  shipDate: string;
  signatureOptIn: boolean;
  recipientResidential: boolean;
  packagingType: string | null;
  serviceType: string | null;
  /** Thành phố người nhận ĐÚNG CHUỖI đã gửi cho hãng. Trong dấu vì nó đổi tiền: FedEx tra phụ
   *  phí vùng sâu xa theo tên thành phố, và "Al Bukayriyah" vs "BUKAYRIYAH" chênh 550.000đ
   *  cùng nhiên liệu và VAT trên đó (đo `878423234737`, 16/10/2026). */
  city: string | null;
}

/** Khoá đóng dấu trong `raw`. Một tên, một chỗ. */
export const KHOA_DAU_VAO_QUOTE = 'dauVaoQuote';

/** Phiên bản dấu hiện hành. Tăng khi thêm/bớt trường đầu vào.
 *  Bản 2 (15/10/2026): thêm `packagingType` + `serviceType`. Bản 3 (16/10/2026): thêm `city`. */
export const PHIEN_BAN_DAU_VAO = 3;

/**
 * `QuoteShipmentInput` → dấu đầu vào. Người đọc cache PHẢI dựng dấu bằng CHÍNH hàm này từ
 * CHÍNH object sẽ truyền cho `quoteShipmentToCache`, để dấu lúc ghi và dấu lúc so không bao
 * giờ lệch nhau (`shipDate` chẳng hạn: cùng một phép `toISOString().slice(0, 10)`).
 */
export function dauVaoTuInput(input: QuoteShipmentInput): DauVaoQuote {
  return {
    v: PHIEN_BAN_DAU_VAO,
    weightKg: input.weightKg,
    dims: input.dims ?? null,
    shipDate: input.shipDate.toISOString().slice(0, 10),
    signatureOptIn: input.signatureOptIn === true,
    recipientResidential: input.recipientResidential === true,
    packagingType: input.packagingType ?? null,
    serviceType: input.serviceType ?? null,
    city: input.city ?? null,
  };
}

export type PhanXetCacheQuote = 'con-dung' | 'lech-dau-vao' | 'khong-biet-dau-vao';

const gan = (a: number, b: number, saiSo: number): boolean => Math.abs(a - b) <= saiSo;

function docDauVao(raw: unknown): DauVaoQuote | null {
  if (raw == null || typeof raw !== 'object') return null;
  const d = (raw as Record<string, unknown>)[KHOA_DAU_VAO_QUOTE];
  if (d == null || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  if (o.v !== PHIEN_BAN_DAU_VAO) return null; // dấu đời khác → không so được, coi như không biết
  if (typeof o.weightKg !== 'number' || typeof o.shipDate !== 'string') return null;
  let dims: DauVaoQuote['dims'] = null;
  if (o.dims != null && typeof o.dims === 'object') {
    const k = o.dims as Record<string, unknown>;
    if (typeof k.length === 'number' && typeof k.width === 'number' && typeof k.height === 'number') {
      dims = { length: k.length, width: k.width, height: k.height };
    } else {
      return null; // có dims mà đọc không ra ba số → coi như không biết, đừng đoán
    }
  }
  return {
    v: PHIEN_BAN_DAU_VAO,
    weightKg: o.weightKg,
    dims,
    shipDate: o.shipDate,
    signatureOptIn: o.signatureOptIn === true,
    recipientResidential: o.recipientResidential === true,
    packagingType: typeof o.packagingType === 'string' ? o.packagingType : null,
    serviceType: typeof o.serviceType === 'string' ? o.serviceType : null,
    city: typeof o.city === 'string' ? o.city : null,
  };
}

/**
 * THUẦN: dòng quote đã lưu còn tính cho ĐÚNG đầu vào hiện tại không.
 *
 * `khong-biet-dau-vao` KHÁC `lech-dau-vao`, và khác một cách quan trọng: "không biết" thì
 * người gọi giữ nguyên dòng cũ (xem `DauVaoQuote`), còn "lệch" mới được quote lại.
 */
export function xetCacheQuote(raw: unknown, hienTai: DauVaoQuote): PhanXetCacheQuote {
  const luu = docDauVao(raw);
  if (!luu) return 'khong-biet-dau-vao';
  if (!gan(luu.weightKg, hienTai.weightKg, 0.0005)) return 'lech-dau-vao';
  if ((luu.dims == null) !== (hienTai.dims == null)) return 'lech-dau-vao';
  if (luu.dims != null && hienTai.dims != null) {
    if (!gan(luu.dims.length, hienTai.dims.length, 0.005)) return 'lech-dau-vao';
    if (!gan(luu.dims.width, hienTai.dims.width, 0.005)) return 'lech-dau-vao';
    if (!gan(luu.dims.height, hienTai.dims.height, 0.005)) return 'lech-dau-vao';
  }
  if (luu.shipDate !== hienTai.shipDate) return 'lech-dau-vao';
  if (luu.signatureOptIn !== hienTai.signatureOptIn) return 'lech-dau-vao';
  if (luu.recipientResidential !== hienTai.recipientResidential) return 'lech-dau-vao';
  if (luu.packagingType !== hienTai.packagingType) return 'lech-dau-vao';
  if (luu.serviceType !== hienTai.serviceType) return 'lech-dau-vao';
  if (luu.city !== hienTai.city) return 'lech-dau-vao';
  return 'con-dung';
}

const num = (n: number | null): string | null => (n === null ? null : n.toString());

export async function quoteShipmentToCache(
  input: QuoteShipmentInput,
): Promise<{ ok: boolean; service?: string; total?: number }> {
  const postcode = effectivePostcode(input.country, input.postcode);
  if (!postcode) return { ok: false }; // không có postcode thật lẫn fallback → bỏ
  const { raw, quotes } = await quoteRate({
    shipperCountryCode: 'VN',
    shipperPostalCode: HUB_POSTAL[input.originHub ?? ''] ?? '700000',
    recipientCountryCode: input.country,
    recipientPostalCode: postcode,
    recipientCity: input.city ?? undefined,
    weightKg: input.weightKg,
    dimsCm: input.dims,
    shipDate: input.shipDate.toISOString().slice(0, 10),
    signatureOptIn: input.signatureOptIn,
    recipientResidential: input.recipientResidential,
    packagingType: input.packagingType,
    serviceType: input.serviceType,
  });
  /* Khai dịch vụ nào thì chọn đúng dịch vụ đó. Để `FEDEX_DEFAULT_SERVICE` cứng ở đây thì vận
   * đơn đi INTERNATIONAL_ECONOMY sẽ rơi vào nhánh `acc[0]` của `pickQuote` — đúng tình cờ
   * (FedEx chỉ trả một dịch vụ khi mình khai), nhưng đúng tình cờ không phải đúng. */
  const q = pickQuote(quotes, input.serviceType ?? FEDEX_DEFAULT_SERVICE);
  if (!q) return { ok: false };

  const row = {
    service: q.serviceType, rateType: q.rateType ?? 'ACCOUNT', currency: q.currency,
    shipDate: input.shipDate,
    totalNetCharge: num(q.totalNetCharge), baseCharge: num(q.baseCharge),
    fuel: q.components.fuel.toString(), fuelPercent: num(q.fuelPercent),
    residential: q.components.residential.toString(), remote: q.components.remote.toString(),
    demand: q.components.demand.toString(),
    signature: q.components.signature.toString(), countryFixed: q.components.countryFixed.toString(),
    vat: q.vat.toString(), discount: q.discount.toString(),
    billingWeightKg: num(q.billingWeightKg), rateZone: q.rateZone,
    /* Đóng dấu ĐẦU VÀO cạnh phản hồi hãng — xem `DauVaoQuote`. Người đọc cache sau này cần
     * biết dòng này tính cho cân/kích thước nào mới dám quyết định có dùng lại hay không. */
    raw: { ...(raw as object), [KHOA_DAU_VAO_QUOTE]: dauVaoTuInput(input) },
  };
  await db.insert(schema.fedexRateQuotes)
    .values({ shipmentId: input.shipmentId, ...row })
    .onConflictDoUpdate({ target: schema.fedexRateQuotes.shipmentId, set: { ...row, quotedAt: new Date() } });
  return { ok: true, service: q.serviceType, total: q.totalNetCharge };
}
