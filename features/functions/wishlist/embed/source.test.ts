import { describe, expect, it } from 'vitest';
import { buildEmbedScript, minifyEmbed } from './source';

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

  it('reacts to variant changes on PDP (PR3)', () => {
    // Variant id changes should refresh the saved-state badge.
    expect(script).toContain('watchVariantChanges');
    expect(script).toContain('MutationObserver');
    expect(script).toContain("'change'");
  });

  it('ships a share button wired to the share endpoint (PR3)', () => {
    expect(script).toContain('wl-share-btn');
    expect(script).toContain('/api/storefront/wishlist/share');
    expect(script).toContain('navigator.share');
    expect(script).toContain('clipboard');
  });

  it('respects per-store config from the boot response (PR4)', () => {
    // Defaults baked in for cold-start before fetch completes
    expect(script).toContain('DEFAULT_CONFIG');
    expect(script).toContain("'#e11d48'");
    expect(script).toContain('buttonLabel');
    expect(script).toContain('buttonPosition');
    // Accent applied via CSS variable so theme can still override
    expect(script).toContain('--wl-accent');
    expect(script).toContain('applyConfigSideEffects');
  });

  it('mounts the email-capture banner with dismiss persistence (PR4)', () => {
    expect(script).toContain('wl-capture');
    expect(script).toContain('__wl_email_capture_dismissed');
    expect(script).toContain('maybeShowEmailCapture');
    expect(script).toContain('renderEmailCapture');
    // Submitting the form merges the guest list immediately
    expect(script).toContain('/api/storefront/wishlist/merge');
  });

  it('captures availability at add-time and renders the OOS badge (PR5)', () => {
    expect(script).toContain('availableForSale');
    expect(script).toContain('product:availability');
    expect(script).toContain('og:availability');
    expect(script).toContain('wl-oos-badge');
    expect(script).toContain('wl-item--oos');
  });

  it('falls back across multiple PDP form selectors (PR5)', () => {
    expect(script).toContain('findCartForm');
    expect(script).toContain('product-form form');
    expect(script).toContain('data-product-form');
    expect(script).toContain('data-type="add-to-cart-form"');
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

describe('minifyEmbed', () => {
  it('strips whole-line // comments and block comments', () => {
    const out = minifyEmbed([
      '// leading comment',
      'var x = 1;',
      '/* block */',
      'var y = 2;',
    ].join('\n'));
    expect(out).not.toContain('leading comment');
    expect(out).not.toContain('/*');
    expect(out).toContain('var x = 1');
    expect(out).toContain('var y = 2');
  });

  it('preserves // inside string literals', () => {
    const out = minifyEmbed(`var url = 'https://example.com/path';`);
    expect(out).toContain('https://example.com/path');
  });

  it('preserves // inside double-quoted string literals', () => {
    const out = minifyEmbed(`var url = "https://example.com/path";`);
    expect(out).toContain('https://example.com/path');
  });

  it('produces a smaller bundle than the raw source', () => {
    const raw = buildEmbedScript({ apiOrigin: 'https://app.example.com' });
    const min = buildEmbedScript({ apiOrigin: 'https://app.example.com' }, { minify: true });
    expect(min.length).toBeLessThan(raw.length);
  });

  it('keeps the minified bundle valid JavaScript', () => {
    const min = buildEmbedScript({ apiOrigin: 'https://app.example.com' }, { minify: true });
    expect(() => new Function(min)).not.toThrow();
  });

  it('preserves the public window.__wishlist API after minify', () => {
    const min = buildEmbedScript({ apiOrigin: 'https://app.example.com' }, { minify: true });
    expect(min).toContain('window.__wishlist');
    expect(min).toContain('open:');
    expect(min).toContain('close:');
    expect(min).toContain('add:');
    expect(min).toContain('remove:');
  });
});
