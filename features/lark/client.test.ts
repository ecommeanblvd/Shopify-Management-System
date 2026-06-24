import { describe, expect, it } from 'vitest';
import { buildOrderNumberSearchBody } from './client';

describe('buildOrderNumberSearchBody', () => {
  it('khớp cả dạng có # và không # (conjunction or)', () => {
    const body = buildOrderNumberSearchBody('#MBLVD28907') as {
      filter: { conjunction: string; conditions: Array<{ field_name: string; operator: string; value: string[] }> };
      page_size: number;
    };
    expect(body.filter.conjunction).toBe('or');
    const vals = body.filter.conditions.flatMap((c) => c.value);
    expect(vals).toContain('MBLVD28907');
    expect(vals).toContain('#MBLVD28907');
    expect(body.filter.conditions.every((c) => c.field_name === 'Order Number' && c.operator === 'is')).toBe(true);
    expect(body.page_size).toBe(500);
  });

  it('đầu vào không # vẫn sinh cả 2 dạng', () => {
    const body = buildOrderNumberSearchBody('TA2209') as {
      filter: { conditions: Array<{ value: string[] }> };
    };
    const vals = body.filter.conditions.flatMap((c) => c.value);
    expect(vals).toContain('TA2209');
    expect(vals).toContain('#TA2209');
  });
});
