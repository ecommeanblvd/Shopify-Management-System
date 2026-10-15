import { fedexFetch } from './client';

export type DeliveryStatus =
  | 'label_created' | 'in_transit' | 'out_for_delivery'
  /** Kiện ĐANG Ở ĐIỂM NHẬN chờ khách tới lấy — hãng hết việc, khách chưa nhận (CEO 02/10/2026). */
  | 'awaiting_pickup'
  | 'delivered' | 'returning' | 'exception' | 'unknown';

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
  DE: 'exception', SE: 'exception', CA: 'exception',
  /* HL = Hold at Location: kiện nằm ở điểm nhận chờ khách tới lấy. TỪ 02/10/2026 tách khỏi
   * 'exception' sang nấc riêng `awaiting_pickup` — "chờ khách lấy" không phải sự cố của hãng,
   * mà gộp vào exception thì nó nằm chung rổ với kiện giao thất bại và không ai phân biệt được
   * việc cần làm. Đo 02/10: 2 kiện FedEx đang exception với lời hãng "Ready for pickup". */
  HL: 'awaiting_pickup',
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
/* Thang nấc để chặn hãng kéo trạng thái LÙI.
 *
 * `awaiting_pickup` CÙNG NẤC với `out_for_delivery`, không đứng sau: hai thứ đều là chặng cuối
 * và đi được CẢ HAI CHIỀU — kiện giao không được thì về điểm nhận chờ khách (ofd → chờ lấy), mà
 * khách xin giao lại thì nó ra xe lần nữa (chờ lấy → ofd). Xếp `awaiting_pickup` thành nấc 3
 * (sau ofd) sẽ chặn đúng chiều thứ hai, và trạng thái đứng im ở "chờ khách lấy" trong khi hãng
 * đã mang đi giao. Nấc bằng nhau thì cả hai chiều qua được, mà vẫn không kéo lùi từ `delivered`. */
const NAC: Record<string, number> = {
  label_created: 0, in_transit: 1, out_for_delivery: 2, awaiting_pickup: 2, delivered: 3,
};

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

/**
 * THÔNG SỐ THẬT của một vận đơn đã phát hành, đọc từ Track API — tức khoá theo MÃ VẬN ĐƠN,
 * không phải dựng lại từ dữ liệu của mình.
 *
 * Vì sao cần (CEO 15/10/2026): đường lấy giá ước tính vốn tự dựng lại lô hàng từ cột cân/kích
 * thước trong CSDL rồi hỏi Rate API, nên nó ra một con số KHÁC con số hãng hiện trên cổng cho
 * chính mã đó. Đo trên `878631025811`: cổng FedEx báo tổng **1.378.588đ**, hệ thống báo
 * 1.496.487đ. Ba đầu vào sai cùng lúc — loại bao gói (hệ thống không khai nên hãng tính thang
 * hộp, thật ra là Túi FedEx), cờ nhà dân (hệ thống suy từ `addr_class` là RESIDENTIAL nên cộng
 * thêm 84.400 + nhiên liệu, hãng KHÔNG thu), và kích thước (CSDL giữ 40×31×2 của danh mục vật
 * tư, nhãn ghi 36×27×6).
 *
 * Lấy đúng sáu thông số dưới đây rồi hỏi lại Rate API thì **khớp từng đồng** với màn hình
 * hãng: base 2.244.600 · nhiên liệu 412.012 · ký nhận 92.700 · xử lý hàng nhập 68.300 · VAT
 * 102.118 · chiết khấu 1.541.142 (VOLUME 1.384.020 + BONUS 157.122) · tổng 1.378.588.
 *
 * ⚠️ Track API **KHÔNG trả tiền**. Đã soát toàn bộ cây phản hồi bằng bộ lọc
 * `charge|amount|rate|cost|price|discount|surcharge|fee|currency|total|freight`: **không một
 * trường nào**. Nó trả ĐẦU VÀO, còn tiền vẫn phải hỏi Rate API — nhưng hỏi bằng đúng đầu vào
 * của vận đơn thì không còn là "dựng lại", mà là tái lập chính lượt tính giá của hãng.
 */
export interface ThongSoVanDonFedex {
  /** `packageDetails.packagingDescription.type`, vd 'FEDEX_PAK' / 'YOUR_PACKAGING'. */
  loaiBaoGoi: string | null;
  /** `serviceDetail.type`, vd 'FEDEX_INTERNATIONAL_PRIORITY'. */
  dichVu: string | null;
  canKg: number | null;
  kichThuocCm: { dai: number; rong: number; cao: number } | null;
  /** `recipientInformation.address.residential` — phân loại CỦA HÃNG trên chính nhãn này.
   *  Đáng tin hơn `addr_class` của mình: trên `878631025811` cột mình ghi RESIDENTIAL mà hãng
   *  ghi false và không thu phí nhà dân. `null` = phản hồi không nói. */
  nhaDan: boolean | null;
  /** `specialHandlings` có `DIRECT_SIGNATURE_REQUIRED` — dịch vụ ĐÃ MUA trên nhãn, thay cho
   *  phép suy theo nước (`countrySupportsDirectSignature`). */
  kyNhanTrucTiep: boolean;
  /** `dateAndTimes` loại `SHIP` → YYYY-MM-DD. Ngày hãng dùng để chốt bảng giá và %nhiên liệu. */
  ngayGui: string | null;
  /** `additionalTrackingInfo.packageIdentifiers` loại `SHIPPER_REFERENCE` — mã đơn nhân sự
   *  khai lúc tạo nhãn, để đối chiếu nhãn có đúng đơn không. */
  maThamChieu: string | null;
}

