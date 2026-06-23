import { fedexFetch } from './client';

export type DeliveryStatus = 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'unknown';

const STATUS_BY_CODE: Record<string, DeliveryStatus> = {
  DL: 'delivered',
  OD: 'out_for_delivery', OF: 'out_for_delivery',
  IT: 'in_transit', IN: 'in_transit', AR: 'in_transit', DP: 'in_transit', PU: 'in_transit', AF: 'in_transit', AP: 'in_transit',
  DE: 'exception', SE: 'exception', CA: 'exception', RS: 'exception',
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

export function parseFedexTrack(raw: unknown): FedexTrackResult {
  const tr = (raw as TrackRaw)?.output?.completeTrackResults?.[0]?.trackResults?.[0];
  const code = tr?.latestStatusDetail?.code ?? null;
  const description = tr?.latestStatusDetail?.statusByLocale ?? tr?.latestStatusDetail?.description ?? null;
  const delISO = tr?.dateAndTimes?.find((d) => d.type === 'ACTUAL_DELIVERY')?.dateTime ?? null;
  const deliveredAt = delISO ? new Date(delISO) : null;
  return { statusCode: code, status: mapFedexStatus(code), description, deliveredAt: deliveredAt && !Number.isNaN(deliveredAt.getTime()) ? deliveredAt : null };
}

/** Gọi FedEx Track API cho 1 tracking number. */
export async function trackFedex(trackingNumber: string): Promise<FedexTrackResult> {
  const raw = await fedexFetch<unknown>('/track/v1/trackingnumbers', {
    method: 'POST',
    json: { includeDetailedScans: false, trackingInfo: [{ trackingNumberInfo: { trackingNumber } }] },
  });
  return parseFedexTrack(raw);
}
