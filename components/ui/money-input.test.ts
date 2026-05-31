import { describe, expect, test } from 'vitest';
import { sanitizeMoneyRaw, formatMoneyForDisplay } from './money-input';

describe('sanitizeMoneyRaw', () => {
  test('passes clean integers through', () => {
    expect(sanitizeMoneyRaw('1234567', 0)).toBe('1234567');
    expect(sanitizeMoneyRaw('1234567', 2)).toBe('1234567');
  });

  test('strips thousand separators (comma + various spaces)', () => {
    expect(sanitizeMoneyRaw('1,234,567', 2)).toBe('1234567');
    expect(sanitizeMoneyRaw('1 234 567', 2)).toBe('1234567');
    expect(sanitizeMoneyRaw('1 234 567', 2)).toBe('1234567');
  });

  test('rejects non-numeric characters', () => {
    expect(sanitizeMoneyRaw('abc123def', 2)).toBe('123');
    expect(sanitizeMoneyRaw('$1,234.56', 2)).toBe('1234.56');
  });

  test('collapses multiple decimal points to one', () => {
    expect(sanitizeMoneyRaw('1.2.3', 2)).toBe('1.23');
    expect(sanitizeMoneyRaw('1..23', 2)).toBe('1.23');
  });

  test('clamps decimal places', () => {
    expect(sanitizeMoneyRaw('1.23456', 2)).toBe('1.23');
    expect(sanitizeMoneyRaw('1.23456', 4)).toBe('1.2345');
  });

  test('drops decimals entirely when decimals=0 (VND)', () => {
    expect(sanitizeMoneyRaw('1234.56', 0)).toBe('1234');
    expect(sanitizeMoneyRaw('1234.', 0)).toBe('1234');
  });

  test('preserves mid-typing states (trailing dot)', () => {
    expect(sanitizeMoneyRaw('1234.', 2)).toBe('1234.');
  });

  test('empty input → empty output', () => {
    expect(sanitizeMoneyRaw('', 2)).toBe('');
  });
});

describe('formatMoneyForDisplay', () => {
  test('adds thousand separators to integer part', () => {
    expect(formatMoneyForDisplay('1234567')).toBe('1,234,567');
    expect(formatMoneyForDisplay('1000')).toBe('1,000');
  });

  test('leaves the decimal part untouched', () => {
    expect(formatMoneyForDisplay('1234.56')).toBe('1,234.56');
    expect(formatMoneyForDisplay('1234.50')).toBe('1,234.50');  // trailing zero kept
  });

  test('preserves trailing dot mid-typing', () => {
    expect(formatMoneyForDisplay('1234.')).toBe('1,234.');
  });

  test('handles short values without separators', () => {
    expect(formatMoneyForDisplay('5')).toBe('5');
    expect(formatMoneyForDisplay('50')).toBe('50');
    expect(formatMoneyForDisplay('500')).toBe('500');
  });

  test('VND-scale numbers (no decimals)', () => {
    expect(formatMoneyForDisplay('1171000')).toBe('1,171,000');
    expect(formatMoneyForDisplay('24000')).toBe('24,000');
  });

  test('empty → empty', () => {
    expect(formatMoneyForDisplay('')).toBe('');
  });
});
