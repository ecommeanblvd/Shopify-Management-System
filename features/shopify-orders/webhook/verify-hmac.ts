import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyShopifyHmac(rawBody: string, headerSig: string, secret: string): boolean {
  if (!headerSig) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(headerSig, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
