import { describe, expect, it } from 'vitest';
import { buildSaveForLaterScript, minifySaveForLater } from './source';

describe('buildSaveForLaterScript', () => {
  const script = buildSaveForLaterScript({ apiOrigin: 'https://app.example.com' });

  it('bakes the API origin into the bundle', () => {
    expect(script).toContain('"https://app.example.com"');
  });

  it('targets the save-for-later storefront API path', () => {
    expect(script).toContain('/api/storefront/save-for-later');
  });

  it('discovers the shop from window.Shopify.shop', () => {
    expect(script).toContain('window.Shopify');
    expect(script).toContain('Shopify.shop');
  });

  it('detects cart pages and probes /cart.js for product metadata', () => {
    expect(script).toContain('isCartPage');
    expect(script).toContain('/cart.js');
    expect(script).toContain('findCartLines');
  });

  it('uses Shopify cart Ajax endpoints to move items back and forth', () => {
    expect(script).toContain('/cart/change.js');
    expect(script).toContain('/cart/add.js');
  });

  it('mounts into [data-save-for-later] hosts AND auto-injects the cart panel', () => {
    expect(script).toContain('data-save-for-later');
    expect(script).toContain('renderCartPanel');
    expect(script).toContain('sfl-cart-panel');
  });

  it('exposes the documented public API surface', () => {
    expect(script).toContain('window.__saveForLater');
    expect(script).toContain('list:');
    expect(script).toContain('refresh:');
    expect(script).toContain('save:');
    expect(script).toContain('removeSaved:');
    expect(script).toContain('restore:');
  });

  it('parses as valid JavaScript', () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it('opens with a leading semicolon to defuse ASI hazards on concatenation', () => {
    expect(script.charAt(0)).toBe(';');
  });
});

describe('minifySaveForLater', () => {
  it('produces a smaller bundle than raw', () => {
    const raw = buildSaveForLaterScript({ apiOrigin: 'https://app.example.com' });
    const min = buildSaveForLaterScript({ apiOrigin: 'https://app.example.com' }, { minify: true });
    expect(min.length).toBeLessThan(raw.length);
  });

  it('keeps the minified bundle valid JavaScript', () => {
    const min = buildSaveForLaterScript({ apiOrigin: 'https://app.example.com' }, { minify: true });
    expect(() => new Function(min)).not.toThrow();
  });

  it('preserves the public window.__saveForLater API after minify', () => {
    const min = buildSaveForLaterScript({ apiOrigin: 'https://app.example.com' }, { minify: true });
    expect(min).toContain('window.__saveForLater');
    expect(min).toContain('list:');
    expect(min).toContain('refresh:');
    expect(min).toContain('save:');
    expect(min).toContain('restore:');
  });
});
