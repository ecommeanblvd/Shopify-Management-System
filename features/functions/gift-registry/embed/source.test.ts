import { describe, expect, it } from 'vitest';
import { buildGiftRegistryScript, minifyGiftRegistry } from './source';

describe('buildGiftRegistryScript', () => {
  const script = buildGiftRegistryScript({ apiOrigin: 'https://app.example.com' });

  it('bakes the API origin into the bundle', () => {
    expect(script).toContain('"https://app.example.com"');
  });

  it('targets the gift-registry API endpoints', () => {
    expect(script).toContain('/api/storefront/gift-registry');
    expect(script).toContain('/by-owner');
    expect(script).toContain('/items');
  });

  it('exposes the documented public API surface', () => {
    expect(script).toContain('window.__giftRegistry');
    expect(script).toContain('openPicker:');
    expect(script).toContain('forgetEmail:');
  });

  it('discovers the shop from window.Shopify.shop', () => {
    expect(script).toContain('window.Shopify');
    expect(script).toContain('Shopify.shop');
  });

  it('falls back across 4 PDP form selectors', () => {
    expect(script).toContain('findCartForm');
    expect(script).toContain('product-form form');
    expect(script).toContain('data-product-form');
  });

  it('mounts the PDP button + modal flow', () => {
    expect(script).toContain('gr-pdp-btn');
    expect(script).toContain('gr-modal');
    expect(script).toContain('mountModal');
    expect(script).toContain('showEmailStep');
    expect(script).toContain('showPickStep');
    expect(script).toContain('showCreateStep');
    expect(script).toContain('showAddStep');
  });

  it('remembers the owner email across visits', () => {
    expect(script).toContain('__gr_owner_email');
    expect(script).toContain('localStorage');
  });

  it('parses as valid JavaScript', () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it('opens with a leading semicolon to defuse ASI hazards on concatenation', () => {
    expect(script.charAt(0)).toBe(';');
  });
});

describe('minifyGiftRegistry', () => {
  it('produces a smaller bundle than raw', () => {
    const raw = buildGiftRegistryScript({ apiOrigin: 'https://app.example.com' });
    const min = buildGiftRegistryScript({ apiOrigin: 'https://app.example.com' }, { minify: true });
    expect(min.length).toBeLessThan(raw.length);
  });

  it('keeps the minified bundle valid JavaScript', () => {
    const min = buildGiftRegistryScript({ apiOrigin: 'https://app.example.com' }, { minify: true });
    expect(() => new Function(min)).not.toThrow();
  });

  it('preserves the public window.__giftRegistry API after minify', () => {
    const min = buildGiftRegistryScript({ apiOrigin: 'https://app.example.com' }, { minify: true });
    expect(min).toContain('window.__giftRegistry');
    expect(min).toContain('openPicker:');
    expect(min).toContain('forgetEmail:');
  });
});
