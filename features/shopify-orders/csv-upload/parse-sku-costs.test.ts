import { describe, it, expect } from 'vitest';
import { parseSkuCostsCsv } from './parse-sku-costs';

const headers = 'sku,cost,currency,effective_from';

describe('parseSkuCostsCsv', () => {
  it('parses well-formed rows', () => {
    const csv = [
      headers,
      'MEAN-A,12.50,USD,2026-05-01',
      'CICI-B,520000,VND,2026-05-01',
    ].join('\n');
    const r = parseSkuCostsCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      sku: 'MEAN-A', cost: '12.50', currency: 'USD', effectiveFrom: '2026-05-01',
    });
  });

  it('defaults effective_from to today when blank', () => {
    const csv = [headers, 'MEAN-A,12.50,USD,'].join('\n');
    const r = parseSkuCostsCsv(csv, new Date('2026-05-28T00:00:00Z'));
    expect(r.rows[0].effectiveFrom).toBe('2026-05-28');
  });

  it('flags non-numeric cost as an error', () => {
    const csv = [headers, 'MEAN-A,abc,USD,2026-05-01'].join('\n');
    const r = parseSkuCostsCsv(csv);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ line: 2, message: expect.stringContaining('cost') });
  });

  it('flags non-ISO-3 currency', () => {
    const csv = [headers, 'MEAN-A,12.50,$,2026-05-01'].join('\n');
    const r = parseSkuCostsCsv(csv);
    expect(r.errors[0].message).toMatch(/currency/i);
  });

  it('flags missing required header', () => {
    const csv = ['sku,cost,currency', 'MEAN-A,12.50,USD'].join('\n');
    const r = parseSkuCostsCsv(csv);
    expect(r.errors[0].message).toMatch(/effective_from/);
  });
});
