/**
 * HMAC SHA-256 verification for the MMP → SMS product webhook.
 *
 * Signing convention (confirmed with the MMP team 2026-06-03):
 *
 *   signature = HMAC_SHA256(secret, `${timestamp}.${rawBody}`)
 *   header    = `X-MEAN-Signature: sha256=<hex>`
 *
 * The timestamp is signed alongside the body so an attacker cannot
 * replay an old request with a fresh `X-MEAN-Timestamp` (would change
 * the signed payload → signature mismatch). Timestamps older than
 * SKEW_TOLERANCE_SECONDS get rejected outright.
 *
 * NEVER call this without first reading the request body as plain text
 * (`await request.text()`). Parsing JSON re-serialises and breaks
 * byte-identical comparison.
 */

import crypto from 'node:crypto';

/** Allowed clock skew between MMP and SMS clocks. 5 min mirrors what
 *  Shopify / Stripe webhooks use. Tightening past 1 min risks dropping
 *  legitimate retries from MMP. */
export const SKEW_TOLERANCE_SECONDS = 300;

const HEX_RE = /^[0-9a-f]+$/i;

export type HmacVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'missing_signature'
        | 'missing_timestamp'
        | 'bad_signature_format'
        | 'timestamp_not_integer'
        | 'timestamp_skew'
        | 'signature_mismatch';
    };

export interface HmacVerifyInput {
  secret: string;
  rawBody: string;
  signatureHeader: string | null | undefined; // X-MEAN-Signature
  timestampHeader: string | null | undefined; // X-MEAN-Timestamp (unix seconds)
  /** Override for tests. Defaults to current epoch seconds. */
  nowSeconds?: number;
}

/**
 * Validate an incoming MMP webhook signature. Pure helper — no I/O.
 *
 * Returns `{ ok: true }` only when:
 *   1. Signature header is present and well-formed (`sha256=<hex>`)
 *   2. Timestamp header is present, an integer
 *   3. Timestamp within `±SKEW_TOLERANCE_SECONDS` of `nowSeconds`
 *   4. Computed HMAC matches the provided signature (timing-safe)
 *
 * Each failure mode is a distinct `reason` so the endpoint can log the
 * actual problem instead of a generic 401.
 */
export function verifyMmpSignature(input: HmacVerifyInput): HmacVerifyResult {
  if (!input.signatureHeader) return { ok: false, reason: 'missing_signature' };
  if (!input.timestampHeader) return { ok: false, reason: 'missing_timestamp' };

  const match = /^sha256=([0-9a-f]+)$/i.exec(input.signatureHeader.trim());
  if (!match || !HEX_RE.test(match[1])) {
    return { ok: false, reason: 'bad_signature_format' };
  }
  const providedHex = match[1].toLowerCase();

  const tsString = input.timestampHeader.trim();
  if (!/^\d+$/.test(tsString)) return { ok: false, reason: 'timestamp_not_integer' };
  const tsSeconds = Number(tsString);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsSeconds) > SKEW_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp_skew' };
  }

  const signedPayload = `${tsString}.${input.rawBody}`;
  const expectedHex = crypto
    .createHmac('sha256', input.secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const providedBuf = Buffer.from(providedHex, 'hex');
  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}

/**
 * Helper for MMP-side code (or our own integration tests) to construct
 * the signature header. Not used by the endpoint itself.
 */
export function signMmpPayload(
  secret: string,
  timestampSeconds: number,
  rawBody: string,
): string {
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`, 'utf8')
    .digest('hex');
  return `sha256=${sig}`;
}

/** Body-only HMAC cho SMS→MMP orders: sha256=<hex> của HMAC_SHA256(secret, rawBody).
 *  KHÁC signMmpPayload (timestamped) — MMP /api/integration/orders verify scheme này. */
export function signMmpBody(secret: string, rawBody: string): string {
  const sig = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${sig}`;
}
