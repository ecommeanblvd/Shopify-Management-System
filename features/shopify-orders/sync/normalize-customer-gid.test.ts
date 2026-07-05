import { describe, expect, it } from 'vitest';
import { normalizeCustomerGid } from './upsert-order';

describe('normalizeCustomerGid', () => {
  it('gid hợp lệ → chuyển về id số dạng string', () => {
    const out = normalizeCustomerGid({ customer: { id: 'gid://shopify/Customer/5812012056758' } });
    expect(out.customer).toEqual({ id: '5812012056758' });
  });

  it('không có customer → giữ nguyên payload', () => {
    const input: { id: string; customer?: { id?: string | null } | null } = { id: 'gid://shopify/Order/1' };
    const out = normalizeCustomerGid(input);
    expect(out).toEqual(input);
  });

  it('customer.id đã là số (string thuần) → giữ nguyên', () => {
    const input = { customer: { id: '5812012056758' } };
    const out = normalizeCustomerGid(input);
    expect(out.customer).toEqual({ id: '5812012056758' });
  });

  it('gid lạ (không khớp pattern Customer) → giữ nguyên', () => {
    const input = { customer: { id: 'gid://shopify/Something/abc' } };
    const out = normalizeCustomerGid(input);
    expect(out.customer).toEqual({ id: 'gid://shopify/Something/abc' });
  });

  it('customer null → giữ nguyên', () => {
    const input = { customer: null };
    const out = normalizeCustomerGid(input);
    expect(out.customer).toBeNull();
  });
});
