import { describe, it, expect } from 'vitest';
import { detectCarrierKey } from './detect-carrier';
import type { ShopifyShippingLine } from '../shopify-types';

function line(title: string | null, code: string | null = null): ShopifyShippingLine {
  return { title, code };
}

describe('detectCarrierKey', () => {
  it('returns null when the shipping-lines list is empty', () => {
    expect(detectCarrierKey([])).toBeNull();
    expect(detectCarrierKey(null)).toBeNull();
    expect(detectCarrierKey(undefined)).toBeNull();
  });

  it('detects FedEx from common operator titles', () => {
    expect(detectCarrierKey([line('FedEx International Priority')])).toBe('fedex');
    expect(detectCarrierKey([line('FEDEX_INTERNATIONAL_ECONOMY')])).toBe('fedex');
    expect(detectCarrierKey([line('Std Express via FedEx')])).toBe('fedex');
  });

  it('detects DHL from common operator titles', () => {
    expect(detectCarrierKey([line('DHL Express Worldwide')])).toBe('dhl');
    expect(detectCarrierKey([line('dhl_express_worldwide')])).toBe('dhl');
    expect(detectCarrierKey([line(null, 'dhl-express')])).toBe('dhl');
  });

  it('reads the code field when title is missing', () => {
    expect(detectCarrierKey([line(null, 'FEDEX_GROUND')])).toBe('fedex');
  });

  it('returns null when nothing matches (operator-typed custom name)', () => {
    expect(detectCarrierKey([line('Standard Shipping')])).toBeNull();
    expect(detectCarrierKey([line('Free shipping over $200')])).toBeNull();
  });

  it('first explicit hit wins across multiple shipping lines', () => {
    // First line is the actual one the customer paid for
    expect(detectCarrierKey([
      line('DHL Express Worldwide'),
      line('FedEx International Priority'),
    ])).toBe('dhl');
  });

  it('skips empty title+code rows defensively', () => {
    expect(detectCarrierKey([
      line('', ''),
      line(null, null),
      line('FedEx International Priority'),
    ])).toBe('fedex');
  });

  it('is case-insensitive', () => {
    expect(detectCarrierKey([line('dhl express')])).toBe('dhl');
    expect(detectCarrierKey([line('FEDEX')])).toBe('fedex');
  });

  it('detects Aramex', () => {
    expect(detectCarrierKey([line('Aramex')])).toBe('aramex');
    expect(detectCarrierKey([line('ARAMEX_EXPRESS', null)])).toBe('aramex');
    expect(detectCarrierKey([line('aramex delivery')])).toBe('aramex');
  });
});
