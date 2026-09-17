/**
 * UPS Tracking API (OAuth client credentials) — client + parser thuần.
 *
 * Cấu hình qua env (đặt trên Railway, KHÔNG commit):
 *   UPS_CLIENT_ID / UPS_CLIENT_SECRET — app trên developer.ups.com có bật sản phẩm "Tracking".
 *   UPS_API_BASE — mặc định https://onlinetools.ups.com (môi trường thử: https://wwwcie.ups.com).
 *
 * Trả cùng shape với FedEx/DHL để `trackAny` xử lý đồng nhất; lịch sử quét đổi sang `SuKienQuet`
 * để đối chiếu lý do chậm (features/shipments/doi-chieu-ups.ts). Chỉ các hàm có `fetch` chạm mạng.
 */
import { randomUUID } from 'node:crypto';
import type { DeliveryStatus, LichSuQuet } from '@/lib/fedex/track';
import type { SuKienQuet } from '@/features/shipments/doi-chieu-fedex';

const DEFAULT_BASE = 'https://onlinetools.ups.com';
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
  // currentStatus không phải lúc nào cũng có `type` — lấy từ hoạt động mới nhất (UPS xếp mới trước).
  const moiNhat = p.activity?.[0]?.status ?? null;
  const type = p.currentStatus?.type ?? moiNhat?.type ?? null;
  const description = p.currentStatus?.description?.trim() || moiNhat?.description?.trim() || null;
  const status = mapUpsStatus(type, description);
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

let token: { value: string; het: number } | null = null;

async function layToken(base: string): Promise<string> {
  if (token && token.het > Date.now() + 60_000) return token.value;
  const id = process.env.UPS_CLIENT_ID;
  const secret = process.env.UPS_CLIENT_SECRET;
  if (!id || !secret) throw new Error('no_ups_key');
  const res = await fetch(`${base}/security/v1/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ups_oauth_http_${res.status} — kiểm tra UPS_CLIENT_ID/UPS_CLIENT_SECRET`);
  const j = (await res.json()) as { access_token?: string; expires_in?: string | number };
  if (!j.access_token) throw new Error('ups_oauth_khong_co_token');
  token = { value: j.access_token, het: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
  return token.value;
}

/** Gọi Track API cho một mã. 404 (mã không tồn tại) → null. Chạm mạng. */
async function goiUps(trackingNumber: string): Promise<unknown | null> {
  const base = process.env.UPS_API_BASE || DEFAULT_BASE;
  const bearer = await layToken(base);
  const tk = trackingNumber.replace(/\s+/g, '').toUpperCase();
  const res = await fetch(`${base}/api/track/v1/details/${encodeURIComponent(tk)}?locale=en_US&returnSignature=false`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      transId: randomUUID().replace(/-/g, '').slice(0, 32),
      transactionSrc: 'mean-blvd-ops',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (res.status === 401) { token = null; throw new Error('ups_unauthorized'); }
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
