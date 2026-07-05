// Order Journey API client (Task 9). Mirrors the `smsFetch` pattern in `./api.ts`
// but lives in its own module since the JSON shapes are new (Task 4/5 backend).

declare const shopify: { sessionToken: { get(): Promise<string> }; settings: { backend_url?: string } };

// Keep in sync with the default in `./api.ts` — same backend for every MEAN store.
const DEFAULT_BACKEND_URL = 'https://shopify-management-system-production.up.railway.app';

function backendBase(): string {
  return (shopify.settings.backend_url ?? '').trim() || DEFAULT_BACKEND_URL;
}

async function smsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await shopify.sessionToken.get();
  const res = await fetch(`${backendBase()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`SMS ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Upload variant: no Content-Type header set — the browser derives the multipart boundary from FormData. */
async function smsUpload<T>(path: string, form: FormData): Promise<T> {
  const token = await shopify.sessionToken.get();
  const res = await fetch(`${backendBase()}${path}`, {
    method: 'POST',
    body: form,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`SMS ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export type CancelPolicy = 'free' | 'fee40' | null;

export interface JourneyPolicy {
  canCancel: CancelPolicy;
  canClaim: boolean;
  claimDeadline: string | null;
  refundPercent: 100 | 60;
  refundAmount: string;
  feeAmount: string;
}

export interface JourneyOrder {
  orderId: string;
  orderNumber: string;
  total: string;
  currency: string;
}

export interface JourneyTimelineStep {
  label: string;
  at: string | null;
}

export interface JourneyTimeline {
  currentStage: string;
  currentStageLabel: string;
  nextStageLabel: string | null;
  steps: JourneyTimelineStep[];
}

export interface ReturnHub {
  label: string;
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
}

export type RequestKind = 'cancel' | 'claim';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'completed';

export interface JourneyRequest {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  reasonCodes: string[];
  createdAt: string;
  refundAmount: string | null;
  currency: string;
  returnHub: ReturnHub | null;
  returnShippingPayer: string | null;
  returnTrackingNumber: string | null;
  returnCarrier: string | null;
  rejectedReason: string | null;
}

export interface JourneyResponse {
  order: JourneyOrder;
  timeline: JourneyTimeline | null;
  productionEta: string | null;
  policy: JourneyPolicy;
  requests: JourneyRequest[];
}

export const CLAIM_REASON_CODES = [
  'damaged_package',
  'damaged_product',
  'wrong_item',
  'wrong_size',
  'missing_item',
  'other',
] as const;
export type ClaimReasonCode = (typeof CLAIM_REASON_CODES)[number];

export const getJourney = (orderId: string) =>
  smsFetch<JourneyResponse>(`/api/customer-account/orders/${orderId}/journey`);

export const postCancelRequest = (orderId: string) =>
  smsFetch<{ ok: boolean; id?: string; error?: string }>(`/api/customer-account/orders/${orderId}/requests`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'cancel' }),
  });

export const postClaimRequest = (
  orderId: string,
  reasonCodes: string[],
  photoKeys: string[],
  description?: string,
) =>
  smsFetch<{ ok: boolean; id?: string; error?: string }>(`/api/customer-account/orders/${orderId}/requests`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'claim', reasonCodes, description, photoKeys }),
  });

export const uploadPhoto = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return smsUpload<{ key: string }>('/api/customer-account/uploads', form);
};

export const postTracking = (requestId: string, carrier: string, tracking: string) =>
  smsFetch<{ ok: boolean; error?: string }>(`/api/customer-account/requests/${requestId}/tracking`, {
    method: 'POST',
    body: JSON.stringify({ carrier, tracking }),
  });
