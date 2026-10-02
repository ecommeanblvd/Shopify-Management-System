import { fedexFetch } from './client';

export type DeliveryStatus = 'label_created' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'returning' | 'exception' | 'unknown';

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
  // MỚI TẠO NHÃN: FedEx đã nhận thông tin lô hàng nhưng CHƯA quét kiện lần nào (CEO 17/09/2026).
  // Trước đây gộp vào 'in_transit' nên nhãn tạo xong rồi bỏ (đơn test, đơn huỷ) hiện mãi là
  // "đang vận chuyển". Đo trên 875606002523: latestStatus OC "Label created", sự kiện IN.
  OC: 'label_created', IN: 'label_created',
  // Đang đi trong mạng lưới.
  IT: 'in_transit', AR: 'in_transit', DP: 'in_transit', PU: 'in_transit',
  AF: 'in_transit', AP: 'in_transit', FD: 'in_transit',
  DY: 'in_transit', DD: 'in_transit',
  // Thấy trên hàng THẬT khi quét 125 kiện ngày 11/09/2026: thông quan và trung
  // chuyển. Trước đó ba mã này rơi vào 'unknown' (CP 17 kiện, CC 3, SF 1).
  CP: 'in_transit', CC: 'in_transit', SF: 'in_transit',
  // Cần người xử lý.
  DE: 'exception', SE: 'exception', CA: 'exception', HL: 'exception',
  // RS = Return to Shipper. Tách khỏi 'exception' vì đây KHÔNG phải chuyện chờ xử lý mà là một
  // kết cục: kiện đang quay về và sẽ KHÔNG BAO GIỜ có ngày giao. Gộp vào exception thì kiện hỏng
  // nặng nhất lại nằm chung rổ với kiện chỉ đang chờ khách gọi lại (CEO 13/09/2026).
  RS: 'returning',
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

/**
 * Cửa sổ còn tra vận đơn, tính từ ngày tạo kiện.
 *
 * Trước là 45 ngày — quá ngắn: kiện chưa giao tới ngày 45 bị BỎ LẠI và đóng băng vĩnh viễn ở
 * trạng thái chưa giao. Đo 14/09/2026: 18 kiện ship hộ gửi 14–23/07 có `last_tracked_at` đứng
 * yên từ 21–23/07, không ai tra nữa, và từ khi 1.2 đếm cả kiện chưa tới (D-078) thì chúng tính
 * TRỄ NẶNG mãi mãi mà không có đường kết thúc.
 *
 * 90 ngày vì đó là mức FedEx còn giữ dữ liệu tra cứu — quá mốc này API cũng không trả lời được
 * nữa, phải đóng bằng tay.
 */
export const CUA_SO_TRACK_NGAY = 90;

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

/** Kết quả lịch sử quét của một mã: danh sách sự kiện, hoặc mã lỗi FedEx trả cho riêng mã đó. */
export type LichSuQuet = { suKien: import('@/features/shipments/doi-chieu-fedex').SuKienQuet[] } | { loi: string };

/**
 * THUẦN: bóc lịch sử quét từ phản hồi Track API (includeDetailedScans). Ghép theo mã vận đơn,
 * KHÔNG theo vị trí — FedEx không cam kết giữ thứ tự.
 */
export function parseLichSuQuet(raw: unknown): Map<string, LichSuQuet> {
  const ra = new Map<string, LichSuQuet>();
  const ds = (raw as { output?: { completeTrackResults?: unknown[] } })?.output?.completeTrackResults ?? [];
  for (const c of ds as Array<{ trackingNumber?: string; trackResults?: Array<{ error?: { code?: string }; scanEvents?: unknown[] }> }>) {
    const tk = c.trackingNumber?.trim();
    if (!tk) continue;
    const tr = c.trackResults?.[0];
    if (tr?.error) { ra.set(tk, { loi: tr.error.code ?? 'LỖI KHÔNG RÕ' }); continue; }
    ra.set(tk, { suKien: (tr?.scanEvents ?? []) as import('@/features/shipments/doi-chieu-fedex').SuKienQuet[] });
  }
  return ra;
}

/** Lấy lịch sử quét chi tiết cho tối đa 30 mã một lần (FedEx giữ dữ liệu 90 ngày). */
export async function layLichSuQuet(trackingNumbers: readonly string[]): Promise<Map<string, LichSuQuet>> {
  const ds = [...new Set(trackingNumbers.map((t) => t.trim()).filter(Boolean))].slice(0, TOI_DA_MOI_LO);
  if (ds.length === 0) return new Map();
  const raw = await fedexFetch<unknown>('/track/v1/trackingnumbers', {
    method: 'POST',
    headers: HEADER_LOCALE,
    boKhoa: 'track',
    json: { includeDetailedScans: true, trackingInfo: ds.map((trackingNumber) => ({ trackingNumberInfo: { trackingNumber } })) },
  });
  return parseLichSuQuet(raw);
}

