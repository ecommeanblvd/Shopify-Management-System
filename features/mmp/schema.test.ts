import { describe, it, expect } from 'vitest';
import { mmpEnvelopeSchema, mmpProductSchema } from './schema';

// Real-shape product the MMP team sent in the integration spec.
const VALID_PRODUCT = {
  portalProductId: 'cmpxirbwd001c6p1qvl66h8i7',
  brandSlug: 'denio',
  sku: 'DN0814',
  name: 'Rachel',
  globalName: 'Rachel Draping Bodycon Dress',
  description: 'Đầm form bodycon dáng corset có cúp quả …',
  collection: 'Reflection',
  productType: 'Maxi Dress',
  status: 'live' as const,
  basePrice: 2990000,
  currency: 'VND' as const,
  priceUsd: 270,
  attributes: { fabric: 'Lace', neckline: 'Sweetheart' },
  details: { season: 'Spring-Summer 26' },
  variants: [
    { sku: 'DN0814-XS-CRE', color: 'Cream', size: 'XS', inventory: 0, price: 2990000, lengthCm: 113 },
    { sku: 'DN0814-S-CRE',  color: 'Cream', size: 'S',  inventory: 0, price: 2990000, lengthCm: 114 },
  ],
  images: [
    { url: 'https://cdn.shopify.com/.../0028.jpg', position: 0, role: 'full_body', isThumbnail: true },
  ],
};

describe('mmpProductSchema', () => {
  it('accepts a full real-shape product from MMP', () => {
    const r = mmpProductSchema.safeParse(VALID_PRODUCT);
    expect(r.success).toBe(true);
  });

  it('accepts the minimum viable product (no optional fields)', () => {
    const r = mmpProductSchema.safeParse({
      portalProductId: 'p1', brandSlug: 'denio', sku: 'X', name: 'X',
      status: 'draft', basePrice: 0, currency: 'VND',
      variants: [{ sku: 'X-V1', inventory: 0, price: 0 }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects when REQUIRED field missing', () => {
    for (const drop of ['portalProductId', 'brandSlug', 'sku', 'name', 'status', 'basePrice', 'currency'] as const) {
      const copy = { ...VALID_PRODUCT } as Record<string, unknown>;
      delete copy[drop];
      const r = mmpProductSchema.safeParse(copy);
      expect(r.success, `should reject missing ${drop}`).toBe(false);
    }
  });

  it('rejects currency that is not VND', () => {
    const r = mmpProductSchema.safeParse({ ...VALID_PRODUCT, currency: 'USD' });
    expect(r.success).toBe(false);
  });

  it('rejects negative basePrice', () => {
    const r = mmpProductSchema.safeParse({ ...VALID_PRODUCT, basePrice: -1 });
    expect(r.success).toBe(false);
  });

  it('rejects non-integer VND basePrice (MMP contract says integer)', () => {
    const r = mmpProductSchema.safeParse({ ...VALID_PRODUCT, basePrice: 999.5 });
    expect(r.success).toBe(false);
  });

  it('rejects priceUsd with more than 2 decimals', () => {
    const r = mmpProductSchema.safeParse({ ...VALID_PRODUCT, priceUsd: 24.555 });
    expect(r.success).toBe(false);
  });

  it('rejects status outside the live/draft/archived enum', () => {
    const r = mmpProductSchema.safeParse({ ...VALID_PRODUCT, status: 'paused' });
    expect(r.success).toBe(false);
  });

  it('rejects empty variants array', () => {
    const r = mmpProductSchema.safeParse({ ...VALID_PRODUCT, variants: [] });
    expect(r.success).toBe(false);
  });

  it('rejects duplicate SKUs within one product', () => {
    const r = mmpProductSchema.safeParse({
      ...VALID_PRODUCT,
      variants: [
        { sku: 'DUP', inventory: 0, price: 100 },
        { sku: 'DUP', inventory: 1, price: 100 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed image URL', () => {
    const r = mmpProductSchema.safeParse({
      ...VALID_PRODUCT,
      images: [{ url: 'not-a-url', position: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it('ALLOWS unknown extra fields (passthrough — forward compat)', () => {
    const r = mmpProductSchema.safeParse({
      ...VALID_PRODUCT,
      newFutureField: 'whatever',
      variants: [{ ...VALID_PRODUCT.variants[0], newVariantField: 'x' }],
    });
    expect(r.success).toBe(true);
  });
});

describe('mmpEnvelopeSchema', () => {
  it('accepts a batch envelope { products: [...] }', () => {
    const r = mmpEnvelopeSchema.safeParse({ products: [VALID_PRODUCT] });
    expect(r.success).toBe(true);
  });

  it('rejects empty products array', () => {
    expect(mmpEnvelopeSchema.safeParse({ products: [] }).success).toBe(false);
  });

  it('rejects extra root keys (strict envelope)', () => {
    expect(mmpEnvelopeSchema.safeParse({ products: [VALID_PRODUCT], extra: 1 }).success).toBe(false);
  });

  it('rejects missing products key', () => {
    expect(mmpEnvelopeSchema.safeParse({}).success).toBe(false);
  });
});
