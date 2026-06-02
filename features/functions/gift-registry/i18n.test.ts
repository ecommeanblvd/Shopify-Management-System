import { describe, expect, test } from 'vitest';
import {
  resolveLocale, getMessages, withLocale, KNOWN_LOCALES,
} from './i18n';

describe('resolveLocale', () => {
  test('returns the locale when it matches a known one', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('vi')).toBe('vi');
  });

  test('is case-insensitive and trim-tolerant', () => {
    expect(resolveLocale(' VI ')).toBe('vi');
    expect(resolveLocale('EN')).toBe('en');
  });

  test('falls back to en for null / empty / unknown', () => {
    expect(resolveLocale(null)).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
    expect(resolveLocale('')).toBe('en');
    expect(resolveLocale('fr')).toBe('en');
    expect(resolveLocale('vi-VN')).toBe('en');
  });
});

describe('getMessages', () => {
  test('returns a complete message bundle for every known locale', () => {
    for (const locale of KNOWN_LOCALES) {
      const m = getMessages(locale);
      expect(m.common.cancel).toBeTruthy();
      expect(m.newPage.title).toBeTruthy();
      expect(m.findPage.title).toBeTruthy();
      expect(m.viewerPage.eyebrow).toBeTruthy();
    }
  });

  test('en and vi bundles have the same shape (no missing keys)', () => {
    const en = getMessages('en');
    const vi = getMessages('vi');
    const enKeys = JSON.stringify(Object.keys(en.newPage).sort());
    const viKeys = JSON.stringify(Object.keys(vi.newPage).sort());
    expect(viKeys).toBe(enKeys);
  });

  test('callback messages format correctly in both locales', () => {
    expect(getMessages('en').findPage.foundHeading(1)).toBe('Found 1 registry:');
    expect(getMessages('en').findPage.foundHeading(3)).toBe('Found 3 registries:');
    expect(getMessages('vi').findPage.foundHeading(3)).toBe('Tìm thấy 3 danh sách:');
  });
});

describe('withLocale', () => {
  test('appends ?lang= when none was present', () => {
    expect(withLocale('/gr/new', 'vi')).toBe('/gr/new?lang=vi');
  });

  test('replaces an existing ?lang=', () => {
    expect(withLocale('/gr/new?lang=en', 'vi')).toBe('/gr/new?lang=vi');
  });

  test('preserves other query params', () => {
    const result = withLocale('/gr/new?shop=mblvd.myshopify.com', 'vi');
    expect(result).toContain('shop=mblvd.myshopify.com');
    expect(result).toContain('lang=vi');
  });
});
