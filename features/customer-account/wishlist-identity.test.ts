import { describe, it, expect } from 'vitest';
import { selectWishlistMatch, planResolve, type WishlistMatchRow } from './wishlist-identity';

const CID = 'gid://shopify/Customer/5812012056758';

describe('selectWishlistMatch', () => {
  it('ưu tiên wishlist có email khi cả hai cùng match', () => {
    const rows: WishlistMatchRow[] = [
      { id: 'w-cid', customerEmail: null, shopifyCustomerId: CID },
      { id: 'w-email', customerEmail: 'a@b.com', shopifyCustomerId: null },
    ];
    expect(selectWishlistMatch(rows, 'a@b.com', CID)?.id).toBe('w-email');
  });
  it('match theo email khi có email', () => {
    const rows: WishlistMatchRow[] = [{ id: 'w1', customerEmail: 'a@b.com', shopifyCustomerId: null }];
    expect(selectWishlistMatch(rows, 'a@b.com', CID)?.id).toBe('w1');
  });
  it('degrade: email null → match theo shopifyCustomerId', () => {
    const rows: WishlistMatchRow[] = [{ id: 'w-cid', customerEmail: null, shopifyCustomerId: CID }];
    expect(selectWishlistMatch(rows, null, CID)?.id).toBe('w-cid');
  });
  it('không match → null', () => {
    const rows: WishlistMatchRow[] = [{ id: 'w-other', customerEmail: 'x@y.com', shopifyCustomerId: 'gid://shopify/Customer/999' }];
    expect(selectWishlistMatch(rows, 'a@b.com', CID)).toBeNull();
  });
  it('email không khớp nhưng customerId khớp → match theo customerId', () => {
    const rows: WishlistMatchRow[] = [{ id: 'w-cid', customerEmail: 'other@x.com', shopifyCustomerId: CID }];
    expect(selectWishlistMatch(rows, 'a@b.com', CID)?.id).toBe('w-cid');
  });
});

describe('planResolve', () => {
  const NOW = new Date('2026-07-05T00:00:00.000Z');
  const SCOPES_OK = ['read_products', 'read_customers'];
  const SCOPES_MISSING = ['read_products'];

  it('cache còn trong TTL → use-cache (kể cả email null)', () => {
    const cached = { email: null, resolvedAt: new Date(NOW.getTime() - 1 * 24 * 3600 * 1000) };
    expect(planResolve(cached, SCOPES_OK, NOW)).toEqual({ action: 'use-cache', email: null });

    const cachedWithEmail = { email: 'a@b.com', resolvedAt: new Date(NOW.getTime() - 6 * 24 * 3600 * 1000) };
    expect(planResolve(cachedWithEmail, SCOPES_OK, NOW)).toEqual({ action: 'use-cache', email: 'a@b.com' });
  });

  it('cache quá 7 ngày → query (khi đủ scope)', () => {
    const expired = { email: 'a@b.com', resolvedAt: new Date(NOW.getTime() - 8 * 24 * 3600 * 1000) };
    expect(planResolve(expired, SCOPES_OK, NOW)).toEqual({ action: 'query' });
  });

  it('thiếu scope read_customers → skip-no-scope (kể cả khi có cache hết hạn)', () => {
    expect(planResolve(undefined, SCOPES_MISSING, NOW)).toEqual({ action: 'skip-no-scope' });

    const expired = { email: 'a@b.com', resolvedAt: new Date(NOW.getTime() - 8 * 24 * 3600 * 1000) };
    expect(planResolve(expired, SCOPES_MISSING, NOW)).toEqual({ action: 'skip-no-scope' });
  });

  it('không có cache + đủ scope → query', () => {
    expect(planResolve(undefined, SCOPES_OK, NOW)).toEqual({ action: 'query' });
  });
});
