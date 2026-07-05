import { describe, expect, it } from 'vitest';
import { ORDER_NODE_FIELDS, ORDER_CUSTOMER_FIELD, orderNodeFields } from './order-fields';

describe('orderNodeFields', () => {
  it('includeCustomer: true → chứa customer { id }', () => {
    const fields = orderNodeFields({ includeCustomer: true });
    expect(fields).toContain(ORDER_CUSTOMER_FIELD);
    expect(fields).toContain(ORDER_NODE_FIELDS);
  });

  it('includeCustomer: false → KHÔNG chứa customer { id }', () => {
    const fields = orderNodeFields({ includeCustomer: false });
    expect(fields).not.toContain('customer {');
    expect(fields).toBe(ORDER_NODE_FIELDS);
  });
});
