import { describe, expect, test } from 'vitest';
import { csvEscape, csvRow, csvBody, csvFilename } from './csv';

describe('csvEscape', () => {
  test('returns empty for null/undefined', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  test('passes plain values through', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape(42)).toBe('42');
    expect(csvEscape(true)).toBe('true');
  });

  test('quotes values with commas', () => {
    expect(csvEscape('a, b')).toBe('"a, b"');
  });

  test('quotes values with newlines', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  test('quotes and doubles inner quotes', () => {
    expect(csvEscape('she said "hi"')).toBe('"she said ""hi"""');
  });

  test('quotes leading/trailing whitespace', () => {
    expect(csvEscape(' leading')).toBe('" leading"');
    expect(csvEscape('trailing ')).toBe('"trailing "');
  });

  test('serialises Date as ISO string', () => {
    const d = new Date('2026-06-02T03:00:00Z');
    expect(csvEscape(d)).toBe('2026-06-02T03:00:00.000Z');
  });
});

describe('csvRow', () => {
  test('joins values with commas and escapes per cell', () => {
    expect(csvRow(['a', 'b,c', null, 1])).toBe('a,"b,c",,1');
  });
});

describe('csvBody', () => {
  test('emits header + rows separated by newlines', () => {
    const body = csvBody(
      ['id', 'name', 'qty'],
      [
        ['1', 'Widget', 3],
        ['2', 'Gizmo, deluxe', 1],
      ],
    );
    expect(body).toBe('id,name,qty\n1,Widget,3\n2,"Gizmo, deluxe",1\n');
  });

  test('handles an empty rows iterable but still ships the header', () => {
    expect(csvBody(['a', 'b'], [])).toBe('a,b\n');
  });
});

describe('csvFilename', () => {
  test('strips the .myshopify.com suffix and timestamps', () => {
    const filename = csvFilename('wishlists', 'meanblvd.myshopify.com');
    expect(filename).toMatch(/^wishlists-meanblvd-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test('leaves custom domains alone', () => {
    const filename = csvFilename('saves', 'shop.example.com');
    expect(filename).toMatch(/^saves-shop\.example\.com-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