/** Hình phần `packageDetails` ta thật sự đọc — khai rõ thay vì `any`, để đổi tên trường là
 *  trình biên dịch kêu chứ không im lặng trả null. */
interface BocGoi {
  packagingDescription?: { type?: unknown };
  weightAndDimensions?: {
    weight?: Array<Record<string, unknown>>;
    dimensions?: Array<Record<string, unknown>>;
  };
}

const so = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * THUẦN: bóc thông số vận đơn từ phản hồi Track API. `null` khi phản hồi không có kết quả
 * hoặc FedEx trả lỗi cho mã đó (nhãn vừa tạo chưa lên hệ thống, mã sai, quá 90 ngày).
 *
 * Mọi trường đều có thể `null` RIÊNG LẺ: FedEx che bớt thông tin tuỳ kiện (vd không trả mã bưu
 * chính người nhận bao giờ). Người gọi phải rơi về nguồn của mình cho ĐÚNG Ô thiếu, chứ không
 * vứt cả khối — thiếu kích thước không có nghĩa là loại bao gói cũng sai.
 */
export function parseThongSoVanDon(raw: unknown): ThongSoVanDonFedex | null {
  const tr = (raw as { output?: { completeTrackResults?: Array<{ trackResults?: unknown[] }> } })
    ?.output?.completeTrackResults?.[0]?.trackResults?.[0] as Record<string, unknown> | undefined;
  if (!tr || tr.error != null) return null;

  const pkg = tr.packageDetails as BocGoi | undefined;
  /* FedEx trả kích thước ở CẢ CM LẪN INCH trong cùng một mảng. Phải lọc theo `units`, không
   * lấy phần tử đầu: thứ tự không được cam kết, và lấy nhầm bản inch là thu nhỏ kiện 2,54 lần
   * rồi báo một giá rẻ bịa ra. */
  const kt = pkg?.weightAndDimensions?.dimensions
    ?.find((d) => String(d.units ?? '').toUpperCase() === 'CM');
  const can = pkg?.weightAndDimensions?.weight
    ?.find((w) => String(w.unit ?? '').toUpperCase() === 'KG');

  const dai = so(kt?.length), rong = so(kt?.width), cao = so(kt?.height);
  const ngay = (tr.dateAndTimes as Array<Record<string, unknown>> | undefined)
    ?.find((d) => String(d.type ?? '') === 'SHIP')?.dateTime;
  const ref = ((tr.additionalTrackingInfo as { packageIdentifiers?: Array<{ type?: unknown; values?: unknown[] }> } | undefined)
    ?.packageIdentifiers ?? []).find((p) => String(p.type ?? '') === 'SHIPPER_REFERENCE')?.values?.[0];
  const resi = (tr.recipientInformation as { address?: { residential?: unknown } } | undefined)?.address?.residential;

  const dichVu = (tr.serviceDetail as { type?: unknown } | undefined)?.type;
  const baoGoi = pkg?.packagingDescription?.type;
  return {
    loaiBaoGoi: typeof baoGoi === 'string' && baoGoi.trim() !== '' ? baoGoi : null,
    dichVu: typeof dichVu === 'string' && dichVu.trim() !== '' ? dichVu : null,
    canKg: so(can?.value),
    // Thiếu MỘT chiều là không dựng khối — ba chiều phải đi cùng nhau mới là một kiện.
    kichThuocCm: dai != null && rong != null && cao != null ? { dai, rong, cao } : null,
    nhaDan: typeof resi === 'boolean' ? resi : null,
    kyNhanTrucTiep: ((tr.specialHandlings as Array<Record<string, unknown>> | undefined) ?? [])
      .some((s) => String(s.type ?? '').toUpperCase().includes('SIGNATURE')),
    ngayGui: typeof ngay === 'string' && ngay.length >= 10 ? ngay.slice(0, 10) : null,
    maThamChieu: typeof ref === 'string' && ref.trim() !== '' ? ref.trim() : null,
  };
}

/** Gọi Track API lấy thông số thật của MỘT vận đơn. `null` khi hãng chưa có dữ liệu cho mã đó
 *  (nhãn vừa tạo), hoặc lượt gọi hỏng — người gọi rơi về dữ liệu của mình và PHẢI nói ra. */
export async function layThongSoVanDon(trackingNumber: string): Promise<ThongSoVanDonFedex | null> {
  try {
    const raw = await fedexFetch<unknown>('/track/v1/trackingnumbers', {
      method: 'POST',
      headers: HEADER_LOCALE,
      boKhoa: 'track',
      json: { includeDetailedScans: false, trackingInfo: [{ trackingNumberInfo: { trackingNumber } }] },
    });
    return parseThongSoVanDon(raw);
  } catch {
    return null;
  }
}
