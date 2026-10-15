/**
 * UPS Tracking API (OAuth client credentials) — client + parser thuần.
 *
 * OAuth + header dùng chung ở `lib/ups/client.ts` (Rating cũng dùng).
 *
 * Trả cùng shape với FedEx/DHL để `trackAny` xử lý đồng nhất; lịch sử quét đổi sang `SuKienQuet`
 * để đối chiếu lý do chậm (features/shipments/doi-chieu-ups.ts). Chỉ các hàm có `fetch` chạm mạng.
 */
import { headerUps, layTokenUps, upsBase, xoaTokenUps } from './client';
import type { DeliveryStatus, LichSuQuet } from '@/lib/fedex/track';
import type { SuKienQuet } from '@/features/shipments/doi-chieu-fedex';

const OUT_FOR_DELIVERY_RE = /out for delivery/i;

export interface UpsTrackResult {
  status: DeliveryStatus;
  description: string | null;
  deliveredAt: Date | null;
}

/**
 * `status.type` của UPS → DeliveryStatus. THUẦN.
 *   M  Manifest — mới có thông tin nhãn (≈ FedEx OC)   MV  nhãn đã huỷ
 *   P  Pickup   I  In transit   O  Out for delivery      D  Delivered
 *   X  Exception                RS Returned to shipper
 */
/**
 * Mã `currentStatus.code` của UPS → trạng thái. ĐÂY là nguồn chính, không phải `type`.
 *
 * ĐO 02/10/2026 trên 47 kiện UPS thật (toàn bộ kiện 1Z trong hệ thống, 17/08–30/09):
 * `currentStatus.type` **KHÔNG CÓ Ở MỘT MÃ NÀO** — 0/47. Nên nhánh `currentStatus.type` của
 * parser là mã chết, và nó LUÔN rơi xuống lấy `type` của lần quét cuối. Hậu quả đo được:
 * 4 kiện `code=005` "On the Way" (đang đi, kèm thông báo có thể chậm) bị gắn `exception`, chỉ
 * vì lần quét cuối là `X`; còn 1 kiện CÙNG `code=005` lại ra `in_transit` vì lần quét cuối là
 * `I`. Cùng một tình trạng thật, hai câu trả lời — và `order-stage.ts` bật cảnh báo
 * "Sự cố giao hàng" cho hàng đang đi bình thường.
 *
 * Bộ mã dưới đây là bộ ĐO ĐƯỢC, không phải bộ đoán từ tài liệu. Mã lạ → `null` để người gọi
 * rơi về luật cũ (theo `type` lần quét), chứ không ép thành `unknown`: luật cũ sai ở ca 005
 * nhưng đúng ở phần lớn ca khác, nên nó là chỗ rơi an toàn hơn.
 */
export function mapUpsCode(code: string | null | undefined): DeliveryStatus | null {
  switch ((code ?? '').trim()) {
    case '011': return 'delivered';
    /* "Ready for Customer Pickup" — kiện ĐANG Ở ĐIỂM UPS chờ khách tới lấy, chưa tới tay ai.
     * CEO 02/10/2026 chốt thêm nấc riêng, nên không còn báo `delivered` (sai: chưa ai nhận) và
     * cũng không gộp vào `exception` (sai: không phải sự cố của hãng). Cùng nấc với FedEx `HL`. */
    case '040': return 'awaiting_pickup';
    /* Ngoại lệ THẬT: giao không thành vì thiếu tiền (thuế/phí người nhận phải trả). */
    case '062': return 'exception';
    /* Đang đi. `005` còn kèm thông báo "có thể chậm" — chậm KHÔNG phải ngoại lệ, và chính UPS
     * vẫn đặt tiêu đề là "On the Way". `087` ở kho địa phương, `160` mới nhận hàng. */
    case '005': case '087': case '160': return 'in_transit';
    default: return null;
  }
}

