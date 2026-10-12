/**
 * OAuth + header dùng chung cho MỌI API của UPS (Tracking, Rating, …).
 *
 * Vì sao tách khỏi `track.ts`: token `client_credentials` sống ~1 giờ và dùng được cho mọi sản
 * phẩm đã bật trên app. Mỗi module tự giữ một bộ nhớ đệm riêng là hai lượt xin token cho cùng
 * một thứ, và khi UPS siết hạn mức thì chỗ hỏng khó truy.
 *
 * Cấu hình qua env (đặt trên Railway, KHÔNG commit):
 *   UPS_CLIENT_ID / UPS_CLIENT_SECRET — app trên developer.ups.com, bật sản phẩm cần dùng.
 *   UPS_API_BASE — mặc định https://onlinetools.ups.com (môi trường thử: https://wwwcie.ups.com).
 */
import { randomUUID } from 'node:crypto';

const DEFAULT_BASE = 'https://onlinetools.ups.com';

export const upsBase = (): string => process.env.UPS_API_BASE || DEFAULT_BASE;

/** Có khai khoá UPS chưa — để chỗ gọi quyết định bỏ qua thay vì ném lỗi. */
export const coKhoaUps = (): boolean => !!process.env.UPS_CLIENT_ID && !!process.env.UPS_CLIENT_SECRET;

let token: { value: string; het: number } | null = null;

/** Xoá token đang giữ — gọi khi UPS trả 401 để lượt sau xin lại. */
export function xoaTokenUps(): void { token = null; }

/** Token Bearer còn hiệu lực (trừ hao 60 giây). Chạm mạng khi hết hạn. */
export async function layTokenUps(): Promise<string> {
  if (token && token.het > Date.now() + 60_000) return token.value;
  const id = process.env.UPS_CLIENT_ID;
  const secret = process.env.UPS_CLIENT_SECRET;
  if (!id || !secret) throw new Error('no_ups_key');
  const res = await fetch(`${upsBase()}/security/v1/oauth/token`, {
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

/** Header UPS đòi ở mọi lượt gọi: Bearer + mã giao dịch để họ truy lại được. */
export function headerUps(bearer: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${bearer}`,
    transId: randomUUID().replace(/-/g, '').slice(0, 32),
    transactionSrc: 'mean-blvd-ops',
    Accept: 'application/json',
    ...extra,
  };
}
