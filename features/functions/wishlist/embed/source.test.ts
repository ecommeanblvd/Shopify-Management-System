import { describe, expect, it } from 'vitest';
import { buildEmbedScript } from './source';

describe('buildEmbedScript', () => {
  const script = buildEmbedScript({ apiOrigin: 'https://app.example.com' });

  it('bakes the API origin into the bundle', () => {
    expect(script).toContain('"https://app.example.com"');
  });

  it('escapes single quotes correctly via JSON serialisation', () => {
    const exotic = buildEmbedScript({ apiOrigin: "https://app'evil.com" });
    expect(exotic).toContain('"https://app\'evil.com"');
    // Must not produce a syntactically broken bundle:
    expect(() => new Function(exotic)).not.toThrow();
  });

  it('targets the storefront wishlist API path', () => {
    expect(script).toContain('/api/storefront/wishlist');
  });

  it('exposes the documented public API surface on window.__wishlist', () => {
    expect(script).toContain('window.__wishlist');
    expect(script).toContain('open:');
    expect(script).toContain('close:');
    expect(script).toContain('add:');
    expect(script).toContain('remove:');
    expect(script).toContain('reload:');
    expect(script).toContain('state:');
  });

  it('discovers the shop from window.Shopify.shop', () => {
    expect(script).toContain('window.Shopify');
    expect(script).toContain('Shopify.shop');
  });

  it('mounts the auto-features required for PR2 install instructions', () => {
    expect(script).toContain('wl-pdp-btn'); // PDP heart button
    expect(script).toContain('wl-drawer');  // drawer skeleton
    expect(script).toContain('#wishlist-page'); // inline page mount
    expect(script).toContain('data-wishlist-trigger'); // open-drawer hook
  });

  it('calls the merge endpoint exactly once per email per browser', () => {
    expect(script).toContain('/api/storefront/wishlist/merge');
    expect(script).toContain('__wl_merged_to');
  });

  it('parses as valid JavaScript', () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it('opens with a leading semicolon to defuse ASI hazards on concatenation', () => {
    expect(script.charAt(0)).toBe(';');
  });
});
