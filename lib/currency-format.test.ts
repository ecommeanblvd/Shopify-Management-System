import { describe, expect, test } from 'vitest';
import { currencyDecimals } from './currency-format';

describe('currencyDecimals', () => {
  test('zero-decimal currencies return 0', () => {
    expect(currencyDecimals('VND')).toBe(0);
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('KRW')).toBe(0);
  });

  test('two-decimal currencies return 2', () => {
    expect(currencyDecimals('USD')).toBe(2);
    expect(currencyDecimals('EUR')).toBe(2);
    expect(currencyDecimals('GBP')).toBe(2);
    expect(currencyDecimals('SGD')).toBe(2);
  });

  test('case-insensitive', () => {
    expect(currencyDecimals('vnd')).toBe(0);
    expect(currencyDecimals('Vnd')).toBe(0);
  });

  test('null / empty / undefined → 2 (safe default)', () => {
    expect(currencyDecimals(null)).toBe(2);
    expect(currencyDecimals(undefined)).toBe(2);
    expect(currencyDecimals('')).toBe(2);
  });

  test('unknown currencies → 2', () => {
    expect(currencyDecimals('XYZ')).toBe(2);
  });
});
