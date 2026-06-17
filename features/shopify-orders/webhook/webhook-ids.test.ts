import { describe, it, expect } from 'vitest';
import { webhookOrderGid, webhookRefundOrderGid } from './webhook-ids';

describe('webhookOrderGid', () => {
  it('ưu tiên admin_graphql_api_id khi là gid hợp lệ', () => {
    expect(webhookOrderGid({ id: 5123, admin_graphql_api_id: 'gid://shopify/Order/5123456789' }))
      .toBe('gid://shopify/Order/5123456789');
  });

  it('dựng gid từ id số khi không có admin_graphql_api_id', () => {
    expect(webhookOrderGid({ id: 5123456789 })).toBe('gid://shopify/Order/5123456789');
    expect(webhookOrderGid({ id: '5123456789' })).toBe('gid://shopify/Order/5123456789');
  });

  it('bỏ qua admin_graphql_api_id rác, fallback về id', () => {
    expect(webhookOrderGid({ id: 42, admin_graphql_api_id: 'not-a-gid' }))
      .toBe('gid://shopify/Order/42');
  });

  it('null khi không có id nào', () => {
    expect(webhookOrderGid({})).toBeNull();
    expect(webhookOrderGid({ id: '' })).toBeNull();
  });
});

describe('webhookRefundOrderGid', () => {
  it('dựng gid đơn cha từ order_id', () => {
    expect(webhookRefundOrderGid({ order_id: 999 })).toBe('gid://shopify/Order/999');
  });
  it('null khi thiếu order_id', () => {
    expect(webhookRefundOrderGid({})).toBeNull();
  });
});
