import { describe, it, expect } from 'vitest';
import { buildPartnerCallbackEnvelope } from './partner-request-envelope';

describe('buildPartnerCallbackEnvelope', () => {
  it('đúng shape { event, brandSlug, ref, occurredAt, data }', () => {
    const e = buildPartnerCallbackEnvelope({ brandSlug: 'kalisa', id: 'req1' }, 'partner.request.approved', 'ok', '2026-07-04T00:00:00.000Z');
    expect(e).toEqual({ event: 'partner.request.approved', brandSlug: 'kalisa', ref: 'req1', occurredAt: '2026-07-04T00:00:00.000Z', data: { note: 'ok' } });
  });
  it('note null vẫn hợp lệ', () => {
    const e = buildPartnerCallbackEnvelope({ brandSlug: 'x', id: 'r' }, 'partner.request.rejected', null, '2026-07-04T00:00:00.000Z');
    expect(e.data).toEqual({ note: null });
  });
});
