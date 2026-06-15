import { describe, expect, it, vi } from 'vitest';
import {
  isTokenFresh,
  nextExpiry,
  createTokenManager,
  type FedexTokenResponse,
} from './client';

describe('isTokenFresh', () => {
  it('false khi chưa có token', () => {
    expect(isTokenFresh(null, 1_000)).toBe(false);
  });
  it('true khi còn hạn (đã trừ skew)', () => {
    expect(isTokenFresh({ token: 't', expiresAtMs: 200_000 }, 100_000, 60_000)).toBe(true);
  });
  it('false khi vào vùng skew sát hết hạn', () => {
    // expiresAt 150s, now 100s, skew 60s → 150-60=90 < 100 → hết tươi
    expect(isTokenFresh({ token: 't', expiresAtMs: 150_000 }, 100_000, 60_000)).toBe(false);
  });
});

describe('nextExpiry', () => {
  it('cộng expires_in (giây) vào now (ms)', () => {
    expect(nextExpiry(3600, 1_000)).toBe(1_000 + 3_600_000);
  });
});

describe('createTokenManager', () => {
  const tok = (over: Partial<FedexTokenResponse> = {}): FedexTokenResponse => ({
    access_token: 'A', expires_in: 3600, token_type: 'bearer', ...over,
  });

  it('cache token: lần 2 không gọi lại fetch khi còn hạn', async () => {
    const fetchToken = vi.fn(async () => tok());
    let now = 0;
    const getToken = createTokenManager({ fetchToken, now: () => now });
    expect(await getToken()).toBe('A');
    now = 1_000_000; // +1000s, vẫn < 3600s
    expect(await getToken()).toBe('A');
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('lấy token mới sau khi hết hạn', async () => {
    const fetchToken = vi.fn(async () => tok({ access_token: `T${fetchToken.mock.calls.length}` }));
    let now = 0;
    const getToken = createTokenManager({ fetchToken, now: () => now });
    await getToken();
    now = 3_600_001; // qua hạn
    await getToken();
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('dedup: nhiều call song song chỉ fetch token 1 lần', async () => {
    let resolve!: (v: FedexTokenResponse) => void;
    const fetchToken = vi.fn(() => new Promise<FedexTokenResponse>((r) => { resolve = r; }));
    const getToken = createTokenManager({ fetchToken, now: () => 0 });
    const p1 = getToken();
    const p2 = getToken();
    resolve(tok());
    expect(await p1).toBe('A');
    expect(await p2).toBe('A');
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });
});