/**
 * Trạng thái giữ lại sau một lượt track tự động.
 *
 * 'returning' (đang hoàn về) là kết luận VẬN HÀNH, thường do người biết việc đặt tay, và hãng
 * KHÔNG phải lúc nào cũng nói ra: kiểm 13/09/2026 trên ca #KLS2053 thì FedEx vẫn trả IT
 * "Delivery updated" cho mã đi, vì chân hoàn về chạy dưới mã vận đơn khác. Để auto-tracker ghi
 * đè thì trạng thái người ta vừa đặt biến mất sau đúng một giờ.
 *
 * Chỉ có MỘT tin đủ mạnh để lật lại: hãng báo đã giao. Còn lại giữ nguyên 'returning'.
 *
 * Từ 02/10/2026 hàm này còn ba luật nữa — xem ghi chú trong thân hàm: 'delivered' là nấc cuối ·
 * 'unknown' không ghi đè được · và hãng KHÔNG kéo trạng thái LÙI trên thang
 * label_created → in_transit → out_for_delivery → delivered.
 */
const NAC: Record<string, number> = { label_created: 0, in_transit: 1, out_for_delivery: 2, delivered: 3 };

export function trangThaiSauKhiTrack(hienTai: string | null | undefined, moi: DeliveryStatus): DeliveryStatus | null {
  /* Hãng nói ĐÚNG thứ đang có → cho qua, đừng coi là "giữ".
   * Không có nhánh này thì mọi luật dưới đây bắn cả khi hai bên GIỐNG NHAU: 35 kiện `delivered`
   * mà hãng cũng nói `delivered` bị xếp vào "giữ trạng thái", và người gọi bỏ luôn việc ghi
   * `deliveredAt`. Vô hại vì cột đã có sẵn, nhưng đọc báo cáo thì sai nghĩa hoàn toàn. */
  if (moi === hienTai) return moi;

  if (hienTai === 'returning' && moi !== 'delivered') return null; // null = đừng đụng vào

  /* ĐÃ GIAO là nấc cuối: chỉ 'returning' lật lại được (giao rồi khách trả lại).
   * Hãng kéo một kiện đã giao về in_transit gần như luôn là dữ liệu cũ của hãng. */
  if (hienTai === 'delivered' && moi !== 'returning') return null; // (moi === 'delivered' đã qua ở trên)

  /* 'unknown' KHÔNG mang tin gì — ghi nó lên một trạng thái đang đúng là xoá tin bằng vô tin.
   * Trước bản này nó ghi đè được, nên một lượt hãng trả rỗng là mất trạng thái. */
  if (moi === 'unknown') return null;

  /* HÃNG THẮNG, NHƯNG KHÔNG LÙI (CEO 02/10/2026).
   *
   * Vì sao cần: đo 02/10 thì cả 43 kiện UPS đang mang `delivery_source = 'lark'` — trạng thái
   * giao do đội vận hành gõ, vì tracking UPS chưa từng chạy. Bật tracking lên là có NGƯỜI GHI
   * THỨ HAI trên cùng một cột: `sync-lark` mỗi giờ, `track-shipments` mỗi 6 giờ, hai bên lật
   * qua lật lại và `delivery_source` chỉ cho biết ai ghi SAU, không cho biết ai ĐÚNG.
   *
   * Luật: nhận cập nhật của hãng khi nó TIẾN LÊN hoặc ngang nấc; lùi thì GIỮ trạng thái đang
   * có. Đo trên dữ liệu thật: 4 kiện UPS đang `out_for_delivery` mà hãng nói `in_transit` —
   * lùi như vậy là xoá công của người vừa nhìn thấy hàng đi giao.
   *
   * Lùi KHÔNG bị bỏ im: người gọi vẫn ghi `track_detail` để thấy hãng đang nói gì (xem
   * `features/shipments/track.ts`). Giữ trạng thái khác hẳn giấu thông tin.
   *
   * `exception` và `returning` KHÔNG ở trên nấc nên vẫn qua: đó là tin có nghĩa, và từ 02/10
   * `exception` của UPS chỉ còn là ngoại lệ thật (thông báo chậm đã về in_transit — xem
   * `lib/ups/track.ts`), nên nó không còn là nguồn báo động giả. */
  const cu = NAC[hienTai ?? ''], mo = NAC[moi];
  if (cu != null && mo != null && mo < cu) return null;

  return moi;
}
