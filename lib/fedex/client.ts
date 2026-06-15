/**
 * FedEx REST API client — OAuth2 (client_credentials) + token cache, dùng
 * chung cho mọi API FedEx (Rate, Track, Address Validation, Ship).
 *
 * Cấu hình qua env (đặt trên Railway, KHÔNG commit):
 *   FEDEX_CLIENT_ID       — API Key (client_id)
 *   FEDEX_CLIENT_SECRET   — Secret Key (client_secret)
 *   FEDEX_ACCOUNT_NUMBER  — số tài khoản (bắt buộc cho giá hợp đồng + tạo nhãn)
 *   FEDEX_API_BASE        — mặc định https://apis.fedex.com (prod);
 *                           sandbox: https://apis-sandbox.fedex.com
 *
 * Env đọc lazy: chỉ ném lỗi khi THỰC SỰ gọi FedEx, để `next build` và các
 * phần khác của app không phụ thuộc vào việc đã cấu hình FedEx hay chưa.
 */

const DEFAULT_BASE = 'https://apis.fedex.com';

export interface FedexTokenResponse {
  access_token: string;
  /** Thời gian sống token, tính bằng GIÂY (FedEx trả ~3600). */
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface CachedToken {
  token: string;
  /** Mốc hết hạn (epoch ms). */
  expiresAtMs: number;
}

/** Token còn dùng được nếu chưa tới hạn (trừ hao `skewMs` để không xài sát mép). */
export function isTokenFresh(cached: CachedToken | null, nowMs: number, skewMs = 60_000): boolean {
  return cached !== null && cached.expiresAtMs - skewMs > nowMs;
}

/** Quy đổi expires_in (giây) thành mốc epoch ms. */
export function nextExpiry(expiresInSec: number, nowMs: number): number {
  return nowMs + expiresInSec * 1000;
}

/**
 * Quản lý token có cache + dedup request đang bay. Tách deps (fetchToken/now)
 * để unit-test không cần mạng và không phụ thuộc đồng hồ thật.
 */
export function createTokenManager(deps: {
  fetchToken: () => Promise<FedexTokenResponse>;
  now?: () => number;
}): () => Promise<string> {
  const now = deps.now ?? (() => Date.now());
  let cached: CachedToken | null = null;
  let inflight: Promise<string> | null = null;

  return async function getToken(): Promise<string> {
    if (isTokenFresh(cached, now())) return cached!.token;
    if (inflight) return inflight; // gộp các call song song vào 1 lần lấy token
    inflight = (async () => {
      const res = await deps.fetchToken();
      cached = { token: res.access_token, expiresAtMs: nextExpiry(res.expires_in, now()) };
      return cached.token;
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  };
}

interface FedexConfig {
  base: string;
  clientId: string;
  clientSecret: string;
  account: string | undefined;
}

function fedexConfig(): FedexConfig {
  const base = process.env.FEDEX_API_BASE || DEFAULT_BASE;
  const clientId = process.env.FEDEX_CLIENT_ID;
  const clientSecret = process.env.FEDEX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Thiếu FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET — đặt trên Railway env.');
  }
  return { base, clientId, clientSecret, account: process.env.FEDEX_ACCOUNT_NUMBER };
}

async function realFetchToken(): Promise<FedexTokenResponse> {
  const { base, clientId, clientSecret } = fedexConfig();
  const res = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`FedEx OAuth ${res.status}: ${await res.text()}`);
  return (await res.json()) as FedexTokenResponse;
}

const getAccessToken = createTokenManager({ fetchToken: realFetchToken });

/** Số tài khoản FedEx — bắt buộc cho giá negotiated + tạo nhãn. */
export function getFedexAccountNumber(): string {
  const { account } = fedexConfig();
  if (!account) throw new Error('Thiếu FEDEX_ACCOUNT_NUMBER — đặt trên Railway env.');
  return account;
}

/** Gọi 1 endpoint FedEx (đã tự gắn bearer token). `json` để gửi body JSON. */
export async function fedexFetch<T>(
  path: string,
  init: Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit } = {},
): Promise<T> {
  const { base } = fedexConfig();
  const token = await getAccessToken();
  const { json, headers, ...rest } = init;
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_US',
      ...(headers as Record<string, string> | undefined),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`FedEx ${path} ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}
