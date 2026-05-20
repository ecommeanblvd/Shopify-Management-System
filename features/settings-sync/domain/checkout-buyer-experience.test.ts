import { describe, it, expect } from 'vitest';
import { normalizeBuyerExperience, denormalizeBuyerExperience } from './checkout-buyer-experience';

const shopifyResponse = {
  shop: {
    buyerExperienceConfiguration: {
      checkoutConfiguration: {
        requirePhoneNumber: false,
        marketingConsentDefault: false,
      },
    },
  },
};

describe('normalizeBuyerExperience', () => {
  it('flattens the Shopify buyer-experience shape', () => {
    expect(normalizeBuyerExperience(shopifyResponse)).toEqual({
      requirePhoneNumber: false,
      marketingConsentDefault: false,
    });
  });

  it('returns defaults when the field is absent', () => {
    expect(normalizeBuyerExperience({ shop: {} })).toEqual({
      requirePhoneNumber: false,
      marketingConsentDefault: false,
    });
  });
});

describe('denormalizeBuyerExperience', () => {
  it('emits only the keys that differ between current and effective', () => {
    const input = denormalizeBuyerExperience(
      { requirePhoneNumber: false, marketingConsentDefault: false },
      { requirePhoneNumber: true,  marketingConsentDefault: false },
    );
    expect(input).toEqual({ requirePhoneNumber: true });
  });
});
