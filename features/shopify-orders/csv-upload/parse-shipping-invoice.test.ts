import { describe, it, expect } from 'vitest';
import { parseShippingInvoiceCsv } from './parse-shipping-invoice';

const headers = 'tracking_number,actual_cost,currency,date';

describe('parseShippingInvoiceCsv', () => {
  it('parses well-formed rows', () => {
    const csv = [headers, '1234567890,12.50,USD,2026-04-15'].join('\n');
    const r = parseShippingInvoiceCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toEqual({
      trackingNumber: '1234567890', actualCost: '12.50', currency: 'USD', date: '2026-04-15',
    });
  });
  it('flags missing tracking_number', () => {
    const csv = [headers, ',12.50,USD,2026-04-15'].join('\n');
    expect(parseShippingInvoiceCsv(csv).errors[0].message).toMatch(/tracking/);
  });
  it('flags non-numeric cost', () => {
    const csv = [headers, '12345,abc,USD,2026-04-15'].join('\n');
    expect(parseShippingInvoiceCsv(csv).errors[0].message).toMatch(/cost/);
  });
});
