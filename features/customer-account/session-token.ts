/** THUẦN: verify Shopify session token (JWT HS256) cho Customer Account UI Extension.
 *  Ký bằng app client secret; claims: dest (shop), aud (client id), sub (customer GID), exp (5').
 *  Không dep ngoài — node:crypto. */
import crypto from 'node:crypto';

export type TokenPayload = { dest: string; sub?: string; aud?: string | string[]; exp: number; [k: string]: unknown };
export type TokenVerify =
  | { ok: true; payload: TokenPayload; shopDomain: string; customerId: string | null }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'bad_aud' | 'no_dest' };

export function shopDomainFromDest(dest: string): string {
  return dest.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

export function customerIdFromSub(sub: string | undefined): string | null {
  if (!sub) return null;
  const m = /^gid:\/\/shopify\/Customer\/(\d+)$/.exec(sub);
  if (m) return m[1];
  return /^\d+$/.test(sub) ? sub : null;
}

function b64uJson(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export function verifySessionToken(
  token: string,
  secrets: string[],
  opts?: { nowSeconds?: number; allowedClientIds?: string[] },
): TokenVerify {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, sig] = parts;

  let header: { alg?: string }; let payload: TokenPayload;
  try {
    header = b64uJson(h) as { alg?: string };
    payload = b64uJson(p) as TokenPayload;
  } catch { return { ok: false, reason: 'malformed' }; }
  if (header.alg !== 'HS256') return { ok: false, reason: 'malformed' };

  const sigBuf = Buffer.from(sig, 'base64url');
  const matched = secrets.some((s) => {
    const expected = crypto.createHmac('sha256', s).update(`${h}.${p}`).digest();
    return expected.length === sigBuf.length && crypto.timingSafeEqual(expected, sigBuf);
  });
  if (!matched) return { ok: false, reason: 'bad_signature' };

  const now = opts?.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return { ok: false, reason: 'expired' };

  const allowed = opts?.allowedClientIds ?? [];
  if (allowed.length > 0) {
    const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
    if (!auds.some((a) => allowed.includes(a))) return { ok: false, reason: 'bad_aud' };
  }

  if (!payload.dest || typeof payload.dest !== 'string') return { ok: false, reason: 'no_dest' };
  return {
    ok: true, payload,
    shopDomain: shopDomainFromDest(payload.dest),
    customerId: customerIdFromSub(payload.sub),
  };
}