export function mapUpsStatus(type: string | null | undefined, description: string | null | undefined): DeliveryStatus {
  switch ((type ?? '').toUpperCase()) {
    case 'D': return 'delivered';
    case 'O': return 'out_for_delivery';
    case 'I':
    case 'P': return description && OUT_FOR_DELIVERY_RE.test(description) ? 'out_for_delivery' : 'in_transit';
    case 'X': return 'exception';
    case 'RS': return 'returning';
    case 'M':
    case 'MV': return 'label_created';
    default: return 'unknown';
  }
}

interface UpsStatus { type?: string | null; code?: string | null; description?: string | null; statusCode?: string | null }
interface UpsActivity { date?: string | null; time?: string | null; gmtDate?: string | null; gmtTime?: string | null; status?: UpsStatus | null }
interface UpsPackage {
  trackingNumber?: string | null;
  currentStatus?: UpsStatus | null;
  deliveryDate?: Array<{ type?: string | null; date?: string | null }> | null;
  deliveryTime?: { type?: string | null; endTime?: string | null } | null;
  activity?: UpsActivity[] | null;
}
interface UpsRaw {
  trackResponse?: { shipment?: Array<{ package?: UpsPackage[] | null; warnings?: Array<{ code?: string; message?: string }> | null }> | null };
}

/** "20260827" + "143005" → Date (giờ địa phương nơi quét, coi như UTC — chỉ cần tới ngày). */
function ngayUps(date: string | null | undefined, time: string | null | undefined): Date | null {
  const d = (date ?? '').trim();
  if (!/^\d{8}$/.test(d)) return null;
  const t = /^\d{6}$/.test((time ?? '').trim()) ? time!.trim() : '000000';
  const r = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)));
  return Number.isNaN(r.getTime()) ? null : r;
}

const goiDau = (raw: unknown): UpsPackage | null =>
  (raw as UpsRaw | null)?.trackResponse?.shipment?.[0]?.package?.[0] ?? null;

/** Phản hồi Track API → trạng thái hiện tại. THUẦN, không nổ với input thiếu. */
export function parseUpsTrack(raw: unknown): UpsTrackResult {
  const p = goiDau(raw);
  if (!p) return { status: 'unknown', description: null, deliveredAt: null };
  const moiNhat = p.activity?.[0]?.status ?? null;
  const description = p.currentStatus?.description?.trim() || moiNhat?.description?.trim() || null;

  /* THỨ TỰ NGUỒN (đo 02/10/2026 trên 47 kiện thật — xem `mapUpsCode`):
   *   1. `currentStatus.code` — mã tình trạng HIỆN TẠI của kiện. Nguồn đúng.
   *   2. nếu mã lạ: rơi về luật cũ theo `type`, với `currentStatus.type` trước (thực tế KHÔNG
   *      BAO GIỜ có) rồi tới `type` của lần quét cuối.
   *
   * Vì sao mã đứng trước `type` lần quét: `type` mô tả MỘT SỰ KIỆN, không mô tả tình trạng.
   * Một thông báo "có thể chậm" (`X`) là một sự kiện trên đường đi, không phải trạng thái của
   * kiện — lấy nó làm trạng thái là biến hàng đang đi thành hàng sự cố.
   *
   * `out_for_delivery` vẫn nhận theo MÔ TẢ cho cả hai nhánh: UPS báo việc đó bằng chữ
   * ("Out For Delivery Today") và bộ 47 kiện không có mã riêng cho nó. */
  const theoMa = mapUpsCode(p.currentStatus?.code);
  const type = p.currentStatus?.type ?? moiNhat?.type ?? null;
  const status = theoMa != null
    ? (theoMa === 'in_transit' && description && OUT_FOR_DELIVERY_RE.test(description) ? 'out_for_delivery' : theoMa)
    : mapUpsStatus(type, description);
  let deliveredAt: Date | null = null;
  if (status === 'delivered') {
    const del = p.deliveryDate?.find((x) => (x.type ?? '').toUpperCase() === 'DEL') ?? null;
    deliveredAt = ngayUps(del?.date, p.deliveryTime?.endTime)
      ?? ngayUps(p.activity?.find((a) => (a.status?.type ?? '').toUpperCase() === 'D')?.date, p.activity?.find((a) => (a.status?.type ?? '').toUpperCase() === 'D')?.time);
  }
  return { status, description, deliveredAt };
}

