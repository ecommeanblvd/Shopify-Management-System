import { describe, expect, test } from 'vitest';
import {
  DEFAULT_WISHLIST_CONFIG,
  resolveWishlistConfig,
  wishlistConfigSchema,
} from './config';

describe('wishlistConfigSchema', () => {
  test('accepts an empty object', () => {
    expect(wishlistConfigSchema.safeParse({}).success).toBe(true);
  });

  test('accepts a fully populated config', () => {
    expect(wishlistConfigSchema.safeParse({
      accentColor: '#abcdef',
      buttonLabel: { unsaved: 'Save', saved: 'Saved!' },
      buttonPosition: 'prepend',
      emailCapture: { enabled: true, headline: 'Hi', cta: 'Go' },
    }).success).toBe(true);
  });

  test('rejects an invalid hex color', () => {
    const r = wishlistConfigSchema.safeParse({ accentColor: 'red' });
    expect(r.success).toBe(false);
  });

  test('rejects unknown buttonPosition', () => {
    const r = wishlistConfigSchema.safeParse({ buttonPosition: 'middle' });
    expect(r.success).toBe(false);
  });

  test('caps label length to defang abuse', () => {
    const r = wishlistConfigSchema.safeParse({
      buttonLabel: { saved: 'x'.repeat(41) },
    });
    expect(r.success).toBe(false);
  });
});

describe('resolveWishlistConfig', () => {
  test('returns full defaults when given null', () => {
    expect(resolveWishlistConfig(null)).toEqual(DEFAULT_WISHLIST_CONFIG);
  });

  test('returns full defaults when given undefined', () => {
    expect(resolveWishlistConfig(undefined)).toEqual(DEFAULT_WISHLIST_CONFIG);
  });

  test('layers user overrides on top of defaults', () => {
    const resolved = resolveWishlistConfig({ accentColor: '#000000' });
    expect(resolved.accentColor).toBe('#000000');
    expect(resolved.buttonLabel).toEqual(DEFAULT_WISHLIST_CONFIG.buttonLabel);
    expect(resolved.emailCapture).toEqual(DEFAULT_WISHLIST_CONFIG.emailCapture);
  });

  test('layers nested overrides without dropping siblings', () => {
    const resolved = resolveWishlistConfig({
      buttonLabel: { saved: 'In your list' },
    });
    expect(resolved.buttonLabel.saved).toBe('In your list');
    expect(resolved.buttonLabel.unsaved).toBe(
      DEFAULT_WISHLIST_CONFIG.buttonLabel.unsaved,
    );
  });

  test('falls back to defaults when a malformed blob is stored', () => {
    // Should never throw on bad DB data — be permissive at read time.
    const resolved = resolveWishlistConfig({ accentColor: 'not-a-color' });
    expect(resolved.accentColor).toBe(DEFAULT_WISHLIST_CONFIG.accentColor);
  });
});
