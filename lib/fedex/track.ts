import { fedexFetch } from './client';

export type DeliveryStatus = 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'unknown';

/**
 * Mã trạng thái FedEx → trạng thái hệ thống. Danh sách lấy từ bộ ca kiểm thử chính
 * thức của FedEx (Basic Integrated Visibility) và đã đối chiếu thật trên sandbox
 * 11/09/2026 — trước đó HL và AD rơi vào 'unknown'.
 *
 * Quy ước: 'exception' nghĩa là CẦN NGƯỜI XỬ LÝ, không phải "có chuyện lạ".
 * Vì vậy kiện chậm (DY/DD) vẫn là 'in_transit' — nó đang đi, và độ trễ đã được
 * bảng SOP đo bằng SỐ NGÀY; còn HL (chờ khách tới lấy) là 'exception' vì không ai
 * gọi khách thì kiện nằm đó mãi.
 */
const STATUS_BY_CODE: Record<string, DeliveryStatus> = {
  DL: 'delivered',
  // Đang trên xe giao / đã tới điểm giao.
  OD: 'out_for_delivery', OF: 'out_for_delivery', ED: 'out_for_delivery', AD: 'out_for_delivery',
  // Đang đi trong mạng lưới.
  IT: 'in_transit', IN: 'in_transit', AR: 'in_transit', DP: 'in_transit', PU: 'in_transit',
  AF: 'in_transit', AP: 'in_transit', FD: 'in_transit', OC: 'in_transit',
  DY: 'in_transit', DD: 'in_transit',
  // Thấy trên hàng THẬT khi quét 125 kiện ngày 11/09/2026: thông quan và trung
  // chuyển. Trước đó ba mã này rơi vào 'unknown' (CP 17 kiện, CC 3, SF 1).
  CP: 'in_transit', CC: 'in_transit', SF: 'in_transit',
  // Cần người xử lý.
  DE: 'exception', SE: 'exception', CA: 'exception', RS: 'exception', HL: 'exception',
};

export function mapFedexStatus(code: string | null | undefined): DeliveryStatus {
  if (!code) return 'unknown';
  return STATUS_BY_CODE[code.toUpperCase()] ?? 'unknown';
}

export interface FedexTrackResult {
  statusCode: string | null;
  status: DeliveryStatus;
  description: string | null;
  deliveredAt: Date | null;
}

interface TrackRaw {
  output?: { completeTrackResults?: Array<{ trackResults?: Array<{
    latestStatusDetail?: { code?: string; statusByLocale?: string; description?: string };
    dateAndTimes?: Array<{ type?: string; dateTime?: string }>;
  }> }> };
}

/**
 * THUẦN: đọc mốc thời gian FedEx trả về mà KHÔNG dịch múi giờ.
 *
 * FedEx trả giờ ĐỊA PHƯƠNG nơi giao, khi thì kèm offset ('…-06:00'), khi thì không.
 * `new Date('2022-11-27T17:39:00')` hiểu chuỗi không offset theo múi giờ của MÁY
 * đang chạy, nên cùng một phản hồi sẽ ra hai kết quả khác nhau trên Railway (UTC)
 * và trên máy ở Việt Nam (+07) — lệch đủ để đổi NGÀY giao và làm sai số ngày trong
 * bảng SOP. Cột timestamp của dự án là UTC-naive nên ta giữ nguyên giờ đồng hồ:
 * bỏ offset nếu có, rồi đọc như UTC.
 */