/** Hoạt động UPS → sự kiện quét dạng chung. Mã ngoại lệ chỉ điền cho sự kiện loại X. THUẦN. */
export function parseUpsLichSu(raw: unknown): LichSuQuet {
  const p = goiDau(raw);
  if (!p) {
    const w = (raw as UpsRaw | null)?.trackResponse?.shipment?.[0]?.warnings?.[0];
    return { loi: w?.code ? `UPS ${w.code}${w.message ? ` ${w.message}` : ''}` : 'UPS không trả kiện' };
  }
  const suKien: SuKienQuet[] = (p.activity ?? []).map((a) => {
    const type = (a.status?.type ?? '').toUpperCase() || null;
    const moTa = a.status?.description?.trim() || null;
    const laNgoaiLe = type === 'X';
    return {
      date: ngayUps(a.date, a.time)?.toISOString() ?? null,
      eventType: type,
      eventDescription: moTa,
      exceptionCode: laNgoaiLe ? (a.status?.code ?? null) : null,
      exceptionDescription: laNgoaiLe ? moTa : null,
    };
  });
  return { suKien };
}

/** Gọi Track API cho một mã. 404 (mã không tồn tại) → null. Chạm mạng. */
async function goiUps(trackingNumber: string): Promise<unknown | null> {
  const base = upsBase();
  const bearer = await layTokenUps();
  const tk = trackingNumber.replace(/\s+/g, '').toUpperCase();
  const res = await fetch(`${base}/api/track/v1/details/${encodeURIComponent(tk)}?locale=en_US&returnSignature=false`, {
    headers: headerUps(bearer),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (res.status === 401) { xoaTokenUps(); throw new Error('ups_unauthorized'); }
  if (res.status === 429) throw new Error('ups_rate_limited');
  if (!res.ok) throw new Error(`ups_track_http_${res.status}`);
  return res.json();
}

export async function trackUps(trackingNumber: string): Promise<UpsTrackResult> {
  const raw = await goiUps(trackingNumber);
  return raw == null ? { status: 'unknown', description: null, deliveredAt: null } : parseUpsTrack(raw);
}

/** Lịch sử quét của một kiện UPS (API UPS tra từng mã một). */
export async function layLichSuQuetUps(trackingNumber: string): Promise<LichSuQuet> {
  const raw = await goiUps(trackingNumber);
  return raw == null ? { loi: 'UPS không tìm thấy mã vận đơn' } : parseUpsLichSu(raw);
}

/**
 * THÔNG SỐ THẬT của một vận đơn UPS, đọc từ Track API — khoá theo MÃ VẬN ĐƠN.
 *
 * Cùng mục đích với `ThongSoVanDonFedex`: thôi dựng lại lô hàng từ cột của mình. Đo 16/10/2026
 * trên 37 kiện UPS, giá hệ thống khớp số điền tay trên Lark **0/37** — ô base 0/37, nhiên liệu
 * 0/37. Ba nguyên nhân, trường dưới đây gỡ hai:
 *   - đường cũ lấy mức RẺ NHẤT (`chonMucReNhat`) thay vì dịch vụ THẬT của nhãn;
 *   - cờ ký nhận suy theo nước thay vì đọc dịch vụ đã mua trên nhãn.
 * (Nguyên nhân thứ ba — ô base ghi giá hợp đồng thay vì niêm yết — nằm ở `lib/ups/rate.ts`.)
 *
 * ⚠️ Track API UPS **KHÔNG trả tiền**, y như FedEx: đã soát cả cây phản hồi, chỉ có dịch vụ,
 * cân, kích thước, địa chỉ, dịch vụ cộng thêm. Tiền vẫn phải hỏi Rating API — nhưng hỏi bằng
 * đúng thông số của nhãn.
 */
export interface ThongSoVanDonUps {
  /**
   * Mã dịch vụ DÙNG ĐƯỢC VỚI RATING API, lấy từ `service.levelCode` và đã bỏ số 0 đầu.
   *
   * KHÔNG phải `service.code`: Track trả `code: '566'` cho cùng dịch vụ mà Rating gọi là `65`
   * (`levelCode: '065'`) — hai hệ mã khác nhau, ghép bằng `code` thì không bao giờ khớp.
   */
  maDichVu: string | null;
  tenDichVu: string | null;
  /** ⚠️ Cân UPS ghi nhận — dùng để ĐỐI SOÁT, KHÔNG dùng dựng giá lúc tạo vận đơn (cùng lý do
   *  như `ThongSoVanDonFedex.canKg`: hãng cân đo lại thì số này đổi). */
  canKg: number | null;
  /** ⚠️ Kích thước UPS ghi nhận — cùng cảnh báo như `canKg`. */
  kichThuocCm: { dai: number; rong: number; cao: number } | null;
  /** Thành phố đích UPS đã chuẩn hoá (viết hoa). Gửi tên này thay tên khách gõ, cùng lý do
   *  như FedEx: hãng tra phụ phí theo tên của nó. */
  thanhPho: string | null;
  /** `additionalServices` có mục ký nhận — dịch vụ ĐÃ MUA trên nhãn. */
  kyNhanTrucTiep: boolean;
}

const soDuong = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** THUẦN: bóc thông số vận đơn UPS. `null` khi phản hồi không có gói nào. */
export function parseThongSoVanDonUps(raw: unknown): ThongSoVanDonUps | null {
  const p = goiDau(raw) as (UpsPackage & {
    service?: { code?: unknown; levelCode?: unknown; description?: unknown };
    weight?: { weight?: unknown };
    dimension?: { length?: unknown; width?: unknown; height?: unknown; unitOfDimension?: unknown };
    additionalServices?: unknown[];
    packageAddress?: Array<{ type?: unknown; address?: { city?: unknown } }>;
  }) | null;
  if (!p) return null;

  const lv = typeof p.service?.levelCode === 'string' ? p.service.levelCode.trim().replace(/^0+/, '') : '';
  const kt = p.dimension;
  /* Chỉ nhận kích thước khi UPS nói rõ đơn vị là CM — nhận bừa bản IN là thu nhỏ kiện 2,54
   * lần. Thiếu một chiều thì bỏ cả khối: ba chiều mới là một kiện. */
  const laCm = String(kt?.unitOfDimension ?? '').trim().toUpperCase() === 'CM';
  const dai = laCm ? soDuong(kt?.length) : null;
  const rong = laCm ? soDuong(kt?.width) : null;
  const cao = laCm ? soDuong(kt?.height) : null;
  const dich = (p.packageAddress ?? []).find((a) => String(a.type ?? '').toUpperCase() === 'DESTINATION');
  const tp = dich?.address?.city;

  return {
    maDichVu: lv !== '' ? lv : null,
    tenDichVu: typeof p.service?.description === 'string' && p.service.description.trim() !== ''
      ? p.service.description.trim() : null,
    canKg: soDuong(p.weight?.weight),
    kichThuocCm: dai != null && rong != null && cao != null ? { dai, rong, cao } : null,
    thanhPho: typeof tp === 'string' && tp.trim() !== '' ? tp.trim() : null,
    kyNhanTrucTiep: (p.additionalServices ?? []).some((s) => /SIGNATURE/i.test(String(s))),
  };
}

/** Gọi Track API lấy thông số thật của một vận đơn UPS. `null` khi hãng chưa có dữ liệu hoặc
 *  lượt gọi hỏng — người gọi rơi về dữ liệu của mình và PHẢI nói ra. */
export async function layThongSoVanDonUps(trackingNumber: string): Promise<ThongSoVanDonUps | null> {
  try {
    const raw = await goiUps(trackingNumber);
    return raw == null ? null : parseThongSoVanDonUps(raw);
  } catch {
    return null;
  }
}
