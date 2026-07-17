/**
 * Auth cho cổng API external (/api/external/*) — app khác của MEAN pull dữ liệu.
 * Bearer key tĩnh trong env EXTERNAL_API_KEY, so sánh constant-time.
 * Nhận cả 2 dạng header: `Authorization: Bearer <key>` hoặc `x-api-key: <key>`.
 */
import { timingSafeEqual } from 'node:crypto';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** null = hợp lệ; Response = trả thẳng lỗi 401/503. */
export function requireExternalApiKey(req: Request): Response | null {
  const expected = process.env.EXTERNAL_API_KEY;
  if (!expected) {
    return Response.json({ error: 'external api not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const key = bearer ?? req.headers.get('x-api-key') ?? '';
  if (!key || !safeEqual(key, expected)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
