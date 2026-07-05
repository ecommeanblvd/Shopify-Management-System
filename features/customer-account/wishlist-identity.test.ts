import { describe, it, expect } from 'vitest';
import { selectWishlistMatch, type WishlistMatchRow } from './wishlist-identity';

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
