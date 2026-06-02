import { describe, expect, it } from 'vitest';
import { buildRecentlyViewedScript, minifyRecentlyViewed } from './source';

describe('buildRecentlyViewedScript', () => {
  const script = buildRecentlyViewedScript({ apiOrigin: 'https://app.example.com' });

  it('bakes the API origin into the bundle', () => {
    expect(script).toContain('"https://app.example.com"');
  });

  it('targets the recently-viewed storefront API path', () => {
    expect(script).toContain('/api/storefront/recently-viewed');
  });

  it('exposes the documented public API surface', () => {
    expect(script).toContain('window.__recentlyViewed');
    expect(script).toContain('list:');
    expect(script).toContain('refresh:');
    expect(script).toContain('clear:');
  });

  it('discovers the shop from window.Shopify.shop', () => {
    expect(script).toContain('window.Shopify');
    expect(script).toContain('Shopify.shop');
  });

  it('auto-logs the current PDP view at boot', () => {
    expect(script).toContain('logCurrentPageView');
    expect(script).toContain('detectProduct');
  });

  it('mounts into every [data-recently-viewed] host', () => {
    expect(script).toContain('data-recently-viewed');
    expect(script).toContain('rv-carousel');
    expect(script).toContain('rv-track');
  });

  it('supports a per-host title via data-title', () => {
    expect(script).toContain('data-title');
  });

  it('hides the product currently on screen from the carousel', () => {
    expect(script).toContain('currentPid');
  });

  it('parses as valid JavaScript', () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it('opens with a leading semicolon to defuse ASI hazards on concatenation', () => {
    expect(script.charAt(0)).toBe(';');
  });
});

describe('minifyRecentlyViewed', () => {
  it('produces a smaller bundle than raw', () => {
    const raw = buildRecentlyViewedScript({ apiOrigin: 'https://app.example.com' });
    const min = buildRecentlyViewedScript({ apiOrigin: 'https://app.example.com' }, { minify: true });
    expect(min.length).toBeLessThan(raw.length);
  });

  it('keeps the minified bundle valid JavaScript', () => {
    const min = buildRecentlyViewedScript({ apiOrigin: 'https://app.example.com' }, { minify: true });
    expect(() => new Function(min)).not.toThrow();
  });

  it('preserves the public window.__recentlyViewed API after minify', () => {
    const min = buildRecentlyViewedScript({ apiOrigin: 'https://app.example.com' }, { minify: true });
    expect(min).toContain('window.__recentlyViewed');
    expect(min).toContain('list:');
    expect(min).toContain('refresh:');
    expect(min).toContain('clear:');
  });

  it('handles trivial input', () => {
    expect(minifyRecentlyViewed('var x = 1;')).toBe('var x = 1;');
  });
});
