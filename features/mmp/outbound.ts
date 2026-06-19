/**
 * SMS → MMP outbound: POST a brand production request, signed with the same
 * HMAC scheme MMP uses inbound (`${timestamp}.${rawBody}`, header x-mean-signature).
 */
import { signMmpPayload } from '@/features/mmp/hmac';
import { buildBrandRequestPayload } from '@/features/fulfillment/brand-logic';

export interface SendResult {
  ok: boolean;
  externalRef?: string;
  error?: string;
}

export async function sendBrandRequest(
  req: { id: string; brandSlug: string | null; sku: string | null; qty: number },
  orderNumber: string,
): Promise<SendResult> {
  const url = process.env.MMP_OUTBOUND_URL;
  // Ký SMS→MMP bằng MMP_OUTBOUND_SECRET. GIÁ TRỊ của nó phải = secret mà MMP dùng
  // để VERIFY request đến từ SMS (phía MMP đặt tên MEAN_WEBHOOK_SECRET). KHÁC với
  // MMP_WEBHOOK_SECRET (secret chiều MMP→SMS, SMS verify product webhook). Secret
  // theo CHIỀU, khớp theo GIÁ TRỊ — KHÔNG fallback sang secret chiều kia (sẽ 401).
  const secret = process.env.MMP_OUTBOUND_SECRET;
  if (!url || !secret) return { ok: false, error: 'not configured' };
  if (!req.brandSlug) return { ok: false, error: 'no brand' };

  const rawBody = JSON.stringify(buildBrandRequestPayload(req, orderNumber));
  const ts = Math.floor(Date.now() / 1000);
  const signature = signMmpPayload(secret, ts, rawBody);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mean-signature': signature,
        'x-mean-timestamp': String(ts),
      },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { ok: true, externalRef: typeof data?.externalRef === 'string' ? data.externalRef : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch failed' };
  }
}
