import { describe, expect, it } from 'vitest';
import { buildBrandRequestPayload, applyConfirmation, isFollowUpDue } from './brand-logic';

describe('buildBrandRequestPayload', () => {
  it('builds the MMP payload from a request + order number', () => {
    expect(buildBrandRequestPayload({ id: 'r1', brandSlug: 'denio', sku: 'A', qty: 2 }, '#1001')).toEqual({
      requestId: 'r1', orderNumber: '#1001', brandSlug: 'denio', sku: 'A', qty: 2,
    });
  });
});

describe('applyConfirmation', () => {
  it('confirmed -> sets confirm fields + line brand_confirmed', () => {
    expect(applyConfirmation({ status: 'confirmed', expectedDeliveryDate: '2026-07-01', note: 'ok' })).toEqual({
      confirmStatus: 'confirmed', expectedDeliveryDate: '2026-07-01', note: 'ok', lineStatus: 'brand_confirmed',
    });
  });
  it('rejected -> line brand_rejected, no delivery date', () => {
    expect(applyConfirmation({ status: 'rejected', note: 'out of capacity' })).toEqual({
      confirmStatus: 'rejected', expectedDeliveryDate: null, note: 'out of capacity', lineStatus: 'brand_rejected',
    });
  });
});

describe('isFollowUpDue', () => {
  it('confirmed + delivery date <= today is due', () => {
    expect(isFollowUpDue({ confirmStatus: 'confirmed', expectedDeliveryDate: '2026-06-09' }, '2026-06-09')).toBe(true);
  });
  it('confirmed + future date is not due', () => {
    expect(isFollowUpDue({ confirmStatus: 'confirmed', expectedDeliveryDate: '2026-06-20' }, '2026-06-09')).toBe(false);
  });
  it('not confirmed is never due', () => {
    expect(isFollowUpDue({ confirmStatus: 'awaiting', expectedDeliveryDate: null }, '2026-06-09')).toBe(false);
  });
});