export function docMocFedex(s: string | null | undefined): Date | null {
  if (!s) return null;
  const tho = s.trim();
  // Bỏ 'Z' hoặc '+07:00' / '-06:00' ở cuối, giữ lại phần ngày-giờ.
  const khongOffset = tho.replace(/(?:Z|[+-]\d{2}:?\d{2})$/, '');
  const d = new Date(`${khongOffset}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseFedexTrack(raw: unknown): FedexTrackResult {
  const tr = (raw as TrackRaw)?.output?.completeTrackResults?.[0]?.trackResults?.[0];
  const code = tr?.latestStatusDetail?.code ?? null;
  const description = tr?.latestStatusDetail?.statusByLocale ?? tr?.latestStatusDetail?.description ?? null;
  const delISO = tr?.dateAndTimes?.find((d) => d.type === 'ACTUAL_DELIVERY')?.dateTime ?? null;
  const deliveredAt = docMocFedex(delISO);
  // Lưới an toàn cho mã lạ về sau: FedEx chỉ đặt ACTUAL_DELIVERY khi hàng ĐÃ giao,
  // nên có mốc đó thì coi là đã giao dù bảng mã chưa biết mã trạng thái. Kiểm trên
  // 125 kiện thật: đúng 85 kiện có mốc này và cả 85 đều mang mã DL, nên luật này
  // hiện KHÔNG đổi kết quả nào — nó chỉ đỡ cho tương lai.
  const status = deliveredAt ? 'delivered' : mapFedexStatus(code);
  return { statusCode: code, status, description, deliveredAt };
}

/** FedEx trả mô tả theo ngôn ngữ; không ép locale thì sandbox trả tiếng Tây Ban Nha
 *  ("Excepción de entrega") và mô tả lưu vào hệ thống sẽ lúc này lúc khác. */
const HEADER_LOCALE = { 'x-locale': 'en_US' };

/** Số mã tối đa FedEx nhận trong MỘT lần gọi (đặc tả Basic Integrated Visibility). */
export const TOI_DA_MOI_LO = 30;

/** Gọi FedEx Track API cho 1 tracking number. */
export async function trackFedex(trackingNumber: string): Promise<FedexTrackResult> {
  const raw = await fedexFetch<unknown>('/track/v1/trackingnumbers', {
    method: 'POST',
    headers: HEADER_LOCALE,
    boKhoa: 'track',
    json: { includeDetailedScans: false, trackingInfo: [{ trackingNumberInfo: { trackingNumber } }] },
  });
  return parseFedexTrack(raw);
}

interface BatchRaw {
  output?: { completeTrackResults?: Array<{ trackingNumber?: string; trackResults?: unknown[] }> };
}

/**
 * THUẦN: bóc phản hồi gọi-theo-lô thành bản đồ theo MÃ VẬN ĐƠN.
 *
 * Bắt buộc ghép theo `trackingNumber` trong phản hồi, TUYỆT ĐỐI không theo thứ tự:
 * đo thật trên sandbox 11/09/2026, gửi 5 mã thì mã thứ 5 trả về là một mã hoàn toàn
 * khác. Ghép theo vị trí sẽ gán ngày giao của kiện này sang kiện khác.
 */
export function parseFedexTrackBatch(raw: unknown): Map<string, FedexTrackResult> {
  const ra = new Map<string, FedexTrackResult>();
  for (const ct of (raw as BatchRaw)?.output?.completeTrackResults ?? []) {
    const tn = ct.trackingNumber?.trim();
    if (!tn) continue;
    ra.set(tn, parseFedexTrack({ output: { completeTrackResults: [ct] } }));
  }
  return ra;
}

/** Gọi Track API cho tối đa 30 mã một lần. Trả bản đồ mã → kết quả; mã không có
 *  trong phản hồi thì KHÔNG xuất hiện trong bản đồ (người gọi tự xử lý). */
export async function trackFedexBatch(trackingNumbers: readonly string[]): Promise<Map<string, FedexTrackResult>> {
  const ds = [...new Set(trackingNumbers.map((t) => t.trim()).filter(Boolean))].slice(0, TOI_DA_MOI_LO);
  if (ds.length === 0) return new Map();
  const raw = await fedexFetch<unknown>('/track/v1/trackingnumbers', {
    method: 'POST',
    headers: HEADER_LOCALE,
    boKhoa: 'track',
    json: { includeDetailedScans: false, trackingInfo: ds.map((trackingNumber) => ({ trackingNumberInfo: { trackingNumber } })) },
  });
  return parseFedexTrackBatch(raw);
}
